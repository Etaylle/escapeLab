import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PA_FROM_MS, PA_GAP_MS } from '../src/world/intro/sequence.js';
import { PA_HIGH, PA_LOW, paChain, REFLECTION_LOWPASS, REFLECTIONS } from '../src/world/pa.js';
import type { VoiceManifest } from '../src/world/radioVoice.js';
import {
  downstream,
  fakeGraph,
  FakeContext,
  lastContext,
  type FakeBufferSource,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
  type FakeParam,
} from './fakeGraph.js';

const FIRST = 'Durchsage der Leitstelle für Trakt C. Es ist 23 Uhr 47.';
const SECOND = 'Reaktor in Teillast, 60 Prozent.';
const MANIFEST: VoiceManifest = {
  aaaaaaaaaaaa: { text: FIRST, ms: 2000, missions: ['blackout'], file: 'aaaaaaaaaaaa.mp3' },
  bbbbbbbbbbbb: { text: SECOND, ms: 1500, missions: ['blackout'], file: 'bbbbbbbbbbbb.mp3' },
};

/** The loudspeakers' chain built on a context of its own, into its output at 0.1. */
function chainOnItsOwn() {
  const ctx = new FakeContext();
  const into = ctx.destination as unknown as AudioNode;
  const pa = paChain(ctx as unknown as BaseAudioContext, into, 0.1);
  return { ctx, pa, input: pa.input as unknown as FakeNode, out: pa.out as unknown as FakeGain };
}

/** A filter's Q as Web Audio takes it for a high- or low-pass, in dB, back to linear. */
const linearQ = (filter: FakeFilter): number => 10 ** (filter.Q.value / 20);

describe('the loudspeakers’ chain', () => {
  it('runs high-pass 300 Hz and low-pass 5 kHz, second order, the direct sound out', () => {
    const { input, out } = chainOnItsOwn();
    expect([PA_LOW, PA_HIGH]).toEqual([300, 5000]);
    const [low] = input.outputs as FakeFilter[];
    const [high] = (low?.outputs ?? []) as FakeFilter[];
    expect([low?.type, low?.frequency.value]).toEqual(['highpass', PA_LOW]);
    expect([high?.type, high?.frequency.value]).toEqual(['lowpass', PA_HIGH]);
    for (const filter of [low, high]) {
      expect(filter && linearQ(filter)).toBeCloseTo(Math.SQRT1_2, 9);
    }
    expect(high?.outputs).toContain(out);
    expect(out.gain.value).toBe(0.1);
  });

  it('lets the room answer later, quieter, duller: no shaper, no static, no squelch', () => {
    const { ctx, input, out } = chainOnItsOwn();
    const high = (input.outputs[0] as FakeNode).outputs[0] as FakeNode;
    type Delay = FakeNode & { delayTime: FakeParam };
    const delays = high.outputs.filter((node) => (node as FakeNode).kind === 'delay') as Delay[];
    expect(delays.map((delay) => delay.delayTime.value)).toEqual(REFLECTIONS.map(([s]) => s));
    for (const [i, delay] of delays.entries()) {
      const [dull] = delay.outputs as FakeFilter[];
      const [level] = (dull?.outputs ?? []) as FakeGain[];
      expect([dull?.type, dull?.frequency.value]).toEqual(['lowpass', REFLECTION_LOWPASS]);
      expect(level?.gain.value).toBe(REFLECTIONS[i]?.[1]);
      expect(level?.outputs).toEqual([out]);
    }
    expect(REFLECTIONS.every(([s, share]) => s > 0.03 && s < 0.12 && share < 0.5)).toBe(true);
    expect(ctx.all('shaper')).toEqual([]);
    expect(ctx.all('buffer')).toEqual([]);
    expect(ctx.all('oscillator')).toEqual([]);
  });
});

describe('the announcement over the loudspeakers', () => {
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
        const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
        return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The voice and the loudspeakers, fresh, the mission's recordings loaded. */
  async function loudspeakers() {
    vi.resetModules();
    const radio = await import('../src/world/radioVoice.js');
    const pa = await import('../src/world/pa.js');
    radio.preloadVoice('blackout');
    await vi.advanceTimersByTimeAsync(0);
    return { radio, pa };
  }

  /** The recordings started so far on the lab's context. */
  const spoken = (): FakeBufferSource[] =>
    lastContext()
      .all<FakeBufferSource>('buffer')
      .filter((source) => source.startedAt !== null);

  it('speaks each line as its moment comes, through the loudspeakers, not the radio', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS - 1);
    expect(spoken()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const [first] = spoken();
    expect(first?.startedAt).toBeCloseTo(10.01, 9);
    const after = [...downstream(first as unknown as FakeNode)];
    const filters = after.filter((node) => node.kind === 'biquad') as FakeFilter[];
    expect(filters.map((filter) => filter.frequency.value)).toEqual(
      expect.arrayContaining([PA_LOW, PA_HIGH, REFLECTION_LOWPASS]),
    );
    expect(filters.some((filter) => filter.frequency.value === 3400)).toBe(false);
    expect(after.some((node) => node.kind === 'delay')).toBe(true);
    expect(after.some((node) => node.kind === 'shaper')).toBe(false);
    // Nothing else plays with it: no static bed, no squelch, no Leitstelle opening.
    expect(spoken()).toHaveLength(1);
    expect(pa.paProbe()).toEqual({ playing: true, lastLine: FIRST, played: 1, cut: false });
    // The second line 0.8 s after the first has ended, by the manifest's 2 s.
    await vi.advanceTimersByTimeAsync(2000 + PA_GAP_MS - 1);
    expect(spoken()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spoken()).toHaveLength(2);
    expect(pa.paProbe().lastLine).toBe(SECOND);
  });

  it('breaks off as the power goes, mid-line, and says nothing more', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS + 500);
    const ctx = lastContext();
    ctx.currentTime = 10.6;
    pa.cutAnnouncement();
    const [first] = spoken();
    expect(first?.stoppedAt).toBeGreaterThan(10.6);
    expect(first?.stoppedAt).toBeLessThan(10.7);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toHaveLength(1);
    expect(pa.paProbe()).toMatchObject({ playing: false, cut: true });
  });

  it('leaves out a line without a recording, and every one whose moment long passed', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement(['Eine Zeile ohne Aufnahme.'], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe().lastLine).toBe('Eine Zeile ohne Aufnahme.');
    // A screen that came in 20 s late: every line's moment long gone.
    pa.startAnnouncement([FIRST, SECOND], Date.now() - 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe().played).toBe(0);
  });

  it('stops with the screen: what was laid out never comes', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(100);
    pa.stopAnnouncement();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe()).toEqual({ playing: false, lastLine: null, played: 0, cut: false });
  });
});
