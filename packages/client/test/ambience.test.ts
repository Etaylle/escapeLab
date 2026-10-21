import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type MapView } from '@escapelab/core';
import {
  BED_LEVEL,
  bedLevels,
  bedPower,
  CORE_PERIOD_S,
  NEIGHBOUR_LEVEL,
  nextCorePeak,
  POWER_DIE_S,
  ROOM_FADE_S,
  roomAt,
  roomPlan,
  type Power,
  type RoomScene,
} from '../src/world/ambience.js';
import { dressMap, seedOf, type DressMap } from '../src/world/dress.js';
import { pulseAt } from '../src/world/gl/pack.js';
import { warmUp } from '../src/world/rooms.js';
import type {
  FakeGain,
  FakeOscillator} from './fakeGraph.js';
import {
  downstream,
  fakeGraph,
  lastContext,
  reaches,
  type FakeContext,
  type FakeNode,
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

describe('the rooms the beds are heard from', () => {
  it('names each tile by the room its label claims, and keeps the room in a doorway', () => {
    expect(roomAt(plan, 4, 1, null)).toBe('ARCHIV');
    expect(roomAt(plan, 3, 4, 'ARCHIV')).toBe('FLUR'); // the opening belongs to the corridor
    expect(roomAt(plan, 13, 9, null)).toBe('REAKTOR');
    expect(roomAt(plan, 4, 7, 'MASCHINENRAUM')).toBe('MASCHINENRAUM'); // on the door
    expect(roomAt(plan, 4, 7, 'FLUR')).toBe('FLUR');
    expect(roomAt(plan, 0, 0, 'LABOR')).toBe('LABOR'); // a wall
  });

  it('knows each room by its kind, and the ways between rooms: doors and openings', () => {
    expect(plan.kinds.get('ARCHIV')).toBe('archive');
    expect(plan.kinds.get('FLUR')).toBe('corridor');
    expect(plan.kinds.get('REAKTOR')).toBe('reactor');
    expect(plan.links).toEqual(
      expect.arrayContaining([
        { a: 'ARCHIV', b: 'FLUR', door: null },
        { a: 'FLUR', b: 'MASCHINENRAUM', door: 'maschinentuer' },
        { a: 'LABOR', b: 'REAKTOR', door: 'reaktortuer' },
      ]),
    );
    // The Flur's two halves meet at the Flurschott: one room, no way to itself.
    expect(plan.links.some((link) => link.a === link.b)).toBe(false);
  });

  it('plays the own room at full, rooms behind an opening or an open door 12 dB under', () => {
    expect(NEIGHBOUR_LEVEL).toBeCloseTo(0.251, 3);
    const shut = bedLevels(plan, 'FLUR', new Set());
    expect(shut).toEqual(new Map([['FLUR', 1], ['ARCHIV', NEIGHBOUR_LEVEL]]));
    const open = bedLevels(plan, 'FLUR', new Set(['maschinentuer', 'labortuer']));
    expect(open.get('MASCHINENRAUM')).toBe(NEIGHBOUR_LEVEL);
    expect(open.get('LABOR')).toBe(NEIGHBOUR_LEVEL);
    expect(open.has('REAKTOR')).toBe(false); // two doors away
    expect(open.has('SERVERRAUM')).toBe(false); // its door shut
  });

  it('lets the audience hear every room 12 dB under', () => {
    const all = bedLevels(plan, null, new Set());
    expect([...all.keys()].sort()).toEqual([...plan.kinds.keys()].sort());
    expect([...all.values()].every((level) => level === NEIGHBOUR_LEVEL)).toBe(true);
  });
});

describe('the power of a bed', () => {
  it('runs on the lab’s power, dies when it fails, comes back with the room’s lights', () => {
    expect(bedPower('FLUR', POWER_ON, 3)).toEqual({ alive: true, warm: Infinity });
    const out: Power = { outAt: 5000, lit: new Map(), won: false };
    expect(bedPower('FLUR', out, 3)).toEqual({ alive: false, from: 5000 });
    const lit: Power = { ...out, lit: new Map([['FLUR', { since: 2.8 }]]) };
    expect(bedPower('FLUR', lit, 3)).toEqual({ alive: true, warm: expect.closeTo(0.2, 6) });
    expect(bedPower('ARCHIV', lit, 3)).toEqual({ alive: false, from: 5000 });
    expect(bedPower('ARCHIV', { ...out, won: true }, 3)).toEqual({ alive: true, warm: Infinity });
  });

  it('beats with the core: on the top of its light’s pulse', () => {
    expect(nextCorePeak(0)).toBeCloseTo(0.6, 9);
    expect(nextCorePeak(0.59)).toBeCloseTo(0.6, 9);
    expect(nextCorePeak(0.6)).toBeCloseTo(3.0, 9); // strictly after: that one is due now
    expect(nextCorePeak(0.7)).toBeCloseTo(3.0, 9);
    const pulse = { periodMs: CORE_PERIOD_S * 1000, depth: 0.4 };
    for (const time of [0, 1.9, 7.3]) {
      expect(pulseAt(pulse, nextCorePeak(time) * 1000)).toBeCloseTo(1, 9);
    }
  });
});

/** The bed whose out-stage is wired straight into the duck bus, reaching a node of `kind`. */
function bedOuts(ctx: FakeContext): FakeGain[] {
  const master = ctx.all<FakeGain>('gain').find((g) => g.outputs.includes(ctx.destination));
  const gains = ctx.all<FakeGain>('gain');
  const duck = gains.find((g) => master !== undefined && g.outputs.includes(master));
  return ctx.all<FakeGain>('gain').filter((g) => duck !== undefined && g.outputs.includes(duck));
}

/** The oscillators feeding `out`, by their frequency: the first one scheduled, or as set. */
function tonesInto(ctx: FakeContext, out: FakeNode): number[] {
  return ctx
    .all<FakeOscillator>('oscillator')
    .filter((osc) => reaches(osc, out))
    .map((osc) => {
      const first = osc.frequency.events.find((event) => event[0] === 'set');
      return first === undefined ? osc.frequency.value : (first[1] as number);
    });
}

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
    ambience.startAmbience(clock);
    return { ambience, ctx: lastContext() };
  }

  const scene = (map: DressMap, x: number, y: number, power: Power, time = 0): RoomScene => ({
    map,
    dressing,
    at: { x, y },
    power,
    time,
  });

  it('builds the own room’s bed and the neighbour’s, crossfading in over 1.2 s', async () => {
    const { ambience, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    const outs = bedOuts(ctx);
    expect(outs).toHaveLength(2);
    const ramps = outs.map((out) => out.gain.ramps().at(-1));
    expect(ramps).toEqual(
      expect.arrayContaining([
        [BED_LEVEL, 10 + ROOM_FADE_S],
        [BED_LEVEL * NEIGHBOUR_LEVEL, 10 + ROOM_FADE_S],
      ]),
    );
    ctx.currentTime = 12;
    expect(ambience.bedProbe()).toEqual({
      room: 'ARCHIV',
      kind: 'archive',
      beds: { archive: 1, corridor: expect.closeTo(NEIGHBOUR_LEVEL, 6) },
      power: { archive: 1, corridor: 1 },
    });
  });

  it('crossfades a change of room: the old down to its neighbour level, the new up', async () => {
    const { ambience, ctx } = await started();
    const map = withDoors();
    ambience.hearRooms(scene(map, 4.5, 1.5, POWER_ON));
    ctx.currentTime = 20;
    ambience.hearRooms(scene(map, 5.5, 5.5, POWER_ON));
    ctx.currentTime = 20 + ROOM_FADE_S / 2;
    const halfway = ambience.bedProbe();
    expect(halfway.room).toBe('FLUR');
    expect(halfway.beds['archive']).toBeCloseTo((1 + NEIGHBOUR_LEVEL) / 2, 6);
    expect(halfway.beds['corridor']).toBeCloseTo((1 + NEIGHBOUR_LEVEL) / 2, 6);
    ctx.currentTime = 20 + ROOM_FADE_S;
    const beds = ambience.bedProbe().beds;
    expect(beds).toEqual({ archive: expect.closeTo(NEIGHBOUR_LEVEL, 6), corridor: 1 });
  });

  it('opens a door onto a room: its bed comes in 12 dB under, and goes once shut', async () => {
    const { ambience, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 5.5, 5.5, POWER_ON));
    ambience.hearRooms(scene(withDoors('maschinentuer'), 5.5, 5.5, POWER_ON));
    ctx.currentTime = 12;
    expect(ambience.bedProbe().beds['machine']).toBeCloseTo(NEIGHBOUR_LEVEL, 6);
    ambience.hearRooms(scene(withDoors(), 5.5, 5.5, POWER_ON));
    ctx.currentTime = 14;
    vi.advanceTimersByTime(250);
    expect(ambience.bedProbe().beds['machine']).toBeUndefined(); // faded out and torn down
  });

  it('gives a server room fans, a 120 Hz hum and a faint 8 kHz whine, on the power', async () => {
    const { ambience, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 12.5, 1.5, POWER_ON));
    const [server] = bedOuts(ctx);
    expect(server).toBeDefined();
    expect(tonesInto(ctx, server as FakeNode).sort((a, b) => a - b)).toEqual([120, 240, 8000]);
    const fans = ctx.all<FakeNode>('buffer').filter((noise) => reaches(noise, server as FakeNode));
    expect(fans).toHaveLength(1);
    const band = [...downstream(fans[0] as FakeNode)].find((node) => node.kind === 'biquad');
    expect(band).toMatchObject({ type: 'bandpass', frequency: { value: 1100 } });
  });

  it('collapses to the dead variant with the bang: the hums spin down and fall', async () => {
    const { ambience, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 12.5, 1.5, POWER_ON));
    const bang = Date.now() + 900;
    ambience.hearRooms(scene(withDoors(), 12.5, 1.5, { ...POWER_ON, outAt: bang }));
    const hum = ctx.all<FakeOscillator>('oscillator').find((osc) => osc.frequency.value === 120);
    expect(hum?.frequency.ramps()).toEqual([[30, expect.closeTo(10.9 + POWER_DIE_S, 6)]]);
    expect(hum?.stoppedAt).toBeCloseTo(10.9 + POWER_DIE_S + 0.05, 6);
    ctx.currentTime = 10.85;
    expect(ambience.bedProbe().power['server']).toBe(1); // until the bang
    ctx.currentTime = 10.9 + POWER_DIE_S;
    expect(ambience.bedProbe().power['server']).toBe(0);
  });

  it('keeps what lives without power: the machine room rumbles on, its strokes stop', async () => {
    const { ambience, ctx } = await started();
    const dark: Power = { outAt: Date.now() - 5000, lit: new Map(), won: false };
    ambience.hearRooms(scene(withDoors(), 2.5, 9.5, dark));
    const [machine] = bedOuts(ctx);
    expect(tonesInto(ctx, machine as FakeNode)).toEqual([38]); // the rumble, no stroke yet
    ctx.currentTime = 30;
    vi.advanceTimersByTime(250);
    expect(tonesInto(ctx, machine as FakeNode)).toEqual([38]); // dead: no stroke came
    const lit: Power = { ...dark, lit: new Map([['MASCHINENRAUM', { since: 0 }]]) };
    ambience.hearRooms(scene(withDoors(), 2.5, 9.5, lit, 9));
    ctx.currentTime = 32;
    vi.advanceTimersByTime(250);
    expect(tonesInto(ctx, machine as FakeNode)).toContain(75); // alive: the slow stroke
  });

  it('warms a room whose lights come back up along their warm-up, dips and all', async () => {
    const { ambience, ctx } = await started();
    const dark: Power = { outAt: Date.now() - 5000, lit: new Map(), won: false };
    ambience.hearRooms(scene(withDoors(), 5.5, 5.5, dark, 4));
    expect(ambience.bedProbe().power['corridor']).toBe(0);
    const lit: Power = { ...dark, lit: new Map([['FLUR', { since: 4 }]]) };
    ambience.hearRooms(scene(withDoors(), 5.5, 5.5, lit, 4));
    const corridor = bedOuts(ctx).find((out) => tonesInto(ctx, out).includes(100)) as FakeNode;
    const hum = ctx.all<FakeOscillator>('oscillator').find((osc) => osc.frequency.value === 100);
    const power = ctx
      .all<FakeGain>('gain')
      .find((g) => g.outputs.includes(corridor) && reaches(hum as FakeNode, g));
    const curve = power?.gain.events.find((event) => event[0] === 'curve');
    expect(curve).toBeDefined();
    const values = [...((curve?.[1] as Float32Array | undefined) ?? [])];
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(values.some((value, i) => i > 0 && value < (values[i - 1] ?? 0))).toBe(true); // a dip
    expect(curve?.[3]).toBeCloseTo(0.5, 6);
    expect(values[13]).toBeCloseTo(warmUp(260), 6);
    ctx.currentTime = 10.5;
    expect(ambience.bedProbe().power['corridor']).toBe(1);
  });

  it('drips in the archive every 7–12 s, throbs in the reactor with the core', async () => {
    let time = 2.5;
    const { ambience, ctx } = await started(() => time);
    ambience.hearRooms(scene(withDoors(), 4.5, 1.5, POWER_ON));
    const archive = bedOuts(ctx).find((out) => tonesInto(ctx, out).length === 0) as FakeNode;
    ctx.currentTime = 16; // the first drip is due 6 s in (half of 12, Math.random() = 0.5)
    vi.advanceTimersByTime(250);
    const drip = ctx.all<FakeOscillator>('oscillator').filter((osc) => reaches(osc, archive));
    expect(drip.map((osc) => osc.startedAt)).toEqual([16.01, expect.closeTo(16.022, 6)]);
    ambience.hearRooms(scene(withDoors(), 13.5, 9.5, POWER_ON, time));
    ctx.currentTime = 40;
    time = 2.5; // the core's next top at 3.0, half a second away
    vi.advanceTimersByTime(250);
    const tones = ctx.all<FakeOscillator>('oscillator');
    const throb = tones.find((osc) => osc.startedAt !== null && osc.startedAt > 39);
    expect(throb?.startedAt).toBeCloseTo(40 + 0.5 - 0.35, 6);
  });

  it('fades every bed out and stops it when the world goes', async () => {
    const { ambience, ctx } = await started();
    ambience.hearRooms(scene(withDoors(), 12.5, 1.5, POWER_ON));
    ambience.stopAmbience();
    const [server] = bedOuts(ctx);
    expect(server?.gain.ramps().at(-1)).toEqual([0, 10.5]);
    const stops = ctx.all<FakeOscillator>('oscillator').map((osc) => osc.stoppedAt);
    expect(stops.every((at) => at === 10.55)).toBe(true);
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
