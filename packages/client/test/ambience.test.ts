import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type MapView } from '@escapelab/core';
import {
  BED_LEVEL,
  bedLevels,
  bedPower,
  CORE_PERIOD_S,
  IDLE,
  loopsOf,
  MAX_NEIGHBOURS,
  NEIGHBOUR_LEVEL,
  nextCorePeak,
  OCCASIONS,
  POWER_DIE_S,
  POWERED,
  ROOM_FADE_S,
  roomAt,
  roomPlan,
  type Power,
  type RoomScene,
} from '../src/world/ambience.js';
import { CAPS } from '../src/world/audio.js';
import { dressMap, seedOf, type DressMap } from '../src/world/dress.js';
import { pulseAt } from '../src/world/gl/pack.js';
import { warmUp } from '../src/world/rooms.js';
import {
  endAll,
  fakeGraph,
  flush,
  FakeOfflineContext,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeContext,
  type FakeGain,
  type FakeOscillator,
} from './fakeGraph.js';

/** A shipped mission's map as the dressing and the beds read it, every door shut. */
function shippedMap(name: string): DressMap {
  const mission = parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${name}.json`, import.meta.url), 'utf8')),
  );
  const { map } = mission;
  return {
    width: map.tiles[0]?.length ?? 0,
    height: map.tiles.length,
    tiles: map.tiles,
    labels: map.labels.map(({ text, x, y, kind }) => ({ text, x, y, ...(kind ? { kind } : {}) })),
    doors: map.doors.map(({ id, x, y }): MapView['doors'][number] => ({ id, x, y, open: false })),
    lamps: map.lamps,
    decor: map.decor.map((d) => ({ kind: d.kind, x: d.x, y: d.y })),
  };
}

const blackout = shippedMap('blackout');
const dressing = dressMap(blackout, seedOf('blackout'));
const plan = roomPlan(dressing, blackout.doors);

/** The blackout map with the doors `open` open: a new object, as every view is. */
function withDoors(...open: string[]): DressMap {
  return { ...blackout, doors: blackout.doors.map((d) => ({ ...d, open: open.includes(d.id) })) };
}

const POWER_ON: Power = { outAt: null, lit: new Map(), won: false };
const IN_FLUR = { x: 5.5, y: 8.5 };

describe('the rooms the beds are heard from', () => {
  it('names each tile by the room its label claims, and keeps the room in a doorway', () => {
    expect(roomAt(plan, 4, 1, null)).toBe('ARCHIV');
    expect(roomAt(plan, 4, 6, 'ARCHIV')).toBe('FLUR'); // the opening belongs to the corridor
    expect(roomAt(plan, 23, 12, null)).toBe('REAKTOR');
    expect(roomAt(plan, 4, 10, 'MASCHINENRAUM')).toBe('MASCHINENRAUM'); // on the door
    expect(roomAt(plan, 0, 0, 'LABOR')).toBe('LABOR'); // a wall
  });

  it('knows each room by its kind, and the ways between rooms and where they are', () => {
    expect(plan.kinds.get('ARCHIV')).toBe('archive');
    expect(plan.kinds.get('REAKTOR')).toBe('reactor');
    expect(plan.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ a: 'ARCHIV', b: 'FLUR', door: null }),
        { a: 'FLUR', b: 'MASCHINENRAUM', door: 'maschinentuer', x: 4.5, y: 10.5 },
        { a: 'REAKTOR', b: 'SÜD-FLUR', door: 'reaktortuer', x: 19.5, y: 13.5 },
      ]),
    );
    expect(plan.links.some((link) => link.a === link.b)).toBe(false);
  });

  it('plays the own room at full, the nearest rooms behind open ways 12 dB under', () => {
    expect(NEIGHBOUR_LEVEL).toBeCloseTo(0.251, 3);
    const shut = bedLevels(plan, 'FLUR', new Set(), IN_FLUR);
    expect(shut).toEqual(new Map([['FLUR', 1], ['ARCHIV', NEIGHBOUR_LEVEL]]));
    const open = bedLevels(plan, 'FLUR', new Set(['maschinentuer']), IN_FLUR);
    expect(open.get('MASCHINENRAUM')).toBe(NEIGHBOUR_LEVEL);
    expect(open.has('REAKTOR')).toBe(false); // two doors away
  });

  it('hears only the MAX_NEIGHBOURS rooms whose ways lie nearest', () => {
    expect(MAX_NEIGHBOURS).toBe(2);
    const doors = new Set(['maschinentuer', 'serverschott', 'labortuer']);
    const west = bedLevels(plan, 'FLUR', doors, { x: 3.5, y: 8.5 });
    expect([...west.keys()].sort()).toEqual(['ARCHIV', 'FLUR', 'MASCHINENRAUM']);
    const east = bedLevels(plan, 'FLUR', doors, { x: 14.5, y: 8.5 });
    expect([...east.keys()].sort()).toEqual(['FLUR', 'MASCHINENRAUM', 'SERVERRAUM']);
  });

  it('plays nothing for a listener in no room, as the audience is', () => {
    expect(bedLevels(plan, null, new Set(), IN_FLUR).size).toBe(0);
  });
});

describe('the power of a bed', () => {
  it('runs on the lab’s power, dies when it fails, comes back with the room’s lights', () => {
    expect(bedPower('FLUR', POWER_ON, 3)).toEqual({ alive: true, warm: Infinity });
    const out: Power = { outAt: 5000, lit: new Map(), won: false };
    expect(bedPower('FLUR', out, 3)).toEqual({ alive: false, from: 5000 });
    const lit: Power = { ...out, lit: new Map([['FLUR', { since: 2.8 }]]) };
    expect(bedPower('FLUR', lit, 3)).toEqual({ alive: true, warm: expect.closeTo(0.2, 6) });
    expect(bedPower('ARCHIV', { ...out, won: true }, 3)).toEqual({ alive: true, warm: Infinity });
  });

  it('plays both layers in the own room, the main one only behind a door', () => {
    expect(loopsOf('reactor', true, false)).toEqual({ power: true, idle: true });
    expect(loopsOf('reactor', true, true)).toEqual({ power: true, idle: false });
    expect(loopsOf('reactor', false, true)).toEqual({ power: false, idle: true });
    expect(loopsOf('archive', false, false)).toEqual({ power: false, idle: false });
    expect(loopsOf('machine', true, false)).toEqual({ power: false, idle: true });
  });

  it('beats with the core: on the top of its light’s pulse', () => {
    expect(nextCorePeak(0.59)).toBeCloseTo(0.6, 9);
    expect(nextCorePeak(0.6)).toBeCloseTo(3.0, 9); // strictly after: that one is due now
    const pulse = { periodMs: CORE_PERIOD_S * 1000, depth: 0.4 };
    for (const time of [0, 1.9, 7.3]) {
      expect(pulseAt(pulse, nextCorePeak(time) * 1000)).toBeCloseTo(1, 9);
    }
  });
});

describe('the layers, rendered once into loops', () => {
  type Build = (ctx: BaseAudioContext, dest: AudioNode) => void;

  /** What a recipe builds on an offline context: its tones by frequency, its noise sources. */
  function rendered(build: Build | undefined) {
    const ctx = new FakeOfflineContext(1, 1000, 24000);
    build?.(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode);
    const tones = ctx.all<FakeOscillator>('oscillator').filter((o) => reaches(o, ctx.destination));
    return { tones: tones.map((o) => o.frequency.value), noise: ctx.all('buffer').length, ctx };
  }

  it('gives a server room fans, a 120 Hz hum and a faint 8 kHz whine; a reactor its rumble', () => {
    expect(rendered(POWERED.server)).toMatchObject({ tones: [120, 240, 8000], noise: 1 });
    expect(rendered(POWERED.lab)).toMatchObject({ tones: [50, 100, 150], noise: 0 });
    expect(rendered(IDLE.reactor)).toMatchObject({ tones: [30], noise: 1 });
    expect(POWERED.machine).toBeUndefined(); // its strokes are sporadic, its rumble idle
  });

  it('repeats every part within a loop: whole cycles of every tone and every wander', () => {
    for (const build of [...Object.values(POWERED), ...Object.values(IDLE)]) {
      const { ctx } = rendered(build);
      for (const osc of ctx.all<FakeOscillator>('oscillator')) {
        expect((osc.frequency.value * 4) % 1).toBeCloseTo(0, 9);
      }
    }
  });
});

describe('the beds as they play', () => {
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function started(clock: () => number = () => 0) {
    vi.resetModules();
    const ambience = await import('../src/world/ambience.js');
    const audio = await import('../src/world/audio.js');
    ambience.startAmbience(clock);
    return { ambience, audio, ctx: lastContext() };
  }

  type Ambience = Awaited<ReturnType<typeof started>>['ambience'];

  const scene = (map: DressMap, x: number, y: number, power: Power, time = 0): RoomScene => ({
    map,
    dressing,
    at: { x, y },
    power,
    time,
  });

  /** The beds' out-stages: the gains wired straight into the duck bus. */
  function bedOuts(ctx: FakeContext): FakeGain[] {
    const gains = ctx.all<FakeGain>('gain');
    const master = gains.find((g) => g.outputs.includes(ctx.destination));
    const duck = gains.find((g) => master !== undefined && g.outputs.includes(master));
    return gains.filter((g) => duck !== undefined && g.outputs.includes(duck));
  }

  /** The loops playing now: looping buffer sources started and not stopped. */
  const loops = (ctx: FakeContext): FakeBufferSource[] =>
    ctx.all<FakeBufferSource>('buffer').filter((b) => b.loop && b.stoppedAt === null);

  /** One round of the lab's ears, and another once the loops have rendered: those due start. */
  async function hearRendered(ambience: Ambience, s: RoomScene): Promise<void> {
    ambience.hearRooms(s);
    await flush();
    ambience.hearRooms(s);
  }

  it('builds the own room’s bed and the nearest neighbour’s, fading in over 1.2 s', async () => {
    const { ambience, ctx } = await started();
    await hearRendered(ambience, scene(withDoors(), 4.5, 1.5, POWER_ON));
    const outs = bedOuts(ctx);
    expect(outs).toHaveLength(2);
    expect(outs.map((out) => out.gain.ramps().at(-1))).toEqual(
      expect.arrayContaining([
        [BED_LEVEL, 10 + ROOM_FADE_S],
        [BED_LEVEL * NEIGHBOUR_LEVEL, 10 + ROOM_FADE_S],
      ]),
    );
    expect(loops(ctx)).toHaveLength(2); // the archive's air, the corridor's vent
    ctx.currentTime = 12;
    expect(ambience.bedProbe()).toEqual({
      room: 'ARCHIV',
      kind: 'archive',
      beds: { archive: 1, corridor: expect.closeTo(NEIGHBOUR_LEVEL, 6) },
      power: { archive: 1, corridor: 1 },
    });
  });

  it('plays a bed as its loop, rendered once a kind at half the live rate', async () => {
    const { ambience, ctx } = await started();
    await hearRendered(ambience, scene(withDoors(), 12.5, 1.5, POWER_ON));
    const [server] = loops(ctx);
    expect(server?.buffer?.sampleRate).toBe(ctx.sampleRate / 2);
    expect(server?.buffer?.duration).toBe(4);
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // no live hums
    const lengths = FakeOfflineContext.rendered.map((offline) => offline.length);
    expect(lengths.every((length) => length === 2 * 4 * (ctx.sampleRate / 2))).toBe(true);
  });

  it('crossfades a change of room: the old down to its neighbour level, the new up', async () => {
    const { ambience, ctx } = await started();
    const map = withDoors();
    ambience.hearRooms(scene(map, 4.5, 1.5, POWER_ON));
    ctx.currentTime = 20;
    ambience.hearRooms(scene(map, 5.5, 8.5, POWER_ON));
    ctx.currentTime = 20 + ROOM_FADE_S / 2;
    const halfway = ambience.bedProbe();
    expect(halfway.room).toBe('FLUR');
    expect(halfway.beds['archive']).toBeCloseTo((1 + NEIGHBOUR_LEVEL) / 2, 6);
    ctx.currentTime = 20 + ROOM_FADE_S;
    const beds = ambience.bedProbe().beds;
    expect(beds).toEqual({ archive: expect.closeTo(NEIGHBOUR_LEVEL, 6), corridor: 1 });
  });

  it('stops the bed of a room no longer heard, and gives its loop back', async () => {
    const { ambience, audio, ctx } = await started();
    await hearRendered(ambience, scene(withDoors('maschinentuer'), 5.5, 8.5, POWER_ON));
    expect(audio.inUse().loop).toBe(3); // the corridor's vent, the archive's air, the rumble
    ctx.currentTime = 12;
    ambience.hearRooms(scene(withDoors(), 5.5, 8.5, POWER_ON));
    ctx.currentTime = 14;
    ambience.hearRooms(scene(withDoors(), 5.5, 8.5, POWER_ON));
    const rumble = ctx.all<FakeBufferSource>('buffer').find((b) => b.stoppedAt === 14);
    expect(rumble).toBeDefined();
    rumble?.end();
    expect(audio.inUse().loop).toBe(2);
    expect(ambience.bedProbe().beds['machine']).toBeUndefined();
  });

  it('collapses to the dead variant at the bang: the powered loop slows and stops', async () => {
    const { ambience, ctx } = await started();
    await hearRendered(ambience, scene(withDoors(), 12.5, 1.5, POWER_ON));
    const [server] = loops(ctx);
    const bang = Date.now() + 900;
    ambience.hearRooms(scene(withDoors(), 12.5, 1.5, { ...POWER_ON, outAt: bang }));
    expect(server?.playbackRate.ramps()).toEqual([[0.25, expect.closeTo(10.9 + POWER_DIE_S, 6)]]);
    expect(server?.stoppedAt).toBeCloseTo(10.9 + POWER_DIE_S + 0.05, 6);
    ctx.currentTime = 10.85;
    expect(ambience.bedProbe().power['server']).toBe(1); // until the bang
    ctx.currentTime = 10.9 + POWER_DIE_S;
    expect(ambience.bedProbe().power['server']).toBe(0);
  });

  it('keeps the machine room rumbling without power, its strokes only with it', async () => {
    const { ambience, ctx } = await started();
    const dark: Power = { outAt: Date.now() - 5000, lit: new Map(), won: false };
    await hearRendered(ambience, scene(withDoors(), 2.5, 12.5, dark));
    expect(loops(ctx)).toHaveLength(1); // the rumble
    ctx.currentTime = 30;
    ambience.hearRooms(scene(withDoors(), 2.5, 12.5, dark));
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // dead: no stroke
    const lit: Power = { ...dark, lit: new Map([['MASCHINENRAUM', { since: 0 }]]) };
    ambience.hearRooms(scene(withDoors(), 2.5, 12.5, lit, 9));
    ctx.currentTime = 32;
    ambience.hearRooms(scene(withDoors(), 2.5, 12.5, lit, 9));
    const stroke = ctx.all<FakeOscillator>('oscillator')[0];
    expect(stroke?.frequency.events[0]).toEqual(['set', 75, expect.any(Number)]);
  });

  it('warms a room whose lights come back up along their warm-up, dips and all', async () => {
    const { ambience, ctx } = await started();
    const dark: Power = { outAt: Date.now() - 5000, lit: new Map(), won: false };
    await hearRendered(ambience, scene(withDoors(), 5.5, 8.5, dark, 4));
    expect(ambience.bedProbe().power['corridor']).toBe(0);
    expect(loops(ctx)).toHaveLength(0); // the corridor's vent runs on power only
    const lit: Power = { ...dark, lit: new Map([['FLUR', { since: 4 }]]) };
    await hearRendered(ambience, scene(withDoors(), 5.5, 8.5, lit, 4));
    const [vent] = loops(ctx);
    const stage = vent?.outputs[0] as FakeGain;
    const curve = stage.gain.events.find((event) => event[0] === 'curve');
    const values = [...((curve?.[1] as Float32Array | undefined) ?? [])];
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(values.some((value, i) => i > 0 && value < (values[i - 1] ?? 0))).toBe(true);
    expect(values[13]).toBeCloseTo(warmUp(260), 6);
    ctx.currentTime = 10.5;
    expect(ambience.bedProbe().power['corridor']).toBe(1);
  });

  it('drips in the archive every 7–12 s, throbs in the reactor peaking with the core', async () => {
    let time = 2.5;
    const { ambience, ctx } = await started(() => time);
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    ctx.currentTime = 16; // the first drip is due 6 s in (half of 12, Math.random() = 0.5)
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    const drip = ctx.all<FakeOscillator>('oscillator');
    expect(drip.map((osc) => osc.startedAt)).toEqual([16.01, expect.closeTo(16.022, 6)]);
    ctx.currentTime = 40;
    time = 2.5; // the core's next top at 3.0, half a second away
    ambience.hearRooms(scene(withDoors(), 23.5, 12.5, POWER_ON, time));
    const throb = ctx.all<FakeOscillator>('oscillator').find((o) => (o.startedAt ?? 0) > 39);
    expect(throb?.startedAt).toBeCloseTo(40 + 0.5 - 0.35, 6);
  });

  it('lets a sporadic sound go once it has ended: nothing of it stays wired', async () => {
    const { ambience, audio, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    ctx.currentTime = 16;
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    const [plink] = ctx.all<FakeOscillator>('oscillator');
    const envelope = plink?.outputs[0] as FakeGain;
    const outlet = envelope.outputs[0] as FakeGain;
    expect(audio.inUse().voice).toBe(2);
    expect(outlet.disconnected).toBe(false);
    endAll(ctx);
    expect(outlet.disconnected).toBe(true);
    expect(audio.inUse().voice).toBe(0);
  });

  it('keeps sporadic sounds within the budget: one with no room left is not played', async () => {
    const { ambience, audio, ctx } = await started();
    expect(audio.claim({ voice: CAPS.voice - 1 })).toBe(true);
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    ctx.currentTime = 16; // a drip is due: it needs two voices, one is left
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0);
    expect(OCCASIONS.archive[0]?.cost).toEqual({ voice: 2 });
  });

  it('fades every bed out and stops it when the world goes', async () => {
    const { ambience, ctx } = await started();
    await hearRendered(ambience, scene(withDoors(), 12.5, 1.5, POWER_ON));
    ambience.stopAmbience();
    const [server] = bedOuts(ctx);
    expect(server?.gain.ramps().at(-1)).toEqual([0, 10.5]);
    expect(ctx.all<FakeBufferSource>('buffer').every((b) => b.stoppedAt === 10.55)).toBe(true);
    expect(() => ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON))).not.toThrow();
    expect(ambience.bedProbe().room).toBeNull();
  });

  it('never throws, with no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.resetModules();
    const ambience = await import('../src/world/ambience.js');
    expect(() => {
      ambience.startAmbience(() => 0);
      ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
      ambience.stopAmbience();
    }).not.toThrow();
    expect(ambience.bedProbe()).toEqual({ room: null, kind: null, beds: {}, power: {} });
  });
});
