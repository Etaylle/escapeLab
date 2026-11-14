import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import type { SoundClient } from '../scripts/elevenlabs.js';
import { parseWav, wavBytes } from '../scripts/pcm.js';
import {
  optionsOf,
  planOf,
  readManifest,
  renderWith,
  type Bench,
  type CatalogItem,
  type Manifest,
  type Places,
  type Studio,
} from '../scripts/sfx.js';

/**
 * What the sound script's tests (sfxScript.test.ts, suiteScript.test.ts) run it with: audio of
 * known loudness as WAVs, which the run decodes as they are; a client of their own — no request
 * leaves — that answers with them; folders of a run's own; and the bench and the studio a run
 * works with.
 */

/** A WAV file as afconvert writes one: 16-bit PCM, interleaved, a chunk before the data. */
export function wavOf(rate: number, channels: readonly number[][]): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const data = frames * channels.length * 2;
  const bytes = new Uint8Array(12 + 24 + 12 + 8 + data);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'FLLR'); // afconvert's padding chunk, skipped
  view.setUint32(40, 4, true);
  tag(48, 'data');
  view.setUint32(52, data, true);
  for (let i = 0; i < frames; i++) {
    channels.forEach((channel, c) => {
      const at = 56 + (i * channels.length + c) * 2;
      view.setInt16(at, Math.round((channel[i] ?? 0) * 32767), true);
    });
  }
  return bytes;
}

/** `ms` of silence, then a sine at `amplitude` for `soundMs`, at `rate`. */
export function toneAfter(rate: number, ms: number, amplitude: number, soundMs: number): number[] {
  const quiet = Math.round((rate * ms) / 1000);
  const sound = Math.round((rate * soundMs) / 1000);
  const wave = (i: number): number => amplitude * Math.sin((2 * Math.PI * 441 * i) / rate);
  return [
    ...Array.from({ length: quiet }, () => 0),
    ...Array.from({ length: sound }, (_, i) => wave(i)),
  ];
}

/** What a file holds, in a word: the SHA-1 of its bytes, which a failure says in a line. */
export const digest = (bytes: Uint8Array): string =>
  createHash('sha1').update(bytes).digest('hex');

/** A piece `seconds` long, a 441 Hz tone at `amplitude` throughout, as a WAV at 2 kHz. */
export const piece = (seconds: number, amplitude: number): Uint8Array<ArrayBuffer> =>
  wavOf(2000, [toneAfter(2000, 0, amplitude, seconds * 1000)]);

/** The answers of a client of the tests' own: WAVs, which the tests decode as they are. */
export interface Answers {
  readonly effects?: readonly Uint8Array<ArrayBuffer>[];
  readonly music?: readonly Uint8Array<ArrayBuffer>[];
}

/** What a piece of music is asked with beside its request: the SDK's request options. */
export type Asked = { readonly timeoutInSeconds?: number } | undefined;

/**
 * A client of the tests' own that answers each effect and each piece of music with the next of
 * its answers, round and round, and keeps the requests and what each piece was asked with; the
 * account has 50 000 credits left.
 */
export function answering(answers: Answers) {
  const effects: ElevenLabs.CreateSoundEffectRequest[] = [];
  const pieces: ElevenLabs.BodyComposeMusicV1MusicPost[] = [];
  const asked: Asked[] = [];
  const nth = (list: Answers['music'] = [], i: number): ReadableStream<Uint8Array> =>
    new Blob([list[i % list.length] ?? new Uint8Array(0)]).stream();
  const credits = { characterCount: 81_000, characterLimit: 131_000 };
  const client: SoundClient = {
    user: { subscription: { get: () => Promise.resolve(credits) } },
    textToSoundEffects: {
      convert: (request) => Promise.resolve(nth(answers.effects, effects.push(request) - 1)),
    },
    music: {
      compose: (request, options) => {
        asked.push(options);
        return Promise.resolve(nth(answers.music, pieces.push(request) - 1));
      },
    },
  };
  return { client, effects, pieces, asked };
}

/** Folders of a run's own: each group's and the takes', in a temporary folder. */
export function placesIn(): Places {
  const root = mkdtempSync(join(tmpdir(), 'escapelab-sfx-test-'));
  const dirs = { sfx: join(root, 'sfx'), music: join(root, 'music') };
  return { dirs, takes: join(root, 'takes') };
}

/**
 * A run's bench in `places`: no pause between requests, every take made at `madeAt`, a piece
 * "encoded" as a WAV, which its decoding reads as it is.
 */
export function benchOf(
  client: SoundClient,
  places: Places,
  madeAt = '2026-11-13T17:40:00.000Z',
): Bench {
  return {
    client,
    places,
    decode: (path) => parseWav(readFileSync(path)),
    encode: (pcm, path) => writeFileSync(path, wavBytes(pcm)),
    now: () => new Date(madeAt),
    wait: () => Promise.resolve(),
  };
}

/** A quiet run of `items` through `bench`, `count` takes of each; returns its manifests. */
export async function runOf(
  items: readonly CatalogItem[],
  count: number,
  bench: Bench,
): Promise<Record<'sfx' | 'music', Manifest>> {
  const { places } = bench;
  const manifests = { sfx: readManifest(places, 'sfx'), music: readManifest(places, 'music') };
  const jobs = planOf(items, manifests, () => false, optionsOf(['--candidates', `${count}`]));
  const candidates = mkdtempSync(join(tmpdir(), 'escapelab-sfx-candidates-test-'));
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await renderWith(jobs, manifests, { count, candidates }, bench);
  } finally {
    quiet.mockRestore();
  }
  return manifests;
}

/** A studio over `places` whose account is `client`, and how often the run opened it. */
export function studioOf(
  client: SoundClient,
  places: Places,
): { studio: Studio; opened: () => number } {
  let opened = 0;
  const { decode, encode, now, wait } = benchOf(client, places);
  const studio: Studio = {
    places,
    decode,
    encode,
    now,
    wait,
    candidates: () => mkdtempSync(join(tmpdir(), 'escapelab-sfx-candidates-test-')),
    account: () => {
      opened += 1;
      return Promise.resolve(client);
    },
  };
  return { studio, opened: () => opened };
}
