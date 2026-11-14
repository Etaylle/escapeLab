/**
 * The radio's cast as the voice script knows it (voice.ts): the roster core keeps in
 * core/src/cast.json — who can fill each role, the voice kept for them and the model it reads
 * with — read as a file, as the script imports nothing of the app; the persons in service, whose
 * lines are made; how a voice is asked for, which the game never needs (casting.json): each
 * person's Voice-Design prompt and the library voices of the account to choose from; and each
 * person's voice heard before it is kept: three samples from their prompt (--design), one of
 * them — or a library voice — kept as their voice on the account and in the roster (--keep).
 * Asks ElevenLabs for nothing itself: whoever calls it hands it a client.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountVoices,
  ELEVEN_FORMAT,
  ELEVEN_MODEL,
  elevenAsk,
  OPERATOR_HELD,
  resolveVoice,
  type DesignClient,
  type Held,
  type SpeechClient,
  type VoiceInfo,
} from './elevenlabs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The roster of the radio's cast, as core reads it (core/src/cast.ts): --keep writes it. */
export const CAST_FILE = resolve(HERE, '../../core/src/cast.json');
/** How each person's voice is asked for: their prompts and the library voices to choose from. */
export const CASTING_FILE = resolve(HERE, 'casting.json');
/**
 * Where --design puts each person's samples, a folder git ignores beside public/, which no
 * build copies, as the music's takes: takes/voices/<slot>/<n>.mp3 and their index.json.
 */
export const SAMPLES_DIR = resolve(HERE, '../takes/voices');

/**
 * Who says a line, as core's radio.ts `Role` has it: the plant's announcement system over the
 * loudspeakers, the Leitstelle on duty on the radio, or the Schichtleitung cutting in.
 */
export type Role = 'pa' | 'operator' | 'lead';

/** The roles, in the roster's order. */
export const ROLES: readonly Role[] = ['pa', 'operator', 'lead'];

/** When a line is heard, as core's radio.ts `RadioMoment` has it. */
export type RadioMoment =
  | 'pa'
  | 'start'
  | 'nudge'
  | 'solved'
  | 'escape'
  | 'announce'
  | 'emergency'
  | 'cleared'
  | 'missed'
  | 'alarm'
  | 'clock'
  | 'won'
  | 'lost'
  | 'lobby';

/**
 * Who speaks at each moment, as core's radio.ts `roleOf` says: the loudspeakers the
 * announcement and the plant's message, the Schichtleitung the clock's calls and the last word
 * on a run lost, the Leitstelle every other line.
 */
const ROLE_AT: Readonly<Record<RadioMoment, Role>> = {
  pa: 'pa',
  start: 'operator',
  nudge: 'operator',
  solved: 'operator',
  escape: 'operator',
  announce: 'pa',
  emergency: 'operator',
  cleared: 'operator',
  missed: 'operator',
  alarm: 'operator',
  clock: 'lead',
  won: 'operator',
  lost: 'lead',
  lobby: 'operator',
};

/** The role that speaks at `moment`. */
export function roleOf(moment: RadioMoment): Role {
  return ROLE_AT[moment];
}

/** A person of the roster, as core's cast.ts `Person` has it. */
export interface Person {
  readonly id: string;
  readonly name: string;
  readonly character: string;
  /** their voice on the ElevenLabs account, kept by --keep */
  readonly voiceId?: string;
  /** the model their voice reads with */
  readonly model?: string;
}

/** The persons for each role, in the roster's order. */
export type Roster = Readonly<Record<Role, readonly Person[]>>;

/** The roster as it stands at `file`. */
export function readRoster(file = CAST_FILE): Roster {
  return JSON.parse(readFileSync(file, 'utf8')) as Roster;
}

/** Writes `roster` to `file`, two spaces to a level, as the file is kept. */
function writeRoster(roster: Roster, file = CAST_FILE): void {
  writeFileSync(file, `${JSON.stringify(roster, null, 2)}\n`);
}

/**
 * A voice of the ElevenLabs library the account has, offered for one person of the cast: its id,
 * its name and what it is as the library labels it, and the person it is offered for, by the
 * name the command line gives them (`slotsOf`): `--keep <slot>=<voice id>` keeps it.
 */
export interface LibraryVoice {
  readonly voiceId: string;
  readonly name: string;
  readonly about: string;
  readonly slot: string;
}

/**
 * How each person's voice is asked for, kept apart from the roster so that the game never carries
 * it: the description Voice Design makes their voice from (`--design`), in English, by their id;
 * and the library voices offered for them, the owner's own pick.
 */
export interface Casting {
  readonly prompts: Readonly<Record<string, string>>;
  readonly library: readonly LibraryVoice[];
}

/** The casting as it stands at `file`. */
export function readCasting(file = CASTING_FILE): Casting {
  return JSON.parse(readFileSync(file, 'utf8')) as Casting;
}

/** The Voice-Design prompt of the person `slot` names; fails, naming the file, without one. */
export function promptOf(casting: Casting, slot: Slot): string {
  const prompt = casting.prompts[slot.person.id];
  if (prompt === undefined) {
    throw new Error(`voice: ${CASTING_FILE} has no prompt for ${slot.person.id} (${slot.name})`);
  }
  return prompt;
}

/**
 * The persons of `role` in service, as core's cast.ts `inService` has them: those whose voice is
 * kept; where none has one yet, the plant's and the Leitstelle's first, the Schichtleitung nobody.
 */
export function inService(roster: Roster, role: Role): readonly Person[] {
  const persons = roster[role];
  const voiced = persons.filter((person) => person.voiceId !== undefined);
  return voiced.length > 0 || role === 'lead' ? voiced : persons.slice(0, 1);
}

/**
 * The role whose person on duty says `role`'s lines, as core's `speakingFor` has it: the role
 * itself, or the Leitstelle for a Schichtleitung nobody of which has a voice.
 */
export function speakingFor(roster: Roster, role: Role): Role {
  return inService(roster, role).length > 0 ? role : 'operator';
}

/** Everybody who says `role`'s lines on some night, as core's `sayersOf`: each needs them made. */
export function sayersOf(roster: Roster, role: Role): readonly Person[] {
  return inService(roster, speakingFor(roster, role));
}

/**
 * How each role's ElevenLabs voice holds: the Leitstelle and the Schichtleitung as every line
 * was read before; the plant steadier, a building's system that says every line alike (on Eleven
 * v3, its Robust setting: elevenlabs.ts `voiceSettings`).
 */
export const ROLE_HELD: Readonly<Record<Role, Held>> = {
  pa: { stability: 0.8, similarityBoost: 0.75 },
  operator: OPERATOR_HELD,
  lead: OPERATOR_HELD,
};

/** The model Voice Design makes a voice with. */
export const DESIGN_MODEL = 'eleven_ttv_v3';
/**
 * The model a library voice reads with, as --keep writes it into the roster: Eleven v4, the
 * script's default, as Helmut's lines were read — a library voice is made for every model.
 */
export const LIBRARY_READS = ELEVEN_MODEL;
/**
 * The model a designed voice reads with, as --keep writes it into the roster: Eleven v3, which
 * Voice Design's voices are made for — on Eleven v4 they may sound less performative, as
 * ElevenLabs says — and which reads audio tags.
 */
export const DESIGNED_READS = 'eleven_v3';

/**
 * What a role's samples say (--design): a few of its own lines, 100 to 1,000 characters, which
 * is what a design costs — the same for every person of the role, so that they are heard alike.
 */
export const DESIGN_TEXT: Readonly<Record<Role, string>> = {
  pa:
    'Durchsage für Trakt C. Es ist 23 Uhr 47, die Nachtschicht hat übernommen. Netzlast im ' +
    'Trakt 96 Prozent, Notstrom in Bereitschaft. Störung im Kühlkreislauf, Relais auf ' +
    'Handbetrieb.',
  operator:
    'Leitstelle an Nachtschicht. Stromausfall im ganzen Trakt, ich sehe nur noch die ' +
    'Notzellen. Notlicht steht, danke. Jetzt der Notstrom, die Anleitung hängt im Archiv. ' +
    'Reaktor läuft. Der Notausgang ist entriegelt, alle raus, jetzt.',
  lead:
    'Noch fünf Minuten auf den Notzellen. Bleibt dran, aber hetzt nicht. Mit halber Schicht ' +
    'geht da drinnen nichts. Ich breche ab, der Trakt bleibt bis morgen dunkel.',
};

/**
 * A person of the cast as the command line names them (--design, --keep): by their role where
 * it has them alone (`pa`, `lead`), else by role and id (`operator:laura`); and the folder their
 * samples go to under SAMPLES_DIR, named alike (`pa`, `operator-laura`).
 */
export interface Slot {
  readonly role: Role;
  readonly person: Person;
  readonly name: string;
  readonly dir: string;
}

/** Every person of `roster` as the command line names them, the roles in order. */
export function slotsOf(roster: Roster): Slot[] {
  return ROLES.flatMap((role) =>
    roster[role].map((person) => {
      const alone = roster[role].length === 1;
      const name = alone ? role : `${role}:${person.id}`;
      return { role, person, name, dir: alone ? role : `${role}-${person.id}` };
    }),
  );
}

/** The person `asked` names (`pa`, `operator:laura`; `pa:anlage` too); fails naming them all. */
export function slotOf(roster: Roster, asked: string | undefined): Slot {
  const slots = slotsOf(roster);
  const found = slots.find(
    ({ name, role, person }) => asked === name || asked === `${role}:${person.id}`,
  );
  if (found === undefined) {
    const names = slots.map(({ name }) => name).join(', ');
    throw new Error(`voice: "${asked ?? ''}" names nobody of the cast — it has ${names}`);
  }
  return found;
}

/**
 * What to run where the person `slot` names has no voice yet: a library voice kept, or three
 * samples made and one of them kept.
 */
export function voiceless(slot: Slot): string {
  const run = 'pnpm --filter @escapelab/client voice';
  return (
    `voice: ${slot.person.name} (${slot.name}) has no voice yet — listen on /voices, then keep ` +
    'a library voice, or design three samples and keep one:\n' +
    `  ${run} --keep ${slot.name}=<voice id>\n` +
    `  ${run} --design ${slot.name}  then  ${run} --keep ${slot.name}=<n>`
  );
}

/** The folder under SAMPLES_DIR the library voices' previews go to: library/<voice id>.mp3. */
export const LIBRARY_DIR = 'library';

/** The bytes of the file at `url`, a library voice's preview; fails naming the status. */
async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** What became of one library voice's preview: its file, or why there is none. */
export type Preview =
  | { readonly voiceId: string; readonly file: string }
  | { readonly voiceId: string; readonly missing: string };

/**
 * Fetches the preview ElevenLabs keeps of each library voice of `casting` into `dir` as
 * <voice id>.mp3, for /voices to play: the account's list of voices names each preview's address
 * (GET /v1/voices), and the preview is a file of ElevenLabs' own — neither costs a credit. A voice
 * the account has not, one without a preview and one whose preview does not come are said, each
 * with why, and the others fetched all the same.
 */
export async function fetchPreviews(
  client: SpeechClient,
  casting: Casting,
  dir = join(SAMPLES_DIR, LIBRARY_DIR),
  download: (url: string) => Promise<Buffer> = fetchBytes,
): Promise<Preview[]> {
  const voices = await accountVoices(client);
  mkdirSync(dir, { recursive: true });
  const previews: Preview[] = [];
  for (const { voiceId } of casting.library) {
    previews.push(await previewOf(voices, voiceId, dir, download));
  }
  return previews;
}

/** The preview of the library voice `voiceId`, fetched into `dir`; or why there is none. */
async function previewOf(
  voices: readonly VoiceInfo[],
  voiceId: string,
  dir: string,
  download: (url: string) => Promise<Buffer>,
): Promise<Preview> {
  const voice = voices.find((each) => each.voiceId === voiceId);
  if (voice === undefined) return { voiceId, missing: 'the account has no such voice' };
  if (voice.previewUrl === undefined) return { voiceId, missing: 'it has no preview' };
  try {
    const bytes = await download(voice.previewUrl);
    const file = join(dir, `${voiceId}.mp3`);
    writeFileSync(file, bytes);
    return { voiceId, file };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { voiceId, missing: `its preview did not come: ${reason}` };
  }
}

/**
 * A sample of a person's voice as Voice Design made it: its number and file in the person's
 * folder, its length, the preview's id that --keep makes the voice from, and what made it — the
 * prompt, the text it says, the model — and when.
 */
export interface Sample {
  readonly n: number;
  readonly file: string;
  readonly seconds: number;
  readonly generatedVoiceId: string;
  readonly prompt: string;
  readonly text: string;
  readonly model: string;
  readonly madeAt: string;
}

/**
 * A person's samples, as their folder's index.json lists them, the oldest first, and the one
 * kept as their voice (--keep), where one is.
 */
export interface Samples {
  readonly role: Role;
  readonly person: string;
  readonly samples: readonly Sample[];
  readonly kept?: { readonly n: number; readonly voiceId: string };
}

/** The list of samples in the folder `dir`; null where it has none yet. */
export function readSamples(dir: string): Samples | null {
  const file = join(dir, 'index.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Samples) : null;
}

/** Writes `samples` as the folder `dir`'s list. */
function writeSamples(dir: string, samples: Samples): void {
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(samples, null, 2)}\n`);
}

/**
 * Asks Voice Design for three samples of the voice of the person `slot` names, from their
 * `prompt` (casting.json), each saying their role's DESIGN_TEXT, into their folder under `dir` —
 * numbered on after those it has — and lists them there. The request costs the text's
 * characters, once for all three; a refusal fails saying what ElevenLabs said.
 */
export async function designVoice(
  client: DesignClient,
  slot: Slot,
  prompt: string,
  dir = SAMPLES_DIR,
  now: () => Date = () => new Date(),
): Promise<Sample[]> {
  const { role, person } = slot;
  const text = DESIGN_TEXT[role];
  const asking = { tag: 'voice', what: `design a voice for ${person.name}` };
  const answer = await elevenAsk(
    () =>
      client.textToVoice.design({
        voiceDescription: prompt,
        modelId: DESIGN_MODEL,
        text,
        outputFormat: ELEVEN_FORMAT,
      }),
    asking,
  );
  const folder = join(dir, slot.dir);
  mkdirSync(folder, { recursive: true });
  const list = readSamples(folder) ?? { role, person: person.id, samples: [] };
  const first = Math.max(0, ...list.samples.map(({ n }) => n)) + 1;
  const madeAt = now().toISOString();
  const made = answer.previews.map((preview, i): Sample => {
    const n = first + i;
    writeFileSync(join(folder, `${n}.mp3`), Buffer.from(preview.audioBase64, 'base64'));
    const { generatedVoiceId, durationSecs: seconds } = preview;
    const how = { prompt, text, model: DESIGN_MODEL, madeAt };
    return { n, file: `${n}.mp3`, seconds, generatedVoiceId, ...how };
  });
  writeSamples(folder, { ...list, samples: [...list.samples, ...made] });
  return made;
}

/** The sample `n` of the person `slot` names in `folder`; fails, saying why, where it has none. */
function sampleOf(slot: Slot, folder: string, n: number): { list: Samples; sample: Sample } {
  const list = readSamples(folder);
  const sample = list?.samples.find((each) => each.n === n);
  if (list === null || sample === undefined) {
    const has = list === null ? 'none' : list.samples.map((each) => each.n).join(', ');
    throw new Error(
      `voice: ${slot.name} has no sample ${n} (it has ${has}) — --design ${slot.name} makes three`,
    );
  }
  if (!existsSync(join(folder, sample.file))) {
    throw new Error(`voice: the sample ${n} of ${slot.name} is gone from ${folder}`);
  }
  return { list, sample };
}

/** What a voice id on the ElevenLabs account looks like: letters and digits, 8 to 64. */
export const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;

/**
 * Writes `voice` into the roster at `cast` as the voice of the person `slot` names, with the
 * model it reads with; returns the person as kept.
 */
function keptAs(slot: Slot, voice: { voiceId: string; model: string }, cast: string): Person {
  const kept: Person = { ...slot.person, ...voice };
  const roster = readRoster(cast);
  const persons = roster[slot.role].map((each) => (each.id === kept.id ? kept : each));
  writeRoster({ ...roster, [slot.role]: persons }, cast);
  return kept;
}

/**
 * Makes the sample `n` of the person `slot` names their voice on the account — which costs no
 * credits, but takes one of the account's voice slots — and keeps it in the roster at `cast`
 * with the model it reads with (DESIGNED_READS), marking the sample kept in its list. Refuses,
 * before anything is asked, a number of no sample there and a sample whose file is gone.
 */
export async function keepVoice(
  client: DesignClient,
  slot: Slot,
  n: number,
  where: { readonly samples?: string; readonly cast?: string } = {},
): Promise<Person> {
  const { samples = SAMPLES_DIR, cast = CAST_FILE } = where;
  const folder = join(samples, slot.dir);
  const { list, sample } = sampleOf(slot, folder, n);
  const voiceName = `EscapeLab ${slot.person.name}`;
  const asking = { tag: 'voice', what: `keep the sample ${n} as ${slot.person.name}'s voice` };
  const made = await elevenAsk(
    () =>
      client.textToVoice.create({
        voiceName,
        voiceDescription: sample.prompt,
        generatedVoiceId: sample.generatedVoiceId,
      }),
    asking,
  );
  if (!VOICE_ID.test(made.voiceId)) {
    throw new Error(`voice: ElevenLabs made the voice "${made.voiceId}", which is no voice id`);
  }
  const kept = keptAs(slot, { voiceId: made.voiceId, model: DESIGNED_READS }, cast);
  writeSamples(folder, { ...list, kept: { n, voiceId: made.voiceId } });
  return kept;
}

/**
 * Makes the library voice `wanted` — its id, or its name exactly — the voice of the person `slot`
 * names, and keeps it in the roster at `cast` with the model it reads with (LIBRARY_READS). The
 * voice is the account's already: nothing is made and nothing spent, the account's list of
 * voices (GET /v1/voices, free) the one thing asked. Refuses, naming the account's voices, one it
 * has not.
 */
export async function keepLibraryVoice(
  client: SpeechClient,
  slot: Slot,
  wanted: string,
  cast = CAST_FILE,
): Promise<Person> {
  const found = resolveVoice(await accountVoices(client), wanted);
  return keptAs(slot, { voiceId: found.voiceId, model: LIBRARY_READS }, cast);
}
