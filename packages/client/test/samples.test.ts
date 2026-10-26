import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGraph, type FakeBuffer } from './fakeGraph.js';
import { serveSamples } from './fakeSamples.js';

/**
 * The loader of the lab's recordings (world/samples.ts) against a fetch the tests serve and a
 * fake OfflineAudioContext that decodes what it serves: no network, no audio thread.
 */

describe('the recordings, loaded', () => {
  beforeEach(() => {
    fakeGraph();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function samples() {
    vi.resetModules();
    return import('../src/world/samples.js');
  }

  const entry = {
    file: 'x.mp3',
    ms: 500,
    gain: 1,
    startMs: 0,
    loop: false,
    hash: '0',
    source: 'elevenlabs',
  } as const;

  it('fetches both lists and every recording they name, once however often asked', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    expect(loader.sample('klaxon')).toBeNull(); // nothing before the lobby asks
    await Promise.all([loader.preloadSamples(), loader.preloadSamples()]);
    expect(fetched.filter((url) => url.endsWith('manifest.json'))).toEqual([
      '/sfx/manifest.json',
      '/music/manifest.json',
    ]);
    const files = fetched.filter((url) => url.endsWith('.mp3'));
    expect(files).toHaveLength(loader.SFX_IDS.length + loader.MUSIC_IDS.length);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain('/sfx/klaxon.mp3');
    expect(files).toContain('/music/calm.mp3');
    expect(loader.sample('klaxon')?.buffer).toMatchObject({ tag: 'klaxon' });
    await loader.preloadSamples();
    expect(fetched.filter((url) => url.endsWith('.mp3'))).toHaveLength(files.length);
  });

  it('shares one load between two asks for the same address', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    const [a, b] = await Promise.all([
      loader.loadSample('klaxon', '/sfx/klaxon.mp3', entry),
      loader.loadSample('klaxon', '/sfx/klaxon.mp3', entry),
    ]);
    expect(a).toBe(b);
    expect(fetched).toEqual(['/sfx/klaxon.mp3']);
  });

  it('brings a recording to its loudness as it decodes, and starts past its silence', async () => {
    serveSamples({ drip: { gain: 2.5, startMs: 120 } });
    const loader = await samples();
    await loader.preloadSamples();
    const drip = loader.sample('drip');
    expect((drip?.buffer as unknown as FakeBuffer).data.every((x) => x === 0.5 * 2.5)).toBe(true);
    expect(drip?.start).toBe(0.12);
    expect((loader.sample('creak')?.buffer as unknown as FakeBuffer).data[0]).toBe(0.5);
  });

  it('says once that a recording failed, keeps it silent, and tries it again', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetched = serveSamples({ siren: { status: 404 } });
    const loader = await samples();
    await loader.preloadSamples();
    expect(loader.sample('siren')).toBeNull();
    expect(loader.sample('klaxon')).not.toBeNull(); // the rest are there
    expect(await loader.loadSample('siren', '/sfx/siren.mp3', entry)).toBeNull();
    expect(fetched.filter((url) => url === '/sfx/siren.mp3')).toHaveLength(2);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said.mock.calls[0]?.[0]).toMatch(/\/sfx\/siren\.mp3 could not be loaded \(HTTP 404\)/);
  });

  it('says once that a list could not be had, and fetches it again on the next ask', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let down = true;
    serveSamples({}, () => Promise.resolve(new Response(null, { status: 404 })));
    const served = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string) =>
      down && url === '/music/manifest.json'
        ? Promise.resolve(new Response(null, { status: 503 }))
        : served(url),
    );
    const loader = await samples();
    await loader.preloadSamples();
    expect(loader.sample('calm')).toBeNull();
    expect(loader.sample('klaxon')).not.toBeNull();
    down = false;
    await loader.preloadSamples();
    expect(loader.sample('calm')).not.toBeNull();
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('hands a recording over once the loading has settled, null for one that failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serveSamples({ 'mains-hum': { status: 500 } });
    const loader = await samples();
    expect(await loader.sampleLoaded('klaxon')).not.toBeNull();
    expect(await loader.sampleLoaded('mains-hum')).toBeNull();
  });
});
