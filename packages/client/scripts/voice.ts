/**
 * The lines heard in a run as recordings, made on a Mac:
 *
 *   pnpm --filter @escapelab/client voice              the lines that have no recording yet
 *   pnpm --filter @escapelab/client voice --fresh      every synthetic line its voice did not make
 *   pnpm --filter @escapelab/client voice --fresh=all  … and a person's recordings too
 *   pnpm --filter @escapelab/client voice --list-voices            the ElevenLabs account's voices
 *   pnpm --filter @escapelab/client voice --sample <voice> <text>  one line by an ElevenLabs voice
 *   pnpm --filter @escapelab/client voice --design-pa              three previews of the plant's
 *   pnpm --filter @escapelab/client voice --keep-pa <id>           voice (Voice Design), one kept
 *
 * Every line a shipped mission (missions/*.json) has heard, as core's `radioLines` lists them:
 * the intro's announcement over the lab's loudspeakers (`intro.pa`, client world/pa.ts), then
 * every line core's `logRadio` (core/src/actions.ts) is ever handed — `radio.start` as the clock
 * starts, every `puzzles[].onSolved` as its station is solved, `radio.escape` as the hatch
 * unlocks, the loudspeakers' `map.sabotage.announce` as an emergency starts, the operator's
 * answers to what a run does (`radio.emergency`, `.alarm`, `.clock`, `.won`, `.lost`) — and
 * every `puzzles[].nudges` line its `nudge` sends while a station stays quiet, and the lobby's
 * Funkprobe (`radio.lobby`) once the crew stands ready; a line written in two or three texts is
 * two or three lines here, a run saying one. Two speakers say them
 * (`Speaker`): the plant's announcement system the loudspeakers' lines, mission control's
 * operator the rest; under ElevenLabs each by a voice of its own, which the manifest keeps
 * (`voices`) — the operator Helmut, the plant a voice made from a description (`PA_VOICE`,
 * --design-pa, --keep-pa) — each holding as its part asks (`SPEAKER_HELD`). The operator says
 * the answers in a mood (`Mood`), which Eleven v3 and v4 are asked for by an audio tag before
 * the words (`MOOD_TAGS`, `spokenText`): the subtitle and the manifest keep the words alone.
 *
 * Each is read by Piper, a neural voice that runs offline — the model VOICE_MODEL names,
 * de_DE-thorsten-high where it names none (docs/sound.md says why) — through `uv run --with
 * piper-tts` on Python 3.13, so nothing is installed for good: a little slower than radio
 * chatter, a pause at every sentence's end, the words espeak-ng would misread given to Piper
 * the way it reads them right (`piperText`). The model comes once from the Piper voices on
 * Hugging Face into ~/.cache/escapelab-piper/, outside the repo. VOICE_ENGINE=say reads the
 * lines with the Mac's own voice instead (`say`, `sayText`); either is squeezed to AAC at
 * BITRATE (`afconvert`) into public/voice/<id>.m4a, the id being the first 12 hex digits of the
 * line's SHA-1. VOICE_ENGINE=elevenlabs has ElevenLabs voices read them (elevenlabs.ts) into
 * public/voice/<id>.mp3. public/voice/manifest.json keeps the speakers' voices as { voices:
 * { [speaker]: { voiceId, name } } } and every line as { lines: { [id]: { text, ms, missions,
 * speaker, mood?, file } } }, `file` naming its recording, with `opens: true` on a line that
 * opens a run (`radio.start`): the radio keys it with the Leitstelle's opening squelch.
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
  ELEVEN_FORMAT,
  ELEVEN_GAP_MS,
  ELEVEN_MODEL,
  ELEVEN_VOICE,
  elevenAsk,
  elevenClient,
  loadApiKey,
  oneByOne,
  OPERATOR_HELD,
  resolveVoice,
  sampleFile,
  samplesDir,
  speakEleven,
  speechRequest,
  voiceRow,
  type DesignClient,
  type ElevenVoice,
  type Held,
  type SpeechClient,
  type VoiceInfo,
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

/**
 * Who says a line, as core's radio.ts `Speaker` has it: the plant's announcement system over the
 * loudspeakers, or mission control's operator on the radio.
 */
export type Speaker = 'pa' | 'operator';

/** The speakers, the operator first: whose voice the script looks up, in that order. */
export const SPEAKERS: readonly Speaker[] = ['operator', 'pa'];

/**
 * How each speaker's ElevenLabs voice holds: the operator as every line was read before; the
 * plant steadier, a building's system that says every line alike.
 */
export const SPEAKER_HELD: Readonly<Record<Speaker, Held>> = {
  operator: OPERATOR_HELD,
  pa: { stability: 0.8, similarityBoost: 0.75 },
};

/**
 * The plant's voice as Voice Design is asked for it (--design-pa): its name on the account, the
 * description it is made from, the model that makes it, and the text its three previews say —
 * a few of the loudspeakers' own lines, 100 to 1,000 characters, which is what a design costs.
 */
export const PA_VOICE = {
  name: 'EscapeLab Durchsage',
  description:
    "Calm, neutral German voice of a research facility's public address system. Mid register, " +
    'even pace, precise diction, slightly synthetic like an automated building announcement, ' +
    'no character, no emotion, no accent. Clean studio recording without background noise.',
  model: 'eleven_ttv_v3',
  text:
    'Durchsage für Trakt C. Es ist 23 Uhr 47, die Nachtschicht hat übernommen. Netzlast im ' +
    'Trakt 96 Prozent, Notstrom in Bereitschaft. Störung im Kühlkreislauf, Relais auf ' +
    'Handbetrieb.',
} as const;

/** A speaker's voice as the manifest keeps it: its id on the account, and its name there. */
export interface SpeakerVoice {
  readonly voiceId: string;
  readonly name: string;
}

/**
 * A line as a mission writes it (core radio.ts `Line`): one text, or two or three, of which a
 * run says one — each its own recording.
 */
export type Line = string | readonly string[];

/** A group of the operator's lines, each under its key: the clock's calls, the end's words. */
type Group = Readonly<Partial<Record<string, Line>>>;

/** What the script reads of a mission's radio: the operator's lines, as core's schema has them. */
export interface RadioLines {
  readonly lobby?: Line;
  readonly start?: Line;
  readonly escape?: Line;
  readonly alarm?: Line;
  readonly clock?: Group;
  readonly emergency?: Group;
  readonly won?: Group;
  readonly lost?: Group;
}

/** What the script reads of a mission: its id, its intro's announcement and its radio lines. */
export interface MissionLines {
  readonly id: string;
  readonly intro?: { readonly pa?: readonly string[] };
  readonly radio?: RadioLines;
  readonly puzzles: readonly { readonly onSolved?: Line; readonly nudges?: readonly Line[] }[];
  readonly map?: { readonly sabotage?: { readonly announce?: Line } };
}

/**
 * How the operator says a line, as core's radio.ts `MOODS` has it by the moment: the first alarm
 * and an emergency missed tense, the clock pressing, an emergency urgent and its clearing
 * relieved, a run won warm, a run lost quiet, the lobby's Funkprobe calm; every other line has
 * none.
 */
export type Mood = 'tense' | 'pressing' | 'urgent' | 'relieved' | 'warm' | 'quiet' | 'calm';

/**
 * The audio tag each mood asks Eleven v3 and v4 for: a short instruction in brackets before the
 * words, never said and never shown — the subtitle and the manifest keep the words alone. One
 * word each, as ElevenLabs' prompting guide asks (one or two; its own examples `[curious]`,
 * `[sad]`, `[whispers]`): „pressing" asks for an insistent voice, „quiet" for a subdued one
 * rather than a softer one. A tag guides the delivery and guarantees none: a take is listened to.
 */
export const MOOD_TAGS: Readonly<Record<Mood, string>> = {
  tense: '[tense]',
  pressing: '[insistent]',
  urgent: '[urgent]',
  relieved: '[relieved]',
  warm: '[warm]',
  quiet: '[subdued]',
  calm: '[calm]',
};

/** Whether `model` reads audio tags (Eleven v3 and v4): an older one would say them aloud. */
export function takesTags(model: string): boolean {
  return /^eleven_v[34]/.test(model);
}

/** The words ElevenLabs is given of a line: its mood's tag before them where `model` reads it. */
export function spokenText(text: string, mood: Mood | null, model: string): string {
  return mood === null || !takesTags(model) ? text : `${MOOD_TAGS[mood]} ${text}`;
}

/**
 * The keys of each group of the operator's answers, in the order core's radio.ts lists them: the
 * clock's calls, a run won by its time left, a run lost by its cause.
 */
const ANSWER_KEYS = {
  clock: ['fiveMinutes', 'twoMinutes', 'lastMinute'],
  won: ['plenty', 'tight', 'lastMinute'],
  lost: ['time', 'alarms', 'abandoned'],
} as const;

/** A line of the operator's answers, and the mood it is said in. */
type Answer = readonly [Line | undefined, Mood];

/**
 * The operator's answers to what a run does, in core's order, each with its mood: an emergency
 * as it starts and as it ends, the first alarm, the clock's calls, the last word on a run won
 * and on one lost.
 */
function answersOf(radio: RadioLines | undefined): Answer[] {
  const group = (name: keyof typeof ANSWER_KEYS, mood: Mood): Answer[] =>
    ANSWER_KEYS[name].map((key) => [radio?.[name]?.[key], mood] as const);
  const emergency = radio?.emergency;
  return [
    [emergency?.['start'], 'urgent'],
    [emergency?.['cleared'], 'relieved'],
    [emergency?.['missed'], 'tense'],
    [radio?.alarm, 'tense'],
    ...group('clock', 'pressing'),
    ...group('won', 'warm'),
    ...group('lost', 'quiet'),
  ];
}

/** Who made a recording a person's: spoken on the /record page, or a file put there. */
export type PersonSource = 'human' | 'upload';

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, who says
 * it and in what mood, whether it opens a run, who made it — a person (`source`), or a voice's
 * render (`render`, a hash of what made it) — and its file in the voice folder.
 */
export interface Entry {
  text: string;
  ms: number;
  missions: string[];
  speaker: Speaker;
  mood?: Mood;
  opens?: true;
  source?: PersonSource;
  render?: string;
  file: string;
}

/** The recordings' list: the speakers' voices, and every recorded line by its id. */
export interface Manifest {
  voices: Partial<Record<Speaker, SpeakerVoice>>;
  lines: Record<string, Entry>;
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

/**
 * A line the shipped missions can put on the air: the missions that say it, who says it, the
 * mood it is said in (null for none), and whether it opens a run.
 */
export interface ShippedLine {
  missions: string[];
  speaker: Speaker;
  mood: Mood | null;
  opens: boolean;
}

/**
 * A line of a mission as the script reads it: what it says, who says it, the mood it is said in
 * (null for none), whether it opens a run.
 */
export interface CatalogLine {
  readonly text: string;
  readonly speaker: Speaker;
  readonly mood: Mood | null;
  readonly opens: boolean;
}

/**
 * Every line heard in `mission`, in the order core's `radioLines` lists them: the intro's
 * announcement over the lab's loudspeakers, line by line (client world/pa.ts), then on the air
 * the start, for each station the nudges it may get while it is up and the line its solve
 * brings, the escape; then the loudspeakers' message as an emergency starts, the operator's
 * answers to what the run does (`answersOf`), and last the lobby's Funkprobe.
 */
export function catalogOf(mission: MissionLines): CatalogLine[] {
  const said =
    (speaker: Speaker, opens = false) =>
    (line: Line | undefined, mood: Mood | null = null): CatalogLine[] =>
      (typeof line === 'string' ? [line] : (line ?? []))
        .filter((text) => text.trim() !== '')
        .map((text) => ({ text, speaker, mood, opens }));
  const { radio, puzzles } = mission;
  const operator = said('operator');
  const stations = puzzles.flatMap((puzzle) => [...(puzzle.nudges ?? []), puzzle.onSolved]);
  return [
    ...(mission.intro?.pa ?? []).flatMap((text) => said('pa')(text)),
    ...said('operator', true)(radio?.start),
    ...stations.flatMap((line) => operator(line)),
    ...operator(radio?.escape),
    ...said('pa')(mission.map?.sabotage?.announce),
    ...answersOf(radio).flatMap(([line, mood]) => operator(line, mood)),
    ...operator(radio?.lobby, 'calm'),
  ];
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

/**
 * Every shipped line, by what it says: the missions that say it, who says it, and whether it
 * opens a run. Fails where two speakers would say the same words: a line has one recording.
 */
export function shippedLines(missions = shippedMissions()): Map<string, ShippedLine> {
  const lines = new Map<string, ShippedLine>();
  for (const mission of missions) {
    for (const { text, speaker, mood, opens } of catalogOf(mission)) {
      const line = lines.get(text) ?? { missions: [], speaker, mood, opens: false };
      if (line.speaker !== speaker || line.mood !== mood) {
        const how = (who: Speaker, as: Mood | null) =>
          as === null ? `the ${who}` : `the ${who} in a ${as} mood`;
        const both = `${how(line.speaker, line.mood)} and ${how(speaker, mood)}`;
        throw new Error(`voice: „${text}" is said by ${both} alike: one line, one recording`);
      }
      if (!line.missions.includes(mission.id)) line.missions.push(mission.id);
      line.opens ||= opens;
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
    speaker: line.speaker,
    ...(line.mood === null ? {} : { mood: line.mood }),
    ...(line.opens ? { opens: true as const } : {}),
    ...(take.source === undefined ? {} : { source: take.source }),
    ...(take.render === undefined ? {} : { render: take.render }),
    file: take.file,
  };
}

/**
 * Who reads: Piper with its voice's name and model file, or the Mac — either for both speakers
 * — or ElevenLabs with a voice for each speaker the manifest names one for.
 */
export type Voice =
  | { readonly engine: 'say' }
  | { readonly engine: 'piper'; readonly name: string; readonly model: string }
  | {
      readonly engine: 'elevenlabs';
      readonly name: string;
      readonly speakers: Readonly<Partial<Record<Speaker, ElevenVoice>>>;
    };

/** A line as a voice is asked to read it: its words, and who says them. */
export interface Said {
  readonly text: string;
  readonly speaker: Speaker;
  /** how the operator says it, asked for by an audio tag (`spokenText`); null for none */
  readonly mood: Mood | null;
}

/**
 * What makes a take, part by part: the engine, the voice and its settings, the words given — for
 * ElevenLabs the speaker's voice, or, where the manifest names none for it yet, the speaker
 * alone, which no take was ever made by.
 */
function madeBy(voice: Voice, { text, speaker, mood }: Said): readonly (string | number)[] {
  if (voice.engine === 'piper') {
    return ['piper', voice.name, LENGTH_SCALE, SENTENCE_PAUSE_S, piperText(text)];
  }
  if (voice.engine === 'say') {
    return ['say', SAY_VOICE, SAY_RATE, sayText(text)];
  }
  const eleven = voice.speakers[speaker];
  if (eleven === undefined) {
    return ['elevenlabs', `no voice for the ${speaker} yet`];
  }
  const request = speechRequest(spokenText(text, mood, eleven.model), eleven.model, eleven.held);
  return ['elevenlabs', eleven.voiceId, JSON.stringify(request)];
}

/**
 * The render of a line by `voice`, as a hash of what makes it (`madeBy`): what that voice would
 * make again, take for take.
 */
export function renderOf(voice: Voice, said: Said): string {
  const made = madeBy(voice, said).join('\n');
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

/**
 * What to run where the line of a `speaker` is to be made and the manifest names no voice for
 * it: only the plant's can be missing, the operator's is Helmut where none is named.
 */
function voiceless(speaker: Speaker): string {
  return (
    `voice: the ${speaker === 'pa' ? "plant's loudspeakers have" : `${speaker} has`} no voice ` +
    'yet — make one, listen to its three previews and keep one, in packages/client:\n' +
    '  node --env-file=<repo>/.env.local scripts/voice.ts --design-pa\n' +
    '  node --env-file=<repo>/.env.local scripts/voice.ts --keep-pa <the id of the one kept>'
  );
}

/**
 * The MP3 ElevenLabs makes of `said` by its speaker's voice among `speakers`: the words with
 * its mood's tag before them where the model reads tags (`spokenText`), the take `renderOf`
 * names. Fails where the speaker has no voice yet.
 */
export async function elevenTake(
  speakers: Readonly<Partial<Record<Speaker, ElevenVoice>>>,
  { text, speaker, mood }: Said,
): Promise<Buffer> {
  const eleven = speakers[speaker];
  if (eleven === undefined) {
    throw new Error(voiceless(speaker));
  }
  return speakEleven(eleven, spokenText(text, mood, eleven.model));
}

/** Reads the line `said`, its recording `id`, into the voice folder: its file and how long. */
async function record(
  said: Said,
  id: string,
  scratch: string,
  voice: Voice,
): Promise<{ file: string; ms: number }> {
  const { text } = said;
  const file = fileOf(voice.engine, id);
  const path = join(VOICE_DIR, file);
  if (voice.engine === 'elevenlabs') {
    writeFileSync(path, await elevenTake(voice.speakers, said));
    return { file, ms: durationOf(path, text) };
  }
  const raw = join(scratch, voice.engine === 'say' ? 'line.aiff' : 'line.wav');
  read(text, raw, voice);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), raw, path]);
  return { file, ms: durationOf(raw, text) };
}

/** The manifest at `file` as it stands; empty where there is none yet. */
export function readManifest(file = MANIFEST_FILE): Manifest {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest)
    : { voices: {}, lines: {} };
}

/** Writes `manifest` to `file`: the speakers' voices, the operator first, then its lines by id. */
export function writeManifest(manifest: Manifest, file = MANIFEST_FILE): void {
  const voices = SPEAKERS.flatMap((speaker) => {
    const voice = manifest.voices[speaker];
    return voice === undefined ? [] : [[speaker, voice] as const];
  });
  const lines = Object.entries(manifest.lines).sort(([a], [b]) => (a < b ? -1 : 1));
  const sorted = { voices: Object.fromEntries(voices), lines: Object.fromEntries(lines) };
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Each speaker's ElevenLabs voice as the manifest names it, found among the account's
 * `voices` — Helmut for the operator where it names none, nothing for the plant until
 * --keep-pa has named one — reading by `model`, holding as SPEAKER_HELD says.
 */
function speakersOf(
  manifest: Manifest,
  voices: readonly VoiceInfo[],
  client: SpeechClient,
  model: string,
): Partial<Record<Speaker, ElevenVoice>> {
  const named: Readonly<Record<Speaker, string | undefined>> = {
    operator: manifest.voices.operator?.voiceId ?? ELEVEN_VOICE,
    pa: manifest.voices.pa?.voiceId,
  };
  return Object.fromEntries(
    SPEAKERS.flatMap((speaker) => {
      const id = named[speaker];
      if (id === undefined) return [];
      const { voiceId } = resolveVoice(voices, id);
      return [[speaker, { client, voiceId, model, held: SPEAKER_HELD[speaker] }] as const];
    }),
  );
}

/** The ElevenLabs voices of the speakers, from the account, by the model ELEVENLABS_MODEL names. */
async function elevenVoice(manifest: Manifest): Promise<Voice> {
  loadApiKey();
  const client = await elevenClient();
  const voices = await accountVoices(client);
  const model = process.env.ELEVENLABS_MODEL || ELEVEN_MODEL;
  const speakers = speakersOf(manifest, voices, client, model);
  const nameOf = (speaker: Speaker): string => {
    const id = speakers[speaker]?.voiceId;
    const name = voices.find((voice) => voice.voiceId === id)?.name ?? id;
    return `${speaker} ${name ?? 'none yet'}`;
  };
  return { engine: 'elevenlabs', name: `${SPEAKERS.map(nameOf).join(', ')} (${model})`, speakers };
}

/**
 * The voice VOICE_ENGINE and VOICE_MODEL ask for, its Piper model fetched where needed; under
 * ElevenLabs the voices `manifest` names for the speakers.
 */
async function chosenVoice(manifest: Manifest): Promise<Voice> {
  const engine = engineOf(process.env.VOICE_ENGINE);
  requireTools(engine);
  if (engine === 'say') {
    return { engine };
  }
  if (engine === 'elevenlabs') {
    return elevenVoice(manifest);
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
function plan(before: Manifest, fresh: Fresh, voice: Voice): Planned[] {
  const lines = [...shippedLines()].sort(([a], [b]) => (voiceId(a) < voiceId(b) ? -1 : 1));
  return lines.map(([text, line]) => {
    const id = voiceId(text);
    const render = renderOf(voice, { text, speaker: line.speaker, mood: line.mood });
    const was = before.lines[id];
    const filed = was !== undefined && existsSync(join(VOICE_DIR, was.file));
    const kept = was !== undefined && keeps(was, text, filed, fresh, render) ? was : null;
    return { text, line, id, kept, render };
  });
}

/** Fails, before anything is asked of anybody, where a line to be made has no voice to read it. */
function refuseVoiceless(voice: Voice, todo: readonly Planned[]): void {
  if (voice.engine !== 'elevenlabs') return;
  const speaker = todo.map(({ line }) => line.speaker).find((each) => !voice.speakers[each]);
  if (speaker !== undefined) {
    throw new Error(voiceless(speaker));
  }
}

/** The files over MAX_FILE_BYTES, and the folder where it is over MAX_FOLDER_BYTES, as warnings. */
function overLimits(lines: Readonly<Record<string, Entry>>): string[] {
  const sizes = Object.values(lines).map((entry) => {
    return [entry.file, statSync(join(VOICE_DIR, entry.file)).size] as const;
  });
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const files = sizes
    .filter(([, size]) => size > MAX_FILE_BYTES)
    .map(([file, size]) => `${file} takes ${(size / 1024).toFixed(0)} kB, over 150 kB`);
  const megabytes = MAX_FOLDER_BYTES / 1024 / 1024;
  const folder =
    total > MAX_FOLDER_BYTES ? [`the folder takes ${total} bytes, over ${megabytes} MB`] : [];
  return [...files, ...folder];
}

/**
 * Makes what is missing and what `fresh` asks for anew, one line after the other and the list
 * written after each, so that a run cut short keeps what it made; then drops what is stale.
 */
async function main(fresh: Fresh): Promise<void> {
  const before = readManifest();
  const voice = await chosenVoice(before);
  mkdirSync(VOICE_DIR, { recursive: true });
  const planned = plan(before, fresh, voice);
  const todo = planned.filter((each) => each.kept === null);
  refuseVoiceless(voice, todo);
  const characters = todo.reduce((sum, each) => sum + each.text.length, 0);
  const who = voice.engine === 'say' ? `say ${SAY_VOICE}` : `${voice.engine} ${voice.name}`;
  console.log(
    `voice: ${todo.length} of ${planned.length} lines to make, ${characters} characters, ${who}`,
  );
  const manifest: Manifest = { voices: { ...before.voices }, lines: { ...before.lines } };
  for (const { text, line, id, kept } of planned) {
    if (kept !== null) manifest.lines[id] = entryOf(text, kept.ms, line, kept);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-voice-'));
  try {
    const jobs = todo.map(({ text, line, id, render }) => async () => {
      const said = { text, speaker: line.speaker, mood: line.mood };
      const { file, ms } = await record(said, id, scratch, voice);
      manifest.lines[id] = entryOf(text, ms, line, { file, render });
      writeManifest(manifest);
      console.log(`voice: ${id} ${(ms / 1000).toFixed(1)} s „${text}"`);
    });
    await oneByOne(jobs, voice.engine === 'elevenlabs' ? ELEVEN_GAP_MS : 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const lines = Object.fromEntries(planned.map(({ id }) => [id, manifest.lines[id] as Entry]));
  finish({ voices: manifest.voices, lines }, todo.length);
}

/** Writes the final list, drops every recording it does not name, says what it holds. */
function finish(manifest: Manifest, made: number): void {
  writeManifest(manifest);
  const entries = Object.values(manifest.lines);
  const named = new Set(entries.map((entry) => entry.file));
  const stale = readdirSync(VOICE_DIR).filter(
    (name) => /\.(m4a|mp3)$/.test(name) && !named.has(name),
  );
  for (const name of stale) unlinkSync(join(VOICE_DIR, name));
  const persons = entries.filter((entry) => entry.source !== undefined).length;
  const bytes = entries.reduce((sum, entry) => sum + statSync(join(VOICE_DIR, entry.file)).size, 0);
  console.log(
    `voice: ${entries.length} lines (${made} made, ${persons} by a person, ` +
      `${stale.length} dropped), ${(bytes / 1024).toFixed(0)} kB in ${VOICE_DIR}`,
  );
  const over = overLimits(manifest.lines);
  for (const warning of over) {
    console.error(`voice: ${warning} — test/voiceLines.test.ts refuses it`);
  }
  if (over.length > 0) process.exitCode = 1;
}

/** A preview of the plant's voice as Voice Design made it: its number, file, length and id. */
export interface Preview {
  readonly n: number;
  readonly file: string;
  readonly seconds: number;
  readonly generatedVoiceId: string;
}

/**
 * Asks Voice Design for the plant's voice from its description (PA_VOICE): its three previews,
 * each saying PA_VOICE.text, into `dir` as pa-1.mp3, pa-2.mp3, pa-3.mp3. The request costs the
 * text's characters, once for all three; a refusal fails saying what ElevenLabs said.
 */
export async function designPa(client: DesignClient, dir: string): Promise<Preview[]> {
  const asking = { tag: 'voice', what: 'design the plant’s voice' };
  const answer = await elevenAsk(
    () =>
      client.textToVoice.design({
        voiceDescription: PA_VOICE.description,
        modelId: PA_VOICE.model,
        text: PA_VOICE.text,
        outputFormat: ELEVEN_FORMAT,
      }),
    asking,
  );
  mkdirSync(dir, { recursive: true });
  return answer.previews.map((preview, i) => {
    const file = join(dir, `pa-${i + 1}.mp3`);
    writeFileSync(file, Buffer.from(preview.audioBase64, 'base64'));
    const { generatedVoiceId, durationSecs: seconds } = preview;
    return { n: i + 1, file, seconds, generatedVoiceId };
  });
}

/**
 * Makes the preview `generatedVoiceId` of --design-pa the account's voice for the plant, named
 * and described as PA_VOICE has it, and keeps it in the manifest at `file` as the plant's —
 * which costs no credits, but takes one of the account's voice slots. Refuses an id no preview
 * could have, before anything is asked.
 */
export async function keepPa(
  client: DesignClient,
  generatedVoiceId: string,
  file = MANIFEST_FILE,
): Promise<SpeakerVoice> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(generatedVoiceId)) {
    throw new Error(
      `voice: --keep-pa takes the id --design-pa printed beside the preview kept, ` +
        `not "${generatedVoiceId}"`,
    );
  }
  const asking = { tag: 'voice', what: `keep the preview ${generatedVoiceId} as the plant's voice` };
  const made = await elevenAsk(
    () =>
      client.textToVoice.create({
        voiceName: PA_VOICE.name,
        voiceDescription: PA_VOICE.description,
        generatedVoiceId,
      }),
    asking,
  );
  const kept = { voiceId: made.voiceId, name: made.name ?? PA_VOICE.name };
  const manifest = readManifest(file);
  writeManifest({ ...manifest, voices: { ...manifest.voices, pa: kept } }, file);
  return kept;
}

/** --design-pa: the plant's three previews made, each said with its id, and how to keep one. */
async function design(): Promise<void> {
  loadApiKey();
  console.log(`voice: Voice Design, ${PA_VOICE.text.length} characters, „${PA_VOICE.name}"`);
  const previews = await designPa(await elevenClient(), samplesDir());
  for (const { n, file, seconds, generatedVoiceId } of previews) {
    console.log(`voice: ${n}  ${file}  ${seconds.toFixed(1)} s  ${generatedVoiceId}`);
  }
  console.log('voice: listen, then keep one: scripts/voice.ts --keep-pa <the id beside it>');
}

/** --keep-pa <id>: that preview kept as the plant's voice. */
async function keep(generatedVoiceId: string | undefined): Promise<void> {
  if (generatedVoiceId === undefined) {
    throw new Error('voice: --keep-pa takes the id --design-pa printed beside the preview kept');
  }
  loadApiKey();
  const kept = await keepPa(await elevenClient(), generatedVoiceId);
  console.log(`voice: the plant speaks with „${kept.name}" (${kept.voiceId}), kept in the manifest`);
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
  const voice = { client, voiceId: found.voiceId, model, held: OPERATOR_HELD };
  writeFileSync(file, await speakEleven(voice, text));
  console.log(`voice: ${file}`);
}

/** What the command line asks for, by its first switch that names something else than the lines. */
const COMMANDS: Readonly<Record<string, (args: readonly string[], at: number) => Promise<void>>> = {
  '--list-voices': () => listVoices(),
  '--sample': (args, at) => sample(args[at + 1], args[at + 2]),
  '--design-pa': () => design(),
  '--keep-pa': (args, at) => keep(args[at + 1]),
};

/**
 * What the command line asks for: the account's voices, a sample, the plant's voice designed
 * or one of its previews kept — or the lines.
 */
function run(args: readonly string[]): Promise<void> {
  const at = args.findIndex((arg) => COMMANDS[arg] !== undefined);
  const command = COMMANDS[args[at] ?? ''];
  return command === undefined ? main(freshOf(args)) : command(args, at);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => run(process.argv.slice(2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
