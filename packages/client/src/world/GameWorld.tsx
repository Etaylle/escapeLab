import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClientMessage, DronePosition, PlayerView, PuzzleView } from '@escapelab/core';
import { beepDue, clock, clockTime, serverAt, timeLeft } from '../clock.js';
import { useServerNow } from '../hooks.js';
import { actionOfKey, isHeld, type Held, type InputAction } from '../input/bindings.js';
import { useGlyph } from '../input/glyphs.js';
import { HeldKeys, watchBindings } from '../input/heldKeys.js';
import { NO_STEER } from '../input/pad.js';
import { onPadPing, padSteer } from '../input/padRuntime.js';
import { addProbes, type MinimapProbe } from '../probes.js';
import type { CoachMark } from '../puzzles/coach.js';
import { TalkButton } from '../screens/Voice.js';
import { getSettings, TEXT_SCALE, useReducedMotion, useSettings } from '../settings.js';
import { VoiceContext } from '../voice/useVoice.js';
import type { Connection } from '../ws.js';
import {
  emergencyCleared,
  useAlarm,
  useAlarmClasses,
  worldHornDue,
  type Alarm,
} from './alarm.js';
import { bedCount, bedProbe, hearRooms, startAmbience, stopAmbience } from './ambience.js';
import { worldText } from './art.js';
import { dressedFor } from './artKit.js';
import { assembleFrame, type FrameSource, type Latest } from './assemble.js';
import {
  blackoutSounds,
  cabinetUnlock,
  countdownBeep,
  emergencyOver,
  footstep,
  graphCensus,
  klaxon,
  lightsOnClick,
  lockerOpen,
  partSeated,
  pingBlip,
  sheetDown,
  powerDrain,
  startPowerHum,
  stopPowerHum,
  systemsOff,
  timed,
  timeSpent,
  wallBump,
  type SoundSystem,
} from './audio.js';
import { ChatWheel, PHRASES, pressDigit, type Wheel, type WheelMove } from './ChatWheel.js';
import { useClusterWake } from './cluster.js';
import { blackoutCue, FLICKER_MS, REVEAL_MS, SEQUENCE_MS } from './coldOpen.js';
import { senseDanger, stopDanger } from './danger.js';
import { doorTurned } from './doors.js';
import { drawsFrame } from './drawRate.js';
import { escaping, useEscapeSince, useEscapeSounds } from './escape.js';
import { answerDiscoveries, firstLook } from './finds.js';
import { useFinaleSounds, type FinaleCue } from './finale.js';
import { runLight } from './frameLight.js';
import { frameTrace, traceRequested, type FrameTrace } from './frameTrace.js';
import { watchInsets, type Insets } from './insets.js';
import { carriedItem, TOUCH } from './interact.js';
import { PAD_CELLS, PadSteer, type PadTouch } from './touchPad.js';
import { hearAnswer, pressE, pressWhenInReach, type PressWorld } from './press.js';
import { filmed, type IntroCue } from './intro/sequence.js';
import { runsOf } from './light.js';
import { positionsOf, type KnownPositions, type Spot } from './movement.js';
import { MUSIC_AFTER_CLICK_MS, musicProbe, setTension, stopMusic, type Tension } from './music.js';
import { worldNews } from './news.js';
import { pingAhead } from './padPing.js';
import { renderRadio, voiceProbe } from './radioVoice.js';
import { preloadSamples } from './samples.js';
import { fitBacking } from './render/backing.js';
import {
  profiled,
  renderKit,
  type ChatLine,
  type Frame,
  type MapPing,
  type RenderKit,
  type WorldMap,
} from './render/frame.js';
import { censusTrace, type CensusTrace } from './render/census.js';
import { graphicsProbe } from './render/graphicsProbe.js';
import { highlightProbe } from './render/highlight.js';
import { labelsShown } from './render/labels.js';
import { minimapGoal, minimapLayout } from './render/hud.js';
import { dropLight } from './render/light.js';
import { PING_LIFETIME_MS } from './render/overlays.js';
import { drawFrame } from './render/pipeline.js';
import { passProfile, profileRequested } from './render/profile.js';
import { noteLabels } from './labelFade.js';
import { lightsHeld, roomArea, roomsComingOn } from './rooms.js';
import {
  follow,
  followOthers,
  followServer,
  newSim,
  walk,
  type Sim,
} from './sim.js';
import { doorMoved, HEAR_EVERY_S, hearCrew, spatialProbe, stopSpatial } from './spatial.js';
import { soundProbe } from './soundProbe.js';
import { streamPositions } from './stream.js';
import { REMOTE_DELAY_MS } from './trail.js';
import { useWorldTip } from './useWorldTip.js';
import { vignettePressure } from './vignette.js';

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
  /** the run's opening on this screen (intro/sequence.ts); none where it plays none */
  intro?: IntroCue | null;
  /**
   * the station whose panel lies over the world; none by default. While it is up the world's
   * tips wait — the device's own line is in its frame — and an alarm sounds the device's horn,
   * not the world's
   */
  station?: PuzzleView | null;
  /** first-time tips wait while the objective bar carries a notice, so the two never stack */
  holdTips: boolean;
  /** a menu stands over the world (menuLayer.ts): the keys are the menu's, the world hears none */
  menuOver?: boolean;
  /** opens the info panel, which owns the briefing and the key list */
  onToggleInfo: () => void;
  /** E at a manual object the server counts this player at: reading needs no message */
  onRead: (manualId: string) => void;
  /** E at a note of the last shift the server counts this player at: its slip comes up */
  onReadNote: (index: number) => void;
  /** E at the armed station: show its panel once it is open */
  onOperate: () => void;
  send: (msg: ClientMessage) => void;
  /** hears the server as it speaks (ws.ts): E's answers; none for the audience, who press none */
  listen?: Connection['listen'];
}

/** The latest of what the world's loop and its listeners read, as the component last rendered. */
interface Live extends Latest {
  station: PuzzleView | null;
  /** a menu stands over the world: it hears no key (`worldHears`) */
  menuOver: boolean;
  /** where the quick chat's wheel stands: what the digits say (ChatWheel.tsx) */
  wheel: Wheel;
  send: (msg: ClientMessage) => void;
  onToggleInfo: () => void;
  onRead: (manualId: string) => void;
  onReadNote: (index: number) => void;
  onOperate: () => void;
}

/** One mounted world: its canvas, its simulation, and what it reads through refs every frame. */
interface Loop extends FrameSource {
  ctx: CanvasRenderingContext2D;
  insets: Insets;
  live: React.MutableRefObject<Live>;
  pings: React.MutableRefObject<MapPing[]>;
  /** the sound systems this page's query switched off (`?audio-off=`) */
  soundOff: ReadonlySet<SoundSystem>;
  /** the frame drawn last, for the walkthrough's probe of the glow; null before the first */
  drawn: Frame | null;
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

type SetWheel = React.Dispatch<React.SetStateAction<Wheel>>;

/** The chat wheel's toggle: open on its phrases where it was shut, shut from either step. */
const toggled = (wheel: Wheel): Wheel => (wheel === null ? PHRASES : null);

/** A press in the chat wheel carried out: the phrase it says goes out, the wheel moves on. */
function moveWheel(send: Props['send'], setWheel: SetWheel, move: WheelMove): void {
  if (move.said !== null) {
    send({ kind: 'chat', ...move.said });
  }
  setWheel(move.wheel);
}

/** What the world's loop is wired to in the component, read as it mounts. */
interface Wiring {
  props: Props;
  refs: WorldRefs;
  live: React.MutableRefObject<Live>;
  alarm: React.MutableRefObject<Alarm | null>;
  setWheel: SetWheel;
  setControlsReach: (px: number) => void;
}

function isTextEntry(el: Element | null): boolean {
  return el !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Whether the run's opening holds this screen's avatar now (intro/sequence.ts `filmed`): it
 * walks nowhere, works nothing and sends no position.
 */
function heldBack(live: Latest): boolean {
  return live.intro !== null && filmed(live.intro, Date.now());
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

/** E's part of the world (press.ts) as the loop has it now. */
function pressWorld(loop: Loop): PressWorld {
  const live = loop.live.current;
  return {
    view: live.view,
    sim: loop.sim,
    shut: live.locked || heldBack(live),
    send: live.send,
    onRead: live.onRead,
    onReadNote: live.onReadNote,
    onOperate: live.onOperate,
  };
}

/** E pressed on this screen (press.ts `pressE`). */
function tryInteract(loop: Loop): void {
  pressE(pressWorld(loop), performance.now());
}

/** Puts down what this player carries, where they stand; the server knows what that is. */
function dropItem(loop: Loop): void {
  if (!loop.live.current.locked && !heldBack(loop.live.current)) {
    loop.live.current.send({ kind: 'drop-item' });
  }
}

/** What a key does once a press, not on its auto-repeat. */
type KeyJob = (loop: Loop, setWheel: SetWheel) => void;

const interactKey: KeyJob = (loop) => tryInteract(loop);
const dropKey: KeyJob = (loop) => dropItem(loop);
const minimapKey: KeyJob = (loop) => {
  loop.sim.minimap = !loop.sim.minimap;
};
const chatKey: KeyJob = (_, setWheel) => setWheel(toggled);
const infoKey: KeyJob = (loop) => loop.live.current.onToggleInfo();
/**
 * The actions that work the world once a press, by whatever key the settings bind them to
 * (input/bindings.ts): the notepad is the game screen's, talking the voice's.
 */
const KEY_JOBS: Partial<Record<InputAction, KeyJob>> = {
  interact: interactKey,
  drop: dropKey,
  minimap: minimapKey,
  chat: chatKey,
  info: infoKey,
};

/**
 * Whether the world hears a key going down: not while a menu stands over it — under the settings
 * or the booklet over a run's menu the keys would reach it otherwise, for no menu's own catch
 * holds them there — nor into a text field, nor with a modifier the browser owns.
 */
export function worldHears(
  menuOver: boolean,
  typing: boolean,
  e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return !menuOver && !typing && !e.altKey && !e.ctrlKey && !e.metaKey;
}

/**
 * A key going down in the world. While the chat wheel stands on a slot's second step, the
 * digits are its, whatever else they are bound to.
 */
function onKeyDown(loop: Loop, e: KeyboardEvent, setWheel: SetWheel, held: HeldKeys): void {
  if (!worldHears(loop.live.current.menuOver, isTextEntry(document.activeElement), e)) {
    return;
  }
  const key = e.key.toLowerCase();
  const onSlot = (loop.live.current.wheel?.slotOf ?? null) !== null;
  if (onSlot && pressChatDigit(loop, key, e, setWheel)) {
    return;
  }
  const action = actionOfKey(getSettings().keys, key);
  if (action !== null && isHeld(action)) {
    holdKey(loop, action, e, held);
  } else {
    pressKey(loop, key, action, e, setWheel);
  }
}

/**
 * A step or the sprint held down, where the world takes it: held until the key that went down
 * comes up again, found by where it sits whatever its name has become meanwhile (`HeldKeys`).
 */
function holdKey(loop: Loop, action: Held, e: KeyboardEvent, held: HeldKeys): void {
  e.preventDefault();
  if (!loop.live.current.locked && !heldBack(loop.live.current)) {
    loop.sim.keys.add(action);
    held.press(e, action);
  }
}

/**
 * A key going down, as the settings bind it: a job done once — the key the game's even on its
 * auto-repeat, so that F5 bound to the minimap reloads nothing —, the chat wheel shut or a
 * phrase said.
 */
function pressKey(
  loop: Loop,
  key: string,
  action: InputAction | null,
  e: KeyboardEvent,
  setWheel: SetWheel,
): void {
  const job = action === null ? undefined : KEY_JOBS[action];
  if (job !== undefined) {
    e.preventDefault();
    if (!e.repeat) {
      job(loop, setWheel);
    }
  } else {
    pressChatDigit(loop, key, e, setWheel);
  }
}

/**
 * Esc over the open chat wheel, as the page hears it while the wheel stands open — capturing:
 * the wheel shuts, and the key goes no further, so that the Esc that shut it opens nothing else,
 * not the run's menu (screens/Game.tsx `escapeStep`). With a menu over the world (`menuOver`) the
 * Esc is the menu's, and the wheel under it stays as it is.
 */
export function wheelEscape(
  setWheel: SetWheel,
  menuOver: () => boolean,
): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key === 'Escape' && !menuOver()) {
      e.stopPropagation();
      setWheel(null);
    }
  };
}

/**
 * While the chat wheel stands open (`open`), Esc shuts it alone (`wheelEscape`) — but under a menu
 * (`live`'s `menuOver`): taken from the frame the wheel comes in, before it is painted, so that no
 * Esc pressed as it shows goes past it.
 */
function useWheelEscape(
  open: boolean,
  setWheel: SetWheel,
  live: { readonly current: Pick<Live, 'menuOver'> },
): void {
  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = wheelEscape(setWheel, () => live.current.menuOver);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setWheel, live]);
}

/**
 * A digit in the chat wheel (ChatWheel.tsx `pressDigit`): 1–8 say a phrase, or open the slot of
 * one that has one, where 1–9 fill it. Whether the wheel took the key.
 */
function pressChatDigit(loop: Loop, key: string, e: KeyboardEvent, setWheel: SetWheel): boolean {
  const live = loop.live.current;
  const digit = /^[1-9]$/.test(key) ? Number(key) : null;
  const move = digit === null ? null : pressDigit(live.view.chat, live.wheel, digit, e.repeat);
  if (move === null) {
    return false;
  }
  e.preventDefault();
  moveWheel(live.send, setWheel, move);
  return true;
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

/** The D-pad's ◀: a ping for the whole crew on the floor the avatar's lamp points at. */
function padPing(loop: Loop): void {
  const map = loop.live.current.view.map;
  if (map !== null) {
    loop.live.current.send({ kind: 'ping', ...pingAhead(map, loop.sim.self) });
  }
}

/** The keyboard and the pointer drive the world; returns what takes them off again. */
function listen(loop: Loop, setWheel: SetWheel): () => void {
  const { canvas, sim } = loop;
  const held = new HeldKeys();
  // A key bound anew takes over at once: whatever the old keys held is let go.
  const stopBindings = watchBindings(() => {
    held.clear();
    sim.keys.clear();
  });
  const keyDown = (e: KeyboardEvent): void => onKeyDown(loop, e, setWheel, held);
  const pointerDown = (e: PointerEvent): void => onPointerDown(loop, e);
  const keyUp = (e: KeyboardEvent): void => {
    const freed = held.release(e);
    if (freed !== null) {
      sim.keys.delete(freed);
    }
  };
  const blur = (): void => {
    held.clear();
    sim.keys.clear();
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  canvas.addEventListener('pointerdown', pointerDown);
  return () => {
    stopBindings();
    canvas.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
  };
}

/**
 * Where the minimap lies on the canvas and the goal it points at, device pixels, as the frame
 * draws them (render/hud.ts); null while it is off or no map is up.
 */
function minimapOf(loop: Loop): MinimapProbe | null {
  const { canvas, sim, insets } = loop;
  const view = loop.live.current.view;
  if (view.map === null || !sim.minimap || canvas.clientWidth === 0) {
    return null;
  }
  const dpr = canvas.width / canvas.clientWidth;
  const layout = minimapLayout(view.map, canvas.width, canvas.height, dpr, insets);
  return { ...layout, dpr, goal: minimapGoal(view.map, view.you.id) };
}

/**
 * `?trace=1`: the walkthrough reads the last frame durations off the page, the camera, your
 * avatar's footfalls, the minimap and its goal, the glow round what the E prompt names, the
 * names drawn under things (render/labels.ts `labelsShown`), what
 * the lab sounds like — the beds, the music, the radio's voice, the partner's place — and the
 * server's clock as the page reads it; and it can render the radio's chain offline.
 */
function traceFrames(loop: Loop): Traced | null {
  if (!traceRequested(location.search)) {
    return null;
  }
  const { sim } = loop;
  const trace = frameTrace();
  const work = censusTrace();
  const drop = addProbes({
    get frames() {
      return trace.frames;
    },
    resetFrames: () => trace.resetFrames(),
    get lightWork() {
      return work.work;
    },
    resetLightWork: () => work.reset(),
    get camera() {
      return { x: sim.draw.x, y: sim.draw.y, scale: sim.scale, lead: { ...sim.lead } };
    },
    get self() {
      return { x: sim.self.x, y: sim.self.y };
    },
    get others() {
      const drawn: Record<string, { x: number; y: number }> = {};
      for (const [id, other] of sim.others) {
        drawn[id] = { x: other.rx, y: other.ry };
      }
      return drawn;
    },
    get footfalls() {
      return sim.footfalls;
    },
    get bumps() {
      return sim.bumps;
    },
    get minimap() {
      return minimapOf(loop);
    },
    get highlight() {
      return loop.drawn === null ? null : highlightProbe(loop.drawn);
    },
    get labels() {
      return loop.drawn === null ? [] : labelsShown(loop.drawn);
    },
    get audio() {
      const sound = { music: musicProbe(), voice: voiceProbe(), spatial: spatialProbe() };
      const nodes = { ...graphCensus(), beds: bedCount() };
      const probe = { ...bedProbe(), ...sound, nodes, spent: timeSpent(), renderRadio };
      return { ...probe, ...soundProbe(), finds: sim.ear.heard };
    },
    get clock() {
      const serverNow = clock.now();
      return {
        offset: clock.offset(),
        serverNow,
        left: timeLeft(loop.live.current.view, serverNow),
      };
    },
  });
  return { trace, work, drop };
}

/** What `?trace=1` keeps of the frame loop: the frame durations, the light's census. */
interface Traced {
  trace: FrameTrace;
  /** the sights and bakes each drawn frame worked out (render/census.ts) */
  work: CensusTrace;
  drop: () => void;
}

/**
 * The frame loop: the simulation runs on every animation frame; the canvas
 * is redrawn less under a panel (drawRate.ts). Returns what stops it.
 */
function runFrames(loop: Loop, traced: Traced | null): () => void {
  let raf = 0;
  let prev = performance.now();
  /** Animation frames since the loop started: under a panel only some are drawn. */
  let frames = 0;
  const frame = (now: number): void => {
    traced?.trace.record(now - prev);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    frames += 1;
    const map = loop.live.current.view.map;
    if (map !== null) {
      step(loop, dt, now, map);
      if (drawsFrame(frames, { locked: loop.live.current.locked, spectator: loop.spectator })) {
        render(loop, map);
        traced?.work.record(loop.kit.census);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/**
 * One frame of the simulation at `now` (the frame's timestamp, performance.now): you, the
 * crew, the doors, the news, the clock, the camera.
 */
function step(loop: Loop, dt: number, now: number, map: WorldMap): void {
  const { sim, spectator } = loop;
  const view = loop.live.current.view;
  // Spectators own no avatar, so every streamed position is "someone else".
  const youId = spectator ? '' : view.you.id;
  const run = view.startedAt;
  if (spectator) {
    sim.cam.x = map.width / 2;
    sim.cam.y = map.height / 2;
    // The audience steers nothing.
    sim.pad = NO_STEER;
  } else {
    followServer(sim, loop.positions.current, map, youId, run);
    // A controller steers as the keys do (input/padRuntime.ts).
    sim.pad = padSteer();
  }
  // The opening holds the avatar where the run put it: no step, no position going out.
  sim.held = heldBack(loop.live.current);
  if (sim.held) {
    sim.keys.clear();
  }
  const sound = walk(sim, map, dt, loop.live.current.locked || sim.held);
  sim.selfAt = now;
  if (!spectator) {
    pressWhenInReach(pressWorld(loop), performance.now());
  }
  if (sound === 'bump') {
    wallBump();
  } else if (sound !== null) {
    footstep(sound === 'sprint');
  }
  // The crew REMOTE_DELAY_MS in the past, where their samples put them (trail.ts).
  const drawnAt = serverAt(now) - REMOTE_DELAY_MS;
  followOthers(sim, positionsOf(loop.positions.current, run), youId, drawnAt);
  slideDoors(sim, map, spectator ? null : sim.self);
  if (map !== sim.seen) {
    look(loop, map);
  }
  lightWhenClear(loop, map);
  hearTheClock(loop, map);
  // camera: follow your avatar, a little ahead of it as it walks, or sit still
  // over the whole lab; a radio line growing the objective bar moves it as gently
  if (!spectator) {
    follow(sim, dt, loop.insets.top, loop.live.current.reduced);
  }
  sim.time += dt;
}

/**
 * A door the view turned slides open or shut (doors.ts), heard from where it is by the player at
 * `listener` — the audience, standing nowhere, hears it unplaced (spatial.ts `doorMoved`).
 */
function slideDoors(sim: Sim, map: WorldMap, listener: Spot | null): void {
  const now = Date.now();
  for (const door of map.doors) {
    const { motion, moved } = doorTurned(sim.doors.get(door.id), door.open, now);
    sim.doors.set(door.id, motion);
    if (moved) {
      doorMoved(map, listener, door);
    }
  }
}

/** How often the lab is listened to, ms: the beds, the crew and the music move no oftener. */
const HEAR_MS = HEAR_EVERY_S * 1000;

/**
 * The lab heard from where this player stands, ten times a second from a timer of its own —
 * never in the frame loop: the beds of the rooms round it, as the power and the lights have
 * them (ambience.ts), the crew's steps and the drones, placed (spatial.ts), and the music
 * under the run (music.ts). The audience stands nowhere and hears none of it.
 */
function hearTheLab(loop: Loop): void {
  const map = loop.live.current.view.map;
  if (map === null || loop.spectator) {
    return;
  }
  const { sim, soundOff } = loop;
  const { view, darkSince, finale } = loop.live.current;
  const outAt = darkSince === null ? null : darkSince + FLICKER_MS;
  timed('beds', () =>
    hearRooms({
      map,
      dressing: dressedFor(loop.kit.art, map, view.missionId).dressing,
      at: sim.self,
      power: { outAt, lit: sim.lit, won: finale?.ending === 'won' },
      time: sim.time,
    }),
  );
  if (!soundOff.has('spatial')) {
    const crew = { map, self: sim.self, others: sim.others, drones: loop.drones.current };
    timed('spatial', () => hearCrew(crew));
  }
  if (!soundOff.has('music')) {
    timed('music', () => setTension(tensionOf(loop, map)));
  }
  // A drone closing in ticks from where it flies, and the edge glows toward it (danger.ts).
  senseDanger({ map, self: sim.self, drones: loop.drones.current }, performance.now());
}

/**
 * What the music follows (music.ts): the run, from 2 s after the blackout's click, the clock,
 * the alarms, the escape, the end.
 */
function tensionOf(loop: Loop, map: WorldMap): Tension {
  const { view, darkSince, finale } = loop.live.current;
  const left = timeLeft(view);
  return {
    run: view.startedAt,
    startAt: darkSince === null ? null : darkSince + REVEAL_MS + MUSIC_AFTER_CLICK_MS,
    left: left === null ? Infinity : left / 1000,
    budget: view.timeLimitSec,
    alarms: view.penaltySeq,
    escaping: escaping(map),
    ending: finale === null ? null : finale.ending === 'won' ? 'won' : 'lost',
  };
}

/**
 * The last ten seconds counted out loud — for a player — on the mission's clock as the server
 * keeps it, and an emergency's power draining as it starts, its chime as it is cleared — and
 * nothing as it runs out, its alarm sounding instead.
 */
function hearTheClock(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  const left = timeLeft(loop.live.current.view);
  if (left !== null && !loop.spectator) {
    const due = beepDue(left, sim.lastBeepAt);
    sim.lastBeepAt = due.last;
    if (due.beep !== null) {
      countdownBeep(due.beep);
    }
  }
  const sabotageOn = map.sabotage !== null;
  if (sabotageOn !== sim.sabotageWasOn) {
    sim.sabotageWasOn = sabotageOn;
    if (sabotageOn) {
      powerDrain();
    } else if (emergencyCleared(loop.live.current.view.events)) {
      emergencyOver();
    }
  }
}

/**
 * The lab answering the crew: what this player found that matters chimes, its caption over it,
 * and names come up as found (finds.ts, labelFade.ts); a locker or cabinet opening within earshot
 * gets its sound, and so does a part put in its place, a room whose lights came on a relay's
 * click and its warm-up (rooms.ts) — in plain sight, once nothing lies over the world
 * (`lightWhenClear`). Whatever this client finds on its first look at a run (`firstLook`) was
 * there before it came in.
 */
function look(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  const news = worldNews(sim.seen, map);
  const run = loop.live.current.view.startedAt;
  const first = firstLook(sim.seen, sim.ear, run);
  sim.labels = noteLabels(sim.labels, map, run, sim.time, first);
  // While the world shows as a film, nothing of the game's own speaks over it.
  const listening = { run, first, held: heldBack(loop.live.current), serverNow: clock.now() };
  sim.ear = answerDiscoveries(sim.ear, map, listening, sim.captions, sim.time);
  sim.seen = map;
  for (const manual of news.opened) {
    const away = Math.hypot(manual.x + 0.5 - sim.self.x, manual.y + 0.5 - sim.self.y);
    if (loop.spectator || away <= HEAR_RADIUS) {
      (manual.kind === 'cabinet' ? cabinetUnlock : lockerOpen)();
    }
  }
  for (const item of news.delivered) {
    if (loop.spectator || Math.hypot(item.x - sim.self.x, item.y - sim.self.y) <= HEAR_RADIUS) {
      partSeated();
    }
  }
  // A part put down (Q) is set down where it now lies, heard as far as a locker opening.
  for (const item of news.dropped) {
    if (loop.spectator || Math.hypot(item.x - sim.self.x, item.y - sim.self.y) <= HEAR_RADIUS) {
      sheetDown();
    }
  }
  const known = new Set(sim.lit.keys());
  const held = lightsHeld(loop.spectator, loop.live.current.station);
  const lit = roomsComingOn(map.litRooms, known, news.lit, sim.pendingLit, held);
  for (const room of lit.long) {
    lightRoom(loop, map, room, -Infinity);
  }
  sim.pendingLit = lit.waiting;
  warmUpRooms(loop, map, lit.now);
}

/** The rooms that waited behind a panel come on once it is gone. */
function lightWhenClear(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  if (sim.pendingLit.length > 0) {
    const held = lightsHeld(loop.spectator, loop.live.current.station);
    const lit = roomsComingOn([], new Set(), [], sim.pendingLit, held);
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

/**
 * Sizes the canvas to its box at this screen's density (render/backing.ts), assembles the frame
 * and draws it; a canvas with no box draws nothing — the screen unmounting in place, its DOM
 * gone before its loop is stopped.
 */
function render(loop: Loop, map: WorldMap): void {
  const { canvas, kit } = loop;
  const dpr = fitBacking(canvas, kit.overlay.canvas, window.devicePixelRatio);
  if (dpr === null) {
    return;
  }
  const perf = performance.now();
  const pings = livePings(loop, perf);
  const frame = profiled(kit, 'assemble', null, () => assembleFrame(loop, map, dpr, perf, pings));
  drawFrame(loop.ctx, frame);
  loop.drawn = frame;
  kit.profile?.endFrame();
}

/**
 * `?profile=1`: what each pass costs, kept in the kit (render/profile.ts) and read off the
 * page by the walkthrough (`window.__escapelab.passes`). Returns what takes the probe off.
 */
function profilePasses(kit: RenderKit): (() => void) | null {
  if (!profileRequested(location.search)) {
    return null;
  }
  const profile = passProfile();
  kit.profile = profile;
  return addProbes({
    get passes() {
      return profile.stats;
    },
    resetPasses: () => profile.reset(),
  });
}

/**
 * The world's life from mount to unmount: the canvas and its kit, the
 * simulation, the listeners, the position stream and the frame loop.
 */
function useWorldLoop({ props, refs, live, alarm, setWheel, setControlsReach }: Wiring): void {
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
    const soundOff = systemsOff(location.search);
    // The lobby loaded the recordings already; a page that came in during a run loads them now.
    void preloadSamples();
    if (!soundOff.has('beds') && !props.spectator) {
      startAmbience(() => sim.time);
    }
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
      texts: { s: 0, dpr: 0, scale: 0, styles: worldText(48, 1) },
      soundOff,
      drawn: null,
    };
    refs.interactRef.current = () => tryInteract(loop);
    refs.dropRef.current = () => dropItem(loop);
    // An audience connection watches only: no controls, no position stream.
    const unlisten = props.spectator ? null : listen(loop, setWheel);
    const unping = props.spectator ? null : onPadPing(() => padPing(loop));
    const unhear = props.listen?.({
      message: (msg) => hearAnswer(sim.presses, msg, performance.now()),
      closed: () => undefined,
    });
    const posTimer = streamPositions(sim, props.spectator, (msg) => live.current.send(msg));
    const traced = traceFrames(loop);
    const tracedGraphics = traceGraphics(loop);
    const profiled = profilePasses(kit);
    const stop = runFrames(loop, traced);
    const ears = setInterval(() => hearTheLab(loop), HEAR_MS);
    return () => {
      stop();
      unhear?.();
      clearInterval(ears);
      clearInterval(posTimer);
      insets.disconnect();
      unlisten?.();
      unping?.();
      stopAmbience();
      stopMusic();
      stopSpatial();
      stopDanger();
      stopPowerHum();
      traced?.drop();
      tracedGraphics?.();
      profiled?.();
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
  wheel: Wheel;
  setWheel: SetWheel;
}

/** A way to walk or the sprint held while a finger is down on its control, let go as it lifts. */
type Press = (held: Held, down: boolean) => void;

/** The arrow each cell of the pad shows (touchPad.ts PAD_CELLS); the middle one a dot. */
const PAD_ARROWS: Readonly<Record<string, string>> = {
  'up-left': '↖',
  up: '↑',
  'up-right': '↗',
  left: '←',
  stop: '•',
  right: '→',
  'down-left': '↙',
  down: '↓',
  'down-right': '↘',
};

/** A cell of the pad the steering finger holds now: lit. */
const HELD_CELL = 'world-pad-cell world-pad-held';

/** The name of the pad's cell that walks `moves` (touchPad.ts PAD_CELLS). */
function cellOf(moves: readonly Held[]): string {
  const same = ([, cell]: (typeof PAD_CELLS)[number]): boolean =>
    cell.length === moves.length && cell.every((move) => moves.includes(move));
  return PAD_CELLS.find(same)?.[0] ?? 'stop';
}

/** Where a pointer is on the pad it fell on: its offset from the middle, and the cell size. */
function touchOn(e: React.PointerEvent<HTMLDivElement>): PadTouch {
  const box = e.currentTarget.getBoundingClientRect();
  return {
    id: e.pointerId,
    dx: e.clientX - (box.left + box.width / 2),
    dy: e.clientY - (box.top + box.height / 2),
    cell: box.width / 3,
  };
}

/**
 * The steering pad under the left thumb of a touch screen (touchPad.ts): eight ways round a
 * middle that stands still, one finger steering as it slides over it — the cell it holds lit —
 * and nothing of it where there are keys (world.css). The finger stays the pad's as it slides
 * past its edge, until it lifts.
 */
function TouchPad({ press }: { press: Press }) {
  const [steer] = useState(() => new PadSteer(press));
  const [lit, setLit] = useState('stop');
  const steered = (): void => setLit(cellOf(steer.held));
  return (
    <div
      className="world-pad"
      role="group"
      aria-label="Steuerkreuz"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        steer.down(touchOn(e));
        steered();
      }}
      onPointerMove={(e) => {
        steer.move(touchOn(e));
        steered();
      }}
      onPointerUp={(e) => {
        steer.up(e.pointerId);
        steered();
      }}
      onPointerCancel={(e) => {
        steer.up(e.pointerId);
        steered();
      }}
      onLostPointerCapture={(e) => {
        steer.up(e.pointerId);
        steered();
      }}
    >
      {PAD_CELLS.map(([name]) => (
        <span
          key={name}
          className={name === lit && name !== 'stop' ? HELD_CELL : 'world-pad-cell'}
          aria-hidden="true"
        >
          {PAD_ARROWS[name]}
        </span>
      ))}
    </div>
  );
}

/** What a control held to act answers a finger with: `move` held while it is down on it. */
function holding(press: Press, move: Held) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press(move, true);
    },
    onPointerUp: () => press(move, false),
    onPointerLeave: () => press(move, false),
    onPointerCancel: () => press(move, false),
  };
}

/**
 * The class of the right thumb's buttons: whole while a finger is on them and a moment after
 * (cluster.ts), and with hands full — where a touch screen offers to put the load down in the
 * chat's place (world.css).
 */
function thumbClass(awake: boolean, carrying: boolean): string {
  const awakeClass = awake ? ['world-thumb--awake'] : [];
  const carryClass = carrying ? ['world-thumb--carrying'] : [];
  return ['world-thumb', ...awakeClass, ...carryClass].join(' ');
}

/**
 * The controls over the world. On a touch screen the steering pad lies under the left thumb
 * and the buttons under the right one, two by two in the corner (world.css): the action where
 * the thumb rests, „Sprint" held to run beside it, talk over the action, and the chat over the
 * sprint — or while hands are full the one that puts the load down, a touch screen's Q, in the
 * chat's place. The buttons stand see-through until a finger comes down on them (cluster.ts).
 * With a keyboard only the chat's handle shows; the key on a button shows only where there are
 * keys.
 */
function WorldControls({ refs, live, view, wheel, setWheel }: ControlsProps) {
  /** what this player carries now; while there is something, a touch screen offers to drop it */
  const load = view.map === null ? undefined : carriedItem(view.map, view.you.id);
  const interactGlyph = useGlyph('interact');
  const chatGlyph = useGlyph('chat');
  const wake = useClusterWake();
  const press: Press = (move, down) => {
    const sim = refs.simRef.current;
    if (sim === null) {
      return;
    }
    if (down && !live.current.locked && !heldBack(live.current)) {
      sim.keys.add(move);
    } else {
      sim.keys.delete(move);
    }
  };
  return (
    <div className="world-controls" ref={refs.controlsRef}>
      <TouchPad press={press} />
      <div className={thumbClass(wake.awake, load !== undefined)} {...wake.handlers}>
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
          className="world-chat-toggle"
          aria-label="Schnellchat"
          onClick={() => setWheel(toggled)}
          aria-expanded={wheel !== null}
        >
          💬<span className="world-key"> [{chatGlyph}]</span>
        </button>
        {/* Held to talk, on a touch screen with the microphone on; the talk key on a keyboard. */}
        <TalkButton className="world-talk">🎤</TalkButton>
        <button className="world-sprint" aria-label="Sprinten" {...holding(press, 'sprint')}>
          Sprint
        </button>
        <button
          className="world-interact"
          aria-label="Benutzen"
          onClick={() => refs.interactRef.current?.()}
        >
          ⚡<span className="world-key"> [{interactGlyph}]</span>
        </button>
      </div>
    </div>
  );
}

/** What the world's DOM shows of its state: the tip, the alarm's classes, the chat wheel. */
interface WorldState {
  refs: WorldRefs;
  live: React.MutableRefObject<Live>;
  tip: CoachMark | null;
  alarmClass: string;
  wheel: Wheel;
  setWheel: SetWheel;
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
  const [wheel, setWheel] = useState<Wheel>(null);
  const [controlsReach, setControlsReach] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const interactRef = useRef<(() => void) | null>(null);
  const dropRef = useRef<(() => void) | null>(null);
  const voice = useContext(VoiceContext);
  const reduced = useReducedMotion();
  const textScale = TEXT_SCALE[useSettings().textSize];
  // The escape (escape.ts) and the ending (finale.ts), as this screen lives them.
  const escapeSince = useEscapeSince(view.map?.exit ?? null, view.startedAt);
  const live = useLatest<Live>({
    view,
    darkSince,
    locked: inputLocked,
    menuOver: props.menuOver === true,
    station,
    wheel,
    finale,
    intro: props.intro ?? null,
    escapeSince,
    reduced,
    textScale,
    voice,
    send: props.send,
    onToggleInfo: props.onToggleInfo,
    onRead: props.onRead,
    onReadNote: props.onReadNote,
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
  useWorldLoop({ props, refs, live, alarm: alarmRef, setWheel, setControlsReach });
  useWheelEscape(wheel !== null, setWheel, live);
  return { refs, live, tip, alarmClass, wheel, setWheel, controlsReach };
}

/**
 * The red edge round the world in the clock's last minute and all through the escape
 * (vignette.ts): an element right over the canvas and under everything else on it — the
 * coach, the controls, the bar — breathing by its opacity alone (finale.css), the harder the
 * more pressing the moment. Gone once the run's end plays on this screen.
 */
function RedEdge({ view, ending }: { view: PlayerView; ending: boolean }) {
  const now = clockTime(view.pausedAt, useServerNow(500));
  const pressure = vignettePressure(view.deadlineAt, now, escaping(view.map), ending);
  return pressure === null ? null : (
    <div className={`vignette vignette--${pressure}`} aria-hidden="true" />
  );
}

export function GameWorld(props: Props) {
  const { spectator } = props;
  const { refs, live, tip, alarmClass, wheel, setWheel, controlsReach } = useWorld(props);
  return (
    // An alarm strobes over the world and shakes the camera (alarm.ts, finale.css).
    <div className={alarmClass === '' ? 'world-wrap' : `world-wrap ${alarmClass}`}>
      <canvas
        ref={refs.canvasRef}
        className={`world-canvas ${spectator ? 'world-canvas--wide' : ''}`}
      />
      {!spectator && <RedEdge view={props.view} ending={props.finale != null} />}
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
          wheel={wheel}
          setWheel={setWheel}
        />
      )}
      {wheel !== null && (
        <ChatWheel
          phrases={props.view.chat}
          wheel={wheel}
          onMove={(move) => moveWheel(props.send, setWheel, move)}
        />
      )}
    </div>
  );
}

/**
 * `?trace=1`: what the world's picture shows of the graphics package's work, read off the page
 * by the walkthrough (`window.__escapelab.graphics`, render/graphicsProbe.ts). Returns what takes
 * the probe off; null without the trace.
 */
function traceGraphics(loop: Loop): (() => void) | null {
  if (!traceRequested(location.search)) {
    return null;
  }
  return addProbes({
    get graphics() {
      return graphicsProbe(loop);
    },
  });
}
