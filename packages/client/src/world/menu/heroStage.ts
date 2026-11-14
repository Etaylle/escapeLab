import { addProbes } from '../../probes.js';
import { domCanvas } from '../atlas.js';
import { TAU } from '../brush.js';
import { figurePhase, shownFacing, TURN_MS, type FigurePose, type Turn } from '../figure.js';
import { traceRequested } from '../frameTrace.js';
import { MAX_DENSITY } from '../render/backing.js';
import {
  AWAY_FACING,
  CLEAR,
  entranceAt,
  FIGURE_TALL,
  flareAt,
  flickerAt,
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
  TOWARD_MS,
  type Entrance,
  type HeroMotion,
  type HeroPlace,
  type StageBox,
  type StageFacts,
  type Step,
} from './hero.js';
import { freeHero, heroCanvas, paintHero, type HeroCanvas } from './heroArt.js';
import {
  aimSweep,
  holdLamp,
  LAMP_STEP,
  lightStep,
  lensAt,
  newSweep,
  reachOf,
  stepSweep,
  STILL_ANGLE,
  tiltOf,
  withinSweep,
  type Sweep,
} from './lamp.js';
import { runScene, type SceneHost } from './loop.js';
import { holdPlace, SCENE_ANCHOR } from './places.js';
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
   * points, holding — a beat on the item attended, or on the room of the place it is turned to
   * once it has come there (`room`, the item's; null while it sweeps) — or sweeping; how far it
   * is on, and how far it flares
   */
  beam: {
    lens: { x: number; y: number };
    reach: number;
    angle: number;
    holding: boolean;
    room: string | null;
    on: number;
    flare: number;
  } | null;
  /** its visor catches the glow of the item it looks at */
  glow: boolean;
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
  /** the colour the profile wears (screens/BarAccount.tsx `profileColor`) */
  color: string;
  /** the microphone is on and sends */
  speaking: boolean;
  /** when the name last settled anew, ms by the page's clock; null for never */
  waveAt: number | null;
  /**
   * the item whose panel lies open over the menu (MainMenu.tsx `PanelId`): the hero steps aside
   * for it, the scene holds the item's place; null for none
   */
  panel: string | null;
  /** a run's card stands first in the menu: the hero looks at it while nothing else holds it */
  card: boolean;
  /** the menu goes for the lobby, the doors closing over it: the hero turns away to the lab */
  leaving: boolean;
  /** the item of the menu taken last: its lamp flares, it steps toward the menu; null for none */
  taken: Taken | null;
}

/**
 * An item of the menu taken: when, ms by the page's clock, and whether it leaves the menu — for a
 * page, the editor or a run, the leaves closing over it — or opens a panel over it.
 */
export interface Taken {
  at: number;
  toward: boolean;
}

/** A phone held sideways or upright, as menu.css lays the menu out for it. */
export const PHONE_QUERY = '(orientation: landscape) and (max-height: 500px), (max-width: 560px)';

/** A length the stylesheets give as `value`, CSS px; 0 where it says none. */
const px = (value: string): number => parseFloat(value) || 0;

/**
 * Where the widest panel over the menu ends, from the stage's left: from the menu's column's left
 * as wide as the stage's content lets it, at most `--menu-panel-w` (menu.css).
 */
function panelRightOf(stage: HTMLElement, box: DOMRect, bodyLeft: number): number {
  const style = getComputedStyle(stage);
  const content = box.width - px(style.paddingLeft) - px(style.paddingRight);
  const widest = px(style.getPropertyValue('--menu-panel-w')) || content;
  return bodyLeft - box.left + Math.min(content, widest);
}

/**
 * The stage `stage` and what stands on it, CSS px — the hero's canvas `canvas` carrying the
 * window's safe areas in its margins (menu.css) — null while it has no box or no menu.
 */
export function stageFacts(stage: HTMLElement, canvas: HTMLCanvasElement): StageFacts | null {
  const box = stage.getBoundingClientRect();
  const body = stage.querySelector('.menu-body')?.getBoundingClientRect();
  if (body === undefined || box.width === 0 || box.height === 0) {
    return null;
  }
  const safe = getComputedStyle(canvas);
  const padding = getComputedStyle(stage);
  return {
    w: box.width,
    h: box.height,
    windowH: window.innerHeight,
    phone: window.matchMedia(PHONE_QUERY).matches,
    padBottom: px(padding.paddingBottom),
    safeRight: px(safe.marginRight),
    safeBottom: px(safe.marginBottom),
    menuRight: body.right - box.left,
    panelRight: panelRightOf(stage, box, body.left),
    ceiling: px(padding.paddingTop),
  };
}

/**
 * Puts the hero's canvas on `box` in the stage, or hides it where it stands nowhere: its style
 * written only where it lies elsewhere, as its loop asks on every frame.
 */
function placeCanvas(canvas: HTMLCanvasElement, box: StageBox | null): void {
  canvas.hidden = box === null;
  if (box === null) {
    return;
  }
  const at = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
  const sides = Object.keys(at) as (keyof typeof at)[];
  if (sides.some((side) => canvas.style[side] !== at[side])) {
    Object.assign(canvas.style, at);
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
 * Measures the stage the hero's canvas stands on, and again whenever it changes size or the
 * window does: the hero placed anew, `changed` told.
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
    const facts = stageFacts(stage, canvas);
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

/** What of the menu the player attends to now. */
export interface Attention {
  /** the item or card attended: the one the pointer is over, else the one in the focus */
  attended: Attended | null;
  /**
   * the item the player picked out — the one the pointer is over, else the one the focus was
   * moved to since the menu came up, not the one the menu put it on —, whose place the scene
   * shows (places.ts); null for none, or a run's card
   */
  picked: string | null;
}

/** The item `hovered`, else `focused` once the focus has `moved`; never a run's card. */
function pickedOf(hovered: Attended | null, focused: Attended | null, moved: boolean) {
  const picked = hovered ?? (moved ? focused : null);
  return picked === null || picked.id === 'card' ? null : picked.id;
}

/**
 * Follows what of the menu on `stage` the player attends to — the item or card the pointer is
 * over, else the one in the focus — and what the player picked out (`Attention`), and tells
 * `changed` of it as it changes. The focus the menu stands on as it comes up is not picked out:
 * the scene drifts until the player moves the focus or the pointer.
 */
function watchAttention(stage: HTMLElement, changed: (attention: Attention) => void): () => void {
  let hovered: Attended | null = null;
  let focused: Attended | null = attendedOf(document.activeElement);
  let first: string | null | undefined = focused?.id;
  let moved = false;
  const tell = (): void => {
    changed({ attended: hovered ?? focused, picked: pickedOf(hovered, focused, moved) });
  };
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
    first ??= focused?.id ?? null;
    moved ||= (focused?.id ?? null) !== first;
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
  /** the item the player picked out (`Attention`); null for none */
  picked: { current: string | null };
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
  /** where the walkthrough holds its beat, ms after an item is taken (`walkthroughBeat`) */
  beatHeld: () => number | null;
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

/**
 * Where the walkthrough holds the hero's beat as an item of the menu is taken, ms after it — its
 * step and its lamp's flare caught on their way (menu-hero-click.png) — under `?trace=1`; null
 * for none.
 */
export function walkthroughBeat(): number | null {
  if (!traceRequested(location.search)) {
    return null;
  }
  const held = window.__heroBeat;
  return typeof held === 'number' ? held : null;
}

/**
 * The page's clock `now` as the hero goes by it: stopped `held` ms after the item `taken` was,
 * where the walkthrough holds the hero's beat there; else `now`.
 */
function heroClock(now: number, taken: Taken | null, held: number | null): number {
  return taken === null || held === null ? now : Math.min(now, taken.at + held);
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
 * stage's right edge as it walks in, and the room to step toward the menu while it does.
 */
function canvasBox(place: HeroPlace, entrance: Entrance, on: HeroPainting): StageBox {
  const { box } = place;
  const { standing, react } = on;
  const room = Math.ceil(stepOf(place, standing) * place.scale);
  const width = entrance.motion.moving ? standing.stageW - box.left : box.width + room;
  const grown = { ...box, width: Math.max(box.width, width) };
  const toward = react.step.to < 0 || react.stepped < 0;
  return toward ? { ...grown, left: grown.left - room, width: grown.width + room } : grown;
}

/**
 * The hero's step aside at `now`: half a scene tile toward the stage's edge while a panel lies
 * open over the menu (`panel`), back as it goes — a new step from wherever the last has come to.
 */
/**
 * How far toward the menu the hero steps after an item was taken that leaves the menu
 * (`Taken.toward`), figure units, below 0: half a scene tile — no further than the menu's column
 * and CLEAR leave it — for TOWARD_MS after it was taken; 0 else, and under reduced motion.
 */
function towardOf(on: HeroPainting, place: HeroPlace, now: number): number {
  const taken = on.look.current.taken;
  if (on.reduced() || taken === null || !taken.toward || now - taken.at >= TOWARD_MS) {
    return 0;
  }
  const room = Math.max(0, place.box.left - (on.standing.menuRight + CLEAR)) / place.scale;
  return -Math.min(stepOf(place, on.standing), room);
}

function stepNow(on: HeroPainting, place: HeroPlace, now: number) {
  const { react } = on;
  const reduced = on.reduced();
  const aside = on.look.current.panel !== null ? stepOf(place, on.standing) : 0;
  const to = aside > 0 ? aside : towardOf(on, place, now);
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
  /** held: a beat on the item attended, or on the room of the place it has come to */
  holding: boolean;
  /** how far it is on, 0 to 1, flickering as it does once a minute */
  on: number;
  /** how far it flares as an item is taken, 0 to 1 */
  flare: number;
}

/**
 * How strong the lamp of `on`'s hero burns at `now`, up `since`: as far as its entrance has
 * switched it on (`lit`), dipping as it flickers once a minute; flaring where an item was taken
 * (hero.ts `flareAt`) — at the steps its beam is laid at, and steady under reduced motion.
 */
function lampLight(on: HeroPainting, lit: number, [now, since]: readonly [number, number]) {
  const reduced = on.reduced();
  const taken = on.look.current.taken;
  const flare = reduced || taken === null ? 0 : flareAt(now - taken.at);
  return {
    on: lightStep(lit * flickerAt(now - since, on.phase, reduced)),
    flare: lightStep(flare),
  };
}

/** Where the menu's places show in the window (places.ts SCENE_ANCHOR): the scene fills it. */
function placeAnchor(): { x: number; y: number } {
  return { x: SCENE_ANCHOR.x * window.innerWidth, y: SCENE_ANCHOR.y * window.innerHeight };
}

/**
 * The place the scene shows for the hero `on` (places.ts): that of the item whose panel lies
 * open, else of the one the player picked out; null for the drift.
 */
function placeTarget(on: HeroPainting): string | null {
  return on.look.current.panel ?? on.picked.current;
}

/**
 * Where the beam of `on`'s hero points at `now` from its lens at `from` in the window, and whether
 * it holds there: turned to the room of the place the scene travels to, and held once it has come
 * there (lamp.ts `aimSweep`) — the lamp lights the room it arrives in —, else along its sweep,
 * holding a beat where it comes to the item attended.
 */
function beamAngle(
  on: HeroPainting,
  from: { x: number; y: number },
  now: number,
): { angle: number; holding: boolean } {
  if (placeTarget(on) !== null) {
    const toward = withinSweep(angleTo(from, placeAnchor()));
    const angle = aimSweep(on.sweep, now, toward);
    return { angle, holding: angle === toward };
  }
  const attended = on.attends.current;
  const angle = stepSweep(on.sweep, now, attended === null ? null : angleTo(from, attended));
  return { angle, holding: on.sweep.hold !== null };
}

/**
 * Where the lamp of `on`'s hero points at `now`, placed `placed` and standing `offset` figure
 * units right of it with its body `bob` up: turned to a place's room, or along its sweep
 * (`beamAngle`) — still under reduced motion — turned in the hands to the nearest of its steps;
 * burning as `light` says (`lampLight`).
 */
function lampAt(
  on: HeroPainting,
  [placed, bob, offset]: readonly [HeroPlace, number, number],
  now: number,
  light: { on: number; flare: number },
): LampFrame {
  const { at } = on.standing;
  const reduced = on.reduced();
  const shift = offset * placed.scale;
  const place = { ...placed, feet: { x: placed.feet.x + shift, y: placed.feet.y } };
  const grip = lensAt(place, tiltOf(STILL_ANGLE), bob);
  const from = { x: grip.x + at.x, y: grip.y + at.y };
  const { angle, holding } = reduced
    ? { angle: STILL_ANGLE, holding: false }
    : beamAngle(on, from, now);
  const tilt = stepped(tiltOf(angle), LAMP_STEP);
  const lens = lensAt(place, tilt, bob);
  return { angle, tilt, lens: { x: lens.x + at.x, y: lens.y + at.y }, holding, ...light };
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
    beam: {
      ...{ lens: lamp.lens, reach, angle: lamp.angle, holding: lamp.holding },
      ...{ room: placeTarget(on), on: lamp.on, flare: lamp.flare },
    },
    glow: !on.reduced() && on.attends.current !== null,
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
 * The hero gone from the stage — left out where the stage leaves it no room, or gone with the
 * menu: its lamp let go, so that the scene lays no beam, and its canvases with it.
 */
function leaveOut(hero: HeroCanvas): void {
  holdLamp(null);
  freeHero(hero);
}

/**
 * What paints the hero on each frame of its loop, up `since` (ms, the page's clock): its pose as
 * it stands now, laid from its layers (heroArt.ts), and the lamp it holds out to the scene's
 * canvas. Says whether it moves on: never under reduced motion, which holds it still until
 * something it shows changes and wakes it.
 */
export function heroPainter(on: HeroPainting, since: number): (now: number) => boolean {
  return (frameAt) => {
    const now = heroClock(frameAt, on.look.current.taken, on.beatHeld());
    const { place } = on.standing;
    holdPlace(placeTarget(on));
    if (place === null) {
      leaveOut(on.hero);
      return false;
    }
    shownOnPage = true;
    const look = on.look.current;
    const reduced = on.reduced();
    const entrance = entranceNow(on, place, now);
    const motion = motionNow(on, place, entrance, now);
    const cues = { phase: on.phase, speaking: look.speaking, waveAt: look.waveAt, reduced };
    const pose = heroPose(cues, [now, since], motion);
    const light = lampLight(on, entrance.lamp, [now, since]);
    const lamp = lampAt(on, [place, pose.bob, motion.offset], now, light);
    const box = canvasBox(place, entrance, on);
    if (on.canvas !== null) {
      placeCanvas(on.canvas, box);
    }
    const dpr = Math.min(MAX_DENSITY, window.devicePixelRatio || 1);
    const glow = !reduced && on.attends.current !== null;
    const frame = { place, box, pose, motion, color: look.color, dpr, lamp, glow };
    if (paintHero(on.hero, frame)) {
      on.probe.laid += 1;
    }
    const lensX = lamp.lens.x - on.standing.at.x;
    const reach = reachOf(FIGURE_TALL * place.scale, lensX, on.standing.menuRight);
    holdLamp({ ...lamp.lens, angle: lamp.angle, reach, on: lamp.on, flare: lamp.flare });
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
    glow: false,
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

/** A hero started on its canvas: what wakes its loop, and its end. */
export interface HeroRun {
  wake: () => void;
  stop: () => void;
}

/**
 * Starts the hero on `canvas` as the menu shows it: measured on its stage, painted by a loop of
 * its own no more than 30 times a second while its canvas shows (loop.ts), woken as the stage,
 * the motion, what the player attends to or what the menu hands it (`look`) change; measured
 * with no room left for it, it lets its lamp and its canvases go at once, as it does stopped.
 * `pass` is the browser's pass's id: the hero's own offset into its loops; `walksIn` whether it
 * walks in on this menu, or stands there from the start. Null where the browser gives no 2D
 * canvas.
 */
export function startHero(
  canvas: HTMLCanvasElement,
  [look, pass, walksIn]: readonly [{ readonly current: HeroLook }, string, boolean],
  host: SceneHost,
  motion: { reduced: () => boolean; watch: (changed: () => void) => () => void },
): HeroRun | null {
  const hero = heroCanvas(canvas, domCanvas);
  const stage = canvas.parentElement;
  if (hero === null || stage === null) {
    return null;
  }
  const probe = emptyProbe();
  const standing: Standing = { place: null, at: { x: 0, y: 0 }, menuRight: 0, stageW: 0, tile: 0 };
  const attends: { current: Attended | null } = { current: null };
  const picked: { current: string | null } = { current: null };
  const phase = figurePhase(pass);
  const entrance = entranceRun(walksIn, walkthroughHold);
  const react = stillReactions();
  const sweep = newSweep();
  const on = {
    ...{ hero, standing, look, attends, picked, sweep, probe },
    ...{ phase, entrance, react, canvas, beatHeld: walkthroughBeat },
  };
  const loop = runScene(heroPainter({ ...on, reduced: motion.reduced }, performance.now()), host);
  const unprobe = probed(probe);
  const unwatch = [
    watchStage(canvas, standing, () => {
      probePlace(probe, standing);
      if (standing.place === null) {
        leaveOut(hero);
      }
      loop.wake();
    }),
    watchAttention(stage, (attention) => {
      attends.current = attention.attended;
      picked.current = attention.picked;
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
      leaveOut(hero);
      holdPlace(null);
    },
  };
}
