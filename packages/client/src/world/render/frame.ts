import type { ChatPhrase, DronePosition, PlayerView, Sight } from '@escapelab/core';
import type { Alarm } from '../alarm.js';
import type { WorldText } from '../art.js';
import { artKit, type ArtKit } from '../artKit.js';
import type { Baked } from '../baked.js';
import type { ColdOpenFrame } from '../coldOpen.js';
import type { DoorMotion } from '../doors.js';
import type { FigureMood } from '../figure.js';
import type { FinaleFrame } from '../finale.js';
import type { LightPath } from '../gl/path.js';
import type { ContextAction } from '../interact.js';
import type { LampMount, Lit } from '../light.js';
import type { MarkerTarget } from '../markers.js';
import type { CeilingLight } from '../power.js';
import type { LitGroup, RoomLight } from '../rooms.js';
import type { Viewport } from '../viewport.js';

/**
 * One frame of the world as the passes draw it (pipeline.ts): a plain object
 * GameWorld.tsx assembles once per drawn frame from its simulation, its refs
 * and the view — the camera, the clocks, the crew, the light worked out for
 * this frame, what lies over the picture — and the kit of canvases, sprites
 * and caches that outlives the frame. A pass reads the frame and draws; it
 * keeps nothing of its own.
 */

export type WorldMap = NonNullable<PlayerView['map']>;

/** A crew member's colour where the view names none. */
export const FALLBACK_COLOR = '#2dd4bf';

/** A spot somebody of the crew pinged for everybody, at `at` (performance.now()). */
export interface MapPing {
  playerId: string;
  x: number;
  y: number;
  at: number;
}

/** A quick-chat line somebody said, at `at` (performance.now()). */
export interface ChatLine {
  playerId: string;
  phrase: ChatPhrase;
  at: number;
}

/** „… entdeckt" over a source the crew has just come across, `at` in sim time. */
export interface Caption {
  x: number;
  y: number;
  text: string;
  at: number;
}

/** Somebody else of the crew, as this screen draws them. */
export interface OtherAvatar {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  /** render position, eased toward x/y */
  rx: number;
  ry: number;
  phase: number;
}

/** A lit room: the tiles its lights reach, as a path in tiles, and the sim time they came on. */
export interface LitRoom {
  tiles: { x: number; y: number }[];
  path: Path2D;
  since: number;
}

/** The room the power lights round you while the lab has it, with its tiles as a path. */
export interface PoweredRoom {
  light: RoomLight;
  path: Path2D;
}

/** A light of this frame: its lamp, what it sees, and where its light may fall (tiles). */
export interface FrameLit extends Lit {
  clip: Path2D;
}

/** This frame's light, worked out before anything is drawn (frameLight.ts). */
export interface FrameLight {
  /** your lamp in the dark; null while the lab has its power, and for the audience */
  own: FrameLit | null;
  /**
   * while the lab has its power, the room it lights round you, whole, to its walls and doors;
   * null in the dark and for the audience
   */
  room: PoweredRoom | null;
  /** the lamps the rest of the crew carry; none while the power is on */
  crew: FrameLit[];
  /** the drones' eyes, by drone id; a frozen drone looks nowhere */
  eyes: Map<string, FrameLit>;
  /** the emergency lamps, where they hang and what they light; none while the power is on */
  lamps: { mount: LampMount; lit: FrameLit }[];
  /** the open hatch's green-white light, as far as it stands open (0 to 1); null while shut */
  exit: { lit: FrameLit; open: number } | null;
  /** a lit room's light falling through an open door into the dark, as far as it stands open */
  spills: { lit: FrameLit; open: number }[];
  /**
   * whether the world shows what lies at (x, y): what some light falls on
   * now or did this run — everything, for the audience
   */
  shown: (x: number, y: number) => boolean;
  /**
   * whether the tile at (x, y) is in the colours of the lab with its power
   * on: in your room while the lab has it — all of the lab, for the
   * audience — and nowhere in the dark
   */
  powered: (x: number, y: number) => boolean;
  /**
   * whether somebody of the crew standing at (x, y) shows: anywhere in the
   * dark, where the lamp they carry lights them up; while the lab has its
   * power, nobody carries one, so only in your room
   */
  crewShown: (x: number, y: number) => boolean;
}

/** Where the minimap sits on the canvas, device pixels: its corner, cell and size. */
export interface MinimapLayout {
  ox: number;
  oy: number;
  cell: number;
  mw: number;
  mh: number;
}

/**
 * What the passes draw with that outlives a frame: the canvas the darkness
 * is cut in, what the light and the red edge keep baked between frames,
 * each with what it was made for, the way the light takes, and the art's
 * sprites and caches.
 */
export interface RenderKit {
  /** the darkness, cut anew every frame and laid over the picture (render/darkness.ts) */
  overlay: CanvasRenderingContext2D;
  /** the lab's ceiling lights baked in each colour asked for, for the map last asked for */
  ceiling: { tiles: string; byLight: Map<CeilingLight, HTMLCanvasElement> } | null;
  /** the lit rooms' tiles grouped by the rooms lighting them (rooms.ts), for the rooms lit */
  groups: { lit: string; groups: LitGroup[] } | null;
  /** the light of the lit rooms and the open hatch as last baked, and what it was baked for */
  roomLight: { key: string; sight: Sight | null; baked: Baked | null } | null;
  /** the open hatch's light cut into the darkness as last baked, and the sight it was cut to */
  hatchCut: { sight: Sight; baked: Baked | null } | null;
  /** the red edge as last baked (vignette.ts), and for which canvas: baked anew for another */
  vignette: { canvas: HTMLCanvasElement; w: number; h: number; dpr: number };
  /**
   * the way the light reaches the picture — the WebGL light layer or the
   * Canvas pass — opened on the first frame (gl/path.ts); null before
   */
  light: LightPath | null;
  /** the art's: the map's dressing, the sprite atlas, the particles, the faint lights' glow */
  art: ArtKit;
  /**
   * since when each of the crew has stood still, by player id, sim ms — kept
   * from frame to frame by assemble.ts; nobody walking is in it
   */
  still: Map<string, number>;
}

/** A fresh kit drawing the darkness into `overlay`: nothing baked yet. */
export function renderKit(overlay: CanvasRenderingContext2D): RenderKit {
  return {
    overlay,
    ceiling: null,
    groups: null,
    roomLight: null,
    hatchCut: null,
    vignette: { canvas: document.createElement('canvas'), w: 0, h: 0, dpr: 0 },
    light: null,
    art: artKit(),
    still: new Map(),
  };
}

export interface Frame {
  /** the canvas, device pixels, and what lies over it: the HUD's bars, the minimap */
  viewport: Viewport;
  /** the world point the camera puts at the canvas's middle, in tiles, and device pixels a tile */
  camera: { x: number; y: number; scale: number };
  /** the simulation's clock, s: what pulses, warms up and swells runs on it */
  time: number;
  /** the wall clock, epoch ms: doors sliding, the hatch, an alarm, the deadline */
  now: number;
  /** the page's clock, ms (performance.now()): pings, chat lines, the red edge's breath */
  perf: number;
  /** the beat the lab's objects pulse with, 0 to 1 */
  pulse: number;
  /** how brightly the emergency lamps burn now: a slow pulse that never goes out */
  burn: number;
  map: WorldMap;
  /** this screen's player, as the view names it */
  youId: string;
  players: PlayerView['players'];
  /** whether this player has seen the Laborkennung */
  signSeen: boolean;
  /** when the clock runs out, epoch ms; null for a run without one */
  deadlineAt: number | null;
  /** your avatar where you steer it, and its gait */
  self: { x: number; y: number; facing: number; moving: boolean };
  walkPhase: number;
  /** the rest of the crew by id, where this screen eases them */
  others: ReadonlyMap<string, OtherAvatar>;
  /** who speaks right now, by player id; none outside the app's voice */
  speaking: ReadonlySet<string> | undefined;
  drones: Readonly<Record<string, DronePosition>>;
  /** each door's slide, by door id (doors.ts) */
  doors: ReadonlyMap<string, DoorMotion>;
  /** the last alarm this screen saw come in (alarm.ts); null for none */
  alarm: Alarm | null;
  /** where the cold open stands (coldOpen.ts) */
  scene: ColdOpenFrame;
  /** where the ending stands (finale.ts); null while the run goes on */
  ending: FinaleFrame | null;
  /** when the escape began on this screen, epoch ms (escape.ts); null before it */
  escapeSince: number | null;
  /** how far the light has turned red here, 0 to 1: from the escape's start; 0 once won */
  red: number;
  /** how far the hatch stands open on this screen, 0 to 1 */
  hatch: number;
  light: FrameLight;
  /** where the map's emergency lamps hang; one that hangs nowhere is left out */
  mounts: readonly LampMount[];
  /** the tiles of every lit room, by key: drawn in the colours of the lab with its power on */
  litTiles: ReadonlySet<string>;
  /** the lit rooms by label */
  lit: ReadonlyMap<string, LitRoom>;
  /** the pings still showing */
  pings: readonly MapPing[];
  /** the chat lines still up */
  chats: readonly ChatLine[];
  /** the captions still rising */
  captions: readonly Caption[];
  /** what this player is meant to head for (markers.ts); none while the run ends on screen */
  markers: readonly MarkerTarget[];
  /** what E does here; null for nothing, under a panel, and while the run ends on screen */
  action: ContextAction | null;
  /** where the minimap sits; null while it is off, and for the audience */
  minimap: MinimapLayout | null;
  /** the world's text at this frame's zoom */
  text: WorldText;
  /** the audience: the whole lab, no avatar, no lamp */
  spectator: boolean;
  /** the player asked for less motion */
  reduced: boolean;
  /** the primary pointer is a finger: no keys to name, the on-screen pad shows */
  touch: boolean;
  kit: RenderKit;
  /** the mission on show, by id: the seed its rooms are dressed from (dress.ts) */
  missionId: string;
  /** a wrong cut shorting the armed fuse box: its sparks fly from (x, y), once for `seq` */
  short: { x: number; y: number; seq: number } | null;
  /** what each of the crew carries, by player id: the item's label, which tells its kind */
  carrying: ReadonlyMap<string, string>;
  /** since when each of the crew has stood still, by player id, sim ms; nobody walking is in it */
  stillSince: ReadonlyMap<string, number>;
  /** how the crew stands while the run ends on screen: celebrating it won, slumped it lost */
  mood: FigureMood;
}

/** Sets `ctx` to draw in tiles, as the camera of `frame` looks. */
export function inTiles(ctx: CanvasRenderingContext2D, { camera, viewport }: Frame): void {
  const s = camera.scale;
  ctx.setTransform(s, 0, 0, s, viewport.w / 2 - camera.x * s, viewport.h / 2 - camera.y * s);
}

/** Where the world point (x, y), in tiles, lies on the canvas of `frame`, device pixels. */
export function toScreen({ camera, viewport }: Frame, x: number, y: number): [number, number] {
  const s = camera.scale;
  return [viewport.w / 2 + (x - camera.x) * s, viewport.h / 2 + (y - camera.y) * s];
}
