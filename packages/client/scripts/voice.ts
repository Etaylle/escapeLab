/**
 * Mission control's lines as recordings, made on a Mac:
 *
 *   pnpm --filter @escapelab/client voice            the lines that have no recording yet
 *   pnpm --filter @escapelab/client voice --fresh    every line anew (another voice, say)
 *
 * Every line a shipped mission (missions/*.json) can put on the air: all core's `logRadio`
 * (core/src/actions.ts) is ever handed — `radio.start` as the clock starts, every
 * `puzzles[].onSolved` as its station is solved, `radio.escape` as the hatch unlocks — and
 * every `puzzles[].nudges` line its `nudge` sends while a station stays quiet.
 *
 * Each is read by Piper, a neural voice that runs offline — the model VOICE_MODEL names,
 * de_DE-thorsten-high where it names none (docs/sound.md says why) — through `uv run --with
 * piper-tts` on Python 3.13, so nothing is installed for good: a little slower than radio
 * chatter, a pause at every sentence's end, the words espeak-ng would misread given to Piper
 * the way it reads them right (`piperText`). The model comes once from the Piper voices on
 * Hugging Face into ~/.cache/escapelab-piper/, outside the repo. VOICE_ENGINE=say reads the
 * lines with the Mac's own voice instead (`say`, `sayText`). Either way the line is squeezed
 * to AAC at BITRATE (`afconvert`) into public/voice/<the first 12 hex digits of the line's
 * SHA-1>.m4a and listed in public/voice/manifest.json as { [id]: { text, ms, missions } },
 * with `opens: true` on a line that opens a run (`radio.start`): the radio keys it with the
 * Leitstelle's opening squelch. A recording no line needs any more goes. The files are
 * committed; test/voiceLines.test.ts fails when a line has none.
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

/** Who reads the lines: Piper, or the Mac's own voice. */
export type VoiceEngine = 'piper' | 'say';

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

const HERE = dirname(fileURLToPath(import.meta.url));
/** The shipped missions. */
export const MISSIONS_DIR = resolve(HERE, '../../../missions');
/** Where the recordings and their list go. */
export const VOICE_DIR = resolve(HERE, '../public/voice');
export const MANIFEST_FILE = join(VOICE_DIR, 'manifest.json');

/** What the script reads of a mission: its id and its radio lines. */
export interface MissionLines {
  readonly id: string;
  readonly radio?: { readonly start?: string; readonly escape?: string };
  readonly puzzles: readonly { readonly onSolved?: string; readonly nudges?: readonly string[] }[];
}

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, and
 * whether it opens a run.
 */
export interface Entry {
  text: string;
  ms: number;
  missions: string[];
  opens?: true;
}

/** A line the shipped missions can put on the air: who says it, and whether it opens a run. */
export interface ShippedLine {
  missions: string[];
  opens: boolean;
}

/**
 * Every line `mission` can put on the air, in the order a run hears them: the start, then for
 * each station the nudges it may get while it is up and the line its solve brings, the escape.
 */
export function radioTexts(mission: MissionLines): string[] {
  const lines = [
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
  if (value === 'say') {
    return 'say';
  }
  throw new Error(`voice: VOICE_ENGINE="${value}" — it takes "piper" (the default) or "say"`);
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
 * own („Notstrom" read as „Nots-trom", „Maschinenraum" stressed on its first syllable, „Kabel"
 * short), and Piper's own phonemes in [[ ]] where no spelling helps („Labor" stressed on its
 * first syllable, „Unterlagen" on its third) — „im Labor" whole, or espeak stresses the „im"
 * left on its own before the phonemes. Found by phonemizing every word of every line
 * (docs/sound.md); single letters need nothing: „Pult A" is read „Pult Ah", „Pult B" „Pult Beh".
 */
export const SPOKEN_AS: readonly (readonly [RegExp, string])[] = [
  [/Notstrom/g, 'Not-Strom'],
  [/Notlicht/g, 'Not-Licht'],
  [/Maschinenraum/g, 'Maschinen-Raum'],
  [/Serverraum/g, 'Server-Raum'],
  [/Signalkette/g, 'Signal-Kette'],
  [/Signalprobe/g, 'Signal-Probe'],
  [/Klemmbrett/g, 'Klemm-Brett'],
  [/Ersatzsicherung/g, 'Ersatz-Sicherung'],
  [/Sicherungsplatz/g, 'Sicherungs-Platz'],
  [/Betriebsanleitung/g, 'Betriebs-Anleitung'],
  [/Plattentür/g, 'Platten-Tür'],
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

/** Who reads, and with which Piper voice. */
type Voice = { engine: 'say' } | { engine: 'piper'; model: string };

/** Fails with what to do where a tool the engine needs is not there. */
function requireTools(engine: VoiceEngine): void {
  if (process.platform !== 'darwin') {
    throw new Error('voice: the recordings are converted with macOS tools (afconvert); use a Mac');
  }
  for (const tool of ['afconvert', 'afinfo', engine === 'piper' ? 'uv' : 'say']) {
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

/** Reads `text` into `raw` (a WAV from Piper, an AIFF from `say`). */
function read(text: string, raw: string, voice: Voice): void {
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

/** Reads `text` into `file` (.m4a) and returns how long it speaks, ms. */
function record(text: string, file: string, scratch: string, voice: Voice): number {
  const raw = join(scratch, voice.engine === 'say' ? 'line.aiff' : 'line.wav');
  read(text, raw, voice);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), raw, file]);
  const info = execFileSync('afinfo', [raw], { encoding: 'utf8' });
  const seconds = /estimated duration:\s*([\d.]+)/.exec(info)?.[1];
  if (seconds === undefined) {
    throw new Error(`voice: afinfo gave no duration for "${text}"`);
  }
  return Math.round(Number(seconds) * 1000);
}

/** The manifest as it stands; empty where there is none yet. */
function readManifest(): Record<string, Entry> {
  return existsSync(MANIFEST_FILE)
    ? (JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, Entry>)
    : {};
}

/** The voice VOICE_ENGINE and VOICE_MODEL ask for, its Piper model fetched where needed. */
async function chosenVoice(): Promise<Voice> {
  const engine = engineOf(process.env.VOICE_ENGINE);
  requireTools(engine);
  if (engine === 'say') {
    return { engine };
  }
  const model = process.env.VOICE_MODEL || PIPER_MODEL;
  return { engine, model: await piperModel(model) };
}

/** Makes what is missing (everything with `fresh`), drops what is stale, writes the list. */
async function main(fresh: boolean): Promise<void> {
  const voice = await chosenVoice();
  mkdirSync(VOICE_DIR, { recursive: true });
  const before = readManifest();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-voice-'));
  const manifest: Record<string, Entry> = {};
  let made = 0;
  try {
    const lines = [...shippedLines()].sort(([a], [b]) => (voiceId(a) < voiceId(b) ? -1 : 1));
    for (const [text, { missions, opens }] of lines) {
      const id = voiceId(text);
      const file = join(VOICE_DIR, `${id}.m4a`);
      const kept = before[id];
      const keep = !fresh && kept !== undefined && kept.text === text && existsSync(file);
      const ms = keep ? kept.ms : record(text, file, scratch, voice);
      made += keep ? 0 : 1;
      if (!keep) console.log(`voice: ${id} ${(ms / 1000).toFixed(1)} s „${text}"`);
      const opening = opens ? { opens: true as const } : {};
      manifest[id] = { text, ms, missions: [...missions].sort(), ...opening };
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const stale = readdirSync(VOICE_DIR).filter(
    (name) => name.endsWith('.m4a') && manifest[name.slice(0, -4)] === undefined,
  );
  for (const name of stale) unlinkSync(join(VOICE_DIR, name));
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  const sizeOf = (id: string): number => statSync(join(VOICE_DIR, `${id}.m4a`)).size;
  const bytes = Object.keys(manifest).reduce((sum, id) => sum + sizeOf(id), 0);
  console.log(
    `voice: ${Object.keys(manifest).length} lines (${made} recorded, ${stale.length} dropped), ` +
      `${(bytes / 1024).toFixed(0)} kB in ${VOICE_DIR}`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.includes('--fresh')).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
