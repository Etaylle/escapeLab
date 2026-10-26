import { vi } from 'vitest';
import { MUSIC_IDS, SFX_IDS, type SampleEntry } from '../src/world/samples.js';

/**
 * The lab's recordings as a test serves them: both manifests, each naming every id, and each
 * file as the text "sample:<id>:<seconds>", which the fake contexts (fakeGraph.ts,
 * fakeAudio.ts) decode to a buffer of 0.5 throughout, tagged with its id — so a test can tell
 * which recording a source plays.
 */

/** How a test serves one recording: its length, its gain, where its sound starts, its status. */
export interface Served {
  readonly seconds?: number;
  readonly gain?: number;
  readonly startMs?: number;
  readonly status?: number;
}

/** The stems and stings last as the catalog has them; everything else half a second. */
const SECONDS: Readonly<Record<string, number>> = {
  calm: 72,
  tense: 72,
  critical: 72,
  won: 10,
  lost: 10,
};

const LOOPS = new Set(['mains-hum', 'siren', 'drone-rotor', 'calm', 'tense', 'critical']);

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
  const entry = (id: string): SampleEntry => ({
    file: `${id}.mp3`,
    ms: Math.round(secondsOf(id) * 1000),
    gain: served[id]?.gain ?? 1,
    startMs: served[id]?.startMs ?? 0,
    floor: 0,
    rms: 0.1,
    loop: LOOPS.has(id) || id.startsWith('bed-'),
    hash: '000000000000',
    source: 'elevenlabs',
  });
  const manifest = (ids: readonly string[]): Record<string, SampleEntry> =>
    Object.fromEntries(ids.map((id) => [id, entry(id)]));
  vi.stubGlobal('fetch', (url: string) => {
    if (!/^\/(?:sfx|music)\//.test(url)) return other(url);
    fetched.push(url);
    if (url === '/sfx/manifest.json') return Promise.resolve(Response.json(manifest(SFX_IDS)));
    if (url === '/music/manifest.json') return Promise.resolve(Response.json(manifest(MUSIC_IDS)));
    const id = /^\/(?:sfx|music)\/([\w-]+)\.mp3$/.exec(url)?.[1];
    const status = id === undefined ? 404 : (served[id]?.status ?? 200);
    const body = status === 200 ? `sample:${id ?? ''}:${secondsOf(id ?? '')}` : null;
    return Promise.resolve(new Response(body, { status }));
  });
  return fetched;
}

/** The samples module afresh, every recording served and loaded. */
export async function loadedSamples(served: Readonly<Record<string, Served>> = {}) {
  serveSamples(served);
  const samples = await import('../src/world/samples.js');
  await samples.preloadSamples();
  return samples;
}
