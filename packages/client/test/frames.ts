import type { PlayerView, Sight } from '@escapelab/core';
import { worldText } from '../src/world/art.js';
import { artKit } from '../src/world/artKit.js';
import type { CanvasMaker } from '../src/world/atlas.js';
import type { LightPath } from '../src/world/gl/path.js';
import type { Lamp } from '../src/world/light.js';
import type { Frame, FrameLight, FrameLit, RenderKit } from '../src/world/render/frame.js';
import { fakeCanvas, type FakeCanvas } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';

/**
 * Frames for the world's passes: a small lab, a camera over it, nobody but
 * you, the dark with no lamp — every test sets what it draws from.
 */

/** A 10×6 lab: two rooms side by side, a doorway at (5, 2) between them. */
export const TILES = [
  '##########',
  '#....#...#',
  '#........#',
  '#....#...#',
  '#....#...#',
  '##########',
];

/** A crew member as the view lists them. */
export function player(
  id: string,
  name: string,
  color: string,
  connected = true,
): PlayerView['players'][number] {
  return { id, name, color, ready: true, isHost: id === 'p1', connected };
}

/** A sight that sees nothing: the passes only hand it on. */
export function sight(): Sight {
  return { tiles: new Set(), walls: new Set(), outline: [] };
}

/** A light of the frame from `lamp`, its clip a stand-in path named `name`. */
export function lit(lamp: Partial<Lamp> = {}, name = 'clip'): FrameLit {
  return {
    lamp: { x: 0, y: 0, glow: 0, beam: null, ...lamp },
    sight: sight(),
    clip: { path: name } as unknown as Path2D,
  };
}

/** The dark with no lamp: everything shown, nothing in the colours of the power on. */
export function lightWith(parts: Partial<FrameLight> = {}): FrameLight {
  return {
    own: null,
    room: null,
    crew: [],
    eyes: new Map(),
    lamps: [],
    exit: null,
    spills: [],
    shown: () => true,
    powered: () => false,
    crewShown: () => true,
    ...parts,
  };
}

/** Fake canvases for the atlas's sprites, each named after its size. */
export const fakeSprites: CanvasMaker = (width, height) =>
  fakeCanvas(width, height, `sprite ${width}x${height}`).canvas;

/** A kit of fake canvases, the darkness cut into `overlay`. */
export function kitWith(overlay: FakeCanvas = fakeCanvas(800, 600, 'overlay')): RenderKit {
  return {
    overlay: overlay.ctx,
    ceiling: null,
    groups: null,
    roomLight: null,
    hatchCut: null,
    vignette: { canvas: fakeCanvas(0, 0, 'vignette').canvas, w: 0, h: 0, dpr: 0 },
    light: canvasLight(),
    art: artKit(fakeSprites),
    still: new Map(),
  };
}

/** The Canvas pass's way for the light, decided already: no WebGL in a test. */
export function canvasLight(): LightPath {
  return {
    asked: null,
    renderer: null,
    choice: { path: 'canvas', reason: 'a test' },
    forced: null,
    layer: null,
    dispose: () => undefined,
  };
}

/** An 800×600 canvas at 100 device pixels a tile over the middle of the lab, and `parts`. */
export function frameWith(parts: Partial<Frame> = {}): Frame {
  return {
    viewport: { w: 800, h: 600, dpr: 1, top: 0, bottom: 0, boxes: [] },
    camera: { x: 5, y: 3, scale: 100 },
    time: 0,
    now: 1_000_000,
    perf: 0,
    pulse: 0.5,
    burn: 0.8,
    map: mapWith({ width: 10, height: 6, tiles: TILES }),
    youId: 'p1',
    players: [player('p1', 'Anna', '#2dd4bf')],
    signSeen: false,
    deadlineAt: null,
    self: { x: 2.5, y: 2.5, facing: 0, moving: false },
    walkPhase: 0,
    others: new Map(),
    speaking: undefined,
    drones: {},
    doors: new Map(),
    alarm: null,
    scene: { lit: false, cover: 0 },
    ending: null,
    escapeSince: null,
    red: 0,
    hatch: 0,
    light: lightWith(),
    mounts: [],
    litTiles: new Set(),
    lit: new Map(),
    pings: [],
    chats: [],
    captions: [],
    markers: [],
    action: null,
    minimap: null,
    text: worldText(100, 1),
    spectator: false,
    reduced: false,
    touch: false,
    kit: kitWith(),
    missionId: 'probe',
    short: null,
    carrying: new Map(),
    stillSince: new Map(),
    mood: 'play',
    ...parts,
  };
}
