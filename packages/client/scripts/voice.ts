/**
 * The lines heard in a run as recordings, made on a Mac, each by the person of the radio's cast
 * who says it:
 *
 *   pnpm --filter @escapelab/client voice              the lines that have no recording yet
 *   pnpm --filter @escapelab/client voice --fresh      every synthetic line its voice did not make
 *   pnpm --filter @escapelab/client voice --fresh=all  … and a person's recordings too
 *   pnpm --filter @escapelab/client voice --list-voices            the ElevenLabs account's voices
 *   pnpm --filter @escapelab/client voice --sample <voice> <text>  one line by an ElevenLabs voice
 *   pnpm --filter @escapelab/client voice --design <slot>   three Voice-Design samples of a person
 *   pnpm --filter @escapelab/client voice --keep <slot>=<n> one of them kept as the person's voice
 *
 * Every line a shipped mission (missions/*.json) has heard, as core's `radioLines` lists them:
 * the intro's announcement over the lab's loudspeakers (`intro.pa`, client world/pa.ts), then
 * every line core's `logRadio` (core/src/actions.ts) is ever handed — `radio.start` as the clock
 * starts, every `puzzles[].onSolved` as its station is solved, `radio.escape` as the hatch
 * unlocks, the loudspeakers' `map.sabotage.announce` as an emergency starts, the answers to what
 * a run does (`radio.emergency`, `.alarm`, `.clock`, `.won`, `.lost`) — and every
 * `puzzles[].nudges` line its `nudge` sends while a station stays quiet, and the lobby's
 * Funkprobe (`radio.lobby`) once the crew stands ready; a line written in two or three texts is
 * two or three lines here, a run saying one. A role says each (`Role`, `roleOf`, as core's
 * radio.ts has them): the plant's loudspeakers, the Leitstelle on duty, the Schichtleitung; and
 * each person of the role in service (core cast.ts `inService`, the roster in core/src/cast.json)
 * has a recording of it of their own, so that whoever is on duty a night is heard. Under
 * ElevenLabs each person reads with the voice the roster keeps for them, made from its prompt
 * with Voice Design (--design, --keep) — Helmut with the library voice his lines were made with —
 * held as the role asks (`ROLE_HELD`). A line says its moment's mood by an audio tag before the
 * words (`MOOD_TAGS`), and may carry tags of its own in the mission's text, which the render
 * hears and nothing shows (`shownText`); the subtitle and the manifest keep the words alone.
 *
 * Each is read by Piper, a neural voice that runs offline — the model VOICE_MODEL names,
 * de_DE-thorsten-high where it names none (docs/sound.md says why) — through `uv run --with
 * piper-tts` on Python 3.13, so nothing is installed for good: a little slower than radio
 * chatter, a pause at every sentence's end, the words espeak-ng would misread given to Piper
 * the way it reads them right (`piperText`). The model comes once from the Piper voices on
 * Hugging Face into ~/.cache/escapelab-piper/, outside the repo. VOICE_ENGINE=say reads the
 * lines with the Mac's own voice instead (`say`, `sayText`); either is squeezed to AAC at
 * BITRATE (`afconvert`) into public/voice/<id>.m4a, the id being the person's and the first 12
 * hex digits of the line's SHA-1 (`lineId`). VOICE_ENGINE=elevenlabs has the cast's ElevenLabs
 * voices read them (elevenlabs.ts) into public/voice/<id>.mp3, only the persons whose voice is
 * kept. public/voice/manifest.json keeps every line as { lines: { [id]: { text, ms, missions,
 * role, person, moment, mood?, opens?, source?, render?, model?, file } } }, `file` naming its
 * recording and `model` what read it, with `opens: true` on a line that opens a run
 * (`radio.start`): the radio keys it with the Leitstelle's opening squelch.
 *
 * A synthetic recording carries `render`, a hash of what made it — the engine, the voice, its
 * settings and the words as that engine was given them, and under ElevenLabs a paid plan where
 * the account holds one (`Plan`) — so --fresh makes anew only what the chosen voice would make
 * differently: a render cut short goes on where it stopped and spends nothing twice, and on a
 * paid plan --fresh makes anew the takes made before without it. A recording a person made on
 * the client's /record page carries `source` (`human`, `upload`) and stays under --fresh;
 * --fresh=all replaces it too. A recording no line needs any more goes. The files are committed;
 * test/voiceLines.test.ts fails when a line has none, or a file or the folder outgrows
 * MAX_FILE_BYTES or MAX_FOLDER_BYTES.
 *
 * Runs on Node's own TypeScript (type stripping): it imports nothing of the app, and reads the
 * roster as a file.
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
  type ElevenVoice,
  type SoundClient,
  type SpeechClient,
} from './elevenlabs.ts';
import {
  CAST_FILE,
  DESIGN_TEXT,
  DESIGNED_READS,
  designVoice,
  inService,
  keepVoice,
  readRoster,
  ROLE_HELD,
  roleOf,
  ROLES,
  SAMPLES_DIR,
  slotOf,
  slotsOf,
  voiceless,
  type Person,
  type RadioMoment,
  type Role,
  type Roster,
  type Slot,
} from './cast.ts';

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
/**
 * The most one recording may take, bytes: 16 s of ElevenLabs' MP3, past the longest line of 28
 * words at the operator's pace, some 13 s.
 */
export const MAX_FILE_BYTES = 200 * 1024;
/**
 * The most the folder may take, bytes: 24 MB, room for the whole cast's lines as ElevenLabs' MP3
 * — three operators, the plant and the Schichtleitung, 260 recordings, some 20.5 MB at the 867
 * bytes a character the recordings take (12 MB held one voice's 100 lines).
 */
export const MAX_FOLDER_BYTES = 24 * 1024 * 1024;

const HERE = dirname(fileURLToPath(import.meta.url));
/** The shipped missions. */
export const MISSIONS_DIR = resolve(HERE, '../../../missions');
/** Where the recordings and their list go. */
export const VOICE_DIR = resolve(HERE, '../public/voice');
export const MANIFEST_FILE = join(VOICE_DIR, 'manifest.json');
/**
 * A line as a mission writes it (core radio.ts `Line`): one text, or two or three, of which a
 * run says one — each its own recording.
 */
export type Line = string | readonly string[];

/** A group of the answers' lines, each under its key: the clock's calls, the end's words. */
type Group = Readonly<Partial<Record<string, Line>>>;

/** What the script reads of a mission's radio: the radio's lines, as core's schema has them. */
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
 * How a line is said, as core's radio.ts `MOODS` has it by the moment: the first alarm and an
 * emergency missed tense, the clock pressing, an emergency urgent and its clearing relieved, a
 * run won warm, a run lost quiet, the lobby's Funkprobe calm; every other line has none.
 */
export type Mood = 'tense' | 'pressing' | 'urgent' | 'relieved' | 'warm' | 'quiet' | 'calm';

/** The mood of each moment that has one (core radio.ts `MOODS`). */
const MOOD_AT: Readonly<Partial<Record<RadioMoment, Mood>>> = {
  alarm: 'tense',
  clock: 'pressing',
  emergency: 'urgent',
  cleared: 'relieved',
  missed: 'tense',
  won: 'warm',
  lost: 'quiet',
  lobby: 'calm',
};

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

/** An audio tag in a line as written: a direction in square brackets („[sighs]"). */
const AUDIO_TAG = /\s*\[[^[\]]+\]\s*/g;
/** Punctuation that closes up to the word before it, where a tag stood between them. */
const CLOSING = /^[,.!?;:]/;

/**
 * A line as it is shown, as core's radio.ts `shownText` has it: its audio tags taken out with the
 * space around them — at either end nothing, between two words a space, before a stop nothing.
 */
export function shownText(said: string): string {
  const spaced = said.replace(AUDIO_TAG, (tag: string, at: number, whole: string) => {
    const rest = whole.slice(at + tag.length);
    return at === 0 || rest === '' || CLOSING.test(rest) ? '' : ' ';
  });
  return spaced.replace(/ {2,}/g, ' ').trim();
}

/** Whether a line as written carries audio tags of its own. */
export function tagged(said: string): boolean {
  return /\[[^[\]]+\]/.test(said);
}

/** Whether `model` reads audio tags (Eleven v3 and v4): an older one would say them aloud. */
export function takesTags(model: string): boolean {
  return /^eleven_v[34]/.test(model);
}

/**
 * The model that reads tags where a voice's own cannot (ELEVENLABS_MODEL naming an older one):
 * the line's tags are its writer's direction, and are never read out.
 */
export const TAG_MODEL = 'eleven_v3';

/** The model a line `said` as written is read with: its voice's `model`, or TAG_MODEL for tags. */
export function modelFor(model: string, said: string): string {
  return takesTags(model) || !tagged(said) ? model : TAG_MODEL;
}

/**
 * The words ElevenLabs is given of a line as written: its mood's tag before them and its own
 * tags where `model` reads them; the words alone where it does not.
 */
export function spokenText(said: string, mood: Mood | null, model: string): string {
  if (!takesTags(model)) return shownText(said);
  return mood === null ? said : `${MOOD_TAGS[mood]} ${said}`;
}

/**
 * The keys of each group of the answers, in the order core's radio.ts lists them: the clock's
 * calls, a run won by its time left, a run lost by its cause.
 */
const ANSWER_KEYS = {
  clock: ['fiveMinutes', 'twoMinutes', 'lastMinute'],
  won: ['plenty', 'tight', 'lastMinute'],
  lost: ['time', 'alarms', 'abandoned'],
} as const;

/** A line of the answers, and the moment it is heard at. */
type Answer = readonly [Line | undefined, RadioMoment];

/**
 * The answers to what a run does, in core's order: an emergency as it starts and as it ends,
 * the first alarm, the clock's calls, the last word on a run won and on one lost.
 */
function answersOf(radio: RadioLines | undefined): Answer[] {
  const group = (name: keyof typeof ANSWER_KEYS): Answer[] =>
    ANSWER_KEYS[name].map((key) => [radio?.[name]?.[key], name] as const);
  const emergency = radio?.emergency;
  return [
    [emergency?.['start'], 'emergency'],
    [emergency?.['cleared'], 'cleared'],
    [emergency?.['missed'], 'missed'],
    [radio?.alarm, 'alarm'],
    ...group('clock'),
    ...group('won'),
    ...group('lost'),
  ];
}

/** Who made a recording a person's: spoken on the /record page, or a file put there. */
export type PersonSource = 'human' | 'upload';

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, the role
 * and the person who say it and the moment it comes at, its mood, whether it opens a run, who
 * made it — a person (`source`), or a voice's render (`render`, a hash of what made it, and the
 * `model` that read it) — and its file in the voice folder.
 */
export interface Entry {
  text: string;
  ms: number;
  missions: string[];
  role: Role;
  person: string;
  moment: RadioMoment;
  mood?: Mood;
  opens?: true;
  source?: PersonSource;
  render?: string;
  model?: string;
  file: string;
}

/** The recordings' list: every recorded line by its id (`lineId`). */
export interface Manifest {
  lines: Record<string, Entry>;
}

/**
 * A recording, as an entry names it: its file, and a person who made it or a voice's render and
 * the model that read it.
 */
export interface Take {
  readonly file: string;
  readonly source?: PersonSource | undefined;
  readonly render?: string | undefined;
  readonly model?: string | undefined;
}

/**
 * Which recordings a run of the script makes anew, beside the lines that have none: none,
 * every synthetic one the chosen voice did not make (`--fresh`: a person's recordings stay),
 * or every one it did not make, a person's too (`--fresh=all`).
 */
export type Fresh = 'none' | 'synthetic' | 'all';

/**
 * A line the shipped missions can put on the air: the missions that say it, the role that says
 * it, the moment it is first heard at, its mood (null for none), whether it opens a run, and how
 * it is written — its audio tags with it — for the render.
 */
export interface ShippedLine {
  missions: string[];
  role: Role;
  moment: RadioMoment;
  mood: Mood | null;
  opens: boolean;
  said: string;
}

/**
 * A line of a mission as the script reads it: what it says as shown, how it is written, the
 * role that says it, the moment it is heard at, its mood (null for none), whether it opens a run.
 */
export interface CatalogLine {
  readonly text: string;
  readonly said: string;
  readonly role: Role;
  readonly moment: RadioMoment;
  readonly mood: Mood | null;
  readonly opens: boolean;
}

/** Every text of `line` heard at `moment`, as the script reads it; none for no line. */
const heardAt =
  (moment: RadioMoment) =>
  (line: Line | undefined): CatalogLine[] =>
    (typeof line === 'string' ? [line] : (line ?? []))
      .filter((said) => said.trim() !== '')
      .map((said) => ({
        text: shownText(said),
        said,
        role: roleOf(moment),
        moment,
        mood: MOOD_AT[moment] ?? null,
        opens: moment === 'start',
      }));

/**
 * Every line heard in `mission`, in the order core's `radioLines` lists them: the intro's
 * announcement over the lab's loudspeakers, line by line (client world/pa.ts), then on the air
 * the start, for each station the nudges it may get while it is up and the line its solve
 * brings, the escape; then the loudspeakers' message as an emergency starts, the answers to what
 * the run does (`answersOf`), and last the lobby's Funkprobe.
 */
export function catalogOf(mission: MissionLines): CatalogLine[] {
  const { radio, puzzles } = mission;
  const stations = puzzles.flatMap((puzzle) => [
    ...(puzzle.nudges ?? []).flatMap((line) => heardAt('nudge')(line)),
    ...heardAt('solved')(puzzle.onSolved),
  ]);
  return [
    ...(mission.intro?.pa ?? []).flatMap((said) => heardAt('pa')(said)),
    ...heardAt('start')(radio?.start),
    ...stations,
    ...heardAt('escape')(radio?.escape),
    ...heardAt('announce')(mission.map?.sabotage?.announce),
    ...answersOf(radio).flatMap(([line, moment]) => heardAt(moment)(line)),
    ...heardAt('lobby')(radio?.lobby),
  ];
}

/** The first 12 hex digits of the SHA-1 of what a line says, as shown. */
export function voiceId(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** The id of the recording of the line `text` as the person `person` says it. */
export function lineId(person: string, text: string): string {
  return `${person}-${voiceId(text)}`;
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
 * Why `said` cannot share the recordings of `line`, the shipped line of the same words: another
 * role says it, or in another mood, or it is written with other audio tags — one line, one
 * recording a person. Null where it can.
 */
function clash(line: ShippedLine, said: CatalogLine): string | null {
  if (line.role === said.role && line.mood === said.mood && line.said === said.said) return null;
  const how = (who: Role, as: Mood | null, written: string): string => {
    const mood = as === null ? '' : ` in a ${as} mood`;
    return `the ${who}${mood}${written === said.text ? '' : ` as „${written}"`}`;
  };
  const was = how(line.role, line.mood, line.said);
  const both = `${was} and ${how(said.role, said.mood, said.said)}`;
  return `voice: „${said.text}" is said by ${both} alike: one line, one recording`;
}

/**
 * Every shipped line, by what it says as shown: the missions that say it, the role that says it
 * and in what mood, whether it opens a run, how it is written. Fails where two roles, two moods
 * or two ways of tagging it would say the same words (`clash`): a line has one recording a
 * person.
 */
export function shippedLines(missions = shippedMissions()): Map<string, ShippedLine> {
  const lines = new Map<string, ShippedLine>();
  for (const mission of missions) {
    for (const said of catalogOf(mission)) {
      const { text, role, moment, mood, opens } = said;
      const line = lines.get(text) ?? { missions: [], role, moment, mood, opens, said: said.said };
      const refused = clash(line, said);
      if (refused !== null) throw new Error(refused);
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

/**
 * The manifest's entry for a line as `person` says it and its recording: a person's stays
 * marked as one, a render names the model that read it.
 */
export function entryOf(
  text: string,
  ms: number,
  line: ShippedLine,
  person: string,
  take: Take,
): Entry {
  return {
    text,
    ms,
    missions: [...line.missions].sort(),
    role: line.role,
    person,
    moment: line.moment,
    ...(line.mood === null ? {} : { mood: line.mood }),
    ...(line.opens ? { opens: true as const } : {}),
    ...(take.source === undefined ? {} : { source: take.source }),
    ...(take.render === undefined ? {} : { render: take.render }),
    ...(take.model === undefined ? {} : { model: take.model }),
    file: take.file,
  };
}

/**
 * The terms a take is made on: the account's plan, free or paid (ElevenLabs' `tier`). A take
 * made on a paid plan may be used commercially, for good; one made on the free plan needs the
 * credit „elevenlabs.io" and may not (docs/sound.md, „Lizenz").
 */
export type Plan = 'free' | 'paid';

/** What a take made on a paid plan adds to its render: --fresh there makes the others anew. */
const PAID_TERMS = 'paid plan';

/** The plan of an account whose subscription names `tier`: the free one where it names none. */
export function planOf(tier: string | undefined): Plan {
  return tier === undefined || tier === 'free' ? 'free' : 'paid';
}

/**
 * Who reads: Piper with its voice's name and model file, or the Mac — either for every person
 * alike — or ElevenLabs with the voice of each person the roster keeps one for, on the
 * account's plan.
 */
export type Voice =
  | { readonly engine: 'say' }
  | { readonly engine: 'piper'; readonly name: string; readonly model: string }
  | {
      readonly engine: 'elevenlabs';
      readonly name: string;
      /** each person whose voice is kept, by their id */
      readonly persons: Readonly<Record<string, ElevenVoice>>;
      /** the account's plan, which the takes are made on */
      readonly plan: Plan;
    };

/** A line as a voice is asked to read it: as shown and as written, who says it, how. */
export interface Said {
  readonly text: string;
  /** as the mission writes it, its audio tags with it */
  readonly said: string;
  readonly person: string;
  /** the mood asked for by an audio tag (`spokenText`); null for none */
  readonly mood: Mood | null;
}

/**
 * What makes a take, part by part: the engine, the voice and its settings, the words given — for
 * ElevenLabs the person's voice and the model that reads the line (`modelFor`), or, where the
 * roster keeps none for them yet, the person alone, which no take was ever made by, and the paid
 * plan where the account holds one: a take of before, which names none, is made anew there
 * under --fresh.
 */
function madeBy(voice: Voice, { text, said, person, mood }: Said): readonly (string | number)[] {
  if (voice.engine === 'piper') {
    return ['piper', voice.name, LENGTH_SCALE, SENTENCE_PAUSE_S, piperText(text)];
  }
  if (voice.engine === 'say') {
    return ['say', SAY_VOICE, SAY_RATE, sayText(text)];
  }
  const eleven = voice.persons[person];
  if (eleven === undefined) {
    return ['elevenlabs', `no voice for ${person} yet`];
  }
  const model = modelFor(eleven.model, said);
  const request = speechRequest(spokenText(said, mood, model), model, eleven.held);
  const terms = voice.plan === 'paid' ? [PAID_TERMS] : [];
  return ['elevenlabs', eleven.voiceId, JSON.stringify(request), ...terms];
}

/**
 * The render of a line by `voice`, as a hash of what makes it (`madeBy`): what that voice would
 * make again, take for take.
 */
export function renderOf(voice: Voice, said: Said): string {
  const made = madeBy(voice, said).join('\n');
  return createHash('sha1').update(made, 'utf8').digest('hex').slice(0, 12);
}

/**
 * The model a take of `said` is read with, as its entry names it: under ElevenLabs the person's
 * (`modelFor`), under Piper its voice; the Mac's voice has none to name.
 */
export function modelOf(voice: Voice, said: Said): string | undefined {
  if (voice.engine === 'piper') return voice.name;
  if (voice.engine === 'say') return undefined;
  const eleven = voice.persons[said.person];
  return eleven === undefined ? undefined : modelFor(eleven.model, said.said);
}

/** Whether `voice` can read the lines of the person `person`: every engine but ElevenLabs can. */
export function canRead(voice: Voice, person: string): boolean {
  return voice.engine !== 'elevenlabs' || voice.persons[person] !== undefined;
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
 * The MP3 ElevenLabs makes of `said` by its person's voice among `persons`: the words with its
 * mood's tag and its own tags where the model reads them (`spokenText`, `modelFor`), the take
 * `renderOf` names. Fails where the person has no voice yet.
 */
export async function elevenTake(
  persons: Readonly<Record<string, ElevenVoice>>,
  { said, person, mood }: Said,
): Promise<Buffer> {
  const eleven = persons[person];
  if (eleven === undefined) {
    throw new Error(`voice: ${person} has no voice yet — --design and --keep one first`);
  }
  const model = modelFor(eleven.model, said);
  return speakEleven({ ...eleven, model }, spokenText(said, mood, model));
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
    writeFileSync(path, await elevenTake(voice.persons, said));
    return { file, ms: durationOf(path, text) };
  }
  const raw = join(scratch, voice.engine === 'say' ? 'line.aiff' : 'line.wav');
  read(text, raw, voice);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), raw, path]);
  return { file, ms: durationOf(raw, text) };
}

/** The manifest at `file` as it stands; empty where there is none yet. */
export function readManifest(file = MANIFEST_FILE): Manifest {
  if (!existsSync(file)) return { lines: {} };
  const { lines } = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  return { lines };
}

/** Writes `manifest` to `file`: its lines in the order of their ids. */
export function writeManifest(manifest: Manifest, file = MANIFEST_FILE): void {
  const lines = Object.entries(manifest.lines).sort(([a], [b]) => (a < b ? -1 : 1));
  writeFileSync(file, `${JSON.stringify({ lines: Object.fromEntries(lines) }, null, 2)}\n`);
}

/**
 * The ElevenLabs voice of every person `roster` keeps one for, as `find` finds it on the account,
 * reading by `override` where ELEVENLABS_MODEL names one, else by the model the roster names for
 * them, holding as their role asks (`ROLE_HELD`).
 */
function castVoices(
  roster: Roster,
  find: (voiceId: string) => string,
  client: SpeechClient,
  override: string | undefined,
): Record<string, ElevenVoice> {
  return Object.fromEntries(
    ROLES.flatMap((role) =>
      roster[role].flatMap((person) => {
        if (person.voiceId === undefined) return [];
        const voiceId = find(person.voiceId);
        const model = override ?? person.model ?? ELEVEN_MODEL;
        return [[person.id, { client, voiceId, model, held: ROLE_HELD[role] }] as const];
      }),
    ),
  );
}

/**
 * The ElevenLabs voices of the cast on `client`'s account, reading by `override` where it names
 * a model, and the account's plan — asked of ElevenLabs first, free of charge.
 */
export async function elevenVoiceOf(
  roster: Roster,
  client: SpeechClient & SoundClient,
  override?: string,
): Promise<Voice> {
  const asking = { tag: 'voice', what: "tell the account's plan" };
  const { tier } = await elevenAsk(() => client.user.subscription.get(), asking);
  const plan = planOf(tier);
  const voices = await accountVoices(client);
  const find = (voiceId: string): string => resolveVoice(voices, voiceId).voiceId;
  const persons = castVoices(roster, find, client, override);
  const read = Object.entries(persons).map(([person, { model }]) => `${person} ${model}`);
  const name = `${read.join(', ') || 'nobody'} (the ${plan} plan)`;
  return { engine: 'elevenlabs', name, persons, plan };
}

/** The cast's ElevenLabs voices and the plan, by the model ELEVENLABS_MODEL names, if any. */
async function elevenVoice(roster: Roster): Promise<Voice> {
  loadApiKey();
  const override = process.env.ELEVENLABS_MODEL || undefined;
  return elevenVoiceOf(roster, await elevenClient(), override);
}

/**
 * The voice VOICE_ENGINE and VOICE_MODEL ask for, its Piper model fetched where needed; under
 * ElevenLabs the voices `roster` keeps for the cast.
 */
async function chosenVoice(roster: Roster): Promise<Voice> {
  const engine = engineOf(process.env.VOICE_ENGINE);
  requireTools(engine);
  if (engine === 'say') {
    return { engine };
  }
  if (engine === 'elevenlabs') {
    return elevenVoice(roster);
  }
  const name = process.env.VOICE_MODEL || PIPER_MODEL;
  return { engine, name, model: await piperModel(name) };
}

/**
 * A shipped line as one person of the cast says it: the line, the person, the recording's id,
 * the take it keeps (null for none), the take it has (`was`, its file there) and the render it
 * would get.
 */
export interface Planned {
  readonly text: string;
  readonly line: ShippedLine;
  readonly person: Person;
  readonly id: string;
  readonly kept: Entry | null;
  readonly was: Entry | null;
  readonly render: string;
}

/** The line `text` as `person` says it, for a voice to read. */
const saidBy = (text: string, line: ShippedLine, person: string): Said => ({
  text,
  said: line.said,
  person,
  mood: line.mood,
});

/**
 * Every shipped line as each person of its role in service says it (`inService`), in the order
 * of their ids, each with what it keeps of `before`.
 */
export function plan(
  before: Manifest,
  fresh: Fresh,
  voice: Voice,
  roster: Roster,
  lines = shippedLines(),
): Planned[] {
  const planned = [...lines].flatMap(([text, line]) =>
    inService(roster, line.role).map((person): Planned => {
      const id = lineId(person.id, text);
      const render = renderOf(voice, saidBy(text, line, person.id));
      const had = before.lines[id];
      const filed = had !== undefined && existsSync(join(VOICE_DIR, had.file));
      const was = filed && had.text === text ? had : null;
      const kept = keeps(had, text, filed, fresh, render) ? (had ?? null) : null;
      return { text, line, person, id, kept, was, render };
    }),
  );
  return planned.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * What a run makes of `planned`: what it keeps nothing of, by the persons `voice` can read — under
 * ElevenLabs the kept cast alone — so that a line already made as it would be made is never made
 * twice.
 */
export function toMake(voice: Voice, planned: readonly Planned[]): Planned[] {
  return planned.filter((each) => each.kept === null && canRead(voice, each.person.id));
}

/**
 * How many characters making `todo` spends: under ElevenLabs the words each person's model is
 * given, a mood's tag and the line's own tags included (`spokenText`); under Piper and the Mac,
 * which spend none, the words.
 */
export function charactersOf(voice: Voice, todo: readonly Planned[]): number {
  return todo.reduce((sum, { text, line, person }) => {
    const model = voice.engine === 'elevenlabs' ? voice.persons[person.id]?.model : undefined;
    if (model === undefined) return sum + text.length;
    const reads = modelFor(model, line.said);
    return sum + spokenText(line.said, line.mood, reads).length;
  }, 0);
}

/** What a character of text to speech costs at most, credits: the rate --plan counts at. */
export const CREDITS_PER_CHARACTER = 1;

/** A client for the plan, which asks ElevenLabs for nothing: any call fails, saying so. */
const NO_CALL: SpeechClient = {
  voices: { getAll: () => Promise.reject(new Error('voice: --plan asks ElevenLabs for nothing')) },
  textToSpeech: {
    convert: () => Promise.reject(new Error('voice: --plan asks ElevenLabs for nothing')),
  },
};

/** ElevenLabs as --plan takes it: the roster's voices as kept, on a paid plan, never asked. */
type Eleven = Extract<Voice, { engine: 'elevenlabs' }>;

/**
 * The voices a render would read with, as the roster keeps them — reading by `override` where
 * ELEVENLABS_MODEL names one — on the paid plan the account holds, which a render reads off it
 * and a dry run cannot: nothing is asked of anybody.
 */
export function plannedVoice(roster: Roster, override?: string): Eleven {
  const persons = castVoices(roster, (voiceId) => voiceId, NO_CALL, override);
  return { engine: 'elevenlabs', name: 'the cast as kept', persons, plan: 'paid' };
}

/**
 * What --plan says of one person of the cast: their name on the command line and the model their
 * voice reads with — null where they have none yet — the lines a run makes for them now, their
 * characters, and those it skips, made as it would make them; and for a person without a voice
 * what its design reads, and every line of their role once it is kept, on Eleven v3.
 */
export interface Cost {
  readonly slot: string;
  readonly name: string;
  readonly model: string | null;
  readonly make: number;
  readonly characters: number;
  readonly skip: number;
  readonly design: number;
  readonly later: { readonly lines: number; readonly characters: number };
}

/** What a person with a voice kept makes once every voice is kept: nothing beside what is now. */
const NOTHING_LATER = { lines: 0, characters: 0 } as const;

/** What a person without a voice yet costs: its design, and their role's lines once it is kept. */
function unvoicedCost(slot: Slot, lines: ReadonlyMap<string, ShippedLine>): Cost {
  const theirs = [...lines.values()].filter((line) => line.role === slot.role);
  const spoken = (line: ShippedLine): number =>
    spokenText(line.said, line.mood, DESIGNED_READS).length;
  const characters = theirs.reduce((sum, line) => sum + spoken(line), 0);
  return {
    slot: slot.name,
    name: slot.person.name,
    model: null,
    make: 0,
    characters: 0,
    skip: 0,
    design: DESIGN_TEXT[slot.role].length,
    later: { lines: theirs.length, characters },
  };
}

/**
 * What every person of `roster` costs a run that asks `fresh` of the recordings `before` (a dry
 * run of `main`, `plannedVoice`): the kept cast's lines to make now, the rest by their design and
 * their lines.
 */
export function costsOf(
  roster: Roster,
  before: Manifest,
  fresh: Fresh,
  override?: string,
  lines = shippedLines(),
): Cost[] {
  const voice = plannedVoice(roster, override);
  const planned = plan(before, fresh, voice, roster, lines);
  const todo = toMake(voice, planned);
  return slotsOf(roster).map((slot) => {
    const id = slot.person.id;
    const eleven = voice.persons[id];
    if (eleven === undefined) return unvoicedCost(slot, lines);
    const mine = todo.filter((each) => each.person.id === id);
    const skip = planned.filter((each) => each.person.id === id && each.kept !== null).length;
    const { name } = slot.person;
    const said = { slot: slot.name, name, model: eleven.model, make: mine.length, skip };
    return { ...said, characters: charactersOf(voice, mine), design: 0, later: NOTHING_LATER };
  });
}

/** A count as --plan says it: „3,817". */
const counted = (n: number): string => n.toLocaleString('en-US');

/** What --plan says of one person: the lines and credits now, or their design and lines later. */
function costLine({ slot, name, model, make, characters, skip, design, later }: Cost): string {
  const who = `${slot.padEnd(16)} ${name.padEnd(10)}`;
  if (model === null) {
    const after = `${counted(later.lines)} lines, ${counted(later.characters)} credits`;
    return `voice:   ${who} no voice yet: its design ${counted(design)} credits, then ${after}`;
  }
  const now = `${counted(make)} lines, ${counted(characters * CREDITS_PER_CHARACTER)} credits`;
  return `voice:   ${who} ${model.padEnd(10)} ${now}; ${counted(skip)} made as they are, kept`;
}

/**
 * What --plan prints of `costs`: what it assumes, a line for each person, what the kept cast
 * costs now and what the whole cast costs once every voice is kept — designs and lines.
 */
export function planReport(costs: readonly Cost[], fresh: Fresh): string[] {
  const asked = fresh === 'none' ? 'voice' : `voice --fresh${fresh === 'all' ? '=all' : ''}`;
  const sum = (of: (cost: Cost) => number): number =>
    costs.reduce((total, cost) => total + of(cost), 0);
  const now = sum((cost) => cost.characters) * CREDITS_PER_CHARACTER;
  const designs = sum((cost) => cost.design);
  const later = sum((cost) => cost.later.characters) * CREDITS_PER_CHARACTER;
  const lines = sum((cost) => cost.make + cost.later.lines);
  return [
    `voice: the plan of \`${asked}\` under ElevenLabs on the paid plan, at most ` +
      `${CREDITS_PER_CHARACTER} credit a character; nothing is asked of ElevenLabs`,
    ...costs.map(costLine),
    `voice: now, the kept cast: ${counted(sum((cost) => cost.make))} lines, ` +
      `${counted(now)} credits`,
    `voice: every voice kept: ${costs.filter((cost) => cost.model === null).length} designs ` +
      `(${counted(designs)} credits) and ${counted(lines)} lines (${counted(now + later)} ` +
      `credits), ${counted(designs + now + later)} credits in all`,
  ];
}

/**
 * What a run says of the persons whose lines wait for a voice: each with how many, and the
 * commands that give them one.
 */
function waitingFor(voice: Voice, planned: readonly Planned[], roster: Roster): string[] {
  const waiting = planned.filter((each) => each.kept === null && !canRead(voice, each.person.id));
  const persons = [...new Set(waiting.map((each) => each.person.id))];
  return persons.map((id) => {
    const slot = slotsOf(roster).find((each) => each.person.id === id);
    const count = waiting.filter((each) => each.person.id === id).length;
    const lines = `${count} line${count === 1 ? '' : 's'} wait`;
    return slot === undefined ? `voice: ${id}: ${lines}` : `${voiceless(slot)}\n  (${lines})`;
  });
}

/** `bytes` in whole kilobytes, as the warnings say them. */
const kilobytes = (bytes: number): string => (bytes / 1024).toFixed(0);

/** The files over MAX_FILE_BYTES, and the folder where it is over MAX_FOLDER_BYTES, as warnings. */
function overLimits(lines: Readonly<Record<string, Entry>>): string[] {
  const sizes = Object.values(lines).map((entry) => {
    return [entry.file, statSync(join(VOICE_DIR, entry.file)).size] as const;
  });
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const cap = kilobytes(MAX_FILE_BYTES);
  const files = sizes
    .filter(([, size]) => size > MAX_FILE_BYTES)
    .map(([file, size]) => `${file} takes ${kilobytes(size)} kB, over ${cap} kB`);
  const megabytes = MAX_FOLDER_BYTES / 1024 / 1024;
  const folder =
    total > MAX_FOLDER_BYTES ? [`the folder takes ${total} bytes, over ${megabytes} MB`] : [];
  return [...files, ...folder];
}

/**
 * The takes a run starts from: every take it keeps, and every take of a person whose voice it
 * cannot read — those stay as they are, whatever is asked anew, until a voice is kept for them.
 */
function startingTakes(voice: Voice, planned: readonly Planned[], before: Manifest): Manifest {
  const manifest: Manifest = { lines: { ...before.lines } };
  for (const { text, line, person, id, kept, was } of planned) {
    const take = kept ?? (canRead(voice, person.id) ? null : was);
    if (take !== null) manifest.lines[id] = entryOf(text, take.ms, line, person.id, take);
  }
  return manifest;
}

/**
 * Makes what is missing and what `fresh` asks for anew, by the persons the voice can read, one
 * line after the other and the list written after each, so that a run cut short keeps what it
 * made; then drops what is stale.
 */
async function main(fresh: Fresh): Promise<void> {
  const before = readManifest();
  const roster = readRoster();
  const voice = await chosenVoice(roster);
  mkdirSync(VOICE_DIR, { recursive: true });
  const planned = plan(before, fresh, voice, roster);
  const todo = toMake(voice, planned);
  const characters = charactersOf(voice, todo);
  const who = voice.engine === 'say' ? `say ${SAY_VOICE}` : `${voice.engine} ${voice.name}`;
  console.log(
    `voice: ${todo.length} of ${planned.length} lines to make, ${characters} characters, ${who}`,
  );
  for (const notice of waitingFor(voice, planned, roster)) console.log(notice);
  const manifest = startingTakes(voice, planned, before);
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-voice-'));
  try {
    const jobs = todo.map(({ text, line, person, id, render }) => async () => {
      const said = saidBy(text, line, person.id);
      const { file, ms } = await record(said, id, scratch, voice);
      const take = { file, render, model: modelOf(voice, said) };
      manifest.lines[id] = entryOf(text, ms, line, person.id, take);
      writeManifest(manifest);
      console.log(`voice: ${id} ${(ms / 1000).toFixed(1)} s „${text}"`);
    });
    await oneByOne(jobs, voice.engine === 'elevenlabs' ? ELEVEN_GAP_MS : 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const kept = planned.flatMap(({ id }) => {
    const entry = manifest.lines[id];
    return entry === undefined ? [] : [[id, entry] as const];
  });
  finish({ lines: Object.fromEntries(kept) }, todo.length);
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

/** --design <slot>: three samples of a person's voice, each with its file, and how to keep one. */
async function design(asked: string | undefined): Promise<void> {
  const slot = slotOf(readRoster(), asked);
  loadApiKey();
  const characters = DESIGN_TEXT[slot.role].length;
  const who = `${slot.person.name} (${slot.name})`;
  console.log(`voice: Voice Design for ${who}, ${characters} characters`);
  const made = await designVoice(await elevenClient(), slot);
  for (const { n, file, seconds } of made) {
    console.log(`voice: ${n}  ${join(SAMPLES_DIR, slot.dir, file)}  ${seconds.toFixed(1)} s`);
  }
  console.log(
    `voice: listen — /voices with pnpm dev — then keep one: ` +
      `node --env-file=<repo>/.env.local scripts/voice.ts --keep ${slot.name}=<n>`,
  );
}

/** --keep <slot>=<n>: that sample kept as the person's voice, in the roster. */
async function keep(asked: string | undefined): Promise<void> {
  const [, name, number] = /^(.+)=([1-9]\d*)$/.exec(asked ?? '') ?? [];
  if (name === undefined || number === undefined) {
    throw new Error('voice: --keep takes a person and a sample: --keep operator:marta=2');
  }
  const slot = slotOf(readRoster(), name);
  loadApiKey();
  const kept = await keepVoice(await elevenClient(), slot, Number(number));
  console.log(
    `voice: ${kept.name} speaks with „EscapeLab ${kept.name}" (${kept.voiceId ?? ''}, ` +
      `${kept.model ?? ''}), kept in ${CAST_FILE} — on duty once the lines are made: ` +
      'VOICE_ENGINE=elevenlabs pnpm --filter @escapelab/client voice --fresh',
  );
}

/**
 * --plan [--fresh]: what that run would make, by whom, and what it costs — no key, no client, no
 * tool: the roster, the manifest and the files alone.
 */
function planned(fresh: Fresh): Promise<void> {
  const override = process.env.ELEVENLABS_MODEL || undefined;
  const costs = costsOf(readRoster(), readManifest(), fresh, override);
  for (const line of planReport(costs, fresh)) console.log(line);
  return Promise.resolve();
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
  '--plan': (args) => planned(freshOf(args)),
  '--list-voices': () => listVoices(),
  '--sample': (args, at) => sample(args[at + 1], args[at + 2]),
  '--design': (args, at) => design(args[at + 1]),
  '--keep': (args, at) => keep(args[at + 1]),
};

/**
 * What the command line asks for: the account's voices, a sample, a person's voice designed or
 * one of its samples kept — or the lines.
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
