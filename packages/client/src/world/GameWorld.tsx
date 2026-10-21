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
import { useMedia } from '../hooks.js';
import { addProbes } from '../probes.js';
import { firstSight, SHOWN_MARKS, type CoachMark } from '../puzzles/coach.js';
import { TalkButton } from '../screens/Voice.js';
import { VoiceContext } from '../voice/useVoice.js';
import { DRONE_MARK_MS, useAlarm, useAlarmClasses, worldHornDue, type Alarm } from './alarm.js';
import {
  drawAlarmMark,
  drawCarryable,
  drawDropZone,
  drawDroneBody,
  drawDroneCone,
  drawSabotagePanel,
} from './hazards.js';
import {
  drawDoor,
  drawEmergencyLamp,
  drawExitHatch,
  drawLeverBox,
  drawManualObject,
  drawPlate,
  drawScientist,
  drawSign,
  drawStation,
  drawVoiceRing,
  makeFloorTile,
  makeWallTile,
  plateCaption,
  worldText,
  type WorldText,
} from './art.js';
import { bake, bakeBox, bakeStep, drawBaked, type Baked } from './baked.js';
import { blackoutCue, coldOpenFrame, SEQUENCE_MS, type ColdOpenFrame } from './coldOpen.js';
import {
  doorOpenness,
  doorTurned,
  isHorizontalDoor,
  spillThrough,
  SPILL_HALF_ANGLE,
  SPILL_REACH,
  type DoorMotion,
} from './doors.js';
import { drawsFrame } from './drawRate.js';
import { escaping, exitOpening, redShift, useEscapeSince, useEscapeSounds } from './escape.js';
import {
  finaleFrame,
  REDUCED_MOTION,
  useFinaleSounds,
  type Ending,
  type FinaleFrame,
} from './finale.js';
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
import {
  litGroups,
  powerRoom,
  roomArea,
  roomsComingOn,
  warmUp,
  type LitGroup,
  type RoomLight,
} from './rooms.js';
import {
  blackoutSounds,
  cabinetUnlock,
  countdownBeep,
  discoveryBlip,
  doorSlide,
  footstep,
  klaxon,
  lightsOnClick,
  lockerOpen,
  pingBlip,
  setTension,
  powerDrain,
  startAmbience,
  startPowerHum,
  stationChirp,
  stopAmbience,
  stopPowerHum,
} from './audio.js';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  doorsShut,
  EMERGENCY_GLOW,
  EMERGENCY_STOPS,
  emergencyLamp,
  lampMount,
  lightClip,
  lightMemory,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  reachOf,
  runsOf,
  SPILL_STOPS,
  type Lamp,
  type LampMount,
  type LightMemory,
  type Lit,
  type Run,
  type Stops,
} from './light.js';
import { ALARM_RED, ceilingLayer, mixTint, WARM, type CeilingLight } from './power.js';
import {
  clampCamera,
  placeRoomNames,
  ROOM_NAME_PX,
  shiftClear,
  type Box,
  type Viewport,
} from './viewport.js';
import { bakeVignette, vignetteBreath, vignetteShown } from './vignette.js';

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
/** How far the green-white light out of the open hatch reaches, in tiles. */
const EXIT_GLOW = 3.2;
/** How long one turn of the escape's siren takes, s: the red light swells with it. */
const SIREN_TURN = 1.25;
/**
 * How much of a lit room's light the escape takes back, at most and at
 * least as the siren turns: the lab on its alarm lighting, your lamp cutting
 * through again.
 */
const ALARM_DIM = [0.62, 0.42] as const;
/** On a touch screen the pad would sit on the avatar: it is lifted this far, CSS pixels. */
const PAD_LIFT = 60;
/** How far round your figure the edge arrows keep off, in tiles. */
const KEEP_OUT_TILES = 1.5;
/** Air between two tags on the screen — a caption and the E prompt — CSS pixels. */
const TAG_AIR = 4;
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

/** The end of the run playing on this screen (finale.ts): how it ended, since when (epoch ms). */
export interface FinaleCue {
  ending: Ending;
  since: number;
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
  /**
   * when the lights went out on this screen, epoch ms (coldOpen.ts
   * `useDarkSince`): the cold open runs from there; null while the power is on
   */
  darkSince: number | null;
  /** the run's ending, while it plays on this screen; none while the run goes on */
  finale?: FinaleCue | null;
  /**
   * the station whose panel lies over the world; none by default. While it is up the world's
   * tips wait — the device's own line is in its frame — and an alarm sounds the device's horn,
   * not the world's
   */
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
  /** each door's slide, by door id (doors.ts) */
  doors: Map<string, DoorMotion>;
  walkPhase: number;
  stepAcc: number;
  cam: { x: number; y: number };
  /** how far the objective bar reaches down, CSS pixels, eased: the camera glides as it grows */
  topCss: number;
  /** `cam` clamped to the map bounds; everything on screen uses this one */
  draw: { x: number; y: number };
  /** device pixels per tile, as the last frame drew it */
  scale: number;
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
  /**
   * lit rooms by label: the tiles their lights reach, as a path in tiles,
   * and the sim time they came on
   */
  lit: Map<string, { tiles: { x: number; y: number }[]; path: Path2D; since: number }>;
  /** rooms lit while something lay over the world: they come on once it is gone */
  pendingLit: string[];
  /** the room the power lights round you while the lab has it, with its tiles as a path */
  room: { light: RoomLight; path: Path2D } | null;
  /** the tiles of every lit room, by key: drawn in the colours of the lab with its power on */
  litTiles: Set<string>;
  /** what this run's lamps and drones have lit so far, and their sights */
  light: LightMemory;
}

/** Cuts a radial glow of `radius` tiles into the darkness at (wx, wy), as its `stops` say. */
type Punch = (wx: number, wy: number, radius: number, stops: Stops) => void;

/** The three ways light is cut into the darkness. */
interface Cutters {
  /** a radial glow round a point */
  punch: Punch;
  /** a lamp's beam, its cone fading out along `stops` */
  beam: (lit: Lit, stops: Stops) => void;
  /** whatever `draw` cuts, only where the lamp of `lit` can see */
  within: (lit: Lit, draw: () => void) => void;
}

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
  /** your lamp in the dark; null while the lab has its power, and for the audience */
  own: Lit | null;
  /**
   * while the lab has its power, the room it lights round you, whole, to its walls and doors;
   * null in the dark and for the audience
   */
  room: Sim['room'];
  /** the lamps the rest of the crew carry; none while the power is on */
  crew: Lit[];
  /** the drones' eyes, by drone id; a frozen drone looks nowhere */
  eyes: Map<string, Lit>;
  /** the emergency lamps, where they hang and what they light; none while the power is on */
  lamps: { mount: LampMount; lit: Lit }[];
  /** the open hatch's green-white light, as far as it stands open (0 to 1); null while shut */
  exit: { lit: Lit; open: number } | null;
  /** a lit room's light falling through an open door into the dark, as far as it stands open */
  spills: { lit: Lit; open: number }[];
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

/** A frame's lights, before what they show is worked out. */
type FrameLamps = Pick<FrameLight, 'own' | 'room' | 'crew' | 'eyes' | 'lamps' | 'exit' | 'spills'>;

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

/** A radial gradient cutting darkness `stops` deep round (x, y) out to `r`, in `g`'s space. */
function cutGradient(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: Stops,
): CanvasGradient {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [offset, depth] of stops) {
    gradient.addColorStop(offset, `rgba(0,0,0,${depth})`);
  }
  return gradient;
}

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

/** How long a tip stays up at most. */
const TIP_MS = 6500;

/**
 * The one sentence a newcomer needs right now, about the world. Over an open
 * station nothing: the device's line lies in its own frame (Game.tsx), and
 * the world the panel covers can wait. On a touch screen, which has no keys,
 * a tip names the ⚡ button instead. The escape needs none: its checklist
 * calls everybody to the hatch.
 */
function coachTip(
  map: WorldMap,
  youId: string,
  carried: WorldMap['items'][number] | undefined,
  station: PuzzleView | null,
  keyboard: boolean,
): CoachMark | null {
  if (station !== null) {
    return null;
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
  if (map.plates.some((plate) => plate.pressed && !plate.freezesDrone)) {
    return {
      id: 'plate',
      text: 'Solange jemand auf der Platte steht, bleibt die Tür offen — nicht runtergehen!',
    };
  }
  void youId;
  return null;
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

export function GameWorld({
  view,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  inputLocked,
  spectator,
  darkSince,
  finale = null,
  station = null,
  holdTips,
  onToggleInfo,
  onRead,
  onOperate,
  send,
}: Props) {
  const [wheelOpen, setWheelOpen] = useState(false);
  /** the world's tip up now */
  const [tip, setTip] = useState<CoachMark | null>(null);
  /** how far the control cluster reaches up from the world's bottom edge, CSS pixels */
  const [controlsReach, setControlsReach] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const darkRef = useRef(darkSince);
  darkRef.current = darkSince;
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
  const stationRef = useRef(station);
  stationRef.current = station;
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
  // notice, so the two never stack, and while a station's panel is up.
  useEffect(() => {
    if (spectator || view.map === null || finale !== null || holdTips) {
      setTip(null);
      return;
    }
    const keyboard = !window.matchMedia(TOUCH).matches;
    const carried = carriedItem(view.map, view.you.id);
    const next = coachTip(view.map, view.you.id, carried, station, keyboard);
    const fresh = firstSight(next, SHOWN_MARKS);
    if (fresh !== null) {
      SHOWN_MARKS.add(fresh.id);
      setTip(fresh);
    } else if (next?.id !== tip?.id) {
      setTip(null);
    }
  }, [view, station, spectator, holdTips, tip, finale]);

  useEffect(() => {
    if (tip === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTip(null), TIP_MS);
    return () => clearTimeout(timer);
  }, [tip]);

  const reduced = useMedia(REDUCED_MOTION);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // The power hums while the lights are on; where this screen sees them fail, it hears them
  // fail with the picture (coldOpen.ts) — under reduced motion with no flicker to arc in —
  // and where it lands in the dark, the hum just ends.
  useEffect(() => {
    if (darkSince === null) {
      startPowerHum();
      return;
    }
    const elapsed = Date.now() - darkSince;
    if (elapsed < SEQUENCE_MS) {
      blackoutSounds(blackoutCue(elapsed, reducedRef.current));
    } else {
      stopPowerHum();
    }
  }, [darkSince]);

  // The world answers an alarm (alarm.ts): the klaxon while the run goes on — the alarm that
  // ends it has the ending's own sound, and an open device sounds its own horn instead — the
  // strobe and the shake, the drones' marks.
  const alarm = useAlarm(view.penaltySeq, () => {
    if (worldHornDue(viewRef.current.phase, stationRef.current != null)) {
      klaxon();
    }
  });
  const alarmRef = useRef<Alarm | null>(alarm);
  alarmRef.current = alarm;
  const alarmClass = useAlarmClasses(alarm, reduced);
  // The escape (escape.ts) and the ending (finale.ts), as this screen lives them.
  const escapeSince = useEscapeSince(view.map?.exit ?? null, view.startedAt);
  const escapeRef = useRef(escapeSince);
  escapeRef.current = escapeSince;
  useEscapeSounds(escapeSince, view.phase === 'playing' && finale === null);
  const finaleRef = useRef(finale);
  finaleRef.current = finale;
  useFinaleSounds(finale);

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
    const floorLit = makeFloorTile(true);
    const wallLit = makeWallTile(true);
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
      time: 0,
      seenPings: new WeakSet<MapPing>(),
      minimap: true,
      sabotageWasOn: false,
      lastBeepAt: Number.POSITIVE_INFINITY,
      seen: null,
      captions: [],
      lit: new Map(),
      pendingLit: [],
      room: null,
      litTiles: new Set(),
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
            get camera() {
              return { x: sim.draw.x, y: sim.draw.y, scale: sim.scale };
            },
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
        sim.room = null;
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

      // a door the view turned slides open or shut, with the hiss (doors.ts)
      const now = Date.now();
      for (const door of map.doors) {
        const { motion, moved } = doorTurned(sim.doors.get(door.id), door.open, now);
        sim.doors.set(door.id, motion);
        if (moved) {
          doorSlide();
        }
      }
      if (map !== sim.seen) {
        look(map);
      }
      lightWhenClear(map);
      hearTheClock(map);

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
     * The lab getting louder as the clock runs out, the last ten seconds
     * counted out loud; and an emergency's siren as it starts, a chirp as it
     * is over.
     */
    function hearTheClock(map: WorldMap): void {
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
      const sabotageOn = map.sabotage !== null;
      if (sabotageOn !== sim.sabotageWasOn) {
        sim.sabotageWasOn = sabotageOn;
        if (sabotageOn) {
          powerDrain();
        } else {
          stationChirp();
        }
      }
    }

    /**
     * The lab answering the crew: a source somebody came across gets a blip
     * and a caption, a locker or cabinet opening within earshot its sound, a
     * room whose lights came on a relay's click and its warm-up (rooms.ts) —
     * in plain sight, once nothing lies over the world (`lightWhenClear`).
     * Whatever this client finds on its first look was there before it came
     * in.
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
      const known = new Set(sim.lit.keys());
      const lit = roomsComingOn(map.litRooms, known, news.lit, sim.pendingLit, covered());
      for (const room of lit.long) {
        lightRoom(map, room, -Infinity);
      }
      sim.pendingLit = lit.waiting;
      warmUpRooms(map, lit.now);
    }

    /** Whether something lies over the world on this screen: a panel, pages, the pause. */
    function covered(): boolean {
      return !spectator && lockedRef.current;
    }

    /** The rooms that waited behind a panel or pages come on once nothing lies over the world. */
    function lightWhenClear(map: WorldMap): void {
      if (sim.pendingLit.length > 0) {
        const lit = roomsComingOn([], new Set(), [], sim.pendingLit, covered());
        sim.pendingLit = lit.waiting;
        warmUpRooms(map, lit.now);
      }
    }

    /** Rooms coming on now: the relay's click, and their lights warming up from this moment. */
    function warmUpRooms(map: WorldMap, rooms: readonly string[]): void {
      if (rooms.length === 0) {
        return;
      }
      for (const room of rooms) {
        lightRoom(map, room, sim.time);
      }
      lightsOnClick();
    }

    /**
     * The lights of `room` are on, since `since` (sim time): its tiles, as a
     * set and as a path of their rows — and seen, whatever lies there, from
     * now on this run.
     */
    function lightRoom(map: WorldMap, room: string, since: number): void {
      const tiles = map.labels.filter((l) => l.text === room).flatMap((l) => roomArea(map, l));
      const keys = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
      const path = new Path2D();
      for (const run of runsOf(keys)) {
        path.rect(run.x, run.y, run.length, 1);
      }
      const { seen } = runLight();
      for (const key of keys) {
        sim.litTiles.add(key);
        seen.add(key);
      }
      sim.lit.set(room, { tiles, path, since });
    }

    function worldToScreen(s: number, w: number, h: number, x: number, y: number): [number, number] {
      return [w / 2 + (x - sim.draw.x) * s, h / 2 + (y - sim.draw.y) * s];
    }

    /**
     * This frame's light, each cut off by walls and shut doors: in the dark
     * your lamp, the crew's lamps, the drones' eyes, the emergency lamps, the
     * open hatch and lit rooms through open doors; while the lab has its
     * power (`powered`), your room lit whole instead — the rest of the lab
     * dark. And what the world shows — whatever lies where light falls now, in
     * a lit room, or fell earlier this run. The audience sees the whole lab,
     * and the drones' cones only; so does everybody once the lab is lit
     * `whole` again, as at the end of a run won.
     */
    function lightUp(map: WorldMap, powered: boolean, whole: boolean): FrameLight {
      const memory = runLight();
      const shut = doorsShut(map);
      const lit = (lamp: Lamp): Lit => ({
        lamp,
        sight: memory.look(map, lamp, reachOf(lamp), shut),
      });
      const lamps = powered ? powerLights(map) : darkLights(map, lit);
      const falling = remember(memory, lamps);
      const everything = spectator || whole;
      const shown = (x: number, y: number): boolean =>
        everything || memory.seen.has(`${Math.floor(x)},${Math.floor(y)}`);
      const inPower = (x: number, y: number): boolean =>
        whole || (powered && (spectator || falling.has(`${x},${y}`)));
      const crewShown = (x: number, y: number): boolean =>
        everything || !powered || falling.has(`${Math.floor(x)},${Math.floor(y)}`);
      return { ...lamps, shown, powered: inPower, crewShown };
    }

    /**
     * What this run's light has done so far: a fresh memory once a new run
     * has started, the lit rooms seen from the start.
     */
    function runLight(): LightMemory {
      const run = viewRef.current.startedAt;
      if (sim.light.run !== run) {
        sim.light = lightMemory(run);
        for (const key of sim.litTiles) {
          sim.light.seen.add(key);
        }
      }
      return sim.light;
    }

    /**
     * The light while the lab has its power: your room's own, whole, to its
     * walls and doors (`ownRoom`) — nothing behind them. Nobody needs a lamp,
     * and the emergency lamps are dark glass. The audience sees the lab whole.
     */
    function powerLights(map: WorldMap): FrameLamps {
      return {
        own: null,
        room: spectator ? null : ownRoom(map),
        crew: [],
        eyes: new Map(),
        lamps: [],
        exit: null,
        spills: [],
      };
    }

    /**
     * The room the power lights round you: the one whose floor you stand on,
     * kept while you stand on a door between two — worked out anew only as
     * you step onto another room's floor.
     */
    function ownRoom(map: WorldMap): Sim['room'] {
      const here = `${Math.floor(sim.self.x)},${Math.floor(sim.self.y)}`;
      if (sim.room?.light.keys.has(here) === true) {
        return sim.room;
      }
      const light = powerRoom(map, sim.self);
      if (light !== null) {
        const path = new Path2D();
        for (const run of light.runs) {
          path.rect(run.x, run.y, run.length, 1);
        }
        sim.room = { light, path };
      }
      return sim.room;
    }

    /**
     * The lights of the dark: your flashlight, the crew's lamps, the drones'
     * eyes, the emergency lamps, the open hatch and the lit rooms' light
     * through open doors.
     */
    function darkLights(map: WorldMap, lit: (lamp: Lamp) => Lit): FrameLamps {
      const cone = { facing: sim.self.facing, halfAngle: CONE_HALF_ANGLE, reach: CONE_REACH };
      const own = spectator ? null : lit({ x: sim.self.x, y: sim.self.y, glow: OWN_GLOW, beam: cone });
      const crew = spectator
        ? []
        : [...sim.others.values()].map((o) => lit({ x: o.rx, y: o.ry, glow: CREW_GLOW, beam: null }));
      return {
        own,
        room: null,
        crew,
        eyes: droneEyes(lit),
        lamps: burningLamps(map, lit),
        exit: exitLight(map, lit),
        spills: doorSpills(map, lit),
      };
    }

    /** How far the hatch stands open on this screen now: it grinds open from the escape's start. */
    function hatchOpen(map: WorldMap): number {
      const since = escapeRef.current;
      return map.exit?.open === true && since !== null ? exitOpening(Date.now() - since) : 0;
    }

    /** The open hatch's green-white light, as far as it has ground open; null while it is shut. */
    function exitLight(map: WorldMap, lit: (lamp: Lamp) => Lit): FrameLight['exit'] {
      const exit = map.exit;
      const open = hatchOpen(map);
      if (exit === null || open <= 0) {
        return null;
      }
      return { lit: lit({ x: exit.x + 0.5, y: exit.y + 0.5, glow: EXIT_GLOW, beam: null }), open };
    }

    /** Each lit room's light falling through an open door into the dark: a wedge (doors.ts). */
    function doorSpills(map: WorldMap, lit: (lamp: Lamp) => Lit): FrameLight['spills'] {
      const now = Date.now();
      const inLight = (x: number, y: number): boolean => sim.litTiles.has(`${x},${y}`);
      return map.doors.flatMap((door) => {
        const motion = sim.doors.get(door.id);
        const open = motion === undefined ? Number(door.open) : doorOpenness(motion, now);
        const spill = spillThrough(map, door, open, inLight);
        if (spill === null) {
          return [];
        }
        const beam = { facing: spill.facing, halfAngle: SPILL_HALF_ANGLE, reach: SPILL_REACH };
        return [{ lit: lit({ x: spill.x, y: spill.y, glow: 0, beam }), open }];
      });
    }

    /** The drones' eyes, by drone id: a frozen drone looks nowhere. */
    function droneEyes(lit: (lamp: Lamp) => Lit): Map<string, Lit> {
      const eyes = new Map<string, Lit>();
      for (const [id, drone] of Object.entries(dronesRef.current)) {
        if (drone.frozen) {
          continue;
        }
        const halfAngle = (drone.halfAngleDeg * Math.PI) / 180;
        const beam = { facing: drone.facing, halfAngle, reach: drone.range };
        eyes.set(id, lit({ x: drone.x, y: drone.y, glow: 0, beam }));
      }
      return eyes;
    }

    /**
     * Marks the tiles `lamps` light now as seen in `memory`, as a lit room's
     * are from the moment its lights come on (`lightRoom`): whatever lies
     * there stays drawn this run. Returns the tiles lit now — with the power
     * on, your room's.
     */
    function remember(memory: LightMemory, lamps: FrameLamps): Set<string> {
      const falling = new Set<string>(lamps.room?.light.keys);
      const { own, crew, eyes, exit, spills } = lamps;
      const lights = [
        ...(own === null ? [] : [own]),
        ...crew,
        ...eyes.values(),
        ...lamps.lamps.map((l) => l.lit),
        ...(exit === null ? [] : [exit.lit]),
        ...spills.map((spill) => spill.lit),
      ];
      for (const { lamp, sight } of lights) {
        for (const key of memory.lights(lamp, sight)) {
          falling.add(key);
        }
      }
      for (const key of falling) {
        memory.seen.add(key);
      }
      return falling;
    }

    /**
     * The emergency lamps burning this frame, each with where its light falls:
     * it lights what lies on its tile and round it. The audience, which sees
     * everything anyway, gets none.
     */
    function burningLamps(map: WorldMap, lit: (lamp: Lamp) => Lit): FrameLight['lamps'] {
      if (spectator) {
        return [];
      }
      return mountedLamps(map)
        .filter(burning)
        .map((mount) => ({ mount, lit: lit(emergencyLamp(mount)) }));
    }

    /** An emergency lamp burns while its room is dark; with the room's lights back, it goes out. */
    function burning(mount: LampMount): boolean {
      return !sim.litTiles.has(`${Math.floor(mount.x)},${Math.floor(mount.y)}`);
    }

    /** Where the map's emergency lamps hang; one that hangs nowhere is left out. */
    function mountedLamps(map: WorldMap): LampMount[] {
      return map.lamps.flatMap((lamp) => {
        const mount = lampMount(map, lamp);
        return mount === null ? [] : [mount];
      });
    }

    /** The lab's ceiling lights baked in each colour asked for, for the map last asked for. */
    let layers: { tiles: string; byLight: Map<CeilingLight, HTMLCanvasElement> } | null = null;
    function layerOf(map: WorldMap, light: CeilingLight): HTMLCanvasElement {
      const tiles = map.tiles.join('\n');
      if (layers === null || layers.tiles !== tiles) {
        layers = { tiles, byLight: new Map() };
      }
      const baked = layers.byLight.get(light) ?? ceilingLayer(map, light);
      layers.byLight.set(light, baked);
      return baked;
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

    /** Device pixels per tile with the whole lab in the picture. */
    function wholeZoom(map: WorldMap, w: number, h: number): number {
      return Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)));
    }

    /** Device pixels per tile: the audience sees the whole lab, a player what covers the canvas. */
    function zoomFor(map: WorldMap, w: number, h: number): number {
      if (spectator) {
        return wholeZoom(map, w, h);
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
      const ending = finaleNow();
      const pull = ending?.pull ?? 0;
      const near = zoomFor(map, w, h);
      const s = near + (wholeZoom(map, w, h) - near) * pull;
      sim.draw = clampCamera(map, pulledBack(map, pull), {
        scale: s,
        w,
        h,
        top: sim.topCss * dpr * (1 - pull),
        lift: touchPad.matches && !spectator ? PAD_LIFT * dpr * (1 - pull) : 0,
      });
      sim.scale = s;
      const scene = sceneNow();
      const whole = (ending?.lit ?? 0) > 0;
      const light = lightUp(map, scene.lit, whole);
      const text = textAt(s, dpr);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04070a';
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      drawTiles(map, s, w, h, light.powered);
      const pulse = (Math.sin(sim.time * 4) + 1) / 2;
      drawProps(map, light, pulse, text);
      drawLamps(map, scene.lit || whole);
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
      renderLight(map, s, w, h, light, scene.lit, ending?.lit ?? 0);
      if (minimap !== null && ending === null) {
        renderMinimap(map, minimap, dpr);
      }
      renderPings(s, w, h, dpr);
      renderScreenText(map, s, view, ending !== null);
      renderCover(Math.max(scene.cover, ending?.dark ?? 0), w, h);
      renderVignette(map, w, h, dpr, ending !== null);
    }

    /**
     * Where the cold open stands on this screen now: the power on, the light failing — one fade
     * under reduced motion — or out.
     */
    function sceneNow(): ColdOpenFrame {
      const since = darkRef.current;
      return coldOpenFrame(since === null ? null : Date.now() - since, reducedRef.current);
    }

    /** Where the ending stands on this screen now (finale.ts); null while the run goes on. */
    function finaleNow(): FinaleFrame | null {
      const cue = finaleRef.current;
      return cue === null ? null : finaleFrame(cue.ending, Date.now() - cue.since, reducedRef.current);
    }

    /** Where the camera looks as it pulls back from the avatar to the middle of the lab. */
    function pulledBack(map: WorldMap, pull: number): { x: number; y: number } {
      return {
        x: sim.cam.x + (map.width / 2 - sim.cam.x) * pull,
        y: sim.cam.y + (map.height / 2 - sim.cam.y) * pull,
      };
    }

    /**
     * The light over the picture: the darkness, and what cuts it open — the
     * lab's own warm light in your room while it has its power. The audience
     * sees the lab whole, warm all over while the power is on; and so does
     * everybody as every room's light comes on at the end of a run won
     * (`whole`, 0 to 1), the darkness lifting as it does.
     */
    function renderLight(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      light: FrameLight,
      powered: boolean,
      whole: number,
    ): void {
      if (whole > 0) {
        renderPowerOn(map, s, w, h, null, whole);
      } else if (powered && (spectator || light.room !== null)) {
        renderPowerOn(map, s, w, h, light.room?.path ?? null, 1);
      }
      if (!spectator && whole < 1) {
        renderLighting(map, s, w, h, light, 1 - whole);
      }
    }

    /** The light failing: the whole picture drops by `cover`, or goes black at 1. */
    function renderCover(cover: number, w: number, h: number): void {
      if (ctx == null || cover <= 0) {
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(1, 2, 4, ${cover})`;
      ctx.fillRect(0, 0, w, h);
    }

    /** The red edge as last baked (vignette.ts), and for which canvas: baked anew for another. */
    const edge = { canvas: document.createElement('canvas'), w: 0, h: 0, dpr: 0 };

    /**
     * The red edge round the world in the clock's last minute and all through
     * the escape, breathing: drawn last, over everything on the canvas. Not
     * for the audience, and gone once the run ends on this screen.
     */
    function renderVignette(
      map: WorldMap,
      w: number,
      h: number,
      dpr: number,
      ending: boolean,
    ): void {
      const shown = vignetteShown(viewRef.current.deadlineAt, Date.now(), escaping(map), ending);
      if (ctx == null || spectator || !shown) {
        return;
      }
      if (edge.w !== w || edge.h !== h || edge.dpr !== dpr) {
        bakeVignette(edge.canvas, w, h, dpr);
        Object.assign(edge, { w, h, dpr });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = vignetteBreath(performance.now(), reducedRef.current);
      ctx.drawImage(edge.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    /** How brightly the emergency lamps burn now: a slow pulse that never goes out. */
    function lampPulse(): number {
      return 0.7 + 0.3 * Math.sin(sim.time * 2.4);
    }

    /**
     * The emergency lamps on their walls and ceilings, pulsing where their
     * room is dark — dark glass while the power is on, and in a room whose
     * lights are back.
     */
    function drawLamps(map: WorldMap, powered: boolean): void {
      if (ctx == null) {
        return;
      }
      const glow = powered ? 0 : lampPulse();
      for (const mount of mountedLamps(map)) {
        ctx.save();
        ctx.translate(mount.x, mount.y);
        drawEmergencyLamp(ctx, { glow: burning(mount) ? glow : 0, facing: mount.facing });
        ctx.restore();
      }
    }

    /**
     * The lab with its power on: the ceiling lights' warm pools and a warm lift
     * over the picture, within `clip` (a path in tiles) — a player's room,
     * whole, nothing beyond its walls; the audience, and everybody at the end
     * of a run won, the whole lab (null) — `strength` up. The darkness goes
     * over it after.
     */
    function renderPowerOn(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      clip: Path2D | null,
      strength: number,
    ): void {
      if (ctx == null) {
        return;
      }
      ctx.save();
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      if (clip !== null) {
        ctx.clip(clip);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = strength;
      ctx.drawImage(layerOf(map, WARM), 0, 0, map.width, map.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255, 186, 128, 0.05)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    /**
     * Floor and walls, as far as the canvas shows them, in the colours of the
     * lab with its power on where `powered` says so — or in a room whose
     * lights are back; tile space.
     */
    function drawTiles(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      powered: (x: number, y: number) => boolean,
    ): void {
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
          const lit = powered(tx, ty) || sim.litTiles.has(`${tx},${ty}`);
          const texture = textureOf(row.charAt(tx), lit);
          if (texture !== null) {
            ctx.drawImage(texture, tx, ty, 1, 1);
          }
        }
      }
    }

    /**
     * What a tile is drawn with: floor or wall, in the colours of the power on
     * where `lit`; nothing for the void beyond the walls.
     */
    function textureOf(tile: string, lit: boolean): HTMLCanvasElement | null {
      if (tile === '.') {
        return lit ? floorLit : floorTex;
      }
      if (tile === '#') {
        return lit ? wallLit : wallTex;
      }
      return null;
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
        const look = {
          pressed: plate.pressed,
          label: plateCaption(plate),
          camera: plate.freezesDrone,
          text,
        };
        drawAt(plate.x + 0.5, plate.y + 0.5, () => drawPlate(ctx, look));
      }
      const now = Date.now();
      for (const door of map.doors) {
        const motion = sim.doors.get(door.id);
        const openT = motion === undefined ? Number(door.open) : doorOpenness(motion, now);
        const horizontal = isHorizontalDoor(map, door);
        drawAt(door.x + 0.5, door.y + 0.5, () => drawDoor(ctx, { openT, horizontal }));
      }
      // Every spot: a station with two consoles stands twice, both lit while it is armed.
      // A main switch has a lever for each of the crew.
      const levers = viewRef.current.players.filter((p) => p.connected).length;
      for (const station of map.stations) {
        if (station.status !== 'locked' || light.shown(station.x, station.y)) {
          const { status } = station;
          const draw =
            station.look === 'lever'
              ? () => drawLeverBox(ctx, { status, pulse, levers })
              : () => drawStation(ctx, { status, pulse, console: station.console ?? null });
          drawAt(station.x + 0.5, station.y + 0.5, draw);
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
        const look = { open: hatchOpen(map), pulse };
        drawAt(exit.x + 0.5, exit.y + 0.5, () => drawExitHatch(ctx, look));
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
      for (const [id, other] of [...sim.others].filter(([, o]) => light.crewShown(o.rx, o.ry))) {
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

      // For a second after an alarm every drone wears a „!" (alarm.ts).
      const alarm = alarmRef.current;
      const marked = alarm === null ? 1 : (Date.now() - alarm.at) / DRONE_MARK_MS;
      for (const drone of Object.values(dronesRef.current)) {
        ctx.save();
        ctx.translate(drone.x, drone.y);
        drawDroneBody(ctx, drone, pulse);
        drawAlarmMark(ctx, marked);
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

    /** The box a tag like the E prompt covers with `text` centred on (sx, sy); device pixels. */
    function tagBox(text: string, sx: number, sy: number, dpr: number): Box {
      if (ctx == null) {
        return { left: sx, top: sy, right: sx, bottom: sy };
      }
      ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      const half = (ctx.measureText(text).width + 16 * dpr) / 2;
      return { left: sx - half, top: sy - 11 * dpr, right: sx + half, bottom: sy + 9 * dpr };
    }

    /** A tag on the screen like the E prompt: a dark pill with rim and text in `tint`, in `box`. */
    function drawTag(text: string, box: Box, tint: string, dpr: number): void {
      if (ctx == null) {
        return;
      }
      ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = 'rgba(7,11,15,0.88)';
      ctx.strokeStyle = tint;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, 5 * dpr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.fillText(text, (box.left + box.right) / 2, box.top + 15 * dpr);
    }

    /** `box` moved down by `dy`, device pixels. */
    function moved(box: Box, dy: number): Box {
      return { ...box, top: box.top + dy, bottom: box.bottom + dy };
    }

    /**
     * „Spind entdeckt" over a source the crew has just come across, rising as
     * it fades — above the E prompt (`prompt`, its box), never on it.
     */
    function renderCaptions(s: number, view: Viewport, prompt: Box | null): void {
      if (ctx == null) {
        return;
      }
      const { w, h, dpr } = view;
      sim.captions = sim.captions.filter((c) => sim.time - c.at < CAPTION_SECONDS);
      for (const caption of sim.captions) {
        const age = (sim.time - caption.at) / CAPTION_SECONDS;
        const [sx, rawY] = worldToScreen(s, w, h, caption.x, caption.y - 1 - 0.3 * age);
        const box = tagBox(caption.text, sx, Math.max(rawY, view.top + 24 * dpr), dpr);
        const ceiling = view.top + 13 * dpr;
        const dy = prompt === null ? 0 : shiftClear(box, prompt, TAG_AIR * dpr, ceiling);
        ctx.globalAlpha = Math.min(1, age * 10, (1 - age) * 4);
        drawTag(caption.text, moved(box, dy), '#93c5fd', dpr);
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

    /**
     * How light is cut into the darkness of the overlay at this frame's zoom:
     * a glow, a beam, and the clip to what a lamp can see.
     */
    function lightCutters(cut: CanvasRenderingContext2D, s: number, w: number, h: number): Cutters {
      const punch: Punch = (wx, wy, radius, stops) => {
        const [sx, sy] = worldToScreen(s, w, h, wx, wy);
        const r = radius * s;
        cut.fillStyle = cutGradient(cut, sx, sy, r, stops);
        cut.fillRect(sx - r, sy - r, r * 2, r * 2);
      };
      /** A beam from `lamp`: its cone, fading out along the gradient `stops`. */
      const beam = ({ lamp }: Lit, stops: Stops): void => {
        if (lamp.beam === null) {
          return;
        }
        const { facing, halfAngle, reach } = lamp.beam;
        const [sx, sy] = worldToScreen(s, w, h, lamp.x, lamp.y);
        const r = reach * s;
        cut.save();
        cut.beginPath();
        cut.moveTo(sx, sy);
        cut.arc(sx, sy, r, facing - halfAngle, facing + halfAngle);
        cut.closePath();
        cut.clip();
        cut.fillStyle = cutGradient(cut, sx, sy, r, stops);
        cut.fillRect(sx - r, sy - r, r * 2, r * 2);
        cut.restore();
      };
      /** Cuts light into the darkness only where `lit` can see: walls and shut doors stop it. */
      const within = (lit: Lit, draw: () => void): void => {
        cut.save();
        cut.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
        cut.clip(clipPath(lit));
        cut.setTransform(1, 0, 0, 1, 0, 0);
        draw();
        cut.restore();
      };
      return { punch, beam, within };
    }

    /**
     * The darkness over the picture, `veil` strong, with every light cut into
     * it where its lamp can see; then the colours of the lights over it.
     */
    function renderLighting(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      light: FrameLight,
      veil: number,
    ): void {
      if (ctx == null) {
        return;
      }
      const burn = lampPulse();
      cutDarkness(map, s, w, h, light, burn);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = veil;
      ctx.drawImage(overlay, 0, 0);
      ctx.globalAlpha = 1;
      const red = escapeRed();
      renderRoomLight(map, s, w, h, light.exit, red);
      renderLampLight(light, burn, s, w, h);
      renderSpillLight(light.spills, red, s, w, h);
      renderEscapeTint(red, w, h);
    }

    /**
     * The darkness of the overlay — deeper in the last minute and all through
     * the escape — none over the lit rooms and, with the power on, over your
     * room, and the light every lamp cuts into it where it can see.
     */
    function cutDarkness(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      light: FrameLight,
      burn: number,
    ): void {
      if (octx == null) {
        return;
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      const deadlineAt = viewRef.current.deadlineAt;
      const pressed =
        escapeRef.current !== null || (deadlineAt !== null && deadlineAt - Date.now() < 60_000);
      const base = (pressed ? 0.945 : 0.92) + 0.02 * Math.sin(sim.time * (pressed ? 3.2 : 1.7));
      octx.clearRect(0, 0, w, h);
      octx.fillStyle = `rgba(3,5,9,${base})`;
      octx.fillRect(0, 0, w, h);
      litDarkness(base, s, w, h);
      for (const run of light.room?.light.runs ?? []) {
        clearRun(run, s, w, h);
      }
      octx.globalCompositeOperation = 'destination-out';
      const { punch, beam, within } = lightCutters(octx, s, w, h);

      // Your light in the dark: a lit circle round you and a flashlight cone in
      // facing direction; everybody else's softer glow. Each lights what it can
      // see, and nothing behind a wall — so the walls cut a clean edge into the
      // circle. With the power on, your room was cleared whole above.
      const own = light.own;
      if (own !== null) {
        within(own, () => {
          punch(own.lamp.x, own.lamp.y, own.lamp.glow, OWN_GLOW_STOPS);
          beam(own, OWN_BEAM_STOPS);
        });
      }
      for (const lit of light.crew) {
        within(lit, () => punch(lit.lamp.x, lit.lamp.y, CREW_GLOW, CREW_GLOW_STOPS));
      }
      // The emergency lamps open the dark a little round them; their red comes after.
      const dim: Stops = EMERGENCY_STOPS.map(([offset, depth]) => [offset, depth * burn]);
      for (const { mount, lit } of light.lamps) {
        within(lit, () => punch(mount.x, mount.y, EMERGENCY_GLOW, dim));
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
      // The open hatch, and a lit room through an open door, as far as each stands open.
      cutHatch(map, light.exit, s, w, h);
      for (const { lit, open } of light.spills) {
        within(lit, () => beam(lit, SPILL_STOPS.map(([offset, depth]) => [offset, depth * open])));
      }
    }

    /** The lit rooms' tiles grouped by the rooms lighting them (rooms.ts), for the rooms lit. */
    let litTileGroups: { lit: string; groups: LitGroup[] } | null = null;

    /**
     * A lit room keeps no darkness at all, walls and doors included — some
     * while its lights are still coming on, and on the escape's alarm
     * lighting: a tile keeps of the overlay's darkness, `base` deep, what
     * every room lighting it leaves. Its pixels are cleared and filled anew,
     * whole ones, so that neighbouring tiles meet without seams; the lamps
     * cut into it after.
     */
    function litDarkness(base: number, s: number, w: number, h: number): void {
      if (octx == null) {
        return;
      }
      const lit = [...sim.lit.keys()].join('\n');
      if (litTileGroups?.lit !== lit) {
        const rooms = new Map([...sim.lit].map(([label, room]) => [label, room.tiles]));
        litTileGroups = { lit, groups: litGroups(rooms) };
      }
      const [most, least] = ALARM_DIM;
      const alarmDim = escapeRed() * (most + (least - most) * sirenSwell());
      const left = (room: string): number =>
        1 - roomUp(sim.lit.get(room)?.since ?? -Infinity) * (1 - alarmDim);
      for (const { rooms, runs } of litTileGroups.groups) {
        const keep = rooms.reduce((dark, room) => dark * left(room), 1);
        octx.fillStyle = `rgba(3,5,9,${base * keep})`;
        for (const run of runs) {
          const [x0, y0, x1, y1] = clearRun(run, s, w, h);
          if (keep > 0) {
            octx.fillRect(x0, y0, x1 - x0, y1 - y0);
          }
        }
      }
    }

    /**
     * Clears the darkness of the overlay over a run of tiles, whole pixels, so
     * that neighbouring runs meet without seams; returns the pixels cleared,
     * left, top, right and bottom.
     */
    function clearRun(run: Run, s: number, w: number, h: number): [number, number, number, number] {
      const [sx0, sy0] = worldToScreen(s, w, h, run.x, run.y);
      const [sx1, sy1] = worldToScreen(s, w, h, run.x + run.length, run.y + 1);
      const x0 = Math.round(sx0);
      const y0 = Math.round(sy0);
      const x1 = Math.round(sx1);
      const y1 = Math.round(sy1);
      octx?.clearRect(x0, y0, x1 - x0, y1 - y0);
      return [x0, y0, x1, y1];
    }

    /** The escape's siren turning, 0 to 1 and back: what the red light swells with. */
    function sirenSwell(): number {
      return reducedRef.current ? 0.5 : 0.5 + 0.5 * Math.sin((sim.time / SIREN_TURN) * Math.PI * 2);
    }

    /** How far the lights of a room that came on at `since` (sim time) are up now. */
    function roomUp(since: number): number {
      return warmUp((sim.time - since) * 1000, reducedRef.current);
    }

    /** How far the light has turned red on this screen: from the escape's start; warm once won. */
    function escapeRed(): number {
      const since = escapeRef.current;
      if (since === null || finaleRef.current?.ending === 'won') {
        return 0;
      }
      return redShift(Date.now() - since);
    }

    /** The light of the lit rooms and the open hatch as last baked, and what it was baked for. */
    let roomLightBaked: { key: string; sight: Lit['sight'] | null; baked: Baked | null } | null =
      null;

    /**
     * The light the lit rooms and the open hatch add over the darkness: a
     * room a solved station lit glows warm again, as the whole lab did with
     * the power on, and turns red, `red` of the way, as the escape's siren
     * sounds; the hatch spills its green-white light as far as it has ground
     * open, cut off by the walls like every light. Baked (baked.ts): a frame
     * lays it over the picture in one go.
     */
    function renderRoomLight(
      map: WorldMap,
      s: number,
      w: number,
      h: number,
      exit: FrameLight['exit'],
      red: number,
    ): void {
      const baked = roomLight(map, exit, red);
      if (ctx == null || baked === null) {
        return;
      }
      ctx.save();
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      ctx.globalCompositeOperation = 'lighter';
      drawBaked(ctx, baked);
      ctx.restore();
    }

    /**
     * The lit rooms' and the open hatch's light, baked again only once it has
     * changed since the last bake — a room warming up, the red coming in,
     * the hatch grinding open, each in the steps of `bakeStep`, or the walls
     * and doors the hatch's light stops at. Null while there is none.
     */
    function roomLight(map: WorldMap, exit: FrameLight['exit'], red: number): Baked | null {
      const rooms = [...sim.lit].map(([label, room]) => `${label} ${bakeStep(roomUp(room.since))}`);
      const open = exit === null ? 'shut' : bakeStep(exit.open);
      const key = [map.tiles.join('/'), bakeStep(red), open, ...rooms].join('|');
      const sight = exit?.lit.sight ?? null;
      if (roomLightBaked === null || roomLightBaked.key !== key || roomLightBaked.sight !== sight) {
        const into = roomLightBaked?.baked?.canvas;
        roomLightBaked = { key, sight, baked: bakeRoomLight(map, exit, bakeStep(red), into) };
      }
      return roomLightBaked.baked;
    }

    /**
     * Bakes the lit rooms' ceiling lights, `red` of the way from warm to red,
     * and the open hatch's glow over them — into `into`, where given.
     */
    function bakeRoomLight(
      map: WorldMap,
      exit: FrameLight['exit'],
      red: number,
      into: HTMLCanvasElement | undefined,
    ): Baked | null {
      const rooms = [...sim.lit.values()];
      const glows = exit === null ? [] : [{ x: exit.lit.lamp.x, y: exit.lit.lamp.y, r: EXIT_GLOW }];
      const box = bakeBox(map, rooms.flatMap((room) => room.tiles), glows);
      if (box === null) {
        return null;
      }
      const tints = [
        { layer: layerOf(map, WARM), share: 1 - red },
        { layer: layerOf(map, ALARM_RED), share: red },
      ].filter(({ share }) => share > 0);
      const draw = (g: CanvasRenderingContext2D): void => {
        g.globalCompositeOperation = 'lighter';
        for (const room of rooms) {
          g.save();
          g.clip(room.path);
          for (const { layer, share } of tints) {
            g.globalAlpha = bakeStep(roomUp(room.since)) * share;
            g.drawImage(layer, 0, 0, map.width, map.height);
          }
          g.restore();
        }
        if (exit !== null) {
          bakeHatchGlow(g, exit.lit, bakeStep(exit.open));
        }
      };
      return bake(box, draw, into);
    }

    /** The open hatch's green-white light, `open` (0 to 1) of its full, where `lit` sees; tiles. */
    function bakeHatchGlow(g: CanvasRenderingContext2D, lit: Lit, open: number): void {
      const { x, y } = lit.lamp;
      const glow = g.createRadialGradient(x, y, 0, x, y, EXIT_GLOW);
      glow.addColorStop(0, `rgba(240, 255, 246, ${0.8 * open})`);
      glow.addColorStop(0.16, `rgba(160, 245, 196, ${0.5 * open})`);
      glow.addColorStop(0.5, `rgba(74, 222, 128, ${0.18 * open})`);
      glow.addColorStop(1, 'rgba(74, 222, 128, 0)');
      g.save();
      g.clip(clipPath(lit));
      g.fillStyle = glow;
      g.fillRect(x - EXIT_GLOW, y - EXIT_GLOW, EXIT_GLOW * 2, EXIT_GLOW * 2);
      g.restore();
    }

    /** The open hatch's light cut into the darkness as last baked, and the sight it was cut to. */
    let hatchCutBaked: { sight: Lit['sight']; baked: Baked | null } | null = null;

    /**
     * Cuts the open hatch's light into the darkness as far as it stands open,
     * where it can see — baked once for that sight (baked.ts), so a frame
     * cuts it in one go.
     */
    function cutHatch(
      map: WorldMap,
      exit: FrameLight['exit'],
      s: number,
      w: number,
      h: number,
    ): void {
      if (octx == null || exit === null) {
        return;
      }
      const { lit } = exit;
      if (hatchCutBaked?.sight !== lit.sight) {
        const { x, y } = lit.lamp;
        const box = bakeBox(map, [], [{ x, y, r: EXIT_GLOW }]);
        const cut = (g: CanvasRenderingContext2D): void => {
          g.clip(clipPath(lit));
          g.fillStyle = cutGradient(g, x, y, EXIT_GLOW, objectGlowStops(0.95));
          g.fillRect(x - EXIT_GLOW, y - EXIT_GLOW, EXIT_GLOW * 2, EXIT_GLOW * 2);
        };
        const into = hatchCutBaked?.baked?.canvas;
        hatchCutBaked = { sight: lit.sight, baked: box === null ? null : bake(box, cut, into) };
      }
      if (hatchCutBaked.baked === null) {
        return;
      }
      octx.save();
      octx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      octx.globalAlpha = exit.open;
      drawBaked(octx, hatchCutBaked.baked);
      octx.restore();
    }

    /**
     * Adds `fill` over the square `r` round (sx, sy) where `lit`'s lamp can
     * see — and within its beam, where it has one: lit, as the darkness was
     * cut, only where its light falls.
     */
    function addLight(lit: Lit, fill: CanvasGradient, sx: number, sy: number, r: number): void {
      if (ctx == null || canvas == null) {
        return;
      }
      const { width: w, height: h } = canvas;
      const s = sim.scale;
      ctx.save();
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);
      ctx.clip(clipPath(lit));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cone = lit.lamp.beam;
      if (cone !== null) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, r, cone.facing - cone.halfAngle, cone.facing + cone.halfAngle);
        ctx.closePath();
        ctx.clip();
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = fill;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.restore();
    }

    /**
     * The emergency lamps' red over the dark, `burn` strong: a hot spot where
     * each hangs, dimming out to its reach, and cut off by the walls like
     * every light.
     */
    function renderLampLight(
      light: FrameLight,
      burn: number,
      s: number,
      w: number,
      h: number,
    ): void {
      if (ctx == null) {
        return;
      }
      const r = EMERGENCY_GLOW * s;
      for (const { mount, lit } of light.lamps) {
        const [sx, sy] = worldToScreen(s, w, h, mount.x, mount.y);
        const red = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        red.addColorStop(0, `rgba(255, 112, 98, ${0.85 * burn})`);
        red.addColorStop(0.12, `rgba(255, 50, 42, ${0.42 * burn})`);
        red.addColorStop(0.5, `rgba(255, 38, 32, ${0.16 * burn})`);
        red.addColorStop(1, 'rgba(255, 38, 32, 0)');
        addLight(lit, red, sx, sy, r);
      }
    }

    /** A lit room's light through an open door: a wedge of its colour falling into the dark. */
    function renderSpillLight(
      spills: FrameLight['spills'],
      red: number,
      s: number,
      w: number,
      h: number,
    ): void {
      if (ctx == null) {
        return;
      }
      const [r, g, b] = mixTint(WARM.tint, ALARM_RED.tint, red);
      for (const { lit, open } of spills) {
        const [sx, sy] = worldToScreen(s, w, h, lit.lamp.x, lit.lamp.y);
        const reach = SPILL_REACH * s;
        const wedge = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach);
        wedge.addColorStop(0, `rgba(${r},${g},${b},${0.3 * open})`);
        wedge.addColorStop(0.6, `rgba(${r},${g},${b},${0.1 * open})`);
        wedge.addColorStop(1, `rgba(${r},${g},${b},0)`);
        addLight(lit, wedge, sx, sy, reach);
      }
    }

    /** The red the escape bathes the world in, `red` of the way, swelling with the siren. */
    function renderEscapeTint(red: number, w: number, h: number): void {
      if (ctx == null || red <= 0) {
        return;
      }
      const swell = sirenSwell();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255, 34, 22, ${(0.06 + 0.05 * swell) * red})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    /**
     * The screen's own text over the world: room names, the arrows to what
     * to walk to, the hatch's sign, the E prompt, captions and chat. While the
     * run ends on screen (`ending`) only the room names stay: the lab is all
     * there is to see.
     */
    function renderScreenText(map: WorldMap, s: number, view: Viewport, ending: boolean): void {
      if (ctx == null) {
        return;
      }
      const { w, h, dpr } = view;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = 'center';
      if (ending) {
        renderRoomNames(map, s, view);
        return;
      }
      // Anything you need to walk to gets an arrow at the screen edge while
      // it is out of sight — in the dark that is the only way to find it. The
      // arrows keep off your figure, and the room names off the arrows, as
      // off the minimap.
      const figure = spectator ? null : figureOn(s, view);
      const shunned = figure === null ? view.boxes : [...view.boxes, figure.keepOut];
      const markers = edgeMarkers(map, s, { ...view, boxes: shunned });
      const arrows = markers.flatMap(({ at, captionWidth }) => markerBoxes(at, captionWidth, dpr));
      renderRoomNames(map, s, { ...view, boxes: [...view.boxes, ...arrows] });
      if (map.exit !== null && map.exit.open) {
        const [ex, ey] = worldToScreen(s, w, h, map.exit.x + 0.5, map.exit.y - 0.5);
        ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('NOTAUSGANG', ex, ey);
      }
      renderEdgeMarkers(markers, dpr);
      const prompt = renderPrompt(map, s, view, figure?.body ?? null);
      renderCaptions(s, view, prompt);
      renderChatBubbles(s, w, h, dpr);
      renderCarrying(map, view);
    }

    /**
     * Your figure on the canvas, device pixels: what it covers, from its name
     * tag over its head down to its feet (`body`), and the stretch of about a
     * tile and a half round it the edge arrows keep off (`keepOut`) — on a
     * phone held sideways the canvas is low, and an arrow would lie on you.
     */
    function figureOn(s: number, view: Viewport): { body: Box; keepOut: Box } {
      const [sx, sy] = worldToScreen(s, view.w, view.h, sim.self.x, sim.self.y);
      const half = Math.max(0.6 * s, 30 * view.dpr);
      const body = {
        left: sx - half,
        top: sy - 0.62 * s - 16 * view.dpr,
        right: sx + half,
        bottom: sy + 0.5 * s,
      };
      const r = KEEP_OUT_TILES * s;
      return { body, keepOut: { left: sx - r, top: sy - r, right: sx + r, bottom: sy + r } };
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

    /**
     * What E does here, over the thing it works on — amber where E does
     * nothing yet — and clear of your figure (`figure`), above it where there
     * is room: standing beside a station, its prompt would lie on your name.
     * Returns where it went, or null for none.
     */
    function renderPrompt(
      map: WorldMap,
      s: number,
      view: Viewport,
      figure: Box | null,
    ): Box | null {
      const { you, sourcesHere, puzzle } = viewRef.current;
      const action = lockedRef.current
        ? null
        : contextAction(map, sim.self, you.id, sourcesHere, puzzle !== null);
      if (action === null) {
        return null;
      }
      const { w, h, dpr } = view;
      const [sx, rawY] = worldToScreen(s, w, h, action.x, action.y);
      // Like the edge arrows: the prompt must stay below the objective bar.
      const text = promptText(action, !touchPad.matches);
      const box = tagBox(text, sx, Math.max(rawY, view.top + 24 * dpr), dpr);
      const ceiling = view.top + 13 * dpr;
      const at = moved(box, figure === null ? 0 : shiftClear(box, figure, TAG_AIR * dpr, ceiling));
      drawTag(text, at, action.kind === 'locked' ? '#fbbf24' : '#2dd4bf', dpr);
      return at;
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
      stopPowerHum();
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
    // An alarm strobes over the world and shakes the camera (alarm.ts, finale.css).
    <div className={alarmClass === '' ? 'world-wrap' : `world-wrap ${alarmClass}`}>
      <canvas ref={canvasRef} className={`world-canvas ${spectator ? 'world-canvas--wide' : ''}`} />
      {tip !== null && (
        // Just above the control cluster, wherever it reaches: never on the
        // avatar under the objective bar, nor on the minimap.
        <div className="coach" style={{ bottom: controlsReach + TIP_GAP }}>
          {tip.text}
        </div>
      )}
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
