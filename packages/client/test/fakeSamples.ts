import { vi } from 'vitest';
import type { VoiceManifest } from '../src/world/radioVoice.js';
import { MUSIC_IDS, SFX_IDS, type SampleEntry } from '../src/world/samples.js';

/**
 * The lab's recordings as a test serves them: both manifests, each naming every id, and each
 * file as the text "sample:<id>:<seconds>:<channels>", which the fake contexts (fakeGraph.ts,
 * fakeAudio.ts) decode to a buffer of 0.5 throughout — a second channel at 0.25 — tagged with
 * its id, so a test can tell which recording a source plays.
 */

/**
 * How a test serves one recording: its length, its gain, where its sound starts, the bars a
 * piece of the score loops on, its status, its channels, the file its entry names (another's, for
 * an entry that borrows a recording), or no entry at all (`listed: false`, as one awaiting its
 * render).
 */
export interface Served {
  readonly seconds?: number;
  readonly gain?: number;
  readonly startMs?: number;
  readonly bars?: number;
  readonly status?: number;
  readonly channels?: number;
  readonly file?: string;
  readonly listed?: false;
}

/** The stems and stings last as the catalog has them; everything else half a second. */
const SECONDS: Readonly<Record<string, number>> = {
  calm: 72,
  tense: 72,
  critical: 72,
  won: 10,
  lost: 10,
};

const STEMS = new Set(['calm', 'tense', 'critical']);
const LOOPS = new Set(['mains-hum', 'siren', 'drone-rotor', ...STEMS]);

const notFound = (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 }));

/**
 * Serves every recording to `fetch`, an entry changed where `served` says so: its length, its
 * gain, its start, or an HTTP status that fails its file; an address outside public/sfx/ and
 * public/music/ goes to `other`, or is not found. Returns the addresses fetched, in the order
 * they were.
 */
export function serveSamples(
  served: Readonly<Record<string, Served>> = {},
  other: (url: string) => Promise<unknown> = notFound,
): string[] {
  const fetched: string[] = [];
  const secondsOf = (id: string): number => served[id]?.seconds ?? SECONDS[id] ?? 0.5;
  /** The bars a piece of the score loops on, where the test serves it so. */
  const barsOf = (id: string): { bars?: number } => {
    const bars = served[id]?.bars;
    return bars === undefined ? {} : { bars };
  };
  const entry = (id: string): SampleEntry => ({
    file: served[id]?.file ?? `${id}.mp3`,
    ms: Math.round(secondsOf(id) * 1000),
    gain: served[id]?.gain ?? 1,
    startMs: served[id]?.startMs ?? 0,
    floor: 0,
    rms: 0.1,
    loop: LOOPS.has(id) || id.startsWith('bed-'),
    hash: '000000000000',
    ...(STEMS.has(id) ? { bpm: 90 } : {}),
    ...barsOf(id),
    source: 'elevenlabs',
  });
  const listed = (id: string): boolean => served[id]?.listed !== false;
  const manifest = (ids: readonly string[]): Record<string, SampleEntry> =>
    Object.fromEntries(ids.filter(listed).map((id) => [id, entry(id)]));
  vi.stubGlobal('fetch', (url: string) => {
    if (!/^\/(?:sfx|music)\//.test(url)) return other(url);
    fetched.push(url);
    if (url === '/sfx/manifest.json') return Promise.resolve(Response.json(manifest(SFX_IDS)));
    if (url === '/music/manifest.json') return Promise.resolve(Response.json(manifest(MUSIC_IDS)));
    const id = /^\/(?:sfx|music)\/([\w-]+)\.mp3$/.exec(url)?.[1];
    const status = id === undefined ? 404 : (served[id]?.status ?? 200);
    const channels = served[id ?? '']?.channels ?? 1;
    const body = status === 200 ? `sample:${id ?? ''}:${secondsOf(id ?? '')}:${channels}` : null;
    return Promise.resolve(new Response(body, { status }));
  });
  return fetched;
}

/**
 * Serves the lab's recordings (`serveSamples`) and the radio's voice: its list, `manifest`, and
 * each of its recordings as bytes the fake contexts decode. Every address of the voice the page
 * asks for goes into `asked`, in order.
 */
export function serveVoice(manifest: VoiceManifest, asked: string[]): void {
  serveSamples({}, (url: string) => {
    asked.push(url);
    const json = (): Promise<VoiceManifest> => Promise.resolve(manifest);
    const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
    return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
  });
}

/** The samples module afresh, every recording served and every effect, loop and bed loaded. */
export async function loadedSamples(served: Readonly<Record<string, Served>> = {}) {
  serveSamples(served);
  const samples = await import('../src/world/samples.js');
  await Promise.all(SFX_IDS.map((id) => samples.loadSample(id)));
  return samples;
}
