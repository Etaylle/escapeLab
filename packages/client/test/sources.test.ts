import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { dressedFor } from '../src/world/artKit.js';
import { strengthAt } from '../src/world/gl/pack.js';
import { AMBER, EMERGENCY, PHOSPHOR, REACTOR, SERVER_BLUE } from '../src/world/palette.js';
import type { Frame } from '../src/world/render/frame.js';
import { glowSources, lampSources, sourcesOf, type LightSource } from '../src/world/sources.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, lit } from './frames.js';

/**
 * A server room with a desk and the reactor's core, side by side:
 *
 *   0123456789
 * 0 ##########
 * 1 #....#...#   SERVERRAUM (2,2), server; REAKTOR (7,2), reactor
 * 2 #....D...#   a door at (5,2); the core at (7,3), a desk at (3,4)
 * 3 #....#...#
 * 4 #....#...#
 * 5 ##########
 */
const TILES = ['##########', '#....#...#', '#........#', '#....#...#', '#....#...#', '##########'];

function lab(parts: Partial<MapView> = {}): MapView {
  return mapWith({
    width: 10,
    height: 6,
    tiles: TILES,
    labels: [
      { text: 'SERVERRAUM', x: 2, y: 2, kind: 'server' },
      { text: 'REAKTOR', x: 7, y: 2, kind: 'reactor' },
    ],
    doors: [{ id: 'tuer', x: 5, y: 2, open: false }],
    decor: [
      { kind: 'core', x: 7, y: 3 },
      { kind: 'desk', x: 3, y: 4 },
    ],
    ...parts,
  });
}

const colours = (sources: readonly LightSource[]): string[] =>
  sources.map((s) => s.colour.join(','));

/** The wall props of a frame's dressing that light up: screens and racks. */
function glowingProps(frame: Frame): number {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  return dressing.props.filter((p) => p.kind === 'screen' || p.kind === 'rack').length;
}

describe('sourcesOf — every coloured light of the frame, one list for both light layers', () => {
  it('lists the core’s pulsing orange, the desk’s screen, and the walls’ screens and racks', () => {
    const frame = frameWith({ map: lab() });
    const sources = sourcesOf(frame);
    const core = sources.find((s) => s.colour.join(',') === REACTOR.join(','));
    expect(core).toMatchObject({ x: 7.5, reach: 3.4, pulse: { periodMs: 2400 } });
    expect(colours(sources)).toContain(PHOSPHOR.join(','));
    // Every screen and rack hung on a wall lights, besides the desk and the core.
    expect(glowSources(frame)).toHaveLength(glowingProps(frame) + 2);
    expect(colours(sources).filter((c) => c === SERVER_BLUE.join(',')).length).toBeGreaterThan(0);
  });

  it('keeps a screen faint in the dark, bright once its room is lit, flickering on', () => {
    const dark = frameWith({ map: lab(), time: 10 });
    const desk = (frame: Frame): LightSource | undefined =>
      glowSources(frame).find((s) => s.x === 3.5 && s.colour.join(',') === PHOSPHOR.join(','));
    const lit = new Map([['SERVERRAUM', { tiles: [], path: {} as Path2D, since: 9.8 }]]);
    const striking = frameWith({ map: lab(), time: 10, lit, litTiles: new Set(['3,4']) });
    const up = frameWith({ map: lab(), time: 12, lit, litTiles: new Set(['3,4']) });
    expect(desk(dark)?.strength).toBeLessThan(0.1);
    expect(desk(striking)?.flicker).toBe(true);
    expect(desk(up)?.strength).toBeGreaterThan(0.3);
    expect(desk(up)?.flicker).toBeUndefined();
  });

  it('shows a light only where its spot shows, and with the power on only in your room', () => {
    const unseen = frameWith({ map: lab(), light: lightWith({ shown: (x) => x < 5 }) });
    expect(colours(glowSources(unseen))).not.toContain(REACTOR.join(','));
    const power = frameWith({
      map: lab(),
      scene: { lit: true, cover: 0 },
      light: lightWith({ powered: (x) => x < 5 }),
    });
    expect(colours(glowSources(power))).not.toContain(REACTOR.join(','));
    expect(colours(glowSources(power))).toContain(PHOSPHOR.join(','));
  });

  it('burns red the emergency lamps the light pass burns, as brightly as it burns them', () => {
    const mount = { x: 2.5, y: 1.05, facing: Math.PI / 2 };
    const lamps = [{ mount, lit: lit({ x: 2.5, y: 1.05, glow: 1.5 }) }];
    const dark = frameWith({ map: lab(), mounts: [mount], light: lightWith({ lamps }) });
    expect(lampSources(dark)).toEqual([
      {
        x: 2.5,
        y: 1.05,
        colour: [...EMERGENCY],
        reach: 1.5,
        strength: 1,
        pulse: { periodMs: (2 * Math.PI * 1000) / 2.4, depth: 0.6 },
      },
    ]);
    const [lamp] = lampSources(dark);
    for (const t of [0, 0.4, 1.3, 2.9]) {
      expect(lamp && strengthAt(lamp, t * 1000)).toBeCloseTo(0.7 + 0.3 * Math.sin(2.4 * t), 9);
    }
    // A lamp the light pass leaves dark — its room lit, the power on, the audience's — is none.
    expect(lampSources(frameWith({ map: lab(), mounts: [mount] }))).toEqual([]);
    expect(sourcesOf(dark).slice(0, 1)).toEqual(lampSources(dark));
  });

  it('turns the amber beacon over the open hatch through the escape only', () => {
    const exit = { x: 8, y: 4, open: true, openedAt: 0, atExit: [] };
    const escaping = frameWith({ map: lab({ exit }), escapeSince: 1, red: 0.5 });
    const beacon = glowSources(escaping).find((s) => s.colour.join(',') === AMBER.join(','));
    expect(beacon).toMatchObject({ x: 8.5, y: 4.5, pulse: { periodMs: 2000 } });
    const locked = lab({ exit: { ...exit, open: false } });
    const shut = frameWith({ map: locked, escapeSince: 1, red: 0.5 });
    expect(colours(glowSources(shut))).not.toContain(AMBER.join(','));
  });

  it('swells a pulsing light between its strength and its depth, as the layer does', () => {
    const colour: [number, number, number] = [1, 2, 3];
    const source: LightSource = { x: 0, y: 0, colour, reach: 1, strength: 1 };
    expect(strengthAt(source, 123)).toBe(1);
    const pulsing = { ...source, pulse: { periodMs: 1000, depth: 0.4 } };
    const samples = Array.from({ length: 20 }, (_, i) => strengthAt(pulsing, i * 50));
    expect(Math.max(...samples)).toBeCloseTo(1, 2);
    expect(Math.min(...samples)).toBeCloseTo(0.6, 2);
  });
});
