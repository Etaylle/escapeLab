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
import type { CoachMark } from '../puzzles/coach.js';
import { TalkButton } from '../screens/Voice.js';
import { VoiceContext } from '../voice/useVoice.js';
import { useAlarm, useAlarmClasses, worldHornDue, type Alarm } from './alarm.js';
import { worldText } from './art.js';
import { assembleFrame, type FrameSource, type Latest } from './assemble.js';
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
import { blackoutCue, SEQUENCE_MS } from './coldOpen.js';
import { doorTurned } from './doors.js';
import { drawsFrame } from './drawRate.js';
import { useEscapeSince, useEscapeSounds } from './escape.js';
import { REDUCED_MOTION, useFinaleSounds, type FinaleCue } from './finale.js';
import { runLight } from './frameLight.js';
import { frameTrace, traceRequested, type FrameTrace } from './frameTrace.js';
import { watchInsets, type Insets } from './insets.js';
import { carriedItem, contextAction, TOUCH, type ContextAction } from './interact.js';
import { runsOf } from './light.js';
import { positionsOf, type KnownPositions } from './movement.js';
import { worldNews } from './news.js';
import { renderKit, type ChatLine, type MapPing, type WorldMap } from './render/frame.js';
import { dropLight } from './render/light.js';
import { PING_LIFETIME_MS } from './render/overlays.js';
import { drawFrame } from './render/pipeline.js';
import { roomArea, roomsComingOn } from './rooms.js';
import { easeOthers, follow, followServer, MOVE_KEYS, newSim, walk, type Sim } from './sim.js';
import { streamPositions } from './stream.js';
import { useWorldTip } from './useWorldTip.js';

/**
 * The world as one screen lives it: a canvas the lab is drawn on, frame by
 * frame, and the controls over it. This component owns the React state, the
 * refs, the input, the sounds and the frame loop — each animation frame it
 * steps the simulation (sim.ts), assembles the frame (assemble.ts) and hands
 * it to the passes (render/pipeline.ts) — and the DOM.
 */

/** A locker or cabinet opening this close (in tiles) is heard. */
const HEAR_RADIUS = 4;
/** Air between the control cluster and a first-time tip above it, CSS pixels. */
const TIP_GAP = 12;

const SOURCE_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

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

/** The latest of what the world's loop and its listeners read, as the component last rendered. */
interface Live extends Latest {
  station: PuzzleView | null;
  send: (msg: ClientMessage) => void;
  onToggleInfo: () => void;
  onRead: (manualId: string) => void;
  onOperate: () => void;
}

/** One mounted world: its canvas, its simulation, and what it reads through refs every frame. */
interface Loop extends FrameSource {
  ctx: CanvasRenderingContext2D;
  insets: Insets;
  live: React.MutableRefObject<Live>;
  pings: React.MutableRefObject<MapPing[]>;
}

/** The component's handles on its canvas, its controls, its simulation and its E and Q jobs. */
interface WorldRefs {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  controlsRef: React.MutableRefObject<HTMLDivElement | null>;
  simRef: React.MutableRefObject<Sim | null>;
  /** the E key's job, shared with the touch button; set while the render loop runs */
  interactRef: React.MutableRefObject<(() => void) | null>;
  /** the Q key's job, shared with the touch button; set while the render loop runs */
  dropRef: React.MutableRefObject<(() => void) | null>;
}

type SetWheel = React.Dispatch<React.SetStateAction<boolean>>;

/** What the world's loop is wired to in the component, read as it mounts. */
interface Wiring {
  props: Props;
  refs: WorldRefs;
  live: React.MutableRefObject<Live>;
  alarm: React.MutableRefObject<Alarm | null>;
  setWheelOpen: SetWheel;
  setControlsReach: (px: number) => void;
}

function isTextEntry(el: Element | null): boolean {
  return el !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** A ref holding `value` as of the latest render: what the loop and the listeners read. */
function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * The power hums while the lights are on; where this screen sees them fail, it hears them
 * fail with the picture (coldOpen.ts) — under reduced motion with no flicker to arc in —
 * and where it lands in the dark, the hum just ends.
 */
function usePowerHum(darkSince: number | null, live: React.MutableRefObject<Live>): void {
  useEffect(() => {
    if (darkSince === null) {
      startPowerHum();
      return;
    }
    const elapsed = Date.now() - darkSince;
    if (elapsed < SEQUENCE_MS) {
      blackoutSounds(blackoutCue(elapsed, live.current.reduced));
    } else {
      stopPowerHum();
    }
  }, [darkSince, live]);
}

/**
 * Fires the one context action. Reading and working an open station stay
 * on this client; everything else the server decides. A locked cabinet
 * only says what is missing.
 */
function tryInteract(loop: Loop): void {
  const current = loop.live.current.view;
  if (current.map === null || loop.live.current.locked) {
    return;
  }
  const action = contextAction(
    current.map,
    loop.sim.self,
    current.you.id,
    current.sourcesHere,
    current.puzzle !== null,
  );
  if (action === null || action.kind === 'locked') {
    return;
  }
  if (action.kind === 'open') {
    loop.live.current.send({ kind: 'open-source', manualId: action.manualId });
    return;
  }
  stationChirp();
  workOn(loop, action, current);
}

/** E at a source that is open, or at the armed station: read it, work it, or ask the server. */
function workOn(loop: Loop, action: ContextAction, current: PlayerView): void {
  if (action.kind === 'read') {
    loop.live.current.onRead(action.manualId);
    return;
  }
  if (action.kind === 'operate') {
    loop.live.current.onOperate();
    if (current.puzzle !== null) {
      return;
    }
  }
  loop.live.current.send({ kind: 'interact' });
}

/** Puts down what this player carries, where they stand; the server knows what that is. */
function dropItem(loop: Loop): void {
  if (!loop.live.current.locked) {
    loop.live.current.send({ kind: 'drop-item' });
  }
}

/** What a key does once a press, not on its auto-repeat. */
type KeyJob = (loop: Loop, e: KeyboardEvent, setWheelOpen: SetWheel) => void;

const interactKey: KeyJob = (loop, e) => {
  e.preventDefault();
  tryInteract(loop);
};
const dropKey: KeyJob = (loop, e) => {
  e.preventDefault();
  dropItem(loop);
};
const minimapKey: KeyJob = (loop) => {
  loop.sim.minimap = !loop.sim.minimap;
};
const chatKey: KeyJob = (_, e, setWheelOpen) => {
  e.preventDefault();
  setWheelOpen((open) => !open);
};
const infoKey: KeyJob = (loop, e) => {
  e.preventDefault();
  loop.live.current.onToggleInfo();
};
/** The keys that work the world once a press, lower-cased: E, Q, M, C and I. */
const KEY_JOBS = new Map<string, KeyJob>([
  ['e', interactKey],
  ['enter', interactKey],
  [' ', interactKey],
  ['q', dropKey],
  ['m', minimapKey],
  ['c', chatKey],
  ['i', infoKey],
  ['h', infoKey],
  ['?', infoKey],
]);

function onKeyDown(loop: Loop, e: KeyboardEvent, setWheelOpen: SetWheel): void {
  if (isTextEntry(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) {
    return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  pressKey(loop, key, e, setWheelOpen);
}

/** A key going down: a step held, a job done once, the chat wheel shut or a phrase said. */
function pressKey(loop: Loop, key: string, e: KeyboardEvent, setWheelOpen: SetWheel): void {
  const job = KEY_JOBS.get(key);
  if (key in MOVE_KEYS) {
    e.preventDefault();
    if (!loop.live.current.locked) {
      loop.sim.keys.add(key);
    }
  } else if (job !== undefined) {
    if (!e.repeat) {
      job(loop, e, setWheelOpen);
    }
  } else if (key === 'escape') {
    setWheelOpen(false);
  } else if (/^[1-8]$/.test(key)) {
    const phrase = CHAT_PHRASE_IDS[Number(key) - 1];
    if (phrase !== undefined) {
      e.preventDefault();
      loop.live.current.send({ kind: 'chat', phrase });
      setWheelOpen(false);
    }
  }
}

/** Click anywhere in the world to ping that spot for the whole crew. */
function onPointerDown(loop: Loop, e: PointerEvent): void {
  const { canvas, sim } = loop;
  if (loop.live.current.view.map === null) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const s = sim.scale;
  const dpr = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;
  const wx = sim.draw.x + (px - canvas.width / 2) / s;
  const wy = sim.draw.y + (py - canvas.height / 2) / s;
  loop.live.current.send({
    kind: 'ping',
    x: Math.round(wx * 100) / 100,
    y: Math.round(wy * 100) / 100,
  });
}

/** The keyboard and the pointer drive the world; returns what takes them off again. */
function listen(loop: Loop, setWheelOpen: SetWheel): () => void {
  const { canvas, sim } = loop;
  const keyDown = (e: KeyboardEvent): void => onKeyDown(loop, e, setWheelOpen);
  const pointerDown = (e: PointerEvent): void => onPointerDown(loop, e);
  const keyUp = (e: KeyboardEvent): void => {
    sim.keys.delete(e.key.toLowerCase());
  };
  const blur = (): void => {
    sim.keys.clear();
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  canvas.addEventListener('pointerdown', pointerDown);
  return () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
  };
}

/** `?trace=1`: the walkthrough reads the last frame durations off the page, and the camera. */
function traceFrames(sim: Sim): { trace: FrameTrace; drop: () => void } | null {
  if (!traceRequested(location.search)) {
    return null;
  }
  const trace = frameTrace();
  const drop = addProbes({
    get frames() {
      return trace.frames;
    },
    resetFrames: () => trace.resetFrames(),
    get camera() {
      return { x: sim.draw.x, y: sim.draw.y, scale: sim.scale };
    },
  });
  return { trace, drop };
}

/**
 * The frame loop: the simulation runs on every animation frame; the canvas
 * is redrawn less under a panel (drawRate.ts). Returns what stops it.
 */
function runFrames(loop: Loop, trace: FrameTrace | null): () => void {
  let raf = 0;
  let prev = performance.now();
  /** Animation frames since the loop started: under a panel only some are drawn. */
  let frames = 0;
  const frame = (now: number): void => {
    trace?.record(now - prev);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    frames += 1;
    const map = loop.live.current.view.map;
    if (map !== null) {
      step(loop, dt, map);
      if (drawsFrame(frames, { locked: loop.live.current.locked, spectator: loop.spectator })) {
        render(loop, map);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** One frame of the simulation: you, the crew, the doors, the news, the clock, the camera. */
function step(loop: Loop, dt: number, map: WorldMap): void {
  const { sim, spectator } = loop;
  const view = loop.live.current.view;
  // Spectators own no avatar, so every streamed position is "someone else".
  const youId = spectator ? '' : view.you.id;
  const run = view.startedAt;
  if (spectator) {
    sim.cam.x = map.width / 2;
    sim.cam.y = map.height / 2;
  } else {
    followServer(sim, loop.positions.current, map, youId, run);
  }
  if (walk(sim, map, dt, loop.live.current.locked)) {
    footstep();
  }
  easeOthers(sim, positionsOf(loop.positions.current, run), youId, dt);
  slideDoors(sim, map);
  if (map !== sim.seen) {
    look(loop, map);
  }
  lightWhenClear(loop, map);
  hearTheClock(loop, map);
  // camera: follow your avatar, or sit still over the whole lab; a radio
  // line growing the objective bar moves it as gently
  if (!spectator) {
    follow(sim, dt, loop.insets.top);
  }
  sim.time += dt;
}

/** A door the view turned slides open or shut, with the hiss (doors.ts). */
function slideDoors(sim: Sim, map: WorldMap): void {
  const now = Date.now();
  for (const door of map.doors) {
    const { motion, moved } = doorTurned(sim.doors.get(door.id), door.open, now);
    sim.doors.set(door.id, motion);
    if (moved) {
      doorSlide();
    }
  }
}

/**
 * The lab getting louder as the clock runs out, the last ten seconds
 * counted out loud; and an emergency's siren as it starts, a chirp as it
 * is over.
 */
function hearTheClock(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  const view = loop.live.current.view;
  const deadline = view.deadlineAt;
  if (deadline !== null && !loop.spectator) {
    const left = (deadline - Date.now()) / 1000;
    const budget = Math.max(1, view.timeLimitSec);
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
function look(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
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
    if (loop.spectator || away <= HEAR_RADIUS) {
      (manual.kind === 'cabinet' ? cabinetUnlock : lockerOpen)();
    }
  }
  const known = new Set(sim.lit.keys());
  const lit = roomsComingOn(map.litRooms, known, news.lit, sim.pendingLit, covered(loop));
  for (const room of lit.long) {
    lightRoom(loop, map, room, -Infinity);
  }
  sim.pendingLit = lit.waiting;
  warmUpRooms(loop, map, lit.now);
}

/** Whether something lies over the world on this screen: a panel, pages, the pause. */
function covered(loop: Loop): boolean {
  return !loop.spectator && loop.live.current.locked;
}

/** The rooms that waited behind a panel or pages come on once nothing lies over the world. */
function lightWhenClear(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  if (sim.pendingLit.length > 0) {
    const lit = roomsComingOn([], new Set(), [], sim.pendingLit, covered(loop));
    sim.pendingLit = lit.waiting;
    warmUpRooms(loop, map, lit.now);
  }
}

/** Rooms coming on now: the relay's click, and their lights warming up from this moment. */
function warmUpRooms(loop: Loop, map: WorldMap, rooms: readonly string[]): void {
  if (rooms.length === 0) {
    return;
  }
  for (const room of rooms) {
    lightRoom(loop, map, room, loop.sim.time);
  }
  lightsOnClick();
}

/**
 * The lights of `room` are on, since `since` (sim time): its tiles, as a
 * set and as a path of their rows — and seen, whatever lies there, from
 * now on this run.
 */
function lightRoom(loop: Loop, map: WorldMap, room: string, since: number): void {
  const { sim } = loop;
  const tiles = map.labels.filter((l) => l.text === room).flatMap((l) => roomArea(map, l));
  const keys = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  const path = new Path2D();
  for (const run of runsOf(keys)) {
    path.rect(run.x, run.y, run.length, 1);
  }
  const { seen } = runLight(sim, loop.live.current.view.startedAt);
  for (const key of keys) {
    sim.litTiles.add(key);
    seen.add(key);
  }
  sim.lit.set(room, { tiles, path, since });
}

/** The pings still showing at `perf`; one this screen has not shown yet blips. */
function livePings(loop: Loop, perf: number): MapPing[] {
  const pings = loop.pings;
  const live = pings.current.filter((p) => perf - p.at < PING_LIFETIME_MS);
  if (live.length !== pings.current.length) {
    pings.current = live;
  }
  for (const ping of live) {
    if (!loop.sim.seenPings.has(ping)) {
      loop.sim.seenPings.add(ping);
      pingBlip();
    }
  }
  return live;
}

/** Sizes the canvas to its box at this screen's density, assembles the frame and draws it. */
function render(loop: Loop, map: WorldMap): void {
  const { canvas, kit } = loop;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    kit.overlay.canvas.width = canvas.width;
    kit.overlay.canvas.height = canvas.height;
  }
  const perf = performance.now();
  drawFrame(loop.ctx, assembleFrame(loop, map, dpr, perf, livePings(loop, perf)));
}

/**
 * The world's life from mount to unmount: the canvas and its kit, the
 * simulation, the listeners, the position stream and the frame loop.
 */
function useWorldLoop({ props, refs, live, alarm, setWheelOpen, setControlsReach }: Wiring): void {
  useEffect(() => {
    const canvas = refs.canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const octx = document.createElement('canvas').getContext('2d');
    if (octx == null) {
      return undefined;
    }
    const kit = renderKit(octx);
    const touchPad = window.matchMedia(TOUCH);
    const insets = watchInsets(canvas, refs.controlsRef.current, setControlsReach);
    const sim = newSim(insets.top);
    refs.simRef.current = sim;
    startAmbience();
    const loop: Loop = {
      canvas,
      ctx,
      kit,
      sim,
      spectator: props.spectator,
      touchPad,
      insets,
      live,
      alarm,
      positions: props.positionsRef,
      drones: props.dronesRef,
      pings: props.pingsRef,
      chats: props.chatsRef,
      clips: new WeakMap(),
      texts: { s: 0, dpr: 0, styles: worldText(48, 1) },
    };
    refs.interactRef.current = () => tryInteract(loop);
    refs.dropRef.current = () => dropItem(loop);
    // An audience connection watches only: no controls, no position stream.
    const unlisten = props.spectator ? null : listen(loop, setWheelOpen);
    const posTimer = streamPositions(sim, props.spectator, (msg) => live.current.send(msg));
    const traced = traceFrames(sim);
    const stop = runFrames(loop, traced?.trace ?? null);
    return () => {
      stop();
      clearInterval(posTimer);
      insets.disconnect();
      unlisten?.();
      stopAmbience();
      stopPowerHum();
      traced?.drop();
      dropLight(kit);
      refs.simRef.current = null;
      refs.interactRef.current = null;
      refs.dropRef.current = null;
    };
    // The loop reads everything through refs; mount/unmount is the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface ControlsProps {
  refs: WorldRefs;
  live: React.MutableRefObject<Live>;
  view: PlayerView;
  wheelOpen: boolean;
  setWheelOpen: SetWheel;
}

/** The control cluster over the world: the pad, the action buttons, chat and talk. */
function WorldControls({ refs, live, view, wheelOpen, setWheelOpen }: ControlsProps) {
  /** what this player carries now; while there is something, a touch screen offers to drop it */
  const load = view.map === null ? undefined : carriedItem(view.map, view.you.id);
  const press = (key: string, down: boolean): void => {
    const sim = refs.simRef.current;
    if (sim === null) {
      return;
    }
    if (down && !live.current.locked) {
      sim.keys.add(key);
    } else {
      sim.keys.delete(key);
    }
  };
  return (
    <div className="world-controls" ref={refs.controlsRef}>
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
            onClick={() => refs.dropRef.current?.()}
          >
            📦
          </button>
        )}
        <button
          className="world-interact"
          aria-label="Benutzen"
          onClick={() => refs.interactRef.current?.()}
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
  );
}

/** The quick-chat phrases, one button each, with the digit that says it. */
function ChatWheel({ send, setWheelOpen }: { send: Props['send']; setWheelOpen: SetWheel }) {
  const say = (phrase: ChatPhrase): void => {
    send({ kind: 'chat', phrase });
    setWheelOpen(false);
  };
  return (
    <div className="chat-wheel" role="menu">
      {CHAT_PHRASE_IDS.map((phrase, i) => (
        <button key={phrase} role="menuitem" onClick={() => say(phrase)}>
          <span className="chat-key">{i + 1}</span>
          {chatText(phrase)}
        </button>
      ))}
    </div>
  );
}

/** What the world's DOM shows of its state: the tip, the alarm's classes, the chat wheel. */
interface WorldState {
  refs: WorldRefs;
  live: React.MutableRefObject<Live>;
  tip: CoachMark | null;
  alarmClass: string;
  wheelOpen: boolean;
  setWheelOpen: SetWheel;
  /** how far the control cluster reaches up from the world's bottom edge, CSS pixels */
  controlsReach: number;
}

/**
 * The world's state, refs and sounds, and its loop wired to them: everything
 * GameWorld renders from, in the order React keeps the hooks.
 */
function useWorld(props: Props): WorldState {
  const { view, spectator, darkSince, inputLocked, holdTips } = props;
  const finale = props.finale ?? null;
  const station = props.station ?? null;
  const [wheelOpen, setWheelOpen] = useState(false);
  const [controlsReach, setControlsReach] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const interactRef = useRef<(() => void) | null>(null);
  const dropRef = useRef<(() => void) | null>(null);
  const voice = useContext(VoiceContext);
  const reduced = useMedia(REDUCED_MOTION);
  // The escape (escape.ts) and the ending (finale.ts), as this screen lives them.
  const escapeSince = useEscapeSince(view.map?.exit ?? null, view.startedAt);
  const live = useLatest<Live>({
    view,
    darkSince,
    locked: inputLocked,
    station,
    finale,
    escapeSince,
    reduced,
    voice,
    send: props.send,
    onToggleInfo: props.onToggleInfo,
    onRead: props.onRead,
    onOperate: props.onOperate,
  });
  useEffect(() => {
    if (live.current.locked) {
      simRef.current?.keys.clear();
    }
  }, [inputLocked, live]);
  const tip = useWorldTip(view, station, spectator, holdTips, finale);
  usePowerHum(darkSince, live);
  // The world answers an alarm (alarm.ts): the klaxon while the run goes on — the alarm that
  // ends it has the ending's own sound, and an open device sounds its own horn instead — the
  // strobe and the shake, the drones' marks.
  const alarm = useAlarm(view.penaltySeq, () => {
    if (worldHornDue(live.current.view.phase, live.current.station != null)) {
      klaxon();
    }
  });
  const alarmRef = useLatest(alarm);
  const alarmClass = useAlarmClasses(alarm, reduced);
  useEscapeSounds(escapeSince, view.phase === 'playing' && finale === null);
  useFinaleSounds(finale);
  const refs = { canvasRef, controlsRef, simRef, interactRef, dropRef };
  useWorldLoop({ props, refs, live, alarm: alarmRef, setWheelOpen, setControlsReach });
  return { refs, live, tip, alarmClass, wheelOpen, setWheelOpen, controlsReach };
}

export function GameWorld(props: Props) {
  const { spectator } = props;
  const { refs, live, tip, alarmClass, wheelOpen, setWheelOpen, controlsReach } = useWorld(props);
  return (
    // An alarm strobes over the world and shakes the camera (alarm.ts, finale.css).
    <div className={alarmClass === '' ? 'world-wrap' : `world-wrap ${alarmClass}`}>
      <canvas
        ref={refs.canvasRef}
        className={`world-canvas ${spectator ? 'world-canvas--wide' : ''}`}
      />
      {tip !== null && (
        // Just above the control cluster, wherever it reaches: never on the
        // avatar under the objective bar, nor on the minimap.
        <div className="coach" style={{ bottom: controlsReach + TIP_GAP }}>
          {tip.text}
        </div>
      )}
      {!spectator && (
        <WorldControls
          refs={refs}
          live={live}
          view={props.view}
          wheelOpen={wheelOpen}
          setWheelOpen={setWheelOpen}
        />
      )}
      {wheelOpen && <ChatWheel send={props.send} setWheelOpen={setWheelOpen} />}
    </div>
  );
}
