import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import { voiced } from '../src/radio.js';
import {
  BAND_HIGH,
  BAND_LOW,
  DUCK_LEVEL,
  NOISE_BED,
  radioChain,
  SHAPER_DRIVE,
  shaperCurve,
  type VoiceManifest,
} from '../src/world/radioVoice.js';
import type {
  FakeGain} from './fakeGraph.js';
import {
  chainFrom,
  fakeGraph,
  FakeContext,
  lastContext,
  type FakeBufferSource,
  type FakeFilter,
  type FakeNode,
  type FakeShaper,
} from './fakeGraph.js';

const LEVER_LINE = 'Erst Handbuch im Archiv, dann Kasten und Prüfpult.';
const MANIFEST: VoiceManifest = {
  aaaaaaaaaaaa: { text: LEVER_LINE, ms: 2000, missions: ['blackout'] },
  bbbbbbbbbbbb: { text: 'Beide hin.', ms: 900, missions: ['systemcheck'] },
};

describe('the radio’s chain', () => {
  it('runs high-pass 300 Hz, low-pass 3.4 kHz, each fourth order, and a gentle shaper', () => {
    const ctx = new FakeContext();
    const into = ctx.destination as unknown as AudioNode;
    const chain = radioChain(ctx as unknown as BaseAudioContext, into, 0.5);
    const nodes = chainFrom(chain.input as unknown as FakeNode);
    expect(nodes.map((node) => node.kind)).toEqual([
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain',
      'destination',
    ]);
    const filters = nodes.slice(1, 5) as FakeFilter[];
    expect(filters.map((f) => [f.type, f.frequency.value])).toEqual([
      ['highpass', BAND_LOW],
      ['highpass', BAND_LOW],
      ['lowpass', BAND_HIGH],
      ['lowpass', BAND_HIGH],
    ]);
    // Web Audio takes a high- or low-pass's Q in dB: the Butterworth pair, 0.5412 and 1.3066.
    const qs = filters.map((f) => 10 ** (f.Q.value / 20));
    expect(qs).toEqual([0.5412, 1.3066, 0.5412, 1.3066].map((q) => expect.closeTo(q, 9)));
    expect((nodes[5] as FakeShaper).oversample).toBe('2x');
    expect((nodes[6] as FakeGain).gain.value).toBe(0.5);
  });

  it('bends gently: odd, rising, full scale at the ends and rounded towards them', () => {
    const curve = shaperCurve(1025);
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[1024]).toBeCloseTo(1, 6);
    expect(curve[512]).toBeCloseTo(0, 6);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i] ?? 0).toBeGreaterThan(curve[i - 1] ?? 0);
      expect(curve[i] ?? 0).toBeCloseTo(-(curve[1024 - i] ?? 0), 6);
    }
    const half = curve[768] ?? 0; // x = 0.5
    expect(half).toBeCloseTo(Math.tanh(SHAPER_DRIVE / 2) / Math.tanh(SHAPER_DRIVE), 4);
    expect(half).toBeGreaterThan(0.5); // it lifts the quiet parts…
    expect(half).toBeLessThan(0.9); // …but does not square them off
  });

  it('voices mission control’s lines, never a note of the last crew', () => {
    const line = (kind: RunEvent['kind']): RunEvent => ({ at: 0, kind, label: 'x', seconds: null });
    expect(voiced(line('radio'))).toBe(true);
    expect(voiced(line('hint'))).toBe(false);
  });
});

describe('a line spoken over the radio', () => {
  let fetched: string[] = [];

  beforeEach(() => {
    fakeGraph();
    fetched = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        fetched.push(url);
        const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
        const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
        return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function voice() {
    vi.resetModules();
    return import('../src/world/radioVoice.js');
  }

  /** Lets the fetches and the decoding settle. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('fetches the run’s mission’s lines at its start, and no other mission’s', async () => {
    const radio = await voice();
    radio.preloadVoice('blackout');
    await settle();
    expect(fetched).toEqual(['/voice/manifest.json', '/voice/aaaaaaaaaaaa.m4a']);
    radio.preloadLines(['Beide hin.', 'Etwas ohne Aufnahme.']);
    await settle();
    expect(fetched.at(-1)).toBe('/voice/bbbbbbbbbbbb.m4a');
    expect(fetched).toHaveLength(3);
  });

  it('speaks a recorded line through the chain: squelch, speech over static, tail', async () => {
    const radio = await voice();
    radio.preloadVoice('blackout');
    await settle();
    expect(radio.sayLine(LEVER_LINE)).toBe(true);
    const ctx = lastContext();
    const sources = ctx.all<FakeBufferSource>('buffer');
    const speech = sources.find((s) => s.buffer?.duration === 1.5);
    expect(speech?.startedAt).toBeCloseTo(10.08, 9); // after the key's squelch
    const normal = speech?.outputs[0] as FakeGain;
    expect(normal.gain.value).toBeCloseTo(0.9 / 0.45, 6); // the recording’s peak at 0.9
    const chain = chainFrom(normal.outputs[0] as FakeNode).map((node) => node.kind);
    expect(chain).toEqual([
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain', // the voice's level
      'gain', // the master gain
      'destination',
    ]);
    const bed = sources.find((s) => s.loop);
    expect((bed?.outputs[0] as FakeGain).gain.value).toBe(NOISE_BED);
    expect(bed?.startedAt).toBeCloseTo(10.08, 9);
    expect(bed?.stoppedAt).toBeCloseTo(11.58, 9);
    const bursts = sources.filter((s) => !s.loop && s !== speech).map((s) => s.startedAt as number);
    expect(bursts.some((at) => at < 10.08)).toBe(true); // keyed up
    expect(bursts.some((at) => at > 11.58)).toBe(true); // and down
  });

  it('ducks the beds and the music 6 dB while it speaks, and reports it playing', async () => {
    const radio = await voice();
    radio.preloadVoice('blackout');
    await settle();
    radio.sayLine(LEVER_LINE);
    const ctx = lastContext();
    const master = ctx.all<FakeGain>('gain').find((g) => g.outputs.includes(ctx.destination));
    const duck = ctx.all<FakeGain>('gain').find((g) => g.outputs.includes(master as FakeNode));
    expect(DUCK_LEVEL).toBeCloseTo(0.501, 3);
    expect(duck?.gain.ramps()).toEqual([
      [DUCK_LEVEL, expect.closeTo(10.08, 9)],
      [1, expect.closeTo(11.98, 9)],
    ]);
    ctx.currentTime = 10.05;
    expect(radio.voiceProbe()).toEqual({ playing: false, lastId: 'aaaaaaaaaaaa' });
    ctx.currentTime = 11;
    expect(radio.voiceProbe()).toEqual({ playing: true, lastId: 'aaaaaaaaaaaa' });
    ctx.currentTime = 11.6;
    expect(radio.voiceProbe().playing).toBe(false);
  });

  it('cuts a line short for a newer one, leaves one without a recording to the chirp', async () => {
    const radio = await voice();
    radio.preloadVoice('blackout');
    radio.preloadVoice('systemcheck');
    await settle();
    radio.sayLine(LEVER_LINE);
    const ctx = lastContext();
    ctx.currentTime = 11;
    expect(radio.sayLine('Beide hin.')).toBe(true);
    const clips = ctx.all<FakeBufferSource>('buffer').filter((s) => s.buffer?.duration === 1.5);
    const [first, second] = clips;
    expect(first?.stoppedAt).toBeCloseTo(11.1, 9);
    expect(second?.startedAt).toBeCloseTo(11.08, 9);
    expect(radio.voiceProbe().lastId).toBe('bbbbbbbbbbbb');
    expect(radio.sayLine('Eine Zeile aus dem Editor.')).toBe(false);
  });

  it('says nothing before a gesture woke the sound, nor anything not loaded', async () => {
    const radio = await voice();
    expect(radio.sayLine(LEVER_LINE)).toBe(false); // no manifest yet
    radio.preloadVoice('blackout');
    await settle();
    lastContext().state = 'suspended';
    expect(radio.sayLine(LEVER_LINE)).toBe(false);
    expect(radio.voiceProbe()).toEqual({ playing: false, lastId: null });
  });

  it('renders the chain offline on white noise, for the harness to measure', async () => {
    class Offline extends FakeContext {
      constructor(
        readonly channels: number,
        readonly length: number,
        rate: number,
      ) {
        super();
        this.sampleRate = rate;
      }
      startRendering(): Promise<{ getChannelData: () => Float32Array }> {
        const out = new Float32Array(this.length).fill(0.25);
        return Promise.resolve({ getChannelData: () => out });
      }
    }
    vi.stubGlobal('OfflineAudioContext', Offline);
    const radio = await voice();
    const render = await radio.renderRadio();
    expect(render.rate).toBe(44100);
    expect(render.input).toHaveLength(32768);
    expect(render.output).toHaveLength(32768);
    expect(Math.max(...render.input.map(Math.abs))).toBeLessThanOrEqual(0.5);
    const offline = lastContext();
    const noise = offline.all<FakeBufferSource>('buffer')[0];
    expect(chainFrom(noise as FakeNode).map((node) => node.kind)).toEqual([
      'buffer',
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain',
      'destination',
    ]);
  });
});
