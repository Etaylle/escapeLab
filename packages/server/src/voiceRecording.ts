import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * the line says, as the client's voice script names its recordings — as a PCM WAV of 8 MB at
 * most, converts it to AAC into the client's public/voice/<id>.m4a and notes in the manifest
 * how long it speaks and that a person speaks it (`source: 'human'`). The game plays whatever
 * the manifest names. Only with ALLOW_RECORD=1, as `pnpm dev` sets it: without, the route
 * answers 404, and so it does for a line no shipped mission puts on the air.
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

/** Reads a WAV's chunks — `fmt ` and `data`, in any order — for how long its PCM speaks. */
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
      pcm = bytes.readUInt16LE(at + 8) === 1;
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

/** Turns the WAV at `wav` into AAC at `m4a`. */
export type Convert = (wav: string, m4a: string) => Promise<void>;

const execFileAsync = promisify(execFile);

/** afconvert, as the voice script squeezes Piper's lines: AAC at 48 kbit/s in an .m4a. */
export async function afconvert(wav: string, m4a: string): Promise<void> {
  try {
    await execFileAsync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', wav, m4a]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'afconvert fehlt: Umgewandelt wird nur auf einem Mac, macOS bringt afconvert mit.',
      );
    }
    throw err;
  }
}

/** A line a shipped mission puts on the air: what it says, who says it, whether it opens a run. */
export interface ShippedLine {
  text: string;
  missions: string[];
  opens: boolean;
}

/** The manifest's entry for a line, as the voice script writes it. */
interface ManifestEntry {
  text: string;
  ms: number;
  missions: string[];
  opens?: true;
  source?: 'human';
}

/**
 * Where the recordings go and which lines take one: the voice folder with its manifest, the
 * shipped missions, and the step from WAV to AAC (afconvert; a stand-in where a test has
 * none). Saves one after the other, so that two never write the manifest over each other.
 */
export class VoiceDesk {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly missions: () => readonly Mission[],
    private readonly convert: Convert = afconvert,
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

  /** Converts `wav`, a person's recording of `line`, into the folder and notes it there. */
  save(id: string, line: ShippedLine, wav: Buffer, ms: number): Promise<ApiResponse> {
    const saved = this.queue.then(() => this.store(id, line, wav, ms));
    this.queue = saved.catch(() => undefined);
    return saved;
  }

  private async store(
    id: string,
    line: ShippedLine,
    wav: Buffer,
    ms: number,
  ): Promise<ApiResponse> {
    const scratch = mkdtempSync(join(tmpdir(), 'escapelab-record-'));
    const part = join(this.dir, `${id}.m4a.part`);
    try {
      const input = join(scratch, `${id}.wav`);
      writeFileSync(input, wav);
      await this.convert(input, part);
      renameSync(part, join(this.dir, `${id}.m4a`));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(part, { force: true });
    }
    const opening = line.opens ? { opens: true as const } : {};
    this.note(id, { text: line.text, ms, missions: line.missions, ...opening, source: 'human' });
    return { status: 200, body: { id, ms, source: 'human' } };
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
  const segment = VOICE_PATH.exec((req.url ?? '/').split('?')[0] ?? '/')?.[1];
  if (req.method !== 'POST' || segment === undefined) {
    return false;
  }
  answer(desk, segment, req).then(
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

async function answer(
  desk: VoiceDesk | null,
  segment: string,
  req: IncomingMessage,
): Promise<ApiResponse> {
  if (desk === null) {
    const error = 'Aufnahmen nimmt der Server nur mit ALLOW_RECORD=1 an.';
    return { status: 404, body: { error } };
  }
  if (!VOICE_ID.test(segment)) {
    const error = `„${segment}" ist keine Kennung eines Funkspruchs: zwölf Hex-Ziffern.`;
    return { status: 400, body: { error } };
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
  const wav = wavLength(body);
  if (!wav.ok) {
    return { status: 400, body: { error: wav.error } };
  }
  return desk.save(segment, line, body, wav.ms);
}

function send(res: ServerResponse, reply: ApiResponse): void {
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
}
