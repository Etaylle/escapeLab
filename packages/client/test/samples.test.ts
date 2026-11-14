import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGraph, type FakeBuffer } from './fakeGraph.js';
import { serveSamples } from './fakeSamples.js';

/**
 * The loader of the lab's recordings (world/samples.ts) against a fetch the tests serve and a
 * fake OfflineAudioContext that decodes what it serves: what is loaded when, folded to one
 * channel or kept in two, let go again, counted — no network, no audio thread.
 */

function unstage(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

async function samples() {
  vi.resetModules();
  const loader = await import('../src/world/samples.js');
  const memory = await import('../src/world/audioMemory.js');
  return { ...loader, decodedBytes: memory.decodedBytes };
}

/** Lets the loads in flight settle, however many turns they take. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const files = (fetched: readonly string[]): string[] =>
  fetched.filter((url) => url.endsWith('.mp3'));

describe('the recordings, loaded', () => {
  beforeEach(() => {
    fakeGraph();
  });
  afterEach(unstage);

  it('loads nothing before it is asked, then the first minute’s recordings only', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    expect(fetched).toEqual([]);
    await Promise.all([loader.preloadSamples(), loader.preloadSamples()]);
    expect(fetched.filter((url) => url.endsWith('manifest.json'))).toEqual(['/sfx/manifest.json']);
    const first = loader.FIRST_MINUTE.map((id) => `/sfx/${id}.mp3`);
    expect(files(fetched).sort()).toEqual(first.sort()); // each once, however often asked
    for (const id of ['lever-chunk', 'breaker-thunk', 'step-steel-2', 'radio-key'] as const) {
      expect(loader.FIRST_MINUTE).toContain(id);
    }
    expect(loader.FIRST_MINUTE.some((id) => loader.isBed(id))).toBe(false);
    expect(files(fetched).some((url) => url.startsWith('/music/'))).toBe(false);
  });

  it('brings the rest of the effects in once asked, two at a time, never a bed', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    await loader.preloadSamples();
    const before = files(fetched).length;
    let running = 0;
    let most = 0;
    const served = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return served(url);
    });
    loader.loadTheRest();
    loader.loadTheRest(); // once
    for (let i = 0; i < 80; i++) await settle();
    const first = new Set<string>(loader.FIRST_MINUTE);
    const rest = loader.SFX_IDS.filter((id) => !loader.isBed(id) && !first.has(id));
    expect(files(fetched).length - before).toBe(rest.length);
    expect(most).toBeLessThanOrEqual(2);
    const beds = loader.SFX_IDS.filter((id) => loader.isBed(id));
    expect(beds.every((id) => loader.sample(id) === null)).toBe(true);
    expect(loader.sample('klaxon')).not.toBeNull();
  });

  it('asks for the rest as soon as an effect not loaded is wanted, not for a bed', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    expect(loader.sample('bed-server')).toBeNull();
    expect(loader.sample('lever-chunk')).toBeNull(); // the first minute's: loading anyway
    await settle();
    expect(files(fetched)).toEqual([]); // a bed is loaded only when its room asks for it
    expect(loader.sample('klaxon')).toBeNull(); // not yet: it brings the rest in
    for (let i = 0; i < 60; i++) await settle();
    expect(loader.sample('klaxon')).not.toBeNull();
  });

  it('folds an effect to one channel at 44.1 kHz; a bed keeps its two at 32 kHz', async () => {
    serveSamples({ klaxon: { channels: 2, gain: 2 }, 'bed-lab': { channels: 2, gain: 0.5 } });
    const loader = await samples();
    const klaxon = await loader.loadSample('klaxon');
    const bed = await loader.loadSample('bed-lab');
    const mono = klaxon?.buffer as unknown as FakeBuffer;
    expect([mono.numberOfChannels, mono.sampleRate]).toEqual([1, loader.DECODE_RATE]);
    expect(mono.data.every((x) => x === ((0.5 + 0.25) / 2) * 2)).toBe(true); // the mean, its gain
    const stereo = bed?.buffer as unknown as FakeBuffer;
    expect([stereo.numberOfChannels, stereo.sampleRate]).toEqual([2, loader.BED_RATE]);
    expect([stereo.getChannelData(0)[0], stereo.getChannelData(1)[0]]).toEqual([0.25, 0.125]);
    expect([loader.DECODE_RATE, loader.BED_RATE]).toEqual([44100, 32000]);
  });

  it('brings a recording to its loudness as it decodes, and starts past its silence', async () => {
    serveSamples({ drip: { gain: 2.5, startMs: 120 } });
    const loader = await samples();
    const drip = await loader.loadSample('drip');
    expect((drip?.buffer as unknown as FakeBuffer).data.every((x) => x === 0.5 * 2.5)).toBe(true);
    expect(drip?.start).toBe(0.12);
    expect(loader.sample('drip')).toBe(drip);
  });

  it('counts what it keeps, and lets a recording go: a later ask loads it anew', async () => {
    const fetched = serveSamples({ 'bed-server': { channels: 2 } });
    const loader = await samples();
    const step = await loader.loadSample('step-concrete-1'); // 0.5 s, one channel at 44.1 kHz
    const bed = await loader.loadSample('bed-server'); // 0.5 s, two channels at 32 kHz
    expect(loader.decodedBytes()).toEqual({
      total: 22050 * 4 + 16000 * 2 * 4,
      effects: 22050 * 4,
      beds: 16000 * 2 * 4,
      voice: 0,
      made: 0,
    });
    expect([step, bed].every((each) => each !== null)).toBe(true);
    loader.releaseSample('bed-server');
    expect(loader.sample('bed-server')).toBeNull();
    expect(loader.decodedBytes().beds).toBe(0);
    await loader.loadSample('bed-server');
    expect(fetched.filter((url) => url === '/sfx/bed-server.mp3')).toHaveLength(2);
  });

  it('shares one load with the recording an entry borrows, counted once', async () => {
    const fetched = serveSamples({ 'step-lino-1': { file: 'step-concrete-1.mp3' } });
    const loader = await samples();
    const [own, borrowed] = await Promise.all([
      loader.loadSample('step-concrete-1'),
      loader.loadSample('step-lino-1'),
    ]);
    expect(borrowed).toBe(own);
    expect(fetched.filter((url) => url === '/sfx/step-concrete-1.mp3')).toHaveLength(1);
    expect(loader.decodedBytes().effects).toBe(22050 * 4);
    loader.releaseSample('step-concrete-1');
    expect(loader.sample('step-lino-1')).toBe(own); // still played by the other
    expect(loader.decodedBytes().effects).toBe(22050 * 4);
    loader.releaseSample('step-lino-1');
    expect(loader.decodedBytes().effects).toBe(0);
  });

  it('leaves silent an entry its manifest does not name yet: it awaits its render', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetched = serveSamples({ 'ui-tick': { listed: false } });
    const loader = await samples();
    expect(await loader.loadSample('ui-tick')).toBeNull();
    expect(files(fetched)).toEqual([]);
    expect(said).not.toHaveBeenCalled();
  });

  it('says once that a recording failed, keeps it silent, and tries it again later', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetched = serveSamples({ siren: { status: 404 } });
    const loader = await samples();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(await loader.loadSample('siren')).toBeNull();
    expect(await loader.loadSample('klaxon')).not.toBeNull(); // the rest are there
    expect(await loader.loadSample('siren')).toBeNull(); // asked again at once: not fetched
    expect(fetched.filter((url) => url === '/sfx/siren.mp3')).toHaveLength(1);
    clock.mockReturnValue(1_000_000 + loader.RETRY_MS);
    expect(await loader.loadSample('siren')).toBeNull();
    expect(fetched.filter((url) => url === '/sfx/siren.mp3')).toHaveLength(2);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said.mock.calls[0]?.[0]).toMatch(/\/sfx\/siren\.mp3 could not be loaded \(HTTP 404\)/);
  });

  it('says once that a list could not be had, and fetches it again later', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let down = true;
    serveSamples();
    const served = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string) =>
      down && url === '/sfx/manifest.json'
        ? Promise.resolve(new Response(null, { status: 503 }))
        : served(url),
    );
    const loader = await samples();
    expect(await loader.loadSample('klaxon')).toBeNull();
    down = false;
    expect(await loader.loadSample('klaxon')).toBeNull(); // asked again at once: not yet
    clock.mockReturnValue(1_000_000 + loader.RETRY_MS);
    expect(await loader.loadSample('klaxon')).not.toBeNull();
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('names the music’s entries for its streams with their tempo, decodes none', async () => {
    const fetched = serveSamples();
    const loader = await samples();
    expect(loader.musicEntry('calm')).toBeNull();
    await loader.musicListed();
    expect(loader.musicEntry('calm')).toMatchObject({ file: 'calm.mp3', bpm: 90 });
    expect(loader.musicEntry('won')?.bpm).toBeUndefined();
    expect(files(fetched)).toEqual([]);
  });
});

describe('a bed brought up too far', () => {
  beforeEach(() => {
    fakeGraph();
  });
  afterEach(unstage);

  it('plays no bed brought up over +12 dB: said once, never fetched; a one-shot', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const served = {
      'bed-facility': { gain: 35.5 },
      'bed-lab': { gain: 3.98 },
      ping: { gain: 20 },
    };
    const fetched = serveSamples(served);
    const loader = await samples();
    expect(loader.BED_GAIN_MAX).toBeCloseTo(3.981, 3); // +12 dB
    expect(await loader.loadSample('bed-facility')).toBeNull();
    expect(await loader.loadSample('bed-facility')).toBeNull();
    expect(await loader.loadSample('bed-lab')).not.toBeNull(); // +12 dB, just
    expect(await loader.loadSample('ping')).not.toBeNull(); // +26 dB: a one-shot's peak
    expect(files(fetched).sort()).toEqual(['/sfx/bed-lab.mp3', '/sfx/ping.mp3']);
    expect(said).toHaveBeenCalledTimes(1);
    const why = /bed-facility\.mp3 could not be loaded \(a bed brought up \+31\.0 dB, over \+12\)/;
    expect(said.mock.calls[0]?.[0]).toMatch(why);
  });
});
