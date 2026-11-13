import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DUCK_ATTACK_S,
  DUCK_DB,
  DUCK_RELEASE_S,
  duckKnots,
  LIMITER,
  limiterMakeup,
  levelOn,
  SEND_DB,
  type Dip,
  type DuckSource,
} from '../src/world/mix.js';
import {
  fakeGraph,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeCompressor,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/** The mix's nodes as the fake graph keeps them. */
interface FakeMix {
  master: FakeGain;
  limiter: FakeCompressor;
  trim: FakeGain;
  sfx: FakeGain;
  ambience: FakeGain;
  ambienceDuck: FakeGain;
  music: FakeGain;
  musicDuck: FakeGain;
  voice: FakeGain;
  announce: FakeGain;
  sends: FakeGain;
}

const db = (level: number): number => 20 * Math.log10(level);

describe('the brickwall on the master', () => {
  it('stands at −3 dB, no knee, 20:1, 1 ms attack and 100 ms release', () => {
    expect(LIMITER).toEqual({ threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
  });

  it('knows the makeup gain Web Audio puts after it: its full-scale gain inverted, to 0.6', () => {
    // At 0 dBFS a 20:1 curve from −3 dB gives −2.85 dB; inverted and raised to 0.6: +1.71 dB.
    expect(limiterMakeup(-3, 20)).toBeCloseTo(1.71, 9);
    expect(limiterMakeup(-6, 4)).toBeCloseTo(2.7, 9);
    expect(limiterMakeup(0, 20)).toBeCloseTo(0, 9);
  });
});

describe('a bus pulled down', () => {
  const dips = (entries: [DuckSource, Dip][]): Map<DuckSource, Dip> => new Map(entries);
  const music = (source: DuckSource): number => 10 ** ((DUCK_DB.music[source] ?? 0) / 20);

  it('pulls the music 8 dB under a voice, 6 under the klaxon and the siren, the beds 4', () => {
    // A voice: mission control's on the radio, and the crew's in the lobby over the menu's sound.
    expect(DUCK_DB).toEqual({
      music: { voice: -8, alarm: -6, siren: -6, crew: -8 },
      ambience: { voice: -4, crew: -4 },
    });
    expect([DUCK_ATTACK_S, DUCK_RELEASE_S]).toEqual([0.05, 0.4]);
  });

  it('goes down over 50 ms as a line starts and comes back over 400 ms after it', () => {
    const knots = duckKnots(dips([['voice', { from: 10, until: 12 }]]), DUCK_DB.music, 9, 1);
    expect(knots).toEqual([
      { at: 9, level: 1 },
      { at: 10, level: 1 },
      { at: 10.05, level: music('voice') },
      { at: 12, level: music('voice') },
      { at: 12.4, level: 1 },
    ]);
    expect(levelOn(knots, 10.025)).toBeCloseTo((1 + music('voice')) / 2, 9);
    expect(levelOn(knots, 11)).toBe(music('voice'));
    expect(levelOn(knots, 12.2)).toBeCloseTo((1 + music('voice')) / 2, 9);
    expect(levelOn(knots, 20)).toBe(1);
  });

  it('holds the deepest of two at once, and lets the shallower one take over', () => {
    const both = dips([
      ['voice', { from: 10, until: 12 }],
      ['alarm', { from: 11, until: 14 }],
    ]);
    const knots = duckKnots(both, DUCK_DB.music, 10, 1);
    expect(knots.map(({ at, level }) => [at, Number(db(level).toFixed(2))])).toEqual([
      [10, 0],
      [10.05, -8],
      [11, -8], // the klaxon comes in: the voice pulls deeper, nothing moves
      [12, -8],
      [12.4, -6], // the voice ends: back up to the klaxon's depth over 400 ms
      [14, -6],
      [14.4, 0],
    ]);
    // The beds feel only the voice: back up for good 400 ms after it.
    const beds = duckKnots(both, DUCK_DB.ambience, 10, 1);
    expect(levelOn(beds, 11)).toBeCloseTo(10 ** (-4 / 20), 12);
    expect(beds.filter((knot) => knot.at >= 12.4).every((knot) => knot.level === 1)).toBe(true);
  });

  it('cuts a move short where the next begins, from where it stood', () => {
    const blip = dips([['voice', { from: 10, until: 10.02 }]]);
    const knots = duckKnots(blip, DUCK_DB.music, 10, 1);
    const halfway = 1 + (music('voice') - 1) * (0.02 / DUCK_ATTACK_S);
    expect(knots[1]).toEqual({ at: 10.02, level: expect.closeTo(halfway, 12) });
    expect(knots[2]).toEqual({ at: expect.closeTo(10.42, 12), level: 1 });
  });

  it('stays down for a pull with no end, and starts from where the bus stands', () => {
    const siren = dips([['siren', { from: 5, until: Infinity }]]);
    const knots = duckKnots(siren, DUCK_DB.music, 10, 0.8);
    expect(knots).toEqual([
      { at: 10, level: 0.8 },
      { at: expect.closeTo(10.05, 12), level: music('siren') },
    ]);
  });
});

describe('the mix on the lab’s context', () => {
  beforeEach(() => {
    fakeGraph();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function engine() {
    vi.resetModules();
    await loadedSamples();
    const audio = await import('../src/world/audio.js');
    const mix = audio.audioEngine() as unknown as FakeMix;
    return { audio, mix, ctx: lastContext() };
  }

  it('sums every bus in the master, the mute, through the brickwall into the output', async () => {
    const { mix, ctx } = await engine();
    expect(mix.master.outputs).toEqual([mix.limiter]);
    expect(mix.limiter.outputs).toEqual([mix.trim]);
    expect(mix.trim.outputs).toEqual([ctx.destination]);
    expect(mix.trim.gain.value).toBeCloseTo(10 ** (-limiterMakeup(-3, 20) / 20), 12);
    const settings = [mix.limiter.threshold, mix.limiter.knee, mix.limiter.ratio];
    expect(settings.map((param) => param.value)).toEqual([-3, 0, 20]);
    expect([mix.limiter.attack.value, mix.limiter.release.value]).toEqual([0.001, 0.1]);
    for (const bus of [mix.sfx, mix.voice, mix.announce, mix.musicDuck, mix.ambienceDuck]) {
      expect(bus.outputs).toContain(mix.master);
    }
    expect(mix.music.outputs).toEqual([mix.musicDuck]);
    expect(mix.ambience.outputs).toEqual([mix.ambienceDuck]);
  });

  it('sends effects, ducked beds and loudspeakers to the reverb, not the radio', async () => {
    const { mix } = await engine();
    const sendOf = (bus: FakeGain): number | undefined => {
      const send = bus.outputs.find((out) => out !== mix.master) as FakeGain | undefined;
      return send?.outputs.includes(mix.sends) === true ? db(send.gain.value) : undefined;
    };
    expect(sendOf(mix.sfx)).toBeCloseTo(SEND_DB.sfx, 9);
    expect(sendOf(mix.ambienceDuck)).toBeCloseTo(SEND_DB.ambience, 9);
    expect(sendOf(mix.announce)).toBeCloseTo(SEND_DB.announce, 9);
    expect(SEND_DB).toEqual({ sfx: -14, ambience: -18, announce: -6 });
    // The radio stays dry, and the music.
    expect(reaches(mix.voice as FakeNode, mix.sends as FakeNode)).toBe(false);
    expect(reaches(mix.music as FakeNode, mix.sends as FakeNode)).toBe(false);
  });

  it('binds Musik to the music, Effekte to effects and beds, Funk to the radio', async () => {
    const { mix } = await engine();
    const { applyVolumes } = await import('../src/settings.js');
    applyVolumes({ radio: 30, effects: 60, music: 90 });
    const target = (bus: FakeGain): unknown => bus.gain.events.at(-1)?.[1];
    expect(target(mix.voice)).toBeCloseTo(0.3, 9);
    expect(target(mix.announce)).toBeCloseTo(0.3, 9);
    expect(target(mix.sfx)).toBeCloseTo(0.6, 9);
    expect(target(mix.ambience)).toBeCloseTo(0.6, 9);
    expect(target(mix.music)).toBeCloseTo(0.9, 9);
  });

  it('builds a later engine at the volumes and the mute already set', async () => {
    vi.resetModules();
    await loadedSamples();
    const audio = await import('../src/world/audio.js');
    audio.setVolumes({ radio: 0.25, effects: 0.5, music: 0.75 });
    audio.setMuted(true);
    const mix = audio.audioEngine() as unknown as FakeMix;
    const values = [mix.voice, mix.sfx, mix.ambience, mix.music, mix.master];
    expect(values.map((bus) => bus.gain.value)).toEqual([0.25, 0.5, 0.5, 0.75, 0]);
  });

  it('pulls the music 6 dB down under the klaxon, and under the siren until it stops', async () => {
    const { audio, mix, ctx } = await engine();
    audio.klaxon(); // a 0.5 s recording as the test serves it
    expect(mix.musicDuck.gain.ramps()).toEqual([
      [1, expect.closeTo(10.01, 9)],
      [expect.closeTo(10 ** (-6 / 20), 9), expect.closeTo(10.06, 9)],
      [expect.closeTo(10 ** (-6 / 20), 9), expect.closeTo(10.51, 9)],
      [1, expect.closeTo(10.91, 9)],
    ]);
    expect(mix.ambienceDuck.gain.ramps().every(([level]) => level === 1)).toBe(true);
    ctx.currentTime = 20;
    audio.startSiren();
    expect(mix.musicDuck.gain.ramps().at(-1)).toEqual([expect.closeTo(10 ** (-6 / 20), 9), 20.05]);
    ctx.currentTime = 30;
    audio.stopSiren();
    expect(mix.musicDuck.gain.ramps().slice(-2)).toEqual([
      [expect.closeTo(10 ** (-6 / 20), 9), 30.3],
      [1, expect.closeTo(30.7, 9)],
    ]);
  });

  it('ticks a volume set through the bus it sets, no oftener than every 60 ms', async () => {
    const { audio, mix, ctx } = await engine();
    const ticks = (): FakeBufferSource[] =>
      ctx.all<FakeBufferSource>('buffer').filter((source) => source.buffer?.tag === 'ui-tick');
    audio.volumeTick('music');
    audio.volumeTick('music'); // the slider dragged on at once: no second tick
    expect(ticks()).toHaveLength(1);
    expect(reaches(ticks()[0] as FakeNode, mix.music as FakeNode)).toBe(true);
    audio.volumeTick('radio');
    expect(reaches(ticks()[1] as FakeNode, mix.voice as FakeNode)).toBe(true);
    ctx.currentTime += 0.06;
    audio.volumeTick('music');
    audio.volumeTick('effects');
    expect(ticks()).toHaveLength(4);
    expect(reaches(ticks()[3] as FakeNode, mix.sfx as FakeNode)).toBe(true);
  });
});
