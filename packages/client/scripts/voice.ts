/**
 * Mission control's lines as recordings — macOS only:
 *
 *   pnpm --filter @escapelab/client voice            the lines that have no recording yet
 *   pnpm --filter @escapelab/client voice --fresh    every line anew (another voice, say)
 *
 * Every line a shipped mission (missions/*.json) can put on the air: all core's `logRadio`
 * (core/src/actions.ts) is ever handed — `radio.start` as the clock starts, every
 * `puzzles[].onSolved` as its station is solved, `radio.escape` as the hatch unlocks — and
 * every `puzzles[].nudges` line its `nudge` sends while a station stays quiet. Each is
 * read by the Mac's voice VOICE at RATE words a minute (`say`), the pauses its dashes, middle
 * dots and colons ask for put in (`speechText`), squeezed to AAC at BITRATE (`afconvert`) into
 * public/voice/<the first 12 hex digits of the line's SHA-1>.m4a, and listed in
 * public/voice/manifest.json as { [id]: { text, ms, missions } }. A recording no line needs any
 * more goes. The files are committed; test/voice.test.ts fails when a line has none.
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
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The voice: Anna, the Mac's natural German voice (see docs/sound.md for why). */
export const VOICE = 'Anna';
/** Words a minute: brisk, as a radio operator talks. */
export const RATE = 190;
/** AAC's bit rate, bits a second: a handset's band needs no more. */
export const BITRATE = 48000;
/** A pause where a line has a dash, a middle dot or a colon, ms. */
export const PAUSE_MS = 250;

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

/** One recorded line: what it says, how long it speaks, ms, and the missions that say it. */
export interface Entry {
  text: string;
  ms: number;
  missions: string[];
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

/**
 * A line as the voice reads it: a dash, a middle dot or a colon — not one between two digits,
 * as in a time — becomes a short pause (`say`'s [[slnc]]); everything else stays as it is
 * written: „Pult A" is read as it stands, and numbers are read as numbers.
 */
export function speechText(text: string): string {
  const pause = ` [[slnc ${PAUSE_MS}]] `;
  return text
    .replace(/\s*[·—–]\s*/g, pause)
    .replace(/(?<!\d)\s*:\s*|\s*:\s*(?!\d)/g, pause)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The shipped missions, as the script reads them. */
export function shippedMissions(dir = MISSIONS_DIR): MissionLines[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as MissionLines);
}

/** Every shipped line, by what it says, with the missions that say it. */
export function shippedLines(missions = shippedMissions()): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  for (const mission of missions) {
    for (const text of radioTexts(mission)) {
      const saying = lines.get(text) ?? [];
      if (!saying.includes(mission.id)) saying.push(mission.id);
      lines.set(text, saying);
    }
  }
  return lines;
}

/** Fails with what to do where the Mac's tools are not there. */
function requireTools(): void {
  if (process.platform !== 'darwin') {
    throw new Error(
      'voice: the recordings are made with macOS tools (say, afconvert); run this on a Mac',
    );
  }
  for (const tool of ['say', 'afconvert', 'afinfo']) {
    try {
      execFileSync('/usr/bin/which', [tool], { stdio: 'ignore' });
    } catch {
      throw new Error(`voice: ${tool} is missing — it comes with macOS; is this a Mac?`);
    }
  }
}

/** Reads `text` into `file` (.m4a) and returns how long it speaks, ms. */
function record(text: string, file: string, scratch: string): number {
  const aiff = join(scratch, 'line.aiff');
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, speechText(text)]);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), aiff, file]);
  const info = execFileSync('afinfo', [aiff], { encoding: 'utf8' });
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

/** Makes what is missing (everything with `fresh`), drops what is stale, writes the list. */
function main(fresh: boolean): void {
  requireTools();
  mkdirSync(VOICE_DIR, { recursive: true });
  const before = readManifest();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-voice-'));
  const manifest: Record<string, Entry> = {};
  let made = 0;
  try {
    const lines = [...shippedLines()].sort(([a], [b]) => (voiceId(a) < voiceId(b) ? -1 : 1));
    for (const [text, missions] of lines) {
      const id = voiceId(text);
      const file = join(VOICE_DIR, `${id}.m4a`);
      const kept = before[id];
      const keep = !fresh && kept !== undefined && kept.text === text && existsSync(file);
      const ms = keep ? kept.ms : record(text, file, scratch);
      made += keep ? 0 : 1;
      manifest[id] = { text, ms, missions: [...missions].sort() };
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
  main(process.argv.includes('--fresh'));
}
