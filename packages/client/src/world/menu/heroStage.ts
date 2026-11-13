import { addProbes } from '../../probes.js';
import { TAU } from '../brush.js';
import { figurePhase, shownFacing, TURN_MS, type FigurePose, type Turn } from '../figure.js';
import { traceRequested } from '../frameTrace.js';
import { MAX_DENSITY } from '../render/backing.js';
import {
  AWAY_FACING,
  entranceAt,
  FIGURE_TALL,
  headAt,
  heroPlace,
  heroPose,
  heroTile,
  HERO_FACING,
  lookToward,
  STANDING_STILL,
  STEP_TILES,
  stepped,
  steppingAt,
  type Entrance,
  type HeroMotion,
  type HeroPlace,
  type StageBox,
  type StageFacts,
  type Step,
} from './hero.js';
import { freeHero, heroCanvas, paintHero, type HeroCanvas } from './heroArt.js';
import {
  holdLamp,
  LAMP_STEP,
  lensAt,
  newSweep,
  reachOf,
  stepSweep,
  STILL_ANGLE,
  tiltOf,
  type Sweep,
} from './lamp.js';
import { runScene, type SceneHost } from './loop.js';
import { uiSound } from '../menuSound.js';

/**
 * The hero on the menu's stage (screens/MenuHero.tsx): its canvas placed on the stage as it is
 * measured (hero.ts), what the player attends to of the menu — the item hovered or in the focus
 * — the loop that paints it (heroArt.ts), the lamp it holds out to the scene's canvas (lamp.ts),
 * and what the walkthrough reads of it.
 */

/** What the walkthrough reads of the hero (`window.__escapelab.hero`, under `?trace=1`). */
export interface HeroProbe {
  /** whether it stands on the stage: false where the stage leaves it no room */
  shown: boolean;
  /** how tall it stands, scene tiles, and CSS px a figure unit */
  tiles: number;
  scale: number;
  /** its canvas's box and its feet in the window, CSS px; null while it is not shown */
  box: { left: number; top: number; width: number; height: number } | null;
  feet: { x: number; y: number } | null;
  /** how far its look is turned from its facing, radians, and its breath, tiles up */
  glance: number;
  bob: number;
  waving: boolean;
  speaking: boolean;
  /** what of the menu the player attends to: an item by its id, `card`; null for nothing */
  attends: string | null;
  /**
   * where its head is turned: at what of the menu, by its id — an item, `card` — and how far
   * from its facing, radians; null at nothing, looking round
   */
  look: { at: string; turned: number } | null;
  /** how far it has stepped aside for a panel open over the menu, 0 to 1 */
  step: number;
  /** the menu goes for the lobby: it turns away toward the lab; where it faces, radians */
  leaving: boolean;
  facing: number;
  /**
   * its lamp's beam: its lens in the window and how far its light reaches, CSS px; where it
   * points, holding a beat or sweeping; how far it is on
   */
  beam: {
    lens: { x: number; y: number };
    reach: number;
    angle: number;
    holding: boolean;
    on: number;
  } | null;
  /**
   * its entrance on the first menu of a page: whether it walks in, how far in it is, ms — null
   * before its first step — and whether it is over, the lamp on
   */
  entrance: { walks: boolean; ms: number | null; done: boolean };
  /** how often its canvas changed, and each of its layers was drawn anew */
  laid: number;
  drawn: { legs: number; upper: number };
}

/** What the hero shows besides the clock, as the menu has it on each render. */
export interface HeroLook {
  /** the colour the profile shows */
  color: string;
  /** the microphone is on and sends */
  speaking: boolean;
  /** when the name last settled anew, ms by the page's clock; null for never */
  waveAt: number | null;
  /** a panel lies open over the menu: the hero steps aside for it */
  panel: boolean;
  /** a run's card stands first in the menu: the hero looks at it while nothing else holds it */
  card: boolean;
  /** the menu goes for the lobby, the doors closing over it: the hero turns away to the lab */
  leaving: boolean;
}

/** The stage `stage` and what stands on it, CSS px; null while it has no box or no menu. */
export function stageFacts(stage: HTMLElement): StageFacts | null {
  const box = stage.getBoundingClientRect();
  const body = stage.querySelector('.menu-body')?.getBoundingClientRect();
  const chip = stage.querySelector('.profile-chip')?.getBoundingClientRect();
  if (body === undefined || chip === undefined || box.width === 0 || box.height === 0) {
    return null;
  }
  return {
    w: box.width,
    h: box.height,
    windowH: window.innerHeight,
    padBottom: parseFloat(getComputedStyle(stage).paddingBottom) || 0,
    menuRight: body.right - box.left,
    chipBottom: chip.bottom - box.top,
  };
}

/** Puts the hero's canvas on `box` in the stage, or hides it where it stands nowhere. */
function placeCanvas(canvas: HTMLCanvasElement, box: StageBox | null): void {
  canvas.hidden = box === null;
  if (box !== null) {
    Object.assign(canvas.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }
}

/** Where the hero stands, kept as the stage is measured: its place, the stage in the window. */
export interface Standing {
  place: HeroPlace | null;
  /** the stage's corner in the window, CSS px */
  at: { x: number; y: number };
  /** where the menu's column ends, from the stage's left, CSS px: the beam stops short of it */
  menuRight: number;
  /** how wide the stage is, CSS px: the hero walks in from its right edge */
  stageW: number;
  /** a scene tile, CSS px: the hero steps aside half of one */
  tile: number;
}

/**
 * Measures the stage the hero's canvas stands on, and again whenever it or the profile change
 * size or the window does: the hero placed anew, `changed` told.
 */
function watchStage(
  canvas: HTMLCanvasElement,
  standing: Standing,
  changed: () => void,
): () => void {
  const stage = canvas.parentElement;
  if (stage === null) {
    return () => undefined;
  }
  const measure = (): void => {
    const facts = stageFacts(stage);
    const box = stage.getBoundingClientRect();
    standing.place = facts === null ? null : heroPlace(facts);
    standing.at = { x: box.left, y: box.top };
    standing.menuRight = facts?.menuRight ?? 0;
    standing.stageW = facts?.w ?? 0;
    standing.tile = facts === null ? 0 : heroTile(facts.windowH);
    placeCanvas(canvas, standing.place === null ? null : standing.place.box);
    changed();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(stage);
  const chip = stage.querySelector('.profile-chip');
  if (chip !== null) observer?.observe(chip);
  window.addEventListener('resize', measure);
  measure();
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  };
}

/** Something of the menu the player attends to: what it is, and its middle in the window. */
export interface Attended {
  /** a menu item by its id (MainMenu.tsx `data-item`), or `card`: a run's card */
  id: string;
  x: number;
  y: number;
}

/** The menu's item or card `target` lies in, as attended; null where it lies in neither. */
export function attendedOf(target: EventTarget | null): Attended | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const found = target.closest('.menu-item, .bound');
  if (found === null) {
    return null;
  }
  const box = found.getBoundingClientRect();
  const id = found instanceof HTMLElement ? (found.dataset['item'] ?? 'card') : 'card';
  return { id, x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Follows what of the menu on `stage` the player attends to — the item or card the pointer is
 * over, else the one in the focus — and tells `changed` of it as it changes.
 */
function watchAttention(
  stage: HTMLElement,
  changed: (attended: Attended | null) => void,
): () => void {
  let hovered: Attended | null = null;
  let focused: Attended | null = null;
  const tell = (): void => changed(hovered ?? focused);
  const over = (e: Event): void => {
    hovered = attendedOf(e.target);
    tell();
  };
  const left = (): void => {
    hovered = null;
    tell();
  };
  const focus = (e: Event): void => {
    focused = attendedOf(e.target);
    tell();
  };
  const blurred = (): void => {
    focused = null;
    tell();
  };
  const events = [
    ['pointerover', over],
    ['pointerleave', left],
    ['focusin', focus],
    ['focusout', blurred],
  ] as const;
  for (const [type, listener] of events) stage.addEventListener(type, listener);
  focused = attendedOf(document.activeElement);
  tell();
  return () => {
    for (const [type, listener] of events) stage.removeEventListener(type, listener);
  };
}

/** The angle from the window's point `from` to `to`, 0 to a full turn, as the sweep counts. */
function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return angle < 0 ? angle + TAU : angle;
}

/** What a hero's painter draws on and reads. */
export interface HeroPainting {
  hero: HeroCanvas;
  standing: Standing;
  look: { readonly current: HeroLook };
  /** what of the menu the player attends to now; null for nothing */
  attends: { current: Attended | null };
  sweep: Sweep;
  probe: HeroProbe;
  /** its entrance on the first menu of a page (`walksIn`), as far as it has come */
  entrance: EntranceRun;
  /** how it reacts to the menu: its step aside, its head's turn, its turn away */
  react: Reactions;
  /** its own offset into its loops (figure.ts figurePhase of the pass's id) */
  phase: number;
  /** whether the player asks for less motion now */
  reduced: () => boolean;
  /** what the hero's canvas is put on: the stage's box it covers (placeCanvas) */
  canvas: HTMLCanvasElement | null;
}

/** A hero's entrance as it goes: whether it walks in, since when, what it has come to. */
export interface EntranceRun {
  walks: boolean;
  /** its first step, ms by the page's clock; null before it */
  since: number | null;
  /** the click has come */
  clicked: boolean;
  done: boolean;
  /** where the walkthrough holds it, ms into it (`window.__heroHold`); null while none does */
  held: () => number | null;
  /** whether it was held at the last frame: let go, it goes on from there */
  wasHeld: boolean;
  /** how far in it was at the last frame, ms */
  last: number;
  /** what sounds the click: the cold open's (world/menuSound.ts) */
  click: () => void;
}

/** A hero's entrance, `walks` in or there from the start; held where the walkthrough holds it. */
export function entranceRun(walks: boolean, held: () => number | null): EntranceRun {
  const start = { since: null, clicked: false, done: !walks, wasHeld: false, last: 0 };
  return { walks, ...start, held, click: clickOn };
}

/** The click of the cold open as the lamp comes on, on the menu's sound. */
function clickOn(): void {
  uiSound('lamp');
}

/** Where the walkthrough holds the hero's entrance, ms into it, under `?trace=1`; null for none. */
export function walkthroughHold(): number | null {
  if (!traceRequested(location.search)) {
    return null;
  }
  const held = window.__heroHold;
  return typeof held === 'number' ? held : null;
}

/** Whether a hero has shown on this page yet: walked in, or stood there from the start. */
let shownOnPage = false;

/**
 * Whether the hero walks in on the menu coming up now: on the first menu of a page that shows
 * it — not one come back from the lobby through the doors (`cameBack`) — and never under reduced
 * motion. A menu the page shows later finds it there already: the page's first hero to paint a
 * frame spends the entrance (`heroPainter`).
 */
export function walksIn(reduced: boolean, cameBack: boolean): boolean {
  return !shownOnPage && !reduced && !cameBack;
}

/** The entrance over: the hero in its place, the click come, the lamp on. */
const ARRIVED: Entrance = { motion: STANDING_STILL, clicked: true, lamp: 1, done: true };

/**
 * Where the hero's entrance stands at `now`, the hero placed `place` on a stage `stageW` wide:
 * walking in from beyond the stage's right edge, the click, the lamp coming on — held where the
 * walkthrough holds it — or over; at once over under reduced motion. The click sounds once.
 */
function entranceNow(on: HeroPainting, place: HeroPlace, now: number): Entrance {
  const run = on.entrance;
  if (run.done || on.reduced()) {
    run.done = true;
    return ARRIVED;
  }
  const ms = entranceClock(run, now);
  const from = (on.standing.stageW - place.box.left) / place.scale;
  const entrance = entranceAt(ms, from);
  if (entrance.clicked && !run.clicked) {
    run.clicked = true;
    run.click();
  }
  run.done = entrance.done && !run.wasHeld;
  return entrance;
}

/**
 * How far into its entrance `run` is at `now`, ms: from its first step on, or where the
 * walkthrough holds it — let go, it goes on from there.
 */
function entranceClock(run: EntranceRun, now: number): number {
  run.since ??= now;
  const held = run.held();
  if (held === null && run.wasHeld) {
    run.since = now - run.last;
  }
  run.wasHeld = held !== null;
  run.last = held ?? now - run.since;
  return run.last;
}

/** How a hero reacts to the menu as it goes: its step aside, its head's turn, its turn away. */
export interface Reactions {
  /** its step aside for a panel, or back */
  step: Step;
  /** how far aside it stood at the last frame, figure units */
  stepped: number;
  /** its head turning to what the player attends to, or back; null before it ever turned */
  look: Turn | null;
  /** its turn away to the lab as the menu goes; null while it stays */
  away: Turn | null;
}

/** A hero that has not reacted to anything yet. */
export function stillReactions(): Reactions {
  return { step: { from: 0, to: 0, since: 0 }, stepped: 0, look: null, away: null };
}

/** How far aside the hero steps for a panel, figure units: STEP_TILES of the scene's tile. */
function stepOf(place: HeroPlace, standing: Standing): number {
  return (STEP_TILES * standing.tile) / place.scale;
}

/**
 * The box the hero's canvas covers: its place's and the room to step aside into, on to the
 * stage's right edge as it walks in.
 */
function canvasBox(place: HeroPlace, entrance: Entrance, standing: Standing): StageBox {
  const { box } = place;
  const room = Math.ceil(stepOf(place, standing) * place.scale);
  const width = entrance.motion.moving ? standing.stageW - box.left : box.width + room;
  return { ...box, width: Math.max(box.width, width) };
}

/**
 * The hero's step aside at `now`: half a scene tile toward the stage's edge while a panel lies
 * open over the menu (`panel`), back as it goes — a new step from wherever the last has come to.
 */
function stepNow(on: HeroPainting, place: HeroPlace, now: number) {
  const { react } = on;
  const reduced = on.reduced();
  const to = on.look.current.panel ? stepOf(place, on.standing) : 0;
  if (react.step.to !== to) {
    const from = steppingAt(react.step, now, reduced).offset;
    react.step = { from, to, since: now };
  }
  const stepping = steppingAt(react.step, now, reduced);
  react.stepped = stepping.offset;
  return stepping;
}

/**
 * Where the hero faces at `now`, its entrance at `entrance`: along its way as it walks in; away
 * toward the lab, in the art's steps, as the menu goes for the lobby; to the menu else.
 */
function facingNow(on: HeroPainting, entrance: Entrance, now: number): number {
  const { react } = on;
  if (!on.look.current.leaving || on.reduced()) {
    react.away = null;
    return entrance.motion.facing;
  }
  react.away ??= { from: HERO_FACING, to: AWAY_FACING, since: now };
  return shownFacing(react.away, now);
}

/**
 * What of the menu the hero's head turns to: what the player attends to — the item hovered or
 * in the focus — else a run's card standing first in the menu; null for nothing.
 */
function lookTarget(on: HeroPainting): Attended | null {
  if (on.attends.current !== null) {
    return on.attends.current;
  }
  const card = on.look.current.card ? on.canvas?.parentElement?.querySelector('.bound') : null;
  return card === null || card === undefined ? null : attendedOf(card);
}

/**
 * Where the hero's head looks at `now`, standing `offset` figure units right of its place facing
 * `facing`: turned a little toward what it looks at (lookToward) in the art's steps over TURN_MS
 * — the turn of the walk cycle — and back the same way as nothing holds it; null once it is
 * back, its glances its own again. Never as it walks or leaves, nor under reduced motion.
 */
function lookNow(
  on: HeroPainting,
  [place, offset, facing]: readonly [HeroPlace, number, number],
  now: number,
): number | null {
  const { react } = on;
  const target = eyeHeldBy(on);
  if (on.reduced() || (target === null && react.look === null)) {
    react.look = null;
    return null;
  }
  const head = headAt(place, offset);
  const from = { x: head.x + on.standing.at.x, y: head.y + on.standing.at.y };
  const to = target === null ? facing : lookToward(angleTo(from, target), facing);
  const turn = turnedTo(react.look, [to, facing], now);
  const back = target === null && now - turn.since >= TURN_MS;
  react.look = back ? null : turn;
  return back ? null : shownFacing(turn, now);
}

/** What holds the hero's eye now (lookTarget): nothing as the menu goes, or under less motion. */
function eyeHeldBy(on: HeroPainting): Attended | null {
  return on.look.current.leaving || on.reduced() ? null : lookTarget(on);
}

/**
 * The head's turn at `now` toward `to`: `turn` as it goes where it already turns there, else a
 * new one from where the head shows now — the facing `facing` where it turned nowhere yet.
 */
function turnedTo(turn: Turn | null, [to, facing]: readonly [number, number], now: number): Turn {
  if (turn !== null && Math.abs(turn.to - to) <= 1e-3) {
    return turn;
  }
  const shown = turn === null ? facing : shownFacing(turn, now);
  return { from: shown, to, since: now };
}

/**
 * How the hero moves at `now`: walking in (`entrance`), stepping aside for a panel, turning away
 * as the menu goes, its head turned to what the player attends to.
 */
function motionNow(
  on: HeroPainting,
  place: HeroPlace,
  entrance: Entrance,
  now: number,
): HeroMotion {
  const walking = entrance.motion;
  const step = stepNow(on, place, now);
  const facing = facingNow(on, entrance, now);
  const offset = walking.offset + step.offset;
  const moving = walking.moving || step.moving;
  const look = moving ? null : lookNow(on, [place, offset, facing], now);
  return { offset, moving, walk: walking.moving ? walking.walk : step.walk, facing, look };
}

/** The lamp `on` the hero holds at `now`: where it points and how it is turned in the hands. */
interface LampFrame {
  angle: number;
  tilt: number;
  /** its lens in the window, CSS px */
  lens: { x: number; y: number };
  holding: boolean;
  /** how far it is on, 0 to 1 */
  on: number;
}

/**
 * Where the lamp of `on`'s hero points at `now`, placed `placed` and standing `offset` figure
 * units right of it with its body `bob` up: along its sweep, holding a beat where it comes to the
 * item attended — or still under reduced motion — turned in the hands to the nearest of its
 * steps; on as far as `lit`.
 */
function lampAt(
  on: HeroPainting,
  [placed, bob, lit, offset]: readonly [HeroPlace, number, number, number],
  now: number,
): LampFrame {
  const { at } = on.standing;
  const reduced = on.reduced();
  const shift = offset * placed.scale;
  const place = { ...placed, feet: { x: placed.feet.x + shift, y: placed.feet.y } };
  const grip = lensAt(place, tiltOf(STILL_ANGLE), bob);
  const from = { x: grip.x + at.x, y: grip.y + at.y };
  const attended = on.attends.current;
  const target = attended === null ? null : angleTo(from, attended);
  const angle = reduced ? STILL_ANGLE : stepSweep(on.sweep, now, target);
  const tilt = stepped(tiltOf(angle), LAMP_STEP);
  const lens = lensAt(place, tilt, bob);
  const holding = !reduced && on.sweep.hold !== null;
  return { angle, tilt, lens: { x: lens.x + at.x, y: lens.y + at.y }, holding, on: lit };
}

/**
 * Notes on the probe how the hero stands (`pose`) and moves (`motion`), where its lamp points
 * (`lamp`) and what it looks at.
 */
function probePose(
  on: HeroPainting,
  [pose, motion]: readonly [FigurePose, HeroMotion],
  lamp: LampFrame,
  reach: number,
): void {
  const run = on.entrance;
  Object.assign(on.probe, {
    glance: pose.look - motion.facing,
    bob: pose.bob,
    waving: pose.arms !== null && pose.arms.front > 1.4,
    speaking: pose.shimmer !== null,
    attends: on.attends.current?.id ?? null,
    leaving: on.look.current.leaving,
    facing: motion.facing,
    beam: { lens: lamp.lens, reach, angle: lamp.angle, holding: lamp.holding, on: lamp.on },
    entrance: { walks: run.walks, ms: run.since === null ? null : run.last, done: run.done },
    drawn: { ...on.hero.drawn },
  });
  probeReactions(on, [pose, motion]);
  probeBox(on.probe, on.standing, motion.offset);
}

/** Notes on the probe what the hero's head is turned to, and how far it has stepped aside. */
function probeReactions(on: HeroPainting, [pose, motion]: readonly [FigurePose, HeroMotion]): void {
  const { place } = on.standing;
  const target = motion.look === null ? null : lookTarget(on);
  const toStep = place === null ? 0 : stepOf(place, on.standing);
  on.probe.look = target === null ? null : { at: target.id, turned: pose.look - motion.facing };
  on.probe.step = toStep > 0 ? on.react.stepped / toStep : 0;
}

/** Notes on the probe the hero's box as it stands now, `offset` figure units right of its place. */
function probeBox(probe: HeroProbe, { place, at }: Standing, offset: number): void {
  if (place !== null) {
    const { box, scale } = place;
    probe.box = { ...box, left: box.left + offset * scale + at.x, top: box.top + at.y };
  }
}

/**
 * What paints the hero on each frame of its loop, up `since` (ms, the page's clock): its pose as
 * it stands now, laid from its layers (heroArt.ts), and the lamp it holds out to the scene's
 * canvas. Says whether it moves on: never under reduced motion, which holds it still until
 * something it shows changes and wakes it.
 */
export function heroPainter(on: HeroPainting, since: number): (now: number) => boolean {
  let boxed: StageBox | null = null;
  return (now) => {
    const { place } = on.standing;
    if (place === null) {
      holdLamp(null);
      return false;
    }
    shownOnPage = true;
    const look = on.look.current;
    const reduced = on.reduced();
    const entrance = entranceNow(on, place, now);
    const motion = motionNow(on, place, entrance, now);
    const cues = { phase: on.phase, speaking: look.speaking, waveAt: look.waveAt, reduced };
    const pose = heroPose(cues, [now, since], motion);
    const lamp = lampAt(on, [place, pose.bob, entrance.lamp, motion.offset], now);
    const box = canvasBox(place, entrance, on.standing);
    if (on.canvas !== null && box !== boxed) {
      placeCanvas(on.canvas, box);
      boxed = box;
    }
    const dpr = Math.min(MAX_DENSITY, window.devicePixelRatio || 1);
    const frame = { place, box, pose, motion, color: look.color, dpr, lamp: lamp };
    if (paintHero(on.hero, frame)) {
      on.probe.laid += 1;
    }
    const lensX = lamp.lens.x - on.standing.at.x;
    const reach = reachOf(FIGURE_TALL * place.scale, lensX, on.standing.menuRight);
    holdLamp({ ...lamp.lens, angle: lamp.angle, reach, on: lamp.on });
    probePose(on, [pose, motion], lamp, reach);
    return !reduced || !entrance.done;
  };
}

/** The hero as it stands for the probe: nothing shown yet. */
function emptyProbe(): HeroProbe {
  return {
    shown: false,
    tiles: 0,
    scale: 0,
    box: null,
    feet: null,
    glance: 0,
    bob: 0,
    waving: false,
    speaking: false,
    attends: null,
    look: null,
    step: 0,
    leaving: false,
    facing: HERO_FACING,
    beam: null,
    entrance: { walks: false, ms: null, done: true },
    laid: 0,
    drawn: { legs: 0, upper: 0 },
  };
}

/** Notes where the hero stands (`standing`) on the probe. */
function probePlace(probe: HeroProbe, { place, at }: Standing): void {
  if (place === null) {
    Object.assign(probe, { shown: false, tiles: 0, scale: 0, box: null, feet: null, beam: null });
    return;
  }
  const { box, feet } = place;
  Object.assign(probe, {
    shown: true,
    tiles: place.tiles,
    scale: place.scale,
    box: { ...box, left: box.left + at.x, top: box.top + at.y },
    feet: { x: feet.x + at.x, y: feet.y + at.y },
  });
}

/** Puts `probe` on the page under `?trace=1`; returns what takes it off again. */
function probed(probe: HeroProbe): () => void {
  if (!traceRequested(location.search)) {
    return () => undefined;
  }
  return addProbes({
    get hero() {
      return structuredClone(probe);
    },
  });
}

/** A canvas `width` × `height` of the page's own: the hero's layers. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A hero started on its canvas: what wakes its loop, and its end. */
export interface HeroRun {
  wake: () => void;
  stop: () => void;
}

/**
 * Starts the hero on `canvas` as the menu shows it: measured on its stage, painted by a loop of
 * its own no more than 30 times a second while its canvas shows (loop.ts), woken as the stage,
 * the motion, what the player attends to or what the menu hands it (`look`) change. `pass` is
 * the browser's pass's id: the hero's own offset into its loops; `walksIn` whether it walks in
 * on this menu, or stands there from the start. Null where the browser gives no 2D canvas.
 */
export function startHero(
  canvas: HTMLCanvasElement,
  [look, pass, walksIn]: readonly [{ readonly current: HeroLook }, string, boolean],
  host: SceneHost,
  motion: { reduced: () => boolean; watch: (changed: () => void) => () => void },
): HeroRun | null {
  const hero = heroCanvas(canvas, makeCanvas);
  const stage = canvas.parentElement;
  if (hero === null || stage === null) {
    return null;
  }
  const probe = emptyProbe();
  const standing: Standing = { place: null, at: { x: 0, y: 0 }, menuRight: 0, stageW: 0, tile: 0 };
  const attends: { current: Attended | null } = { current: null };
  const phase = figurePhase(pass);
  const entrance = entranceRun(walksIn, walkthroughHold);
  const react = stillReactions();
  const sweep = newSweep();
  const on = { hero, standing, look, attends, sweep, probe, phase, entrance, react, canvas };
  const loop = runScene(heroPainter({ ...on, reduced: motion.reduced }, performance.now()), host);
  const unprobe = probed(probe);
  const unwatch = [
    watchStage(canvas, standing, () => {
      probePlace(probe, standing);
      loop.wake();
    }),
    watchAttention(stage, (attended) => {
      attends.current = attended;
      loop.wake();
    }),
    motion.watch(() => loop.wake()),
  ];
  return {
    wake: loop.wake,
    stop: () => {
      loop.stop();
      unwatch.forEach((stop) => stop());
      unprobe();
      holdLamp(null);
      freeHero(hero);
    },
  };
}
