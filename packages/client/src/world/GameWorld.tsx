import { useContext, useEffect, useRef, useState } from 'react';
import {
  chatText,
  CHAT_PHRASE_IDS,
  type ChatPhrase,
  type ClientMessage,
  type DronePosition,
  type ManualKind,
  type PlayerView,
  type PuzzleView,
} from '@escapelab/core';
import { addProbes } from '../probes.js';
import { deviceCoach, firstSight, type CoachMark } from '../puzzles/coach.js';
import { TalkButton } from '../screens/Voice.js';
import { VoiceContext } from '../voice/useVoice.js';
import {
  drawCarryable,
  drawDropZone,
  drawDroneBody,
  drawDroneCone,
  drawSabotagePanel,
} from './hazards.js';
import {
  drawDoor,
  drawManualObject,
  drawPlate,
  drawScientist,
  drawSign,
  drawStation,
  drawVoiceRing,
  makeFloorTile,
  makeWallTile,
  worldText,
  type WorldText,
} from './art.js';
import { drawsFrame } from './drawRate.js';
import { frameTrace, traceRequested } from './frameTrace.js';
import { carriedItem, contextAction, promptText } from './interact.js';
import {
  markerBoxes,
  markerTargets,
  placeMarkers,
  type MarkerPlacement,
  type MarkerTarget,
} from './markers.js';
import {
  correction,
  ECHO_MS,
  positionsOf,
  startingSpot,
  type KnownPositions,
  type Streamed,
} from './movement.js';
import { worldNews } from './news.js';
import { roomArea } from './rooms.js';
import {
  cabinetUnlock,
  countdownBeep,
  discoveryBlip,
  doorSlide,
  footstep,
  lockerOpen,
  pingBlip,
  setTension,
  powerDrain,
  startAmbience,
  stationChirp,
  stopAmbience,
} from './audio.js';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  doorsShut,
  lightClip,
  lightMemory,
  litTiles,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  reachOf,
  type Lamp,
  type LightMemory,
  type Lit,
  type Stops,
} from './light.js';
import {
  clampCamera,
  placeRoomNames,
  ROOM_NAME_PX,
  type Box,
  type Viewport,
} from './viewport.js';

const FALLBACK_COLOR = '#2dd4bf';
const SPEED = 4.2; // tiles per second
const RADIUS = 0.28; // collision half-size
const POS_SEND_MS = 80;
const PING_LIFETIME_MS = 3200;

const CHAT_LIFETIME_MS = 4200;
/** How long „… entdeckt" stays over a source the crew has just come across. */
const CAPTION_SECONDS = 2;
/** A locker or cabinet opening this close (in tiles) is heard. */
const HEAR_RADIUS = 4;
/** Your lamp: a glow all round, and a flashlight cone where you face — in tiles and radians. */
const OWN_GLOW = 3.2;
const CONE_REACH = 7.5;
const CONE_HALF_ANGLE = 0.5;
/** The glow of the lamp everybody else of the crew carries, in tiles. */
const CREW_GLOW = 2.8;
/** On a touch screen the pad would sit on the avatar: it is lifted this far, CSS pixels. */
const PAD_LIFT = 60;
/** Air between the control cluster and a first-time tip above it, CSS pixels. */
const TIP_GAP = 12;
/** The primary pointer is a finger: no keys to name, the on-screen pad shows (as ui.css has it). */
const TOUCH = '(pointer: coarse)';

const SOURCE_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

export interface MapPing {
  playerId: string;
  x: number;
  y: number;
  at: number;
}

export interface ChatLine {
  playerId: string;
  phrase: ChatPhrase;
  at: number;
}

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<KnownPositions>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  inputLocked: boolean;
  /** audience view: whole map revealed, no controls, no own avatar */
  spectator: boolean;
  /** the station whose panel lies over the world, for its device's coach mark; none by default */
  station?: PuzzleView | null;
  /** first-time tips wait while the objective bar carries a notice, so the two never stack */
  holdTips: boolean;
  /** opens the info panel, which owns the briefing and the key list */
  onToggleInfo: () => void;
  /** E at a manual object the server counts this player at: reading needs no message */
  onRead: (manualId: string) => void;
  /** E at the armed station: show its panel once it is open */
  onOperate: () => void;
  send: (msg: ClientMessage) => void;
}

interface OtherAvatar {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  /** render position, eased toward x/y */
  rx: number;
  ry: number;
  phase: number;
}

interface Sim {
  /** the run `self` was placed for, by its `startedAt`; null before the first frame */
  run: number | null;
  self: { x: number; y: number; facing: number; moving: boolean };
  /** what this client streamed lately: its own steps coming back are no correction */
  streamed: Streamed[];
  others: Map<string, OtherAvatar>;
  keys: Set<string>;
  doors: Map<string, { t: number; target: number }>;
  walkPhase: number;
  stepAcc: number;
  cam: { x: number; y: number };
  /** how far the objective bar reaches down, CSS pixels, eased: the camera glides as it grows */
  topCss: number;
  /** `cam` clamped to the map bounds; everything on screen uses this one */
  draw: { x: number; y: number };
  /** device pixels per tile, as the last frame drew it */
  scale: number;
  flash: number;
  lastPenaltySeq: number;
  time: number;
  /** pings already sounded, so the blip fires once per ping */
  seenPings: WeakSet<MapPing>;
  minimap: boolean;
  sabotageWasOn: boolean;
  /** last whole second announced by the countdown, so each tick fires once */
  lastBeepAt: number;
  /** the map as the last frame saw it, to tell what changed since; null before the first */
  seen: WorldMap | null;
  /** „… entdeckt" over sources the crew has just come across, `at` in sim time */
  captions: { x: number; y: number; text: string; at: number }[];
  /** lit rooms by label: the tiles their lights reach and the sim time they came on */
  lit: Map<string, { tiles: { x: number; y: number }[]; since: number }>;
  /** what this run's lamps and drones have lit so far, and their sights */
  light: LightMemory;
}

/** Cuts a radial glow of `radius` tiles into the darkness at (wx, wy), as its `stops` say. */
type Punch = (wx: number, wy: number, radius: number, stops: Stops) => void;

/** Where the minimap sits on the canvas, device pixels: its corner, cell and size. */
interface MinimapLayout {
  ox: number;
  oy: number;
  cell: number;
  mw: number;
  mh: number;
}

/** The dark frame round the minimap's map, CSS pixels. */
const MINIMAP_FRAME = 5;

/** An arrow at the screen's edge: what it points at, its caption and where it sits. */
interface EdgeMarker {
  target: MarkerTarget;
  caption: string;
  captionWidth: number;
  at: MarkerPlacement;
}

/** This frame's light, worked out before anything is drawn. */
interface FrameLight {
  /** your lamp; null for the audience */
  own: Lit | null;
  /** the lamps the rest of the crew carry */
  crew: Lit[];
  /** the drones' eyes, by drone id; a frozen drone looks nowhere */
  eyes: Map<string, Lit>;
  /** whether the world shows what lies at (x, y): some light falls on its tile now or did this run */
  shown: (x: number, y: number) => boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
};

function isTextEntry(el: Element | null): boolean {
  return el !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

type WorldMap = NonNullable<PlayerView['map']>;

function blocked(map: WorldMap, closedDoors: Set<string>, x: number, y: number): boolean {
  for (const dx of [-RADIUS, RADIUS]) {
    for (const dy of [-RADIUS, RADIUS]) {
      const tx = Math.floor(x + dx);
      const ty = Math.floor(y + dy);
      if (map.tiles[ty]?.charAt(tx) !== '.' || closedDoors.has(`${tx},${ty}`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The tips this page has shown. Each is shown once per session — across
 * runs, so a second run is not cluttered with things you already know.
 */
const SEEN_TIPS = new Set<string>();

/** How long a tip stays up at most. */
const TIP_MS = 6500;

/**
 * The one sentence a newcomer needs right now. Over an open station that is
 * its device's line, and nothing about the world the panel covers. On a
 * touch screen, which has no keys, a tip names the ⚡ button instead.
 */
function coachTip(
  map: WorldMap,
  youId: string,
  carried: WorldMap['items'][number] | undefined,
  station: PuzzleView | null,
  keyboard: boolean,
): CoachMark | null {
  if (station !== null) {
    return deviceCoach(station);
  }
  if (map.sabotage !== null) {
    return { id: 'sabotage', text: 'Notfall! Jede Person an ein eigenes Ventil — sofort losrennen.' };
  }
  // A key has no marked spot: it goes into a cabinet, found or not yet.
  if (carried !== undefined && (carried.deliverTo === null || opensCabinet(map, carried.id))) {
    const there = keyboard ? 'dort E drücken' : 'dort ⚡ tippen';
    return { id: 'key', text: `Ein Schlüssel: Er schließt einen Aktenschrank auf — ${there}.` };
  }
  if (carried !== undefined) {
    return {
      id: 'carry',
      text: keyboard
        ? 'Du trägst etwas: Bring es zur markierten Fläche und drücke E. Mit Q legst du es ab.'
        : 'Du trägst etwas: Bring es zur markierten Fläche und tippe ⚡. Mit 📦 legst du es ab.',
    };
  }
  if (map.exit !== null && map.exit.open) {
    return { id: 'exit', text: 'Der Notausgang ist offen — ihr müsst alle gemeinsam dort ankommen.' };
  }
  if (map.plates.some((plate) => plate.pressed && !plate.freezesDrone)) {
    return {
      id: 'plate',
      text: 'Solange jemand auf der Platte steht, bleibt die Tür offen — nicht runtergehen!',
    };
  }
  void youId;
  return null;
}

/** Escape hatch: dim grey while locked, pulsing green once it opens. */
export function drawExit(ctx: CanvasRenderingContext2D, open: boolean, pulse: number): void {
  ctx.save();
  const glow = open ? 0.35 + 0.3 * pulse : 0;
  if (open) {
    ctx.fillStyle = `rgba(74,222,128,${0.12 + 0.1 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = open ? '#14532d' : '#111a22';
  ctx.strokeStyle = open ? `rgba(74,222,128,${Math.min(1, 0.7 + glow)})` : '#2a3947';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.roundRect(-0.38, -0.38, 0.76, 0.76, 0.1);
  ctx.fill();
  ctx.stroke();
  // hazard stripes
  ctx.strokeStyle = open ? 'rgba(74,222,128,0.8)' : 'rgba(125,143,158,0.35)';
  ctx.lineWidth = 0.07;
  for (const offset of [-0.18, 0, 0.18]) {
    ctx.beginPath();
    ctx.moveTo(-0.26, offset + 0.09);
    ctx.lineTo(0.26, offset - 0.09);
    ctx.stroke();
  }
  ctx.restore();
}

/** The manual object prints the rules of the station that is armed now. */
function coversArmed(map: WorldMap, manual: WorldMap['manuals'][number]): boolean {
  const armed = map.stations.find((s) => s.status === 'armed');
  return armed !== undefined && manual.puzzleIds.includes(armed.puzzleId);
}

/** A cabinet's key goes into its padlock: the cabinet is the drop-off, no zone needed. */
function opensCabinet(map: WorldMap, itemId: string): boolean {
  return map.manuals.some((manual) => manual.needsKey === itemId);
}

/**
 * How far a room's lights are up `t` seconds after they came on: strip lights
 * that stutter for a moment, then rise to full within the second.
 */
function lightsUp(t: number): number {
  if (t >= 1) {
    return 1;
  }
  const rise = t * (2 - t);
  return t < 0.35 && Math.sin(t * 60) < 0 ? rise * 0.3 : rise;
}

/** A door bar is horizontal when its left/right neighbors are barriers. */
function isHorizontalDoor(map: WorldMap, x: number, y: number): boolean {
  const doorCells = new Set(map.doors.map((d) => `${d.x},${d.y}`));
  const barrier = (bx: number, by: number): boolean =>
    map.tiles[by]?.charAt(bx) === '#' || doorCells.has(`${bx},${by}`);
  return barrier(x - 1, y) && barrier(x + 1, y);
}

export function GameWorld({
  view,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  inputLocked,
  spectator,
  station = null,
  holdTips,
  onToggleInfo,
  onRead,
  onOperate,
  send,
}: Props) {
  const [wheelOpen, setWheelOpen] = useState(false);
  /** the tip up now, and whether it lies over a station's panel rather than over the world */
  const [tip, setTip] = useState<(CoachMark & { overPanel: boolean }) | null>(null);
  /** how far the control cluster reaches up from the world's bottom edge, CSS pixels */
  const [controlsReach, setControlsReach] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lockedRef = useRef(inputLocked);
  lockedRef.current = inputLocked;
  const sendRef = useRef(send);
  sendRef.current = send;
  const infoRef = useRef(onToggleInfo);
  infoRef.current = onToggleInfo;
  const readRef = useRef(onRead);
  readRef.current = onRead;
  const operateRef = useRef(onOperate);
  operateRef.current = onOperate;
  /** the crew's voice, read on every frame for who speaks; none outside the app */
  const voice = useContext(VoiceContext);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /** the E key's job, shared with the touch button; set while the render loop runs */
  const interactRef = useRef<(() => void) | null>(null);
  /** the Q key's job, shared with the touch button; set while the render loop runs */
  const dropRef = useRef<(() => void) | null>(null);
  const simRef = useRef<Sim | null>(null);
  /** what this player carries now; while there is something, a touch screen offers to drop it */
  const load = spectator || view.map === null ? undefined : carriedItem(view.map, view.you.id);

  useEffect(() => {
    if (lockedRef.current) {
      simRef.current?.keys.clear();
    }
  }, [inputLocked]);

  // Coach marks react to the view, not to the render loop: a new view comes
  // with every move anyone makes, so a tip stays up while it still fits, for
  // TIP_MS at most. The world's tips wait while the objective bar carries a
  // notice, so the two never stack; a station's panel covers that bar.
  useEffect(() => {
    if (spectator || view.map === null || (holdTips && station === null)) {
      setTip(null);
      return;
    }
    const keyboard = !window.matchMedia(TOUCH).matches;
    const carried = carriedItem(view.map, view.you.id);
    const next = coachTip(view.map, view.you.id, carried, station, keyboard);
    const fresh = firstSight(next, SEEN_TIPS);
    if (fresh !== null) {
      SEEN_TIPS.add(fresh.id);
      setTip({ ...fresh, overPanel: station !== null });
    } else if (next?.id !== tip?.id) {
      setTip(null);
    }
  }, [view, station, spectator, holdTips, tip]);

  useEffect(() => {
    if (tip === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTip(null), TIP_MS);
    return () => clearTimeout(timer);
  }, [tip]);


  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const overlay = document.createElement('canvas');
    const octx = overlay.getContext('2d');
    if (octx == null) {
      return undefined;
    }
    const floorTex = makeFloorTile();
    const wallTex = makeWallTile();
    // Same condition the stylesheet uses to show the on-screen pad.
    const touchPad = window.matchMedia(TOUCH);

    // The objective bar and the control cluster are HTML overlays lying on the
    // canvas, and both change height with their contents. Anything the canvas
    // draws near those edges has to keep clear, so we track them instead of
    // assuming a height: how far the bar reaches down from the top edge, and
    // how far the cluster reaches up from the bottom one.
    const stageTop = canvas.closest('.stage')?.querySelector('.stage-top') ?? null;
    const wrap = canvas.parentElement;
    const controls = controlsRef.current;
    let safeTopCss = 0;
    let safeBottomCss = 0;
    const measure = (): void => {
      safeTopCss = stageTop instanceof HTMLElement ? stageTop.offsetHeight : 0;
      const reach = controls === null || wrap === null ? 0 : wrap.clientHeight - controls.offsetTop;
      safeBottomCss = Math.max(0, reach);
      setControlsReach(safeBottomCss);
    };
    measure();
    const overlayObserver = new ResizeObserver(measure);
    for (const el of [stageTop, controls, wrap]) {
      if (el !== null) {
        overlayObserver.observe(el);
      }
    }

    const sim: Sim = {
      run: null,
      self: { x: 0, y: 0, facing: 0, moving: false },
      streamed: [],
      others: new Map(),
      keys: new Set(),
      doors: new Map(),
      walkPhase: 0,
      stepAcc: 0,
      cam: { x: 0, y: 0 },
      topCss: safeTopCss,
      draw: { x: 0, y: 0 },
      scale: 48,
      flash: 0,
      lastPenaltySeq: viewRef.current.penaltySeq,
      time: 0,
      seenPings: new WeakSet<MapPing>(),
      minimap: true,
      sabotageWasOn: false,
      lastBeepAt: Number.POSITIVE_INFINITY,
      seen: null,
      captions: [],
      lit: new Map(),
      light: lightMemory(null),
    };
    simRef.current = sim;
    startAmbience();

    /**
     * Fires the one context action. Reading and working an open station stay
     * on this client; everything else the server decides. A locked cabinet
     * only says what is missing.
     */
    function tryInteract(): void {
      const current = viewRef.current;
      if (current.map === null || lockedRef.current) {
        return;
      }
      const action = contextAction(
        current.map,
        sim.self,
        current.you.id,
        current.sourcesHere,
        current.puzzle !== null,
      );
      if (action === null || action.kind === 'locked') {
        return;
      }
      if (action.kind === 'open') {
        sendRef.current({ kind: 'open-source', manualId: action.manualId });
        return;
      }
      stationChirp();
      if (action.kind === 'read') {
        readRef.current(action.manualId);
        return;
      }
      if (action.kind === 'operate') {
        operateRef.current();
        if (current.puzzle !== null) {
          return;
        }
      }
      sendRef.current({ kind: 'interact' });
    }
    interactRef.current = tryInteract;

    /** Puts down what this player carries, where they stand; the server knows what that is. */
    function dropItem(): void {
      if (!lockedRef.current) {
        sendRef.current({ kind: 'drop-item' });
      }
    }
    dropRef.current = dropItem;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTextEntry(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      if (key in MOVE_KEYS) {
        e.preventDefault();
        if (!lockedRef.current) {
          sim.keys.add(key);
        }
      } else if ((key === 'e' || key === 'enter' || key === ' ') && !e.repeat) {
        e.preventDefault();
        tryInteract();
      } else if (key === 'q' && !e.repeat) {
        e.preventDefault();
        dropItem();
      } else if (key === 'm' && !e.repeat) {
        sim.minimap = !sim.minimap;
      } else if (key === 'c' && !e.repeat) {
        e.preventDefault();
        setWheelOpen((open) => !open);
      } else if ((key === 'i' || key === 'h' || key === '?') && !e.repeat) {
        e.preventDefault();
        infoRef.current();
      } else if (key === 'escape') {
        setWheelOpen(false);
      } else if (/^[1-8]$/.test(key)) {
        const phrase = CHAT_PHRASE_IDS[Number(key) - 1];
        if (phrase !== undefined) {
          e.preventDefault();
          sendRef.current({ kind: 'chat', phrase });
          setWheelOpen(false);
        }
      }
    };

    /** Click anywhere in the world to ping that spot for the whole crew. */
    const onPointerDown = (e: PointerEvent): void => {
      if (canvas == null || viewRef.current.map === null) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const s = sim.scale;
      const dpr = canvas.height / rect.height;
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      const wx = sim.draw.x + (px - canvas.width / 2) / s;
      const wy = sim.draw.y + (py - canvas.height / 2) / s;
      sendRef.current({
        kind: 'ping',
        x: Math.round(wx * 100) / 100,
        y: Math.round(wy * 100) / 100,
      });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      sim.keys.delete(e.key.toLowerCase());
    };
    const onBlur = (): void => {
      sim.keys.clear();
    };
    // An audience connection watches only: no controls, no position stream.
    if (!spectator) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      canvas.addEventListener('pointerdown', onPointerDown);
    }

    // Every position goes out stamped with the run it was walked in.
    const lastSent = { run: NaN, x: NaN, y: NaN, facing: NaN, moving: false };
    const posTimer = setInterval(() => {
      const run = sim.run;
      if (run === null || spectator) {
        return;
      }
      const { x, y, facing, moving } = sim.self;
      const changed =
        run !== lastSent.run ||
        Math.abs(x - lastSent.x) > 0.01 ||
        Math.abs(y - lastSent.y) > 0.01 ||
        Math.abs(facing - lastSent.facing) > 0.05 ||
        moving !== lastSent.moving;
      if (changed) {
        Object.assign(lastSent, { run, x, y, facing, moving });
        const now = performance.now();
        const spot = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
        sim.streamed = [
          ...sim.streamed.filter((sent) => now - sent.at <= ECHO_MS),
          { ...spot, at: now },
        ];
        sendRef.current({
          kind: 'pos',
          run,
          ...spot,
          facing: Math.round(facing * 100) / 100,
          moving,
        });
      }
    }, POS_SEND_MS);

    let raf = 0;
    let prev = performance.now();
    /** Animation frames since the loop started: under a panel only some are drawn. */
    let frames = 0;
    // `?trace=1`: the walkthrough reads the last frame durations off the page.
    const trace = traceRequested(location.search) ? frameTrace() : null;
    const dropTrace =
      trace === null
        ? null
        : addProbes({
            get frames() {
              return trace.frames;
            },
            resetFrames: () => trace.resetFrames(),
          });

    /**
     * Your avatar by the server's word: every run starts it on its spawn — on
     * the first frame, and after a rematch with the world still up — and a
     * step the server refused puts it back where the server kept it.
     */
    function followServer(map: WorldMap, youId: string, run: number | null): void {
      const known = positionsRef.current;
      if (sim.run !== run) {
        const start = startingSpot(known, youId, map, run);
        Object.assign(sim.self, start);
        sim.cam.x = start.x;
        sim.cam.y = start.y;
        sim.run = run;
        sim.streamed = [];
        return;
      }
      const back = correction(known, youId, run, sim.self, sim.streamed, performance.now());
      if (back !== null) {
        Object.assign(sim.self, back);
      }
    }

    function step(dt: number, map: WorldMap): void {
      // Spectators own no avatar, so every streamed position is "someone else".
      const youId = spectator ? '' : viewRef.current.you.id;
      const run = viewRef.current.startedAt;
      if (spectator) {
        sim.cam.x = map.width / 2;
        sim.cam.y = map.height / 2;
      } else {
        followServer(map, youId, run);
      }

      // input → velocity
      let dx = 0;
      let dy = 0;
      if (!lockedRef.current) {
        for (const [key, [kx, ky]] of Object.entries(MOVE_KEYS)) {
          if (sim.keys.has(key)) {
            dx += kx;
            dy += ky;
          }
        }
      }
      const len = Math.hypot(dx, dy);
      sim.self.moving = len > 0;
      if (len > 0) {
        dx /= len;
        dy /= len;
        sim.self.facing = Math.atan2(dy, dx);
        const closedDoors = new Set(
          map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`),
        );
        const nx = sim.self.x + dx * SPEED * dt;
        if (!blocked(map, closedDoors, nx, sim.self.y)) {
          sim.self.x = nx;
        }
        const ny = sim.self.y + dy * SPEED * dt;
        if (!blocked(map, closedDoors, sim.self.x, ny)) {
          sim.self.y = ny;
        }
        sim.walkPhase = (sim.walkPhase + dt * 2.4) % 1;
        sim.stepAcc += SPEED * dt;
        if (sim.stepAcc > 0.5) {
          sim.stepAcc = 0;
          footstep();
        }
      }

      // remote avatars ease toward their streamed positions
      const k = 1 - Math.exp(-dt * 12);
      const live = positionsOf(positionsRef.current, run);
      for (const [id, pos] of Object.entries(live)) {
        if (id === youId) {
          continue;
        }
        const other = sim.others.get(id);
        if (other === undefined) {
          sim.others.set(id, { ...pos, rx: pos.x, ry: pos.y, phase: 0 });
        } else {
          other.x = pos.x;
          other.y = pos.y;
          other.facing = pos.facing;
          other.moving = pos.moving;
          other.rx += (pos.x - other.rx) * k;
          other.ry += (pos.y - other.ry) * k;
          if (pos.moving) {
            other.phase = (other.phase + dt * 2.4) % 1;
          }
        }
      }
      for (const id of sim.others.keys()) {
        if (live[id] === undefined) {
          sim.others.delete(id);
        }
      }

      // door animation + sound
      for (const door of map.doors) {
        const target = door.open ? 1 : 0;
        const anim = sim.doors.get(door.id);
        if (anim === undefined) {
          sim.doors.set(door.id, { t: target, target });
        } else {
          if (anim.target !== target) {
            anim.target = target;
            doorSlide();
          }
          anim.t += (target - anim.t) * (1 - Math.exp(-dt * 7));
        }
      }
      if (map !== sim.seen) {
        look(map);
      }

      // The lab gets louder as the clock runs out, and counts the last ten
      // seconds out loud.
      const deadline = viewRef.current.deadlineAt;
      if (deadline !== null && !spectator) {
        const left = (deadline - Date.now()) / 1000;
        const budget = Math.max(1, viewRef.current.timeLimitSec);
        setTension(Math.min(1, Math.max(0, 1 - left / (budget * 0.5))));
        const whole = Math.ceil(left);
        if (whole <= 10 && whole >= 0 && whole < sim.lastBeepAt) {
          sim.lastBeepAt = whole;
          countdownBeep(whole);
        }
      }

      // emergency siren on the rising edge of a sabotage
      const sabotageOn = map.sabotage !== null;
      if (sabotageOn !== sim.sabotageWasOn) {
        sim.sabotageWasOn = sabotageOn;
        if (sabotageOn) {
          powerDrain();
        } else {
          stationChirp();
        }
      }

      // penalty feedback
      if (viewRef.current.penaltySeq > sim.lastPenaltySeq) {
        sim.lastPenaltySeq = viewRef.current.penaltySeq;
        sim.flash = 1;
        powerDrain();
      }
      sim.flash = Math.max(0, sim.flash - dt / 0.9);

      // camera: follow your avatar, or sit still over the whole lab; a radio
      // line growing the objective bar moves it as gently
      if (!spectator) {
        const ck = 1 - Math.exp(-dt * 6);
        sim.cam.x += (sim.self.x - sim.cam.x) * ck;
        sim.cam.y += (sim.self.y - sim.cam.y) * ck;
        sim.topCss += (safeTopCss - sim.topCss) * ck;
      }
      sim.time += dt;
    }

    /**
     * The lab answering the crew: a source somebody came across gets a blip
     * and a caption, a locker or cabinet opening within earshot its sound, a
     * room whose lights came on the door sound and a fade-in. Whatever this
     * client finds on its first look was there before it came in.
     */
    function look(map: WorldMap): void {
      const news = worldNews(sim.seen, map);
      sim.seen = map;
      for (const manual of news.found) {
        const text = `${SOURCE_NAMES[manual.kind]} entdeckt`;
        sim.captions.push({ x: manual.x + 0.5, y: manual.y, text, at: sim.time });
      }
      if (news.found.length > 0) {
        discoveryBlip();
      }
      for (const manual of news.opened) {
        const away = Math.hypot(manual.x + 0.5 - sim.self.x, manual.y + 0.5 - sim.self.y);
        if (spectator || away <= HEAR_RADIUS) {
          (manual.kind === 'cabinet' ? cabinetUnlock : lockerOpen)();
        }
      }
      for (const room of map.litRooms.filter((text) => !sim.lit.has(text))) {
        const tiles = map.labels.filter((l) => l.text === room).flatMap((l) => roomArea(map, l));
        sim.lit.set(room, { tiles, since: news.lit.includes(room) ? sim.time : -Infinity });
      }
      if (news.lit.length > 0) {
        doorSlide();
      }
    }

    function worldToScreen(s: number, w: number, h: number, x: number, y: number): [number, number] {
      return [w / 2 + (x - sim.draw.x) * s, h / 2 + (y - sim.draw.y) * s];
    }

    /**
     * This frame's light: your lamp, the crew's lamps and the drones' eyes,
     * each cut off by walls and shut doors; and what the world shows —
     * whatever lies where light falls now, in a lit room, or fell earlier
     * this run. The audience sees the whole lab, and the drones' cones only.
     */
    function lightUp(map: WorldMap): FrameLight {
      const run = viewRef.current.startedAt;
      if (sim.light.run !== run) {
        sim.light = lightMemory(run);
      }
      const { look, seen } = sim.light;
      const shut = doorsShut(map);
      const lit = (lamp: Lamp): Lit => ({ lamp, sight: look(map, lamp, reachOf(lamp), shut) });
      const cone = { facing: sim.self.facing, halfAngle: CONE_HALF_ANGLE, reach: CONE_REACH };
      const own = spectator ? null : lit({ x: sim.self.x, y: sim.self.y, glow: OWN_GLOW, beam: cone });
      const crew = spectator
        ? []
        : [...sim.others.values()].map((o) => lit({ x: o.rx, y: o.ry, glow: CREW_GLOW, beam: null }));
      const eyes = new Map<string, Lit>();
      for (const [id, drone] of Object.entries(dronesRef.current)) {
        if (drone.frozen) {
          continue;
        }
        const halfAngle = (drone.halfAngleDeg * Math.PI) / 180;
        const beam = { facing: drone.facing, halfAngle, reach: drone.range };
        eyes.set(id, lit({ x: drone.x, y: drone.y, glow: 0, beam }));
      }
      for (const { lamp, sight } of [...(own === null ? [] : [own]), ...crew, ...eyes.values()]) {
        for (const key of litTiles(lamp, sight)) {
          seen.add(key);
        }
      }
      for (const tile of [...sim.lit.values()].flatMap((room) => room.tiles)) {
        seen.add(`${tile.x},${tile.y}`);
      }
      const shown = (x: number, y: number): boolean =>
        spectator || seen.has(`${Math.floor(x)},${Math.floor(y)}`);
      return { own, crew, eyes, shown };
    }

    /** Clip paths in tiles, by the sight they were made from: a lamp standing still reuses its own. */
    const clipPaths = new WeakMap<Lit['sight'], Path2D>();

    /** Where a light falls, as a path in tiles: the floor it sees and the walls it lights whole. */
    function clipPath({ sight }: Lit): Path2D {
      const known = clipPaths.get(sight);
      if (known !== undefined) {
        return known;
      }
      const { outline, walls } = lightClip(sight);
      const path = new Path2D();
      outline.forEach((spot, i) => (i === 0 ? path.moveTo(spot.x, spot.y) : path.lineTo(spot.x, spot.y)));
      path.closePath();
      for (const run of walls) {
        path.rect(run.x, run.y, run.length, 1);
      }
      clipPaths.set(sight, path);
      return path;
    }

    /** Device pixels per tile: the audience sees the whole lab, a player what covers the canvas. */
    function zoomFor(map: WorldMap, w: number, h: number): number {
      if (spectator) {
        return Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)));
      }
      // Zoom so the lab always covers the canvas: no black bars beside it — but
      // stop before the lab turns into giant tiles on very wide windows.
      const cover = Math.max(w / map.width, h / map.height);
      return Math.min(170, Math.max(cover, Math.min(88, h / 10.5)));
    }

    /** The world's text at the zoom it was last worked out for; the zoom seldom changes. */
    const texts = { s: 0, dpr: 0, styles: worldText(48, 1) };
    function textAt(s: number, dpr: number): WorldText {
      if (texts.s !== s || texts.dpr !== dpr) {
        Object.assign(texts, { s, dpr, styles: worldText(s, dpr) });
      }
      return texts.styles;
    }

    function render(map: WorldMap): void {
      if (canvas == null || ctx == null || octx == null) {
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        overlay.width = canvas.width;
        overlay.height = canvas.height;
      }
      const w = canvas.width;
      const h = canvas.height;
      const s = zoomFor(map, w, h);
      sim.draw = clampCamera(map, sim.cam, {
        scale: s,
        w,
        h,
        top: sim.topCss * dpr,
        lift: touchPad.matches && !spectator ? PAD_LIFT * dpr : 0,
      });
      sim.scale = s;
      const light = lightUp(map);
      const text = textAt(s, dpr);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04070a';
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      drawTiles(map, s, w, h);
      const pulse = (Math.sin(sim.time * 4) + 1) / 2;
      drawProps(map, light, pulse, text);
      drawFigures(map, light, pulse, text);

      const minimap = spectator || !sim.minimap ? null : minimapLayout(map, w, h, dpr);
      const view: Viewport = {
        w,
        h,
        dpr,
        top: safeTopCss * dpr,
        bottom: safeBottomCss * dpr,
        boxes: minimap === null ? [] : [minimapBox(minimap, dpr)],
      };
      if (!spectator) {
        renderLighting(map, s, w, h, light);
      }
      if (minimap !== null) {
        renderMinimap(map, minimap, dpr);
      }
      renderPings(s, w, h, dpr);
      renderScreenText(map, s, view);
    }

    /** Floor and walls, as far as the canvas shows them; tile space. */
    function drawTiles(map: WorldMap, s: number, w: number, h: number): void {
      if (ctx == null) {
        return;
      }
      const x0 = Math.max(0, Math.floor(sim.draw.x - w / 2 / s) - 1);
      const x1 = Math.min(map.width - 1, Math.ceil(sim.draw.x + w / 2 / s) + 1);
      const y0 = Math.max(0, Math.floor(sim.draw.y - h / 2 / s) - 1);
      const y1 = Math.min(map.height - 1, Math.ceil(sim.draw.y + h / 2 / s) + 1);
      for (let ty = y0; ty <= y1; ty++) {
        const row = map.tiles[ty] ?? '';
        for (let tx = x0; tx <= x1; tx++) {
          const tile = row.charAt(tx);
          if (tile === '.') {
            ctx.drawImage(floorTex, tx, ty, 1, 1);
          } else if (tile === '#') {
            ctx.drawImage(wallTex, tx, ty, 1, 1);
          }
        }
      }
    }

    /**
     * The lab's things, in tile space. Objects show only where some light has
     * fallen — a cabinet behind a wall stays unseen. Sources reach this map once
     * found; a station that is up or done, the sign, the hatch and the valves
     * always show.
     */
    function drawProps(map: WorldMap, light: FrameLight, pulse: number, text: WorldText): void {
      if (ctx == null) {
        return;
      }
      const drawAt = (x: number, y: number, draw: () => void): void => {
        ctx.save();
        ctx.translate(x, y);
        draw();
        ctx.restore();
      };
      for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
        const { pressed, label, freezesDrone: camera } = plate;
        const look = { pressed, label, camera, text };
        drawAt(plate.x + 0.5, plate.y + 0.5, () => drawPlate(ctx, look));
      }
      for (const door of map.doors) {
        const openT = sim.doors.get(door.id)?.t ?? (door.open ? 1 : 0);
        const horizontal = isHorizontalDoor(map, door.x, door.y);
        drawAt(door.x + 0.5, door.y + 0.5, () => drawDoor(ctx, { openT, horizontal }));
      }
      // Every spot: a station with two consoles stands twice, both lit while it is armed.
      for (const station of map.stations) {
        if (station.status !== 'locked' || light.shown(station.x, station.y)) {
          const look = { status: station.status, pulse, console: station.console ?? null };
          drawAt(station.x + 0.5, station.y + 0.5, () => drawStation(ctx, look));
        }
      }
      for (const manual of map.manuals) {
        const active = coversArmed(map, manual);
        const { kind, label, opened } = manual;
        const look = { kind, label, active, opened, pulse, text };
        drawAt(manual.x + 0.5, manual.y + 0.5, () => drawManualObject(ctx, look));
      }
      const sign = map.edgeworkSign;
      if (sign !== null) {
        const seen = viewRef.current.presence.signSeen;
        const look = { label: 'LABORKENNUNG', seen, pulse, text };
        drawAt(sign.x + 0.5, sign.y + 0.5, () => drawSign(ctx, look));
      }
      const exit = map.exit;
      if (exit !== null) {
        drawAt(exit.x + 0.5, exit.y + 0.5, () => drawExit(ctx, exit.open, pulse));
      }
      for (const panel of map.sabotage?.panels ?? []) {
        drawAt(panel.x + 0.5, panel.y + 0.5, () => drawSabotagePanel(ctx, panel.occupied, pulse));
      }
      for (const item of map.items) {
        const zone = item.deliverTo;
        if (zone !== null && !opensCabinet(map, item.id) && light.shown(zone.x, zone.y)) {
          drawAt(zone.x + 0.5, zone.y + 0.5, () => drawDropZone(ctx, item.delivered, pulse));
        }
        if (!item.delivered && item.carriedBy === null && light.shown(item.x, item.y)) {
          const look = { label: item.label, pulse, carried: false, text };
          drawAt(item.x, item.y, () => drawCarryable(ctx, look));
        }
      }
    }

    /** Drones and the crew, in tile space; what somebody carries rides above their head. */
    function drawFigures(map: WorldMap, light: FrameLight, pulse: number, text: WorldText): void {
      if (ctx == null) {
        return;
      }
      // drone cones go under the avatars so figures stay readable inside them; a cone
      // ends at the walls, like the drone's sight on the server
      for (const [id, drone] of Object.entries(dronesRef.current)) {
        const eye = light.eyes.get(id);
        ctx.save();
        if (eye !== undefined) {
          ctx.clip(clipPath(eye));
        }
        ctx.translate(drone.x, drone.y);
        drawDroneCone(ctx, drone, pulse);
        ctx.restore();
      }

      // avatars: remote first, local on top; whoever speaks stands in a ring
      const youId = viewRef.current.you.id;
      const metaOf = new Map(viewRef.current.players.map((p) => [p.id, p]));
      const speaking = voiceRef.current?.getState().speaking;
      for (const [id, other] of sim.others) {
        const meta = metaOf.get(id);
        ctx.save();
        ctx.translate(other.rx, other.ry + 0.3);
        if (speaking?.has(id) === true) {
          drawVoiceRing(ctx, meta?.color ?? FALLBACK_COLOR, sim.time);
        }
        drawScientist(ctx, {
          color: meta?.color ?? FALLBACK_COLOR,
          name: meta?.name ?? '???',
          facing: other.facing,
          moving: other.moving,
          walkPhase: other.phase,
          isYou: false,
          connected: meta?.connected ?? true,
          text,
        });
        ctx.restore();
      }
      if (!spectator) {
        const you = metaOf.get(youId);
        ctx.save();
        ctx.translate(sim.self.x, sim.self.y + 0.3);
        if (speaking?.has(youId) === true) {
          drawVoiceRing(ctx, you?.color ?? FALLBACK_COLOR, sim.time);
        }
        drawScientist(ctx, {
          color: you?.color ?? FALLBACK_COLOR,
          name: you?.name ?? 'DU',
          facing: sim.self.facing,
          moving: sim.self.moving,
          walkPhase: sim.walkPhase,
          isYou: true,
          connected: true,
          text,
        });
        ctx.restore();
      }

      for (const drone of Object.values(dronesRef.current)) {
        ctx.save();
        ctx.translate(drone.x, drone.y);
        drawDroneBody(ctx, drone, pulse);
        ctx.restore();
      }

      for (const item of map.items) {
        const carrier =
          item.delivered || item.carriedBy === null ? undefined : drawnAt(item.carriedBy);
        if (carrier !== undefined) {
          ctx.save();
          ctx.translate(carrier.x, carrier.y - 0.75);
          drawCarryable(ctx, { label: item.label, pulse, carried: true });
          ctx.restore();
        }
      }
    }

    /** Where a crew member is drawn now: you where you stand, the rest where they ease to. */
    function drawnAt(playerId: string): { x: number; y: number } | undefined {
      if (playerId === viewRef.current.you.id) {
        return sim.self;
      }
      const other = sim.others.get(playerId);
      return other === undefined ? undefined : { x: other.rx, y: other.ry };
    }

    /** Expanding rings for recent pings, plus an edge arrow for off-screen ones. */
    function renderPings(s: number, w: number, h: number, dpr: number): void {
      if (ctx == null) {
        return;
      }
      const now = performance.now();
      const live = pingsRef.current.filter((p) => now - p.at < PING_LIFETIME_MS);
      if (live.length !== pingsRef.current.length) {
        pingsRef.current = live;
      }
      const colorOf = new Map(
        viewRef.current.players.map((p) => [p.id, p.color]),
      );
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const ping of live) {
        if (!sim.seenPings.has(ping)) {
          sim.seenPings.add(ping);
          pingBlip();
        }
        const age = (now - ping.at) / PING_LIFETIME_MS;
        const color = colorOf.get(ping.playerId) ?? FALLBACK_COLOR;
        const [px, py] = worldToScreen(s, w, h, ping.x, ping.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - age;
        for (const phase of [0, 0.33, 0.66]) {
          const t = (age * 2.2 + phase) % 1;
          ctx.lineWidth = 2.5 * dpr * (1 - t);
          ctx.beginPath();
          ctx.arc(px, py, (0.25 + t * 1.3) * s, 0, Math.PI * 2);
          ctx.stroke();
        }
        const margin = 26 * dpr;
        if (px < margin || px > w - margin || py < margin || py > h - margin) {
          const cx = Math.min(w - margin, Math.max(margin, px));
          const cy = Math.min(h - margin, Math.max(margin, py));
          const angle = Math.atan2(py - h / 2, px - w / 2);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(10 * dpr, 0);
          ctx.lineTo(-7 * dpr, 7 * dpr);
          ctx.lineTo(-7 * dpr, -7 * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }

    /** A tag on the screen like the E prompt: a dark pill with rim and text in `tint`. */
    function drawTag(text: string, sx: number, sy: number, tint: string, dpr: number): void {
      if (ctx == null) {
        return;
      }
      ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      const tw = ctx.measureText(text).width + 16 * dpr;
      ctx.fillStyle = 'rgba(7,11,15,0.88)';
      ctx.strokeStyle = tint;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.roundRect(sx - tw / 2, sy - 11 * dpr, tw, 20 * dpr, 5 * dpr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.fillText(text, sx, sy + 4 * dpr);
    }

    /** „Spind entdeckt" over a source the crew has just come across, rising as it fades. */
    function renderCaptions(s: number, w: number, h: number, dpr: number): void {
      if (ctx == null) {
        return;
      }
      sim.captions = sim.captions.filter((c) => sim.time - c.at < CAPTION_SECONDS);
      for (const caption of sim.captions) {
        const age = (sim.time - caption.at) / CAPTION_SECONDS;
        const [sx, rawY] = worldToScreen(s, w, h, caption.x, caption.y - 1 - 0.3 * age);
        ctx.globalAlpha = Math.min(1, age * 10, (1 - age) * 4);
        drawTag(caption.text, sx, Math.max(rawY, (safeTopCss + 24) * dpr), '#93c5fd', dpr);
      }
      ctx.globalAlpha = 1;
    }

    /** Speech bubbles above whoever just said something. */
    function renderChatBubbles(s: number, w: number, h: number, dpr: number): void {
      if (ctx == null) {
        return;
      }
      const now = performance.now();
      const live = chatsRef.current.filter((c) => now - c.at < CHAT_LIFETIME_MS);
      if (live.length !== chatsRef.current.length) {
        chatsRef.current = live;
      }
      // Only the newest line per speaker, so spam cannot stack up.
      const newest = new Map<string, ChatLine>();
      for (const line of live) {
        newest.set(line.playerId, line);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = 'center';
      for (const [playerId, line] of newest) {
        const at =
          playerId === viewRef.current.you.id
            ? { x: sim.self.x, y: sim.self.y }
            : sim.others.get(playerId);
        if (at === undefined) {
          continue;
        }
        const wx = 'rx' in at ? at.rx : at.x;
        const wy = ('ry' in at ? at.ry : at.y) - 1.15;
        const [sx, sy] = worldToScreen(s, w, h, wx, wy);
        const text = chatText(line.phrase);
        ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
        const tw = ctx.measureText(text).width + 18 * dpr;
        const age = (now - line.at) / CHAT_LIFETIME_MS;
        ctx.globalAlpha = age > 0.8 ? (1 - age) / 0.2 : 1;
        ctx.fillStyle = 'rgba(232,240,247,0.95)';
        ctx.beginPath();
        ctx.roundRect(sx - tw / 2, sy - 12 * dpr, tw, 22 * dpr, 7 * dpr);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx - 5 * dpr, sy + 9 * dpr);
        ctx.lineTo(sx + 5 * dpr, sy + 9 * dpr);
        ctx.lineTo(sx, sy + 16 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#0a0f14';
        ctx.fillText(text, sx, sy + 4 * dpr);
        ctx.globalAlpha = 1;
      }
    }

    /**
     * Where the corner minimap goes: top right, below the objective bar — the
     * clock, and a radio line while one is up. It scales with the window, but
     * never so small it stops being readable or so large it eats a phone
     * screen.
     */
    function minimapLayout(map: WorldMap, w: number, h: number, dpr: number): MinimapLayout {
      const targetCss = Math.min(190, Math.max(110, (w / dpr) * 0.16));
      const oy = Math.max(84, safeTopCss) * dpr;
      // A short window has less room below the clock than beside it, and both
      // the minimap and the control cluster hug the right edge.
      const roomBelow = (h - oy - (safeBottomCss + 2 * MINIMAP_FRAME) * dpr) / map.height;
      const fit = Math.round((targetCss * dpr) / map.width);
      const cell = Math.max(3, Math.min(fit, Math.floor(roomBelow)));
      const mw = map.width * cell;
      const mh = map.height * cell;
      return { ox: w - mw - 14 * dpr, oy, cell, mw, mh };
    }

    /** What the minimap covers, its frame included: the arrows and room names keep off it. */
    function minimapBox({ ox, oy, mw, mh }: MinimapLayout, dpr: number): Box {
      const frame = MINIMAP_FRAME * dpr;
      return { left: ox - frame, top: oy - frame, right: ox + mw + frame, bottom: oy + mh + frame };
    }

    /** Corner minimap: layout, doors, objective, exit and everyone's dot. */
    function renderMinimap(map: WorldMap, layout: MinimapLayout, dpr: number): void {
      if (ctx == null) {
        return;
      }
      const { ox, oy, cell } = layout;
      const { left, top, right, bottom } = minimapBox(layout, dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = '#070b0f';
      ctx.strokeStyle = '#24323f';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.roundRect(left, top, right - left, bottom - top, 6 * dpr);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#18242f';
      for (let ty = 0; ty < map.height; ty++) {
        const row = map.tiles[ty] ?? '';
        for (let tx = 0; tx < map.width; tx++) {
          if (row.charAt(tx) === '.') {
            ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
          }
        }
      }
      for (const door of map.doors) {
        ctx.fillStyle = door.open ? '#1f3b32' : '#fbbf24';
        ctx.fillRect(ox + door.x * cell, oy + door.y * cell, cell, cell);
      }
      for (const plate of map.plates) {
        ctx.fillStyle = plate.pressed ? '#2dd4bf' : '#39465a';
        ctx.fillRect(ox + plate.x * cell + cell / 4, oy + plate.y * cell + cell / 4, cell / 2, cell / 2);
      }
      for (const station of map.stations) {
        ctx.fillStyle =
          station.status === 'armed' ? '#2dd4bf' : station.status === 'done' ? '#1f6b60' : '#2c3947';
        ctx.fillRect(ox + station.x * cell, oy + station.y * cell, cell, cell);
      }
      for (const manual of map.manuals) {
        ctx.fillStyle = coversArmed(map, manual) ? '#60a5fa' : '#2c4766';
        ctx.fillRect(ox + manual.x * cell, oy + manual.y * cell, cell, cell);
      }
      // Half a cell, so it does not pass for a closed door; gone once read.
      if (map.edgeworkSign !== null && !viewRef.current.presence.signSeen) {
        const { x, y } = map.edgeworkSign;
        ctx.fillStyle = '#fcd34d';
        ctx.fillRect(ox + x * cell + cell / 4, oy + y * cell + cell / 4, cell / 2, cell / 2);
      }
      if (map.exit !== null) {
        ctx.fillStyle = map.exit.open ? '#4ade80' : '#2c3947';
        ctx.fillRect(ox + map.exit.x * cell, oy + map.exit.y * cell, cell, cell);
      }
      for (const drone of Object.values(dronesRef.current)) {
        ctx.fillStyle = drone.frozen ? '#7d8f9e' : drone.alerted ? '#f87171' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(ox + drone.x * cell, oy + drone.y * cell, cell * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const colorOf = new Map(
        viewRef.current.players.map((p) => [p.id, p.color]),
      );
      const dot = (x: number, y: number, color: string, ring: boolean): void => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(ox + x * cell, oy + y * cell, cell * 0.55, 0, Math.PI * 2);
        ctx.fill();
        if (ring) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = dpr;
          ctx.stroke();
        }
      };
      for (const [id, other] of sim.others) {
        dot(other.rx, other.ry, colorOf.get(id) ?? FALLBACK_COLOR, false);
      }
      dot(sim.self.x, sim.self.y, colorOf.get(viewRef.current.you.id) ?? FALLBACK_COLOR, true);
      ctx.globalAlpha = 1;
    }

    /**
     * The glow the lab's objects give off on their own: the armed station's
     * beacon, the sources found, the sign, the open hatch, the valves — and,
     * on tiles light has fallen on, plates worth finding, crates and drop-offs.
     */
    function glowObjects(map: WorldMap, light: FrameLight, punch: Punch): void {
      const glow = (wx: number, wy: number, radius: number, strength: number): void =>
        punch(wx, wy, radius, objectGlowStops(strength));
      for (const station of map.stations) {
        if (station.status === 'armed') {
          glow(station.x + 0.5, station.y + 0.5, 2.4, 0.85);
        } else if (station.status === 'done') {
          glow(station.x + 0.5, station.y + 0.5, 1.1, 0.4);
        }
      }
      for (const manual of map.manuals) {
        const active = coversArmed(map, manual);
        glow(manual.x + 0.5, manual.y + 0.5, active ? 2.1 : 1.3, active ? 0.8 : 0.5);
      }
      if (map.edgeworkSign !== null) {
        glow(map.edgeworkSign.x + 0.5, map.edgeworkSign.y + 0.5, 1.4, 0.6);
      }
      // A camera plate is worth finding before anybody stands on it.
      for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
        if (plate.pressed || plate.freezesDrone) {
          glow(plate.x + 0.5, plate.y + 0.5, 1.0, 0.5);
        }
      }
      if (map.exit !== null && map.exit.open) {
        glow(map.exit.x + 0.5, map.exit.y + 0.5, 2.6, 0.9);
      }
      for (const panel of map.sabotage?.panels ?? []) {
        glow(panel.x + 0.5, panel.y + 0.5, 2.4, 0.9);
      }
      for (const item of map.items) {
        if (!item.delivered && item.carriedBy === null && light.shown(item.x, item.y)) {
          glow(item.x, item.y, 1.6, 0.7);
        }
        const zone = item.deliverTo;
        if (zone !== null && light.shown(zone.x, zone.y)) {
          glow(zone.x + 0.5, zone.y + 0.5, 1.4, 0.6);
        }
      }
    }

    function renderLighting(map: WorldMap, s: number, w: number, h: number, light: FrameLight): void {
      if (octx == null || ctx == null) {
        return;
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      const deadlineAt = viewRef.current.deadlineAt;
      const lowTime = deadlineAt !== null && deadlineAt - Date.now() < 60_000;
      // The lab dims further during the final minute.
      const base =
        (lowTime ? 0.945 : 0.92) + 0.02 * Math.sin(sim.time * (lowTime ? 3.2 : 1.7));
      octx.clearRect(0, 0, w, h);
      octx.fillStyle = `rgba(3,5,9,${base})`;
      octx.fillRect(0, 0, w, h);
      octx.globalCompositeOperation = 'destination-out';

      const punch: Punch = (wx, wy, radius, stops) => {
        const [sx, sy] = worldToScreen(s, w, h, wx, wy);
        const r = radius * s;
        const g = octx.createRadialGradient(sx, sy, 0, sx, sy, r);
        for (const [offset, depth] of stops) {
          g.addColorStop(offset, `rgba(0,0,0,${depth})`);
        }
        octx.fillStyle = g;
        octx.fillRect(sx - r, sy - r, r * 2, r * 2);
      };
      /** A beam from `lamp`: its cone, fading out along the gradient `stops`. */
      const beam = ({ lamp }: Lit, stops: Stops): void => {
        if (lamp.beam === null) {
          return;
        }
        const { facing, halfAngle, reach } = lamp.beam;
        const [sx, sy] = worldToScreen(s, w, h, lamp.x, lamp.y);
        const r = reach * s;
        octx.save();
        octx.beginPath();
        octx.moveTo(sx, sy);
        octx.arc(sx, sy, r, facing - halfAngle, facing + halfAngle);
        octx.closePath();
        octx.clip();
        const g = octx.createRadialGradient(sx, sy, 0, sx, sy, r);
        for (const [offset, depth] of stops) {
          g.addColorStop(offset, `rgba(0,0,0,${depth})`);
        }
        octx.fillStyle = g;
        octx.fillRect(sx - r, sy - r, r * 2, r * 2);
        octx.restore();
      };
      /** Cuts light into the darkness only where `lit` can see: walls and shut doors stop it. */
      const within = (lit: Lit, draw: () => void): void => {
        octx.save();
        octx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
        octx.clip(clipPath(lit));
        octx.setTransform(1, 0, 0, 1, 0, 0);
        draw();
        octx.restore();
      };

      // Your lamp: a lit circle round you plus a flashlight cone in facing direction;
      // everybody else's softer glow. Each lights what it can see, and nothing behind
      // a wall — so the walls cut a clean edge into the circle.
      const own = light.own;
      if (own !== null) {
        within(own, () => {
          punch(own.lamp.x, own.lamp.y, OWN_GLOW, OWN_GLOW_STOPS);
          beam(own, OWN_BEAM_STOPS);
        });
      }
      for (const lit of light.crew) {
        within(lit, () => punch(lit.lamp.x, lit.lamp.y, CREW_GLOW, CREW_GLOW_STOPS));
      }
      glowObjects(map, light, punch);
      // Drone cones light their own path as far as the drone sees, which is what
      // makes them readable; a frozen drone has no cone, only a glimmer around its body.
      for (const [id, drone] of Object.entries(dronesRef.current)) {
        const eye = light.eyes.get(id);
        if (eye === undefined) {
          punch(drone.x, drone.y, 0.9, objectGlowStops(0.5));
          continue;
        }
        within(eye, () => beam(eye, DRONE_BEAM_STOPS));
        punch(drone.x, drone.y, 1.1, objectGlowStops(0.75));
      }
      // A lit room keeps no darkness at all, walls and doors included; one
      // path per room, so its tiles meet without seams.
      for (const room of sim.lit.values()) {
        octx.fillStyle = `rgba(0,0,0,${lightsUp(sim.time - room.since)})`;
        octx.beginPath();
        for (const tile of room.tiles) {
          const [sx, sy] = worldToScreen(s, w, h, tile.x, tile.y);
          octx.rect(sx, sy, s, s);
        }
        octx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(overlay, 0, 0);
      if (sim.flash > 0) {
        ctx.fillStyle = `rgba(248,60,60,${0.26 * sim.flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    function renderScreenText(map: WorldMap, s: number, view: Viewport): void {
      if (ctx == null) {
        return;
      }
      const { w, h, dpr } = view;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = 'center';
      // Anything you need to walk to gets an arrow at the screen edge while
      // it is out of sight — in the dark that is the only way to find it. The
      // room names keep off the arrows, as off the minimap.
      const markers = edgeMarkers(map, s, view);
      const arrows = markers.flatMap(({ at, captionWidth }) => markerBoxes(at, captionWidth, dpr));
      renderRoomNames(map, s, { ...view, boxes: [...view.boxes, ...arrows] });
      if (map.exit !== null && map.exit.open) {
        const [ex, ey] = worldToScreen(s, w, h, map.exit.x + 0.5, map.exit.y - 0.45);
        ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('NOTAUSGANG → ALLE HIERHER!', ex, ey);
      }
      renderEdgeMarkers(markers, dpr);
      renderPrompt(map, s, view);
      renderCaptions(s, w, h, dpr);
      renderChatBubbles(s, w, h, dpr);
      renderCarrying(map, view);
    }

    /** The arrows due at the screen's edge this frame, each with its caption, placed. */
    function edgeMarkers(map: WorldMap, s: number, view: Viewport): EdgeMarker[] {
      if (ctx == null) {
        return [];
      }
      const { w, h, dpr } = view;
      ctx.font = `700 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      const crew = positionsOf(positionsRef.current, sim.run);
      const marks = markerTargets(map, viewRef.current.you.id, sim.self, crew).map((target) => {
        const [px, py] = worldToScreen(s, w, h, target.x, target.y);
        const tiles = Math.round(Math.hypot(target.x - sim.self.x, target.y - sim.self.y));
        const caption = `${target.label} ${tiles}m`;
        return { target, caption, px, py, captionWidth: ctx.measureText(caption).width };
      });
      const placements = placeMarkers(marks, view);
      return marks.flatMap(({ target, caption, captionWidth }, i) => {
        const at = placements[i];
        return at == null ? [] : [{ target, caption, captionWidth, at }];
      });
    }

    function renderEdgeMarkers(markers: readonly EdgeMarker[], dpr: number): void {
      if (ctx == null) {
        return;
      }
      ctx.font = `700 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      for (const { target, caption, at } of markers) {
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(at.angle);
        ctx.fillStyle = target.color;
        ctx.beginPath();
        ctx.moveTo(13 * dpr, 0);
        ctx.lineTo(-8 * dpr, 9 * dpr);
        ctx.lineTo(-8 * dpr, -9 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = target.color;
        ctx.fillText(caption, at.x, at.captionY);
      }
    }

    /**
     * Room names are signage, not world objects: a fixed size above every
     * prop's label, nudged in rather than cut off at a side, and left out
     * where they would lie off screen or under something else.
     */
    function renderRoomNames(map: WorldMap, s: number, view: Viewport): void {
      if (ctx == null) {
        return;
      }
      const { w, h, dpr } = view;
      ctx.save();
      ctx.font = `700 ${ROOM_NAME_PX * dpr}px ui-monospace, Menlo, monospace`;
      const names = map.labels.map((label) => {
        const [x, y] = worldToScreen(s, w, h, label.x + 0.5, label.y + 0.5);
        return { text: label.text, x, y, width: ctx.measureText(label.text).width };
      });
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(3,6,10,0.85)';
      ctx.fillStyle = 'rgba(160,174,190,0.8)';
      for (const name of placeRoomNames(names, view)) {
        ctx.strokeText(name.text, name.x, name.y);
        ctx.fillText(name.text, name.x, name.y);
      }
      ctx.restore();
    }

    /** What E does here, over the thing it works on; amber where E does nothing yet. */
    function renderPrompt(map: WorldMap, s: number, view: Viewport): void {
      const { you, sourcesHere, puzzle } = viewRef.current;
      const action = lockedRef.current
        ? null
        : contextAction(map, sim.self, you.id, sourcesHere, puzzle !== null);
      if (action === null) {
        return;
      }
      const { w, h, dpr } = view;
      const [sx, rawY] = worldToScreen(s, w, h, action.x, action.y);
      // Like the edge arrows: the prompt must stay below the objective bar.
      const sy = Math.max(rawY, view.top + 24 * dpr);
      const tint = action.kind === 'locked' ? '#fbbf24' : '#2dd4bf';
      drawTag(promptText(action, !touchPad.matches), sx, sy, tint, dpr);
    }

    /**
     * A standing reminder of the Q key while hands are full. A touch screen has
     * its 📦 button for that instead, and its crew strip says what you carry.
     */
    function renderCarrying(map: WorldMap, view: Viewport): void {
      if (ctx == null || touchPad.matches) {
        return;
      }
      const carrying = carriedItem(map, viewRef.current.you.id);
      if (carrying !== undefined) {
        ctx.font = `700 ${12 * view.dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = '#60a5fa';
        ctx.fillText(`📦 ${carrying.label} — [Q] ablegen`, view.w / 2, view.h - 16 * view.dpr);
      }
    }

    function frame(now: number): void {
      trace?.record(now - prev);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      frames += 1;
      const map = viewRef.current.map;
      if (map !== null) {
        // The simulation runs on every frame; the canvas is redrawn less under a panel.
        step(dt, map);
        if (drawsFrame(frames, { locked: lockedRef.current, spectator })) {
          render(map);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(posTimer);
      overlayObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stopAmbience();
      dropTrace?.();
      simRef.current = null;
      interactRef.current = null;
      dropRef.current = null;
    };
    // The loop reads everything through refs; mount/unmount is the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = (key: string, down: boolean): void => {
    const sim = simRef.current;
    if (sim === null) {
      return;
    }
    if (down && !lockedRef.current) {
      sim.keys.add(key);
    } else {
      sim.keys.delete(key);
    }
  };

  return (
    <div className="world-wrap">
      <canvas ref={canvasRef} className={`world-canvas ${spectator ? 'world-canvas--wide' : ''}`} />
      {tip !== null &&
        (tip.overPanel ? (
          <div className="coach coach--panel">{tip.text}</div>
        ) : (
          // Just above the control cluster, wherever it reaches: never on the
          // avatar under the objective bar, nor on the minimap.
          <div className="coach" style={{ bottom: controlsReach + TIP_GAP }}>
            {tip.text}
          </div>
        ))}
      {!spectator && (
      <div className="world-controls" ref={controlsRef}>
        <div className="world-dpad" role="group" aria-label="Steuerkreuz">
          {(
            [
              ['w', '↑', 'up'],
              ['a', '←', 'left'],
              ['d', '→', 'right'],
              ['s', '↓', 'down'],
            ] as const
          ).map(([key, glyph, dir]) => (
            <button
              key={key}
              className={`world-dpad-btn world-dpad-btn--${dir}`}
              onPointerDown={(e) => {
                e.preventDefault();
                press(key, true);
              }}
              onPointerUp={() => press(key, false)}
              onPointerLeave={() => press(key, false)}
              aria-label={dir}
            >
              {glyph}
            </button>
          ))}
        </div>
        {/*
         * The action button, and over it while hands are full the one that puts
         * the load down: a touch screen's Q (world.css shows it there only).
         * The key on a button shows only where there are keys.
         */}
        <div className="world-actions">
          {load !== undefined && (
            <button
              className="world-drop"
              aria-label="Ablegen"
              onClick={() => dropRef.current?.()}
            >
              📦
            </button>
          )}
          <button
            className="world-interact"
            aria-label="Benutzen"
            onClick={() => interactRef.current?.()}
          >
            ⚡<span className="world-key"> [E]</span>
          </button>
        </div>
        <button
          className="world-chat-toggle"
          aria-label="Schnellchat"
          onClick={() => setWheelOpen((open) => !open)}
          aria-expanded={wheelOpen}
        >
          💬<span className="world-key"> [C]</span>
        </button>
        {/* Held to talk, on a touch screen with the microphone on; V does it on a keyboard. */}
        <TalkButton className="world-talk">🎤</TalkButton>
      </div>
      )}

      {wheelOpen && (
        <div className="chat-wheel" role="menu">
          {CHAT_PHRASE_IDS.map((phrase, i) => (
            <button
              key={phrase}
              role="menuitem"
              onClick={() => {
                send({ kind: 'chat', phrase });
                setWheelOpen(false);
              }}
            >
              <span className="chat-key">{i + 1}</span>
              {chatText(phrase)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
