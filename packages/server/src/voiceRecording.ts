import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { radioLines, type Mission } from '@escapelab/core';
import type { ApiResponse } from './api.js';
import { readBody } from './body.js';

/**
 * A person's voice for mission control (the client's /record page): POST /voice/:id takes a
 * recording of the radio line whose id it names — the first 12 hex digits of the SHA-1 of what
 * the line says, as the client's voice script names its recordings — of 8 MB at most: a take
 * the page recorded (a PCM WAV, `source: 'human'`), or a file put there (`?source=upload`: an
 * MP3, an M4A or a WAV). An MP3 or an M4A is kept as it is, a WAV converted to AAC; either goes
 * into the client's public/voice/ under the line's id, and the manifest's entry for the line
 * names the file, how long it speaks — decoded, to the millisecond — and who made it. The game
 * plays whatever the manifest names. Only with ALLOW_RECORD=1, as `pnpm dev` sets it: without,
 * the route answers 404, and so it does for a line no shipped mission puts on the air.
 */

/** The most a recording may weigh, bytes: some 95 s of 16-bit mono at 44.1 kHz. */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

/**
 * Whether the server takes recordings: with ALLOW_RECORD=1, as `pnpm dev` sets it; not with 0
 * or unset. Throws for anything else, so that a misspelt switch is not mistaken for either.
 */
export function recordingAllowed(env: NodeJS.ProcessEnv): boolean {
  const flag = env['ALLOW_RECORD'] ?? '';
  if (flag === '1') {
    return true;
  }
  if (flag === '' || flag === '0') {
    return false;
  }
  throw new Error(
    `ALLOW_RECORD=${flag} versteht der Server nicht — ALLOW_RECORD=1 nimmt Aufnahmen der ` +
      'Funksprüche an, ohne bleibt es bei den gespeicherten',
  );
}

/** The id of a line's recording: the first 12 hex digits of the SHA-1 of what it says. */
export function voiceId(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** How long a WAV's samples speak, ms; or why it is no PCM WAV, as a sentence. */
export type WavLength = { ok: true; ms: number } | { ok: false; error: string };

/**
 * Reads a WAV's chunks — `fmt ` and `data`, in any order — for how long its PCM speaks: plain
 * PCM (format 1), or PCM in the extensible format (0xFFFE, its sub-format 1), which afconvert
 * writes for a decoded AAC.
 */
export function wavLength(bytes: Buffer): WavLength {
  const riff = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF';
  if (!riff || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, error: 'Keine WAV-Datei: Der RIFF-Kopf fehlt.' };
  }
  let pcm = false;
  let byteRate = 0;
  let data = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ' && size >= 16 && at + 24 <= bytes.length) {
      const format = bytes.readUInt16LE(at + 8);
      const extensible = format === 0xfffe && size >= 40 && at + 34 <= bytes.length;
      pcm = format === 1 || (extensible && bytes.readUInt16LE(at + 32) === 1);
      byteRate = bytes.readUInt32LE(at + 16);
    } else if (id === 'data') {
      data = Math.min(size, bytes.length - at - 8);
    }
    at += 8 + size + (size % 2);
  }
  if (!pcm || byteRate === 0) {
    return { ok: false, error: 'Keine PCM-Aufnahme: Angenommen wird nur unkomprimiertes WAV.' };
  }
  if (data === 0) {
    return { ok: false, error: 'Die Aufnahme ist leer.' };
  }
  return { ok: true, ms: Math.round((data / byteRate) * 1000) };
}

/** What a recording sent in is, by its first bytes. */
export type AudioKind = 'wav' | 'mp3' | 'm4a' | 'webm';

/**
 * The kind of audio `bytes` hold, by their first bytes: RIFF/WAVE, an ID3 tag or an MPEG audio
 * frame (an MP3), an ISO box `ftyp` (an M4A), the EBML header (a WebM); null for anything else.
 */
export function audioKind(bytes: Buffer): AudioKind | null {
  const ascii = (from: number, to: number): string => bytes.toString('ascii', from, to);
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  const [first = 0, second = 0] = bytes;
  // An MPEG frame: eleven bits of sync, then a layer that is not 0 (which AAC's ADTS has).
  const frame = first === 0xff && (second & 0xe0) === 0xe0 && (second & 0x06) !== 0;
  if (ascii(0, 3) === 'ID3' || frame) return 'mp3';
  if (bytes.length >= 8 && ascii(4, 8) === 'ftyp') return 'm4a';
  return bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 ? 'webm' : null;
}

/** Who made a recording sent in: a person at the page's microphone, or a file put there. */
export type Source = 'human' | 'upload';

/** Turns the WAV at `wav` into AAC at `m4a`. */
export type Convert = (wav: string, m4a: string) => Promise<void>;

/** How long the recording at `file` speaks, decoded, ms. */
export type Measure = (file: string) => Promise<number>;

const execFileAsync = promisify(execFile);

/** Runs afconvert, and says what to do where there is none. */
async function afconvertRun(args: readonly string[]): Promise<void> {
  try {
    await execFileAsync('afconvert', [...args]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'afconvert fehlt: Umgewandelt wird nur auf einem Mac, macOS bringt afconvert mit.',
      );
    }
    throw err;
  }
}

/** afconvert, as the voice script squeezes Piper's lines: AAC at 48 kbit/s in an .m4a. */
export function afconvert(wav: string, m4a: string): Promise<void> {
  return afconvertRun(['-f', 'm4af', '-d', 'aac', '-b', '48000', wav, m4a]);
}

/** How long `file` speaks, ms: decoded by afconvert into a WAV, whose samples are counted. */
export async function decodedMs(file: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'escapelab-measure-'));
  try {
    const wav = join(dir, 'decoded.wav');
    await afconvertRun(['-f', 'WAVE', '-d', 'LEI16', file, wav]);
    const length = wavLength(readFileSync(wav));
    if (!length.ok) {
      throw new Error(length.error);
    }
    return length.ms;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A line a shipped mission puts on the air: what it says, who says it, whether it opens a run. */
export interface ShippedLine {
  text: string;
  missions: string[];
  opens: boolean;
}

/** A recording sent in: its kind, its bytes, and — for a WAV, from its header — its length. */
export interface Sound {
  readonly kind: Exclude<AudioKind, 'webm'>;
  readonly bytes: Buffer;
  readonly ms: number | null;
}

/** The manifest's entry for a line, as the voice script writes it. */
interface ManifestEntry {
  text: string;
  ms: number;
  missions: string[];
  opens?: true;
  source?: Source;
  file: string;
}

/**
 * Where the recordings go and which lines take one: the voice folder with its manifest, the
 * shipped missions, the step from WAV to AAC and the measure of a file kept as it is (afconvert;
 * stand-ins where a test has none). Saves one after the other, so that two never write the
 * manifest over each other.
 */
export class VoiceDesk {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly missions: () => readonly Mission[],
    private readonly convert: Convert = afconvert,
    private readonly measure: Measure = decodedMs,
  ) {}

  /** The shipped line whose recording has the id `id`; null where no mission says it. */
  line(id: string): ShippedLine | null {
    let found: ShippedLine | null = null;
    for (const mission of this.missions()) {
      for (const line of radioLines(mission).filter((said) => voiceId(said.text) === id)) {
        found ??= { text: line.text, missions: [], opens: false };
        if (!found.missions.includes(mission.id)) found.missions.push(mission.id);
        found.opens ||= line.when === 'start';
      }
    }
    found?.missions.sort();
    return found;
  }

  /** Stores `sound`, a recording of `line` made by `source`, and notes it in the manifest. */
  save(id: string, line: ShippedLine, sound: Sound, source: Source): Promise<ApiResponse> {
    const saved = this.queue.then(() => this.store(id, line, sound, source));
    this.queue = saved.catch(() => undefined);
    return saved;
  }

  private async store(
    id: string,
    line: ShippedLine,
    sound: Sound,
    source: Source,
  ): Promise<ApiResponse> {
    const file = `${id}.${sound.kind === 'mp3' ? 'mp3' : 'm4a'}`;
    const scratch = mkdtempSync(join(tmpdir(), 'escapelab-record-'));
    try {
      const input = join(scratch, `${id}.${sound.kind}`);
      writeFileSync(input, sound.bytes);
      const ms = sound.ms ?? (await this.lengthOf(input));
      if (typeof ms === 'string') {
        return { status: 400, body: { error: `Die Datei ließ sich nicht lesen: ${ms}` } };
      }
      await this.put(input, sound.kind === 'wav', file);
      // The line's recording of the other kind, an earlier one, goes.
      rmSync(join(this.dir, file.endsWith('.mp3') ? `${id}.m4a` : `${id}.mp3`), { force: true });
      const opening = line.opens ? { opens: true as const } : {};
      this.note(id, { text: line.text, ms, missions: line.missions, ...opening, source, file });
      return { status: 200, body: { id, ms, source, file } };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /** How long a file kept as it is speaks, decoded, ms; or why it does not decode. */
  private lengthOf(input: string): Promise<number | string> {
    return this.measure(input).catch((err: unknown) =>
      err instanceof Error ? err.message : String(err),
    );
  }

  /** Puts `input` into the folder as `file`, whole or not at all: converted, or as it came. */
  private async put(input: string, convert: boolean, file: string): Promise<void> {
    const part = join(this.dir, `${file}.part`);
    try {
      if (convert) {
        await this.convert(input, part);
      } else {
        copyFileSync(input, part);
      }
      renameSync(part, join(this.dir, file));
    } finally {
      rmSync(part, { force: true });
    }
  }

  /** Writes `entry` into the manifest, which keeps its entries in the order of their ids. */
  private note(id: string, entry: ManifestEntry): void {
    const file = join(this.dir, 'manifest.json');
    const manifest = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, ManifestEntry>)
      : {};
    manifest[id] = entry;
    const sorted = Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1));
    writeFileSync(`${file}.tmp`, `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  }
}

const VOICE_PATH = /^\/voice\/([^/]+)$/;
const VOICE_ID = /^[0-9a-f]{12}$/;

/**
 * Answers POST /voice/:id — with `desk` null, as without ALLOW_RECORD=1, a 404 — and returns
 * true when the request was one (the answer may follow once its body is in).
 */
export function serveVoiceRecording(
  desk: VoiceDesk | null,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const [path = '/', query = ''] = (req.url ?? '/').split('?');
  const segment = VOICE_PATH.exec(path)?.[1];
  if (req.method !== 'POST' || segment === undefined) {
    return false;
  }
  answer(desk, segment, new URLSearchParams(query), req).then(
    (reply) => send(res, reply),
    (err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[escapelab] POST ${req.url} failed: ${reason}`);
      const error = `Die Aufnahme ließ sich nicht speichern: ${reason}`;
      send(res, { status: 500, body: { error } });
    },
  );
  return true;
}

/**
 * Who made the recording, as the address says — ?source=upload for a file, a person else — or
 * why the address cannot be one for a recording.
 */
function sourceOf(segment: string, query: URLSearchParams): Source | ApiResponse {
  if (!VOICE_ID.test(segment)) {
    const error = `„${segment}" ist keine Kennung eines Funkspruchs: zwölf Hex-Ziffern.`;
    return { status: 400, body: { error } };
  }
  const asked = query.get('source') ?? 'human';
  if (asked !== 'human' && asked !== 'upload') {
    const error = `source=${asked} gibt es nicht: Eine Datei kommt mit source=upload.`;
    return { status: 400, body: { error } };
  }
  return asked;
}

/** What the request's bytes are, or why the route turns them away. */
function soundOf(bytes: Buffer): Sound | ApiResponse {
  const kind = audioKind(bytes);
  if (kind === 'webm') {
    const error = 'WebM kann afconvert nicht lesen: Angenommen werden mp3, m4a oder wav.';
    return { status: 415, body: { error } };
  }
  if (kind === null) {
    const error = 'Keine Audiodatei: Angenommen werden mp3, m4a oder wav.';
    return { status: 415, body: { error } };
  }
  if (kind !== 'wav') {
    return { kind, bytes, ms: null };
  }
  const wav = wavLength(bytes);
  return wav.ok ? { kind, bytes, ms: wav.ms } : { status: 400, body: { error: wav.error } };
}

async function answer(
  desk: VoiceDesk | null,
  segment: string,
  query: URLSearchParams,
  req: IncomingMessage,
): Promise<ApiResponse> {
  if (desk === null) {
    const error = 'Aufnahmen nimmt der Server nur mit ALLOW_RECORD=1 an.';
    return { status: 404, body: { error } };
  }
  const source = sourceOf(segment, query);
  if (typeof source !== 'string') {
    return source;
  }
  const line = desk.line(segment);
  if (line === null) {
    const error = `Zur Kennung ${segment} gibt es keinen Funkspruch in den Missionen.`;
    return { status: 404, body: { error } };
  }
  const body = await readBody(req, MAX_RECORDING_BYTES);
  if (body === null) {
    const error = `Die Aufnahme ist größer als ${MAX_RECORDING_BYTES / 1024 / 1024} MB.`;
    return { status: 413, body: { error } };
  }
  const sound = soundOf(body);
  return 'status' in sound ? sound : desk.save(segment, line, sound, source);
}

function send(res: ServerResponse, reply: ApiResponse): void {
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
}
