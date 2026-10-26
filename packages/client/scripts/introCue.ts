/**
 * The opening's music (src/world/intro/cue.ts), composed once by ElevenLabs Music:
 *
 *   pnpm --filter @escapelab/client intro-cue             compose it, where missing or stale
 *   pnpm --filter @escapelab/client intro-cue --dry-run   what it would do and spend
 *
 * One instrumental bed of CUE_MS — dark, low, industrial, slowly building, as CUE_PROMPT asks —
 * through the official SDK, @elevenlabs/elevenlabs-js, into public/intro/title.mp3, and its list
 * public/intro/manifest.json { file, ms, hash }. `hash` is over what makes the cue — the whole
 * request: the prompt, the length, the format, instrumental — so that a run finding the same
 * hash and its file composes nothing anew, and a changed prompt composes it again. Before it
 * composes, it reads the account's credits (`client.user.subscription.get()`) and stops where
 * fewer than CREDIT_FLOOR remain; afterwards it says what the cue cost. The key comes from the
 * environment, as the voice script's does (elevenlabs.ts `loadApiKey`), and is printed nowhere.
 *
 * Runs on Node's own TypeScript (type stripping), as the voice script does, and measures the
 * file with macOS's afinfo.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { loadApiKey } from './elevenlabs.ts';

/** What the cue is asked to be: a bed under an announcement, no tune to talk over. */
export const CUE_PROMPT =
  'Instrumental underscore for the opening of a game set in a 1980s research facility at ' +
  'night. A deep, sustained synth drone and the distant hum of heavy machinery, slow metallic ' +
  'pulses like a ventilation fan turning, sparse and cold. No melody, no drums, no vocals. It ' +
  'builds very slowly over the whole length: a low string swell and a sub-bass rumble rise ' +
  'towards the end, restrained and industrial, and it stays low enough to speak over.';
/** How long the cue runs, ms: the opening's shot and a little more; the blackout cuts it off. */
export const CUE_MS = 40_000;
/** MP3 at 44.1 kHz and 96 kbit/s, as the voice's: a bed under speech needs no more. */
export const CUE_FORMAT = 'mp3_44100_96';
/** Fewer credits left than this, and the script composes nothing. */
export const CREDIT_FLOOR = 40_000;
/** The cue's file in its folder. */
export const CUE_FILE = 'title.mp3';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where the cue and its list go. */
export const INTRO_DIR = resolve(HERE, '../public/intro');

/** The cue's list, as the client reads it (cue.ts `CueManifest`). */
export interface CueEntry {
  file: string;
  ms: number;
  hash: string;
}

/** What the script asks of the SDK's client: the account's credits, and music. */
export interface CueClient {
  readonly user: {
    readonly subscription: {
      get(): PromiseLike<{ readonly characterCount: number; readonly characterLimit: number }>;
    };
  };
  readonly music: {
    compose(
      request: ElevenLabs.BodyComposeMusicV1MusicPost,
    ): PromiseLike<ReadableStream<Uint8Array>>;
  };
}

/** What ElevenLabs is asked for. */
export function cueRequest(): ElevenLabs.BodyComposeMusicV1MusicPost {
  return {
    prompt: CUE_PROMPT,
    musicLengthMs: CUE_MS,
    forceInstrumental: true,
    outputFormat: CUE_FORMAT,
  };
}

/** The cue's hash: the first 12 hex digits of the SHA-1 of the request that makes it. */
export function cueHash(request: ElevenLabs.BodyComposeMusicV1MusicPost): string {
  return createHash('sha1').update(JSON.stringify(request), 'utf8').digest('hex').slice(0, 12);
}

/** How many credits the account has left. */
export async function creditsLeft(client: CueClient): Promise<number> {
  const { characterCount, characterLimit } = await client.user.subscription.get();
  return characterLimit - characterCount;
}

/** What the script works on: the folder, how a file is measured, where it reports. */
export interface CueRun {
  readonly dir: string;
  /** how long the file at a path plays, ms */
  readonly measure: (path: string) => number;
  readonly log: (line: string) => void;
  readonly dryRun: boolean;
}

/** The list in `dir` as it stands; null where there is none. */
function readEntry(dir: string): CueEntry | null {
  const file = join(dir, 'manifest.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CueEntry) : null;
}

/**
 * Composes the cue into `run.dir` where its list does not name the cue this request makes
 * (`cueHash`) or its file is gone: after reading the credits, and only with CREDIT_FLOOR left.
 * Returns what it did: kept the cue, only planned it (a dry run), or composed it.
 */
export async function composeCue(
  client: CueClient,
  run: CueRun,
): Promise<'kept' | 'planned' | 'composed'> {
  const request = cueRequest();
  const hash = cueHash(request);
  const kept = readEntry(run.dir);
  if (kept?.hash === hash && existsSync(join(run.dir, kept.file))) {
    run.log(`intro cue: ${kept.file} is the cue this prompt makes (${hash}); nothing to compose`);
    return 'kept';
  }
  const left = await creditsLeft(client);
  run.log(`intro cue: ${left} credits left`);
  if (left < CREDIT_FLOOR) {
    throw new Error(
      `intro cue: only ${left} credits left, under ${CREDIT_FLOOR} — nothing composed; ` +
        'wait for the plan to renew, or raise CREDIT_FLOOR knowingly',
    );
  }
  if (run.dryRun) {
    run.log(`intro cue: would compose ${CUE_MS / 1000} s (${hash}) into ${run.dir}`);
    return 'planned';
  }
  const audio = await client.music.compose(request);
  mkdirSync(run.dir, { recursive: true });
  const path = join(run.dir, CUE_FILE);
  writeFileSync(path, Buffer.from(await new Response(audio).arrayBuffer()));
  const entry: CueEntry = { file: CUE_FILE, ms: run.measure(path), hash };
  writeFileSync(join(run.dir, 'manifest.json'), `${JSON.stringify(entry, null, 2)}\n`);
  const after = await creditsLeft(client);
  run.log(`intro cue: ${entry.ms} ms into ${path}, ${left - after} credits spent, ${after} left`);
  return 'composed';
}

/** How long the file at `path` plays, ms, as afinfo estimates it. */
function afinfoMs(path: string): number {
  const info = execFileSync('afinfo', [path], { encoding: 'utf8' });
  const seconds = /estimated duration:\s*([\d.]+)/.exec(info)?.[1];
  if (seconds === undefined) {
    throw new Error(`intro cue: afinfo gave no duration for ${path}`);
  }
  return Math.round(Number(seconds) * 1000);
}

/** The SDK's client, which takes the key from the environment and leaves retrying to us. */
async function cueClient(): Promise<CueClient> {
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  return new ElevenLabsClient({ maxRetries: 0 });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(async () => {
      loadApiKey();
      const run = {
        dir: INTRO_DIR,
        measure: afinfoMs,
        log: (line: string) => console.log(line),
        dryRun: process.argv.includes('--dry-run'),
      };
      await composeCue(await cueClient(), run);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
