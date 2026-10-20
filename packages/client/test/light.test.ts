import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sightFrom } from '@escapelab/core';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  doorsShut,
  EMERGENCY_GLOW,
  EMERGENCY_STOPS,
  emergencyLamp,
  lampMount,
  lightClip,
  litTiles,
  litTilesCache,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  POWER_REACH,
  powerLamp,
  reachOf,
  runsOf,
  sightCache,
  type Lamp,
  type Stops,
} from '../src/world/light.js';

/**
 * Two rooms, west (x 1–3) and east (x 5–7), joined by a door at (4,2).
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door at (4,2)
 * 3 #...#...#
 * 4 #########
 */
const map = { tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#########'] };
const open = doorsShut({ doors: [{ id: 'tuer', x: 4, y: 2, open: true }] });
const shut = doorsShut({ doors: [{ id: 'tuer', x: 4, y: 2, open: false }] });

const glow = (x: number, y: number, radius: number): Lamp => ({ x, y, glow: radius, beam: null });

describe('doorsShut', () => {
  it('lists the doors that stop light right now, by tile', () => {
    expect([...open]).toEqual([]);
    expect([...shut]).toEqual(['4,2']);
  });
});

describe('lightClip — where a lamp’s light may fall', () => {
  it('takes the room’s walls whole, row by row, and nothing behind them', () => {
    const clip = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, shut));
    expect(clip.walls).toEqual([
      { x: 0, y: 0, length: 5 },
      { x: 0, y: 1, length: 1 },
      { x: 4, y: 1, length: 1 },
      { x: 0, y: 2, length: 1 },
      { x: 4, y: 2, length: 1 },
      { x: 0, y: 3, length: 1 },
      { x: 4, y: 3, length: 1 },
      { x: 0, y: 4, length: 5 },
    ]);
  });

  it('outlines the floor up to the walls, and on through the door once it is open', () => {
    const inRoom = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, shut)).outline;
    expect(inRoom.length).toBeGreaterThan(100);
    expect(inRoom.every((p) => p.x >= 1 - 1e-9 && p.x <= 4 + 1e-9)).toBe(true);
    expect(inRoom.every((p) => p.y >= 1 - 1e-9 && p.y <= 4 + 1e-9)).toBe(true);
    const through = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, open)).outline;
    expect(Math.max(...through.map((p) => p.x))).toBeCloseTo(8, 6);
  });

  it('keeps the outline of the sight it was made from, corner by corner', () => {
    const sight = sightFrom(map, { x: 6.2, y: 1.7 }, 4, open);
    expect(lightClip(sight).outline).toBe(sight.outline);
  });
});

describe('litTiles — what a lamp lights', () => {
  it('lights what its glow touches and nothing beyond it', () => {
    const lit = litTiles(glow(2.5, 2.5, 1), sightFrom(map, { x: 2.5, y: 2.5 }, 1, shut));
    expect(lit.sort()).toEqual(['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3']);
  });

  it('lights far down its beam, through an open door, and not beside it', () => {
    const lamp: Lamp = { x: 1.5, y: 2.5, glow: 0, beam: { facing: 0, halfAngle: 0.3, reach: 6 } };
    const lit = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), open));
    expect(lit).toEqual(expect.arrayContaining(['1,2', '5,2', '7,2']));
    expect(lit).not.toContain('1,1');
    expect(lit).not.toContain('1,3');
    const blocked = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), shut));
    expect(blocked).toContain('4,2');
    expect(blocked.filter((key) => Number(key.split(',')[0]) > 4)).toEqual([]);
  });

  it('lights nothing behind a wall, even close by', () => {
    const lit = litTiles(glow(3.5, 1.5, 3), sightFrom(map, { x: 3.5, y: 1.5 }, 3, shut));
    expect(lit).toContain('4,1');
    expect(lit).not.toContain('5,1');
  });
});

describe('reachOf', () => {
  it('reaches as far as the glow or the beam, whichever is longer', () => {
    expect(reachOf(glow(0, 0, 2.8))).toBe(2.8);
    expect(reachOf({ x: 0, y: 0, glow: 3.2, beam: { facing: 0, halfAngle: 0.5, reach: 7.5 } })).toBe(
      7.5,
    );
  });
});

describe('sightCache', () => {
  it('takes a sight once for a lamp standing still, and afresh when a door moves', () => {
    const look = sightCache();
    const first = look(map, { x: 2.5, y: 2.5 }, 5, open);
    expect(first).toEqual(sightFrom(map, { x: 2.5, y: 2.5 }, 5, open));
    expect(look(map, { x: 2.5, y: 2.5 }, 5, new Set())).toBe(first);
    expect(look(map, { x: 2.5004, y: 2.5 }, 5, open)).toBe(first);
    expect(look(map, { x: 2.6, y: 2.5 }, 5, open)).not.toBe(first);
    expect(look(map, { x: 2.5, y: 2.5 }, 5, shut)).not.toBe(first);
    expect(look(map, { x: 2.5, y: 2.5 }, 3, open)).not.toBe(first);
  });

  it('forgets the sight asked for longest ago once it holds as many as it may', () => {
    const look = sightCache(2);
    const first = look(map, { x: 1.5, y: 1.5 }, 3, open);
    const second = look(map, { x: 2.5, y: 1.5 }, 3, open);
    look(map, { x: 3.5, y: 1.5 }, 3, open);
    expect(look(map, { x: 1.5, y: 1.5 }, 3, open)).not.toBe(first);
    expect(look(map, { x: 2.5, y: 1.5 }, 3, open)).not.toBe(second);
  });

  it('keeps the sight of a lamp standing still while a moving one fills it up', () => {
    const look = sightCache(2);
    const still = look(map, { x: 1.5, y: 1.5 }, 3, open);
    for (const x of [2.5, 3.5, 5.5, 6.5, 7.5]) {
      look(map, { x, y: 2.5 }, 3, open);
      expect(look(map, { x: 1.5, y: 1.5 }, 3, open)).toBe(still);
    }
  });
});

describe('litTilesCache', () => {
  it('works out a lamp’s tiles once for a sight, and afresh for another lamp or sight', () => {
    const lights = litTilesCache();
    const lamp = glow(2.5, 2.5, 1.5);
    const sight = sightFrom(map, lamp, 1.5, open);
    const first = lights(lamp, sight);
    expect(first).toEqual(litTiles(lamp, sight));
    expect(lights({ ...lamp }, sight)).toBe(first);
    const wider = glow(2.5, 2.5, 3);
    expect(lights(wider, sight)).toEqual(litTiles(wider, sight));
    const other = sightFrom(map, lamp, 1.5, shut);
    expect(lights(lamp, other)).not.toBe(first);
    expect(lights(lamp, other)).toEqual(litTiles(lamp, other));
  });
});

describe('runsOf', () => {
  it('merges tiles side by side in a row, whatever order they come in, and nothing else', () => {
    expect(runsOf(['3,1', '1,1', '2,1', '1,2', '5,1'])).toEqual([
      { x: 1, y: 1, length: 3 },
      { x: 5, y: 1, length: 1 },
      { x: 1, y: 2, length: 1 },
    ]);
    expect(runsOf([])).toEqual([]);
  });
});

/** How deep a gradient with these stops cuts at `offset`: straight lines between them, as drawn. */
function depthAt(stops: Stops, offset: number): number {
  const after = stops.findIndex(([at]) => at >= offset);
  const [hiAt, hiDepth] = stops[after] ?? stops[stops.length - 1] ?? [1, 0];
  const [loAt, loDepth] = stops[after - 1] ?? [hiAt, hiDepth];
  if (hiAt === loAt) {
    return hiDepth;
  }
  return loDepth + ((offset - loAt) / (hiAt - loAt)) * (hiDepth - loDepth);
}

/** Offsets from a glow's middle out to its rim, a twentieth apart. */
const OFFSETS = Array.from({ length: 21 }, (_, i) => i / 20);

describe('the lamps’ gradients', () => {
  it('clear the darkness through 70 % of your lamp’s radius, fading only at the rim', () => {
    for (const offset of OFFSETS.filter((t) => t <= 0.7)) {
      expect(depthAt(OWN_GLOW_STOPS, offset)).toBe(1);
    }
    const rim = OFFSETS.filter((t) => t > 0.7).map((t) => depthAt(OWN_GLOW_STOPS, t));
    rim.forEach((depth, i) => expect(depth).toBeLessThan(i === 0 ? 1 : (rim[i - 1] ?? 0)));
    expect(depthAt(OWN_GLOW_STOPS, 1)).toBe(0);
  });

  it('light the crew’s lamps a little softer than yours, but still as lamps', () => {
    for (const offset of OFFSETS) {
      expect(depthAt(CREW_GLOW_STOPS, offset)).toBeLessThanOrEqual(depthAt(OWN_GLOW_STOPS, offset));
    }
    expect(depthAt(CREW_GLOW_STOPS, 0)).toBeLessThan(1);
    expect(depthAt(CREW_GLOW_STOPS, 0.5)).toBeGreaterThanOrEqual(0.75);
  });

  it('cut deeper with your lamp than the old glow did, all the way to its rim', () => {
    const before = objectGlowStops(1);
    for (const offset of OFFSETS.slice(1, -1)) {
      expect(depthAt(OWN_GLOW_STOPS, offset)).toBeGreaterThan(depthAt(before, offset));
    }
  });

  it('fade every glow and beam out to nothing at its rim, inward to outward', () => {
    for (const stops of [OWN_GLOW_STOPS, OWN_BEAM_STOPS, CREW_GLOW_STOPS, DRONE_BEAM_STOPS]) {
      expect(stops[0]?.[0]).toBe(0);
      expect(stops.at(-1)).toEqual([1, 0]);
      stops.slice(1).forEach(([at, depth], i) => {
        expect(at).toBeGreaterThan(stops[i]?.[0] ?? 1);
        expect(depth).toBeLessThanOrEqual(stops[i]?.[1] ?? 0);
        expect(depth).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('keep the objects’ own glow as it was: half its depth past the middle', () => {
    expect(objectGlowStops(0.8)).toEqual([
      [0, 0.8],
      [0.55, 0.8 * 0.55],
      [1, 0],
    ]);
  });
});

describe('emergency lamps — where they hang and what they light', () => {
  it('hang a lamp on the floor in its tile’s middle', () => {
    expect(lampMount(map, { x: 2, y: 2 })).toEqual({ x: 2.5, y: 2.5, facing: null });
  });

  it('hang a lamp on a wall on its face toward the floor, south first, just over the floor', () => {
    // The north wall above (2,1): it shines south, into the room.
    expect(lampMount(map, { x: 2, y: 0 })).toEqual({ x: 2.5, y: 1.05, facing: Math.PI / 2 });
    // The west wall beside (1,2): it shines east.
    expect(lampMount(map, { x: 0, y: 2 })).toEqual({ x: 1.05, y: 2.5, facing: 0 });
  });

  it('hang nowhere without floor beside the wall, nor off the map', () => {
    expect(lampMount(map, { x: 0, y: 0 })).toBeNull();
    expect(lampMount(map, { x: 12, y: 2 })).toBeNull();
  });

  it('light round where they hang, their own tile included, and nothing behind the wall', () => {
    // Two cells either side of one wall: the lamp on it hangs on its east face.
    const cells = { tiles: ['#####', '#.#.#', '#####'] };
    const mount = lampMount(cells, { x: 2, y: 1 });
    expect(mount).toEqual({ x: 3.05, y: 1.5, facing: 0 });
    if (mount === null) {
      return;
    }
    const lamp = emergencyLamp(mount);
    expect(lamp).toEqual({ x: 3.05, y: 1.5, glow: EMERGENCY_GLOW, beam: null });
    const lit = litTiles(lamp, sightFrom(cells, lamp, reachOf(lamp), new Set()));
    expect(lit).toEqual(expect.arrayContaining(['2,1', '3,1']));
    expect(lit).not.toContain('1,1');
    const onFloor = emergencyLamp({ x: 2.5, y: 2.5, facing: null });
    expect(litTiles(onFloor, sightFrom(map, onFloor, reachOf(onFloor), shut))).toContain('2,2');
  });

  it('glow dimmer than any lamp of the crew, out to nothing at their reach', () => {
    for (const offset of OFFSETS) {
      const crew = depthAt(CREW_GLOW_STOPS, offset);
      expect(depthAt(EMERGENCY_STOPS, offset)).toBeLessThan(crew + 1e-9);
    }
    expect(depthAt(EMERGENCY_STOPS, 0)).toBeLessThan(0.6);
    expect(EMERGENCY_STOPS.at(-1)).toEqual([1, 0]);
    expect(EMERGENCY_GLOW).toBe(1.5);
  });
});

describe('the power on — the room’s own light round you', () => {
  it('lights all round you as far as you see, with no beam', () => {
    const lamp = powerLamp({ x: 2.5, y: 2.5 });
    expect(lamp).toEqual({ x: 2.5, y: 2.5, glow: POWER_REACH, beam: null });
    expect(reachOf(lamp)).toBe(POWER_REACH);
  });

  it('lights your whole room and nothing behind a wall or a shut door', () => {
    const lamp = powerLamp({ x: 2.5, y: 2.5 });
    const lit = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), shut));
    expect(lit).toEqual(expect.arrayContaining(['1,1', '3,1', '1,3', '3,3', '2,2', '4,2']));
    expect(lit.filter((key) => Number(key.split(',')[0]) > 4)).toEqual([]);
    const through = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), open));
    expect(through).toEqual(expect.arrayContaining(['5,2', '7,2']));
  });

  it('shows one step into Blackout’s Archiv the room, not what lies behind its walls', () => {
    const { map: lab } = JSON.parse(
      readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
    ) as { map: { tiles: string[]; doors: { x: number; y: number }[] } };
    // Every door shut, as at the start of a run.
    const doors = new Set(lab.doors.map((door) => `${door.x},${door.y}`));
    const lamp = powerLamp({ x: 3.5, y: 1.5 });
    const lit = litTiles(lamp, sightFrom(lab, lamp, reachOf(lamp), doors));
    // The Archiv's open row with the book at 2,1 and the fuse at 5,1; the sign at 4,3; and
    // down the passage, five tiles away, the Flur.
    expect(lit).toEqual(
      expect.arrayContaining(['1,1', '2,1', '3,1', '4,1', '5,1', '4,3', '3,5', '3,6']),
    );
    // Behind the east wall the key at 7,3 and the Serverraum; round a corner the lever at 7,5.
    for (const hidden of ['7,3', '12,1', '7,5']) {
      expect(lit).not.toContain(hidden);
    }
  });
});
