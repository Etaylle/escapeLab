/**
 * Mission control's lines as recordings, made on a Mac:
 *
 *   pnpm --filter @escapelab/client voice              the lines that have no recording yet
 *   pnpm --filter @escapelab/client voice --fresh      every synthetic line this voice did not make
 *   pnpm --filter @escapelab/client voice --fresh=all  … and a person's recordings too
 *   pnpm --filter @escapelab/client voice --list-voices            the ElevenLabs account's voices
 *   pnpm --filter @escapelab/client voice --sample <voice> <text>  one line by an ElevenLabs voice
 *
 * Every line a shipped mission (missions/*.json) has mission control say: the intro's
 * announcement over the lab's loudspeakers (`intro.pa`, client world/pa.ts), then all core's
 * `logRadio` (core/src/actions.ts) is ever handed — `radio.start` as the clock starts, every
 * `puzzles[].onSolved` as its station is solved, `radio.escape` as the hatch unlocks — and
 * every `puzzles[].nudges` line its `nudge` sends while a station stays quiet.
 *
 * Each is read by Piper, a neural voice that runs offline — the model VOICE_MODEL names,
 * de_DE-thorsten-high where it names none (docs/sound.md says why) — through `uv run --with
 * piper-tts` on Python 3.13, so nothing is installed for good: a little slower than radio
 * chatter, a pause at every sentence's end, the words espeak-ng would misread given to Piper
 * the way it reads them right (`piperText`). The model comes once from the Piper voices on
 * Hugging Face into ~/.cache/escapelab-piper/, outside the repo. VOICE_ENGINE=say reads the
 * lines with the Mac's own voice instead (`say`, `sayText`); either is squeezed to AAC at
 * BITRATE (`afconvert`) into public/voice/<id>.m4a, the id being the first 12 hex digits of the
 * line's SHA-1. VOICE_ENGINE=elevenlabs has an ElevenLabs voice read them (elevenlabs.ts) into
 * public/voice/<id>.mp3. public/voice/manifest.json lists every line as { [id]: { text, ms,
 * missions, file } }, `file` naming its recording, with `opens: true` on a line that opens a
 * run (`radio.start`): the radio keys it with the Leitstelle's opening squelch.
 *
 * A synthetic recording carries `render`, a hash of what made it — the engine, the voice, its
 * settings and the words as that engine was given them — so --fresh makes anew only what the
 * chosen voice would make differently: a render cut short goes on where it stopped and spends
 * nothing twice. A recording a person made on the client's /record page carries `source`
 * (`human`, `upload`) and stays under --fresh; --fresh=all replaces it too. A recording no line
 * needs any more goes. The files are committed; test/voiceLines.test.ts fails when a line has
 * none, or a file or the folder outgrows MAX_FILE_BYTES or MAX_FOLDER_BYTES.
 *
 * Runs on Node's own TypeScript (type stripping): it imports nothing of the app.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountVoices,
  ELEVEN_GAP_MS,
  ELEVEN_MODEL,
  ELEVEN_VOICE,
  elevenClient,
  loadApiKey,
  oneByOne,
  resolveVoice,
  sampleFile,
  samplesDir,
  speakEleven,
  speechRequest,
  voiceRow,
  type ElevenVoice,
} from './elevenlabs.ts';

/** Who reads the lines: Piper, the Mac's own voice, or an ElevenLabs voice. */
export type VoiceEngine = 'piper' | 'say' | 'elevenlabs';

/** The Piper voice where VOICE_MODEL names none: Thorsten, high quality (docs/sound.md). */
export const PIPER_MODEL = 'de_DE-thorsten-high';
/** Piper, pinned: a build tool that `uv` fetches and runs, never a dependency of the app. */
export const PIPER_PACKAGE = 'piper-tts==1.8.0';
/** The Python `uv` runs Piper on. */
export const PYTHON = '3.13';
/** How long Piper holds each sound against the model's own pace: a little slower than chatter. */
export const LENGTH_SCALE = 1.05;
/** The silence Piper leaves between two sentences of a line, s. */
export const SENTENCE_PAUSE_S = 0.25;
/** Where the Piper models are kept: outside the repo, fetched once. */
export const MODEL_DIR = join(homedir(), '.cache', 'escapelab-piper');
/** The Piper voices on Hugging Face, at the revision the shipped recordings were made from. */
export const VOICES_URL =
  'https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';

/** The Mac's voice for VOICE_ENGINE=say: Anna, its natural German voice. */
export const SAY_VOICE = 'Anna';
/** Words a minute for `say`: brisk, as a radio operator talks. */
export const SAY_RATE = 190;
/** For `say`: a pause where a line has a dash, a middle dot or a colon, ms. */
export const PAUSE_MS = 250;
/** AAC's bit rate, bits a second: a handset's band needs no more. */
export const BITRATE = 48000;
/** The most one recording may take, bytes. */
export const MAX_FILE_BYTES = 150 * 1024;
/** The most the folder may take, bytes: 6 MB, room for every line as ElevenLabs' MP3. */
export const MAX_FOLDER_BYTES = 6 * 1024 * 1024;

const HERE = dirname(fileURLToPath(import.meta.url));
/** The shipped missions. */
export const MISSIONS_DIR = resolve(HERE, '../../../missions');
/** Where the recordings and their list go. */
export const VOICE_DIR = resolve(HERE, '../public/voice');
export const MANIFEST_FILE = join(VOICE_DIR, 'manifest.json');

/** What the script reads of a mission: its id, its intro's announcement and its radio lines. */
export interface MissionLines {
  readonly id: string;
  readonly intro?: { readonly pa?: readonly string[] };
  readonly radio?: { readonly start?: string; readonly escape?: string };
  readonly puzzles: readonly { readonly onSolved?: string; readonly nudges?: readonly string[] }[];
}

/** Who made a recording a person's: spoken on the /record page, or a file put there. */
export type PersonSource = 'human' | 'upload';

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, whether it
 * opens a run, who made it — a person (`source`), or a voice's render (`render`, a hash of what
 * made it) — and its file in the voice folder.
 */
export interface Entry {
  text: string;
  ms: number;
  missions: string[];
  opens?: true;
  source?: PersonSource;
  render?: string;
  file: string;
}

/** A recording, as an entry names it: its file, and a person who made it or a voice's render. */
export interface Take {
  readonly file: string;
  readonly source?: PersonSource | undefined;
  readonly render?: string | undefined;
}

/**
 * Which recordings a run of the script makes anew, beside the lines that have none: none,
 * every synthetic one the chosen voice did not make (`--fresh`: a person's recordings stay),
 * or every one it did not make, a person's too (`--fresh=all`).
 */
export type Fresh = 'none' | 'synthetic' | 'all';

/** A line the shipped missions can put on the air: who says it, and whether it opens a run. */
export interface ShippedLine {
  missions: string[];
  opens: boolean;
}

/**
 * Every line mission control says in `mission`, in the order a run hears them: the intro's
 * announcement over the lab's loudspeakers, line by line (client world/pa.ts), then on the air
 * the start, for each station the nudges it may get while it is up and the line its solve
 * brings, the escape.
 */
export function radioTexts(mission: MissionLines): string[] {
  const lines = [
    ...(mission.intro?.pa ?? []),
    mission.radio?.start,
    ...mission.puzzles.flatMap((puzzle) => [...(puzzle.nudges ?? []), puzzle.onSolved]),
    mission.radio?.escape,
  ];
  return lines.filter((line): line is string => line !== undefined && line.trim() !== '');
}

/** The id of a line's recording: the first 12 hex digits of the SHA-1 of what it says. */
export function voiceId(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** The engine VOICE_ENGINE asks for: Piper where it asks for none. */
export function engineOf(value: string | undefined): VoiceEngine {
  if (value === undefined || value === '' || value === 'piper') {
    return 'piper';
  }
  if (value === 'say' || value === 'elevenlabs') {
    return value;
  }
  throw new Error(
    `voice: VOICE_ENGINE="${value}" — it takes "piper" (the default), "say" or "elevenlabs"`,
  );
}

/** The file an engine records the line `id` into: ElevenLabs' MP3, else AAC in an .m4a. */
export function fileOf(engine: VoiceEngine, id: string): string {
  return `${id}.${engine === 'elevenlabs' ? 'mp3' : 'm4a'}`;
}

/**
 * Where a file of the Piper voice `model` lies among the Piper voices: a voice is named
 * <language>_<REGION>-<name>-<quality>, and lies under <language>/<language>_<REGION>/<name>/
 * <quality>/, its model in .onnx, its settings in .onnx.json.
 */
export function modelUrl(model: string, ext: '.onnx' | '.onnx.json'): string {
  const parts = /^([a-z]{2,3})_([A-Z]{2})-([^-/]+)-([^-/]+)$/.exec(model);
  if (parts === null) {
    throw new Error(
      `voice: VOICE_MODEL="${model}" — a Piper voice is named like ${PIPER_MODEL} ` +
        '(see https://huggingface.co/rhasspy/piper-voices)',
    );
  }
  const [, language, region, name, quality] = parts;
  const code = `${language}_${region}`;
  return `${VOICES_URL}/${language}/${code}/${name}/${quality}/${model}${ext}`;
}

/**
 * A line as `say` reads it: a dash, a middle dot or a colon — not one between two digits, as
 * in a time — becomes a short pause (`say`'s [[slnc]]); everything else stays as it is
 * written: „Pult A" is read as it stands, and numbers are read as numbers.
 */
export function sayText(text: string): string {
  const pause = ` [[slnc ${PAUSE_MS}]] `;
  return text
    .replace(/\s*[·—–]\s*/g, pause)
    .replace(/(?<!\d)\s*:\s*|\s*:\s*(?!\d)/g, pause)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words of the shipped lines that espeak-ng — whose phonemes Piper speaks — gets wrong, and
 * how Piper is given them instead: a compound split where its parts come out right on their
 * own („Notstrom" read as „Nots-trom", „Notzellen" stressed on „zel", „Maschinenraum" stressed
 * on its first syllable, „Südtür" with a short ü, „Westende" as „Wes-tende", „Kabel" short),
 * and Piper's own phonemes in [[ ]] where no spelling helps („Labor" stressed on its first
 * syllable, „Unterlagen" on its third) — „im Labor" whole, or espeak stresses the „im" left on
 * its own before the phonemes. A block never ends a sentence that another follows: Piper runs
 * the next sentence into it, stop and pause lost. Found by phonemizing every word of every
 * line (docs/sound.md); single letters need nothing: „Pult A" is read „Pult Ah", „Pult B"
 * „Pult Beh".
 */
export const SPOKEN_AS: readonly (readonly [RegExp, string])[] = [
  [/Notstrom/g, 'Not-Strom'],
  [/Notlicht/g, 'Not-Licht'],
  [/Notzellen/g, 'Not-Zellen'],
  [/Maschinenraum/g, 'Maschinen-Raum'],
  [/Serverraum/g, 'Server-Raum'],
  [/Signalkette/g, 'Signal-Kette'],
  [/Signalprobe/g, 'Signal-Probe'],
  [/Klemmbrett/g, 'Klemm-Brett'],
  [/Ersatzsicherung/g, 'Ersatz-Sicherung'],
  [/Sicherungsplatz/g, 'Sicherungs-Platz'],
  [/Plattentür/g, 'Platten-Tür'],
  [/Südtür/g, 'Süd-Tür'],
  [/Westtür/g, 'West-Tür'],
  [/Westende/g, 'West-Ende'],
  [/Ostende/g, 'Ost-Ende'],
  [/Speicherkern/g, 'Speicher-Kern'],
  [/Schaltplan/g, 'Schalt-Plan'],
  [/Flurplatte/g, 'Flur-Platte'],
  [/Südwand/g, 'Süd-Wand'],
  [/Nordwand/g, 'Nord-Wand'],
  [/Nordseite/g, 'Nord-Seite'],
  [/Kabel/g, 'Kahbel'],
  [/Kameraplatte/g, '[[kˈaməraplˌatə]]'],
  [/Unterlagen/g, '[[ˈʊntɜlˌɑːɡən]]'],
  [/\bim Labor\b/g, '[[ɪm labˈoːɾ]]'],
  [/[Ll]abor/g, '[[labˈoːɾ]]'],
];

/**
 * A line as Piper reads it: a time („23:47", „23:05 Uhr") said as one („23 Uhr 47", „23 Uhr
 * 5" — espeak-ng reads the colon as „Uhr" and would say a written „Uhr" twice); a dash or a
 * middle dot a pause as long as a semicolon's (espeak-ng drops a middle dot); the words in
 * SPOKEN_AS given as Piper reads them right. Other numbers stay digits, which espeak-ng reads
 * as numbers; a colon and a comma pause on their own, a sentence's end with SENTENCE_PAUSE_S.
 */
export function piperText(text: string): string {
  const time = (_: string, hours: string, minutes: string): string =>
    minutes === '00' ? `${Number(hours)} Uhr` : `${Number(hours)} Uhr ${Number(minutes)}`;
  const timed = text.replace(/\b(\d{1,2}):(\d{2})(?:\s*Uhr\b)?/g, time);
  const paused = timed.replace(/\s*[·—–]\s*/g, '; ');
  const spoken = SPOKEN_AS.reduce((line, [word, said]) => line.replace(word, said), paused);
  return spoken.replace(/\s+/g, ' ').trim();
}

/** The shipped missions, as the script reads them. */
export function shippedMissions(dir = MISSIONS_DIR): MissionLines[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as MissionLines);
}

/** Every shipped line, by what it says: the missions that say it, and whether it opens a run. */
export function shippedLines(missions = shippedMissions()): Map<string, ShippedLine> {
  const lines = new Map<string, ShippedLine>();
  for (const mission of missions) {
    for (const text of radioTexts(mission)) {
      const line = lines.get(text) ?? { missions: [], opens: false };
      if (!line.missions.includes(mission.id)) line.missions.push(mission.id);
      line.opens ||= text === mission.radio?.start;
      lines.set(text, line);
    }
  }
  return lines;
}

/** What the command line asks to be made anew: `--fresh`, `--fresh=all`, or neither. */
export function freshOf(args: readonly string[]): Fresh {
  const asked = args.filter((arg) => arg.startsWith('--fresh'));
  const stray = asked.find((arg) => arg !== '--fresh' && arg !== '--fresh=all');
  if (stray !== undefined) {
    throw new Error(
      `voice: ${stray} — it takes --fresh (every synthetic line anew) or --fresh=all ` +
        "(a person's recordings too)",
    );
  }
  if (asked.includes('--fresh=all')) {
    return 'all';
  }
  return asked.length > 0 ? 'synthetic' : 'none';
}

/**
 * Whether the recording `kept` of the line `text` stays as it is: it says the line and its file
 * is there (`filed`), and either it is what the chosen voice would make again (`render`), or
 * `fresh` does not ask for it anew — a person's recording only --fresh=all makes anew.
 */
export function keeps(
  kept: Entry | undefined,
  text: string,
  filed: boolean,
  fresh: Fresh,
  render: string,
): boolean {
  if (kept === undefined || kept.text !== text || !filed) {
    return false;
  }
  if (kept.render === render) {
    return true;
  }
  return fresh === 'none' || (fresh === 'synthetic' && kept.source !== undefined);
}

/** The manifest's entry for a line and its recording: a person's stays marked as one. */
export function entryOf(text: string, ms: number, line: ShippedLine, take: Take): Entry {
  return {
    text,
    ms,
    missions: [...line.missions].sort(),
    ...(line.opens ? { opens: true as const } : {}),
    ...(take.source === undefined ? {} : { source: take.source }),
    ...(take.render === undefined ? {} : { render: take.render }),
    file: take.file,
  };
}

/** Who reads: Piper with its voice's name and model file, the Mac, or an ElevenLabs voice. */
export type Voice =
  | { readonly engine: 'say' }
  | { readonly engine: 'piper'; readonly name: string; readonly model: string }
  | { readonly engine: 'elevenlabs'; readonly name: string; readonly voice: ElevenVoice };

/** What makes a take, part by part: the engine, the voice and its settings, the words given. */
function madeBy(voice: Voice, text: string): readonly (string | number)[] {
  if (voice.engine === 'piper') {
    return ['piper', voice.name, LENGTH_SCALE, SENTENCE_PAUSE_S, piperText(text)];
  }
  if (voice.engine === 'say') {
    return ['say', SAY_VOICE, SAY_RATE, sayText(text)];
  }
  const request = speechRequest(text, voice.voice.model);
  return ['elevenlabs', voice.voice.voiceId, JSON.stringify(request)];
}

/**
 * The render of `text` by `voice`, as a hash of what makes it (`madeBy`): what that voice would
 * make again, take for take.
 */
export function renderOf(voice: Voice, text: string): string {
  const made = madeBy(voice, text).join('\n');
  return createHash('sha1').update(made, 'utf8').digest('hex').slice(0, 12);
}

/** The tools each engine needs: ElevenLabs only afinfo, to know how long an MP3 speaks. */
const TOOLS: Readonly<Record<VoiceEngine, readonly string[]>> = {
  piper: ['afconvert', 'afinfo', 'uv'],
  say: ['afconvert', 'afinfo', 'say'],
  elevenlabs: ['afinfo'],
};

/** Fails with what to do where a tool the engine needs is not there. */
function requireTools(engine: VoiceEngine): void {
  if (process.platform !== 'darwin') {
    throw new Error('voice: the recordings are measured with macOS tools (afinfo); use a Mac');
  }
  for (const tool of TOOLS[engine]) {
    try {
      execFileSync('/usr/bin/which', [tool], { stdio: 'ignore' });
    } catch {
      throw new Error(
        tool === 'uv'
          ? 'voice: uv is missing — `brew install uv`, or read the lines with the Mac\'s own ' +
              'voice: VOICE_ENGINE=say pnpm --filter @escapelab/client voice --fresh'
          : `voice: ${tool} is missing — it comes with macOS; is this a Mac?`,
      );
    }
  }
}

/** What to run by hand where the Piper voice `model` cannot be fetched from here. */
function fetchByHand(model: string): string {
  const dir = '~/.cache/escapelab-piper';
  return [
    'Fetch it once by hand, then run this again:',
    `  mkdir -p ${dir}`,
    `  curl -L -o ${dir}/${model}.onnx '${modelUrl(model, '.onnx')}'`,
    `  curl -L -o ${dir}/${model}.onnx.json '${modelUrl(model, '.onnx.json')}'`,
    "Or read the lines with the Mac's own voice: " +
      'VOICE_ENGINE=say pnpm --filter @escapelab/client voice --fresh',
  ].join('\n');
}

/** Fetches `url` into `file`, whole or not at all. */
async function download(url: string, file: string, model: string): Promise<void> {
  console.log(`voice: fetching ${url}`);
  const part = `${file}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    writeFileSync(part, Buffer.from(await res.arrayBuffer()));
    renameSync(part, file);
  } catch (error) {
    rmSync(part, { force: true });
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `voice: the Piper voice ${model} could not be fetched (${why}).\n${fetchByHand(model)}`,
    );
  }
}

/** The Piper voice `model` in MODEL_DIR, its model and settings fetched where not there yet. */
async function piperModel(model: string): Promise<string> {
  mkdirSync(MODEL_DIR, { recursive: true });
  for (const ext of ['.onnx.json', '.onnx'] as const) {
    const file = join(MODEL_DIR, `${model}${ext}`);
    if (!existsSync(file) || statSync(file).size === 0) {
      await download(modelUrl(model, ext), file, model);
    }
  }
  return join(MODEL_DIR, `${model}.onnx`);
}

/** Reads `text` into `raw`: a WAV from Piper, an AIFF from `say`. */
function read(text: string, raw: string, voice: Exclude<Voice, { engine: 'elevenlabs' }>): void {
  if (voice.engine === 'say') {
    execFileSync('say', ['-v', SAY_VOICE, '-r', String(SAY_RATE), '-o', raw, sayText(text)]);
    return;
  }
  const uv = ['run', '--quiet', '--no-project', '--python', PYTHON, '--with', PIPER_PACKAGE];
  const piper = ['python', '-m', 'piper', '--model', voice.model, '--output-file', raw];
  const pace = ['--length-scale', `${LENGTH_SCALE}`, '--sentence-silence', `${SENTENCE_PAUSE_S}`];
  execFileSync('uv', [...uv, ...piper, ...pace], {
    input: piperText(text),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/** How long the recording at `path` speaks, ms, as afinfo estimates it. */
function durationOf(path: string, text: string): number {
  const info = execFileSync('afinfo', [path], { encoding: 'utf8' });
  const seconds = /estimated duration:\s*([\d.]+)/.exec(info)?.[1];
  if (seconds === undefined) {
    throw new Error(`voice: afinfo gave no duration for "${text}"`);
  }
  return Math.round(Number(seconds) * 1000);
}

/** Reads `text`, the line `id`, into the voice folder; returns its file and how long it speaks. */
async function record(
  text: string,
  id: string,
  scratch: string,
  voice: Voice,
): Promise<{ file: string; ms: number }> {
  const file = fileOf(voice.engine, id);
  const path = join(VOICE_DIR, file);
  if (voice.engine === 'elevenlabs') {
    writeFileSync(path, await speakEleven(voice.voice, text));
    return { file, ms: durationOf(path, text) };
  }
  const raw = join(scratch, voice.engine === 'say' ? 'line.aiff' : 'line.wav');
  read(text, raw, voice);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), raw, path]);
  return { file, ms: durationOf(raw, text) };
}

/** The manifest as it stands; empty where there is none yet. */
function readManifest(): Record<string, Entry> {
  return existsSync(MANIFEST_FILE)
    ? (JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, Entry>)
    : {};
}

/** Writes the manifest, its entries in the order of their ids. */
function writeManifest(manifest: Readonly<Record<string, Entry>>): void {
  const sorted = Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1));
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`);
}

/** The ElevenLabs voice ELEVENLABS_VOICE names — Helmut where it names none — from the account. */
async function elevenVoice(): Promise<Voice> {
  loadApiKey();
  const client = await elevenClient();
  const wanted = process.env.ELEVENLABS_VOICE || ELEVEN_VOICE;
  const found = resolveVoice(await accountVoices(client), wanted);
  const model = process.env.ELEVENLABS_MODEL || ELEVEN_MODEL;
  const name = `${found.name ?? found.voiceId} (${model})`;
  return { engine: 'elevenlabs', name, voice: { client, voiceId: found.voiceId, model } };
}

/** The voice VOICE_ENGINE and VOICE_MODEL ask for, its Piper model fetched where needed. */
async function chosenVoice(): Promise<Voice> {
  const engine = engineOf(process.env.VOICE_ENGINE);
  requireTools(engine);
  if (engine === 'say') {
    return { engine };
  }
  if (engine === 'elevenlabs') {
    return elevenVoice();
  }
  const name = process.env.VOICE_MODEL || PIPER_MODEL;
  return { engine, name, model: await piperModel(name) };
}

/** A shipped line as a run sees it: its id, the take it has, and the render it would get. */
interface Planned {
  readonly text: string;
  readonly line: ShippedLine;
  readonly id: string;
  readonly kept: Entry | null;
  readonly render: string;
}

/** Every shipped line, in the order of their ids, each with what it keeps of `before`. */
function plan(before: Readonly<Record<string, Entry>>, fresh: Fresh, voice: Voice): Planned[] {
  const lines = [...shippedLines()].sort(([a], [b]) => (voiceId(a) < voiceId(b) ? -1 : 1));
  return lines.map(([text, line]) => {
    const id = voiceId(text);
    const render = renderOf(voice, text);
    const was = before[id];
    const filed = was !== undefined && existsSync(join(VOICE_DIR, was.file));
    const kept = was !== undefined && keeps(was, text, filed, fresh, render) ? was : null;
    return { text, line, id, kept, render };
  });
}

/** The files over MAX_FILE_BYTES, and the folder where it is over MAX_FOLDER_BYTES, as warnings. */
function overLimits(manifest: Readonly<Record<string, Entry>>): string[] {
  const sizes = Object.values(manifest).map((entry) => {
    return [entry.file, statSync(join(VOICE_DIR, entry.file)).size] as const;
  });
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const files = sizes
    .filter(([, size]) => size > MAX_FILE_BYTES)
    .map(([file, size]) => `${file} takes ${(size / 1024).toFixed(0)} kB, over 150 kB`);
  const folder = total > MAX_FOLDER_BYTES ? [`the folder takes ${total} bytes, over 6 MB`] : [];
  return [...files, ...folder];
}

/**
 * Makes what is missing and what `fresh` asks for anew, one line after the other and the list
 * written after each, so that a run cut short keeps what it made; then drops what is stale.
 */
async function main(fresh: Fresh): Promise<void> {
  const voice = await chosenVoice();
  mkdirSync(VOICE_DIR, { recursive: true });
  const before = readManifest();
  const planned = plan(before, fresh, voice);
  const todo = planned.filter((each) => each.kept === null);
  const characters = todo.reduce((sum, each) => sum + each.text.length, 0);
  const who = voice.engine === 'say' ? `say ${SAY_VOICE}` : `${voice.engine} ${voice.name}`;
  console.log(
    `voice: ${todo.length} of ${planned.length} lines to make, ${characters} characters, ${who}`,
  );
  const manifest: Record<string, Entry> = { ...before };
  for (const { text, line, id, kept } of planned) {
    if (kept !== null) manifest[id] = entryOf(text, kept.ms, line, kept);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-voice-'));
  try {
    const jobs = todo.map(({ text, line, id, render }) => async () => {
      const { file, ms } = await record(text, id, scratch, voice);
      manifest[id] = entryOf(text, ms, line, { file, render });
      writeManifest(manifest);
      console.log(`voice: ${id} ${(ms / 1000).toFixed(1)} s „${text}"`);
    });
    await oneByOne(jobs, voice.engine === 'elevenlabs' ? ELEVEN_GAP_MS : 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  finish(Object.fromEntries(planned.map(({ id }) => [id, manifest[id] as Entry])), todo.length);
}

/** Writes the final list, drops every recording it does not name, says what it holds. */
function finish(manifest: Readonly<Record<string, Entry>>, made: number): void {
  writeManifest(manifest);
  const named = new Set(Object.values(manifest).map((entry) => entry.file));
  const stale = readdirSync(VOICE_DIR).filter(
    (name) => /\.(m4a|mp3)$/.test(name) && !named.has(name),
  );
  for (const name of stale) unlinkSync(join(VOICE_DIR, name));
  const persons = Object.values(manifest).filter((entry) => entry.source !== undefined).length;
  const bytes = Object.values(manifest).reduce(
    (sum, entry) => sum + statSync(join(VOICE_DIR, entry.file)).size,
    0,
  );
  console.log(
    `voice: ${Object.keys(manifest).length} lines (${made} made, ${persons} by a person, ` +
      `${stale.length} dropped), ${(bytes / 1024).toFixed(0)} kB in ${VOICE_DIR}`,
  );
  const over = overLimits(manifest);
  for (const warning of over) {
    console.error(`voice: ${warning} — test/voiceLines.test.ts refuses it`);
  }
  if (over.length > 0) process.exitCode = 1;
}

/** --list-voices: the ElevenLabs account's voices, one a line. */
async function listVoices(): Promise<void> {
  loadApiKey();
  for (const voice of await accountVoices(await elevenClient())) {
    console.log(voiceRow(voice));
  }
}

/** --sample <voice> "<text>": one line read by an ElevenLabs voice, into samplesDir(). */
async function sample(wanted: string | undefined, text: string | undefined): Promise<void> {
  if (wanted === undefined || text === undefined || text.trim() === '') {
    throw new Error(
      'voice: --sample takes a voice and a line: --sample <voice id or name> "<text>"',
    );
  }
  loadApiKey();
  const client = await elevenClient();
  const found = resolveVoice(await accountVoices(client), wanted);
  const model = process.env.ELEVENLABS_MODEL || ELEVEN_MODEL;
  const who = `${found.name ?? found.voiceId} (${model})`;
  console.log(`voice: ${text.length} characters, read by ${who}`);
  const dir = samplesDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, sampleFile(wanted));
  writeFileSync(file, await speakEleven({ client, voiceId: found.voiceId, model }, text));
  console.log(`voice: ${file}`);
}

/** What the command line asks for: the account's voices, a sample, or the lines. */
function run(args: readonly string[]): Promise<void> {
  if (args.includes('--list-voices')) {
    return listVoices();
  }
  const at = args.indexOf('--sample');
  if (at >= 0) {
    return sample(args[at + 1], args[at + 2]);
  }
  return main(freshOf(args));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => run(process.argv.slice(2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
