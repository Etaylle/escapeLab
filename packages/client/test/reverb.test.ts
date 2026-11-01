import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  impulseResponse,
  METAL_MODES,
  ROOM_IRS,
  ROOM_SWITCH_S,
  type IrSpec,
} from '../src/world/reverb.js';
import {
  fakeGraph,
  lastContext,
  type FakeBuffer,
  type FakeConvolver,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';

const RATE = 48000;

/** The RMS of `data` from `from` to `to`, shares of its length. */
function rms(data: Float32Array, from: number, to: number): number {
  const a = Math.floor(data.length * from);
  const b = Math.floor(data.length * to);
  let sum = 0;
  for (let i = a; i < b; i++) sum += (data[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** The share of `data`'s energy in its first difference: how much of it lies up high. */
function brightness(data: Float32Array): number {
  let all = 0;
  let edge = 0;
  for (let i = 1; i < data.length; i++) {
    all += (data[i] ?? 0) ** 2;
    edge += ((data[i] ?? 0) - (data[i - 1] ?? 0)) ** 2;
  }
  return edge / all;
}

/** The power of `data` at `hz` (Goertzel), over its first `seconds`. */
function powerAt(data: Float32Array, hz: number, seconds: number): number {
  const n = Math.floor(seconds * RATE);
  const k = 2 * Math.cos((2 * Math.PI * hz) / RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s = (data[i] ?? 0) + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

describe('a room’s answer', () => {
  it('rings as long as its room’s kind: a corridor 1.2 s, a reactor 1.8, a server 0.4', () => {
    const seconds = Object.fromEntries(Object.entries(ROOM_IRS).map(([k, s]) => [k, s.seconds]));
    expect(seconds).toEqual({
      corridor: 1.2,
      lab: 0.6,
      server: 0.4,
      reactor: 1.8,
      archive: 0.5,
      machine: 1,
      control: 0.7,
      plain: 0.6,
    });
    for (const spec of Object.values(ROOM_IRS)) {
      const [left, right] = impulseResponse(spec, RATE);
      expect([left.length, right.length]).toEqual([
        Math.ceil(spec.seconds * RATE),
        Math.ceil(spec.seconds * RATE),
      ]);
    }
  });

  it('decays by 60 dB over its time: its last tenth far under its first', () => {
    for (const spec of Object.values(ROOM_IRS)) {
      for (const data of impulseResponse(spec, RATE)) {
        const fall = 20 * Math.log10(rms(data, 0.9, 1) / rms(data, 0, 0.1));
        expect(fall).toBeLessThan(-45);
        expect(fall).toBeGreaterThan(-66);
      }
    }
  });

  it('comes out the same from the same seed, two channels apart, another room otherwise', () => {
    const [left, right] = impulseResponse(ROOM_IRS.lab, RATE);
    const [again] = impulseResponse(ROOM_IRS.lab, RATE);
    expect(again).toEqual(left);
    expect(right).not.toEqual(left);
    const [other] = impulseResponse({ ...ROOM_IRS.lab, seed: 99 }, RATE);
    expect(other).not.toEqual(left);
  });

  it('gives back as much as its level says: its RMS gain, a dead archive least', () => {
    for (const spec of Object.values(ROOM_IRS)) {
      for (const data of impulseResponse(spec, RATE)) {
        let sum = 0;
        for (const x of data) sum += x * x;
        expect(Math.sqrt(sum)).toBeCloseTo(spec.level, 4);
      }
    }
    const levels = Object.values(ROOM_IRS).map((spec) => spec.level);
    expect(Math.min(...levels)).toBe(ROOM_IRS.archive.level);
  });

  it('stays bright in a corridor, dull in the server room and among the archive’s books', () => {
    const [corridor] = impulseResponse(ROOM_IRS.corridor, RATE);
    const [server] = impulseResponse(ROOM_IRS.server, RATE);
    const [archive] = impulseResponse(ROOM_IRS.archive, RATE);
    expect(brightness(corridor)).toBeGreaterThan(2 * brightness(server));
    expect(brightness(corridor)).toBeGreaterThan(2 * brightness(archive));
  });

  it('rings like steel in the reactor hall: its modes stand over the noise', () => {
    const plain: IrSpec = { ...ROOM_IRS.reactor, metal: 0 };
    const [steel] = impulseResponse(ROOM_IRS.reactor, RATE);
    const [noise] = impulseResponse(plain, RATE);
    const mode = METAL_MODES[0];
    expect(powerAt(steel, mode, 0.5)).toBeGreaterThan(10 * powerAt(noise, mode, 0.5));
    expect(ROOM_IRS.reactor.metal).toBeGreaterThan(0);
    expect(ROOM_IRS.server.metal).toBe(0);
  });
});

describe('the room answering on the mix’s sends', () => {
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function room() {
    vi.resetModules();
    const audio = await import('../src/world/audio.js');
    const reverb = await import('../src/world/reverb.js');
    const mix = audio.audioEngine() as unknown as { sends: FakeNode; master: FakeNode };
    return { reverb, mix, ctx: lastContext() };
  }

  /** The wet level a convolver's return comes in at. */
  const wetOf = (convolver: FakeConvolver | undefined): FakeGain =>
    convolver?.outputs[0] as FakeGain;

  it('plays the room’s response, as it is, on the sends into the master', async () => {
    const { reverb, mix, ctx } = await room();
    reverb.hearRoom('corridor');
    const [convolver] = ctx.all<FakeConvolver>('convolver');
    const buffer = convolver?.buffer as FakeBuffer;
    expect([buffer.numberOfChannels, buffer.length]).toEqual([2, Math.ceil(1.2 * ctx.sampleRate)]);
    expect(buffer.getChannelData(0)).toEqual(impulseResponse(ROOM_IRS.corridor, 8000)[0]);
    expect(convolver?.normalize).toBe(false); // its level is the room's own
    expect(mix.sends.outputs).toContain(convolver);
    expect(wetOf(convolver).outputs).toEqual([mix.master]);
    expect(wetOf(convolver).gain.ramps()).toEqual([[1, 10 + ROOM_SWITCH_S]]);
    expect(reverb.reverbProbe()).toEqual({ room: 'corridor', crossing: false });
    reverb.hearRoom('corridor'); // the same kind: nothing moves
    expect(ctx.all('convolver')).toHaveLength(1);
  });

  it('crossfades to the next room’s answer over 300 ms, the old one let go after', async () => {
    const { reverb, ctx } = await room();
    reverb.hearRoom('corridor');
    ctx.currentTime = 20;
    reverb.hearRoom('server');
    const [corridor, server] = ctx.all<FakeConvolver>('convolver');
    expect(wetOf(corridor).gain.ramps().at(-1)).toEqual([0, 20 + ROOM_SWITCH_S]);
    expect(wetOf(server).gain.ramps()).toEqual([[1, 20 + ROOM_SWITCH_S]]);
    expect(reverb.reverbProbe()).toEqual({ room: 'server', crossing: true });
    vi.advanceTimersByTime((ROOM_SWITCH_S + 1.2) * 1000 - 1);
    expect(corridor?.disconnected).toBe(false); // its tail still rings
    vi.advanceTimersByTime(1);
    expect(corridor?.disconnected).toBe(true);
    expect(server?.disconnected).toBe(false);
  });

  it('cuts an answer still going for a third, and leaves nobody’s room dry', async () => {
    const { reverb, ctx } = await room();
    reverb.hearRoom('lab');
    reverb.hearRoom('reactor');
    reverb.hearRoom('archive');
    const [lab, reactor, archive] = ctx.all<FakeConvolver>('convolver');
    expect(wetOf(lab).gain.ramps().at(-1)).toEqual([0, expect.closeTo(10.02, 9)]);
    expect(wetOf(reactor).gain.ramps().at(-1)).toEqual([0, 10 + ROOM_SWITCH_S]);
    reverb.hearRoom(null);
    expect(wetOf(archive).gain.ramps().at(-1)).toEqual([0, 10 + ROOM_SWITCH_S]);
    expect(reverb.reverbProbe().room).toBeNull();
    expect(ctx.all('convolver')).toHaveLength(3);
  });

  it('builds nothing with ?audio-off=reverb, and never throws without audio', async () => {
    vi.stubGlobal('location', { search: '?audio-off=reverb' });
    const off = await room();
    off.reverb.hearRoom('corridor');
    expect(off.ctx.all('convolver')).toHaveLength(0);
    vi.stubGlobal('AudioContext', undefined);
    vi.resetModules();
    const none = await import('../src/world/reverb.js');
    expect(() => {
      none.hearRoom('lab');
      none.stopReverb();
    }).not.toThrow();
  });

  it('fades the room out and lets it go when the world goes', async () => {
    const { reverb, ctx } = await room();
    reverb.hearRoom('control');
    reverb.stopReverb();
    const [control] = ctx.all<FakeConvolver>('convolver');
    expect(wetOf(control).gain.ramps().at(-1)).toEqual([0, 10 + ROOM_SWITCH_S]);
    vi.runAllTimers();
    expect(control?.disconnected).toBe(true);
    expect(reverb.reverbProbe()).toEqual({ room: null, crossing: false });
  });
});
