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
import { beepDue, clock, clockTime, serverAt, timeLeft } from '../clock.js';
import { useServerNow } from '../hooks.js';
import { actionOfKey, isHeld, type Held, type InputAction } from '../input/bindings.js';
import { useGlyph } from '../input/glyphs.js';
import { HeldKeys, watchBindings } from '../input/heldKeys.js';
import { inputDevice } from '../input/device.js';
import { NO_STEER } from '../input/pad.js';
import { onPadPing, padSteer } from '../input/padRuntime.js';
import { addProbes, type MinimapProbe } from '../probes.js';
import type { CoachMark } from '../puzzles/coach.js';
import { TalkButton } from '../screens/Voice.js';
import { getSettings, useReducedMotion } from '../settings.js';
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
  discoveryBlip,
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
import { blackoutCue, FLICKER_MS, REVEAL_MS, SEQUENCE_MS } from './coldOpen.js';
import { senseDanger, stopDanger } from './danger.js';
import { doorTurned } from './doors.js';
import { drawsFrame } from './drawRate.js';
import { escaping, useEscapeSince, useEscapeSounds } from './escape.js';
import { useFinaleSounds, type FinaleCue } from './finale.js';
import { runLight } from './frameLight.js';
import { frameTrace, traceRequested, type FrameTrace } from './frameTrace.js';
import { watchInsets, type Insets } from './insets.js';
import { carriedItem, TOUCH } from './interact.js';
import { hearAnswer, pressE, pressWhenInReach, type PressWorld } from './press.js';
import { filmed, type IntroCue } from './intro/sequence.js';
import { runsOf } from './light.js';
import { positionsOf, type KnownPositions, type Spot } from './movement.js';
import { MUSIC_AFTER_CLICK_MS, musicProbe, setTension, stopMusic, type Tension } from './music.js';
import { worldNews } from './news.js';
import { noteMount } from './notes.js';
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
import { labelsShown } from './render/objects.js';
import { minimapGoal, minimapLayout } from './render/hud.js';
import { dropLight } from './render/light.js';
import { PING_LIFETIME_MS } from './render/overlays.js';
import { drawFrame } from './render/pipeline.js';
import { passProfile, profileRequested } from './render/profile.js';
import { noteLabels } from './labels.js';
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
type KeyJob = (loop: Loop, setWheelOpen: SetWheel) => void;

const interactKey: KeyJob = (loop) => tryInteract(loop);
const dropKey: KeyJob = (loop) => dropItem(loop);
const minimapKey: KeyJob = (loop) => {
  loop.sim.minimap = !loop.sim.minimap;
};
const chatKey: KeyJob = (_, setWheelOpen) => setWheelOpen((open) => !open);
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

function onKeyDown(loop: Loop, e: KeyboardEvent, setWheelOpen: SetWheel, held: HeldKeys): void {
  if (isTextEntry(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) {
    return;
  }
  const key = e.key.toLowerCase();
  const action = actionOfKey(getSettings().keys, key);
  if (action !== null && isHeld(action)) {
    holdKey(loop, action, e, held);
  } else {
    pressKey(loop, key, action, e, setWheelOpen);
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
  setWheelOpen: SetWheel,
): void {
  const job = action === null ? undefined : KEY_JOBS[action];
  if (job !== undefined) {
    e.preventDefault();
    if (!e.repeat) {
      job(loop, setWheelOpen);
    }
  } else if (key === 'escape') {
    setWheelOpen(false);
  } else {
    sayPhrase(loop, key, e, setWheelOpen);
  }
}

/** 1–8 say the chat wheel's phrases, and shut it. */
function sayPhrase(loop: Loop, key: string, e: KeyboardEvent, setWheelOpen: SetWheel): void {
  const phrase = /^[1-8]$/.test(key) ? CHAT_PHRASE_IDS[Number(key) - 1] : undefined;
  if (phrase !== undefined) {
    e.preventDefault();
    loop.live.current.send({ kind: 'chat', phrase });
    setWheelOpen(false);
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

/** The D-pad's ◀: a ping for the whole crew on the floor the avatar's lamp points at. */
function padPing(loop: Loop): void {
  const map = loop.live.current.view.map;
  if (map !== null) {
    loop.live.current.send({ kind: 'ping', ...pingAhead(map, loop.sim.self) });
  }
}

/** The keyboard and the pointer drive the world; returns what takes them off again. */
function listen(loop: Loop, setWheelOpen: SetWheel): () => void {
  const { canvas, sim } = loop;
  const held = new HeldKeys();
  // A key bound anew takes over at once: whatever the old keys held is let go.
  const stopBindings = watchBindings(() => {
    held.clear();
    sim.keys.clear();
  });
  const keyDown = (e: KeyboardEvent): void => onKeyDown(loop, e, setWheelOpen, held);
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
 * names drawn under things (render/objects.ts `labelsShown`), what
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
      return { ...bedProbe(), ...sound, nodes, spent: timeSpent(), renderRadio, ...soundProbe() };
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
 * The lab answering the crew: a source or a note of the last shift somebody
 * came across gets a blip and a caption, a locker or cabinet opening within
 * earshot its sound, and so does a part put in its place, a
 * room whose lights came on a relay's click and its warm-up (rooms.ts) —
 * in plain sight, once nothing lies over the world (`lightWhenClear`).
 * Whatever this client finds on its first look was there before it came
 * in.
 */
function look(loop: Loop, map: WorldMap): void {
  const { sim } = loop;
  const news = worldNews(sim.seen, map);
  const run = loop.live.current.view.startedAt;
  sim.labels = noteLabels(sim.labels, map, run, sim.time, sim.seen === null);
  sim.seen = map;
  for (const manual of news.found) {
    const text = `${SOURCE_NAMES[manual.kind]} entdeckt`;
    sim.captions.push({ x: manual.x + 0.5, y: manual.y, text, at: sim.time });
  }
  for (const note of news.notes) {
    const mount = noteMount(map, note);
    if (mount !== null) {
      sim.captions.push({ x: mount.x, y: mount.y - 0.6, text: 'Notiz entdeckt', at: sim.time });
    }
  }
  // While the world shows as a film, nothing of the game's own speaks over it.
  if (news.found.length + news.notes.length > 0 && !heldBack(loop.live.current)) {
    discoveryBlip();
  }
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
 * and draws it.
 */
function render(loop: Loop, map: WorldMap): void {
  const { canvas, kit } = loop;
  const dpr = fitBacking(canvas, kit.overlay.canvas, window.devicePixelRatio);
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
      texts: { s: 0, dpr: 0, styles: worldText(48, 1) },
      soundOff,
      drawn: null,
    };
    refs.interactRef.current = () => tryInteract(loop);
    refs.dropRef.current = () => dropItem(loop);
    // An audience connection watches only: no controls, no position stream.
    const unlisten = props.spectator ? null : listen(loop, setWheelOpen);
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
  wheelOpen: boolean;
  setWheelOpen: SetWheel;
}

/** The pad's buttons: the way each walks while held, and its arrow. */
const PAD_MOVES = [
  ['up', '↑'],
  ['left', '←'],
  ['right', '→'],
  ['down', '↓'],
] as const;

/** A move held while a finger rests on its button, let go as the finger lifts or slides off. */
type Press = (held: Held, down: boolean) => void;

/**
 * The steering pad of a touch screen, and beside it „Sprint": held, the avatar runs, as with
 * the sprint key on a keyboard (world.css shows both under a finger only).
 */
function TouchPad({ press }: { press: Press }) {
  const held = (move: Held) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press(move, true);
    },
    onPointerUp: () => press(move, false),
    onPointerLeave: () => press(move, false),
    onPointerCancel: () => press(move, false),
  });
  return (
    <>
      <div className="world-dpad" role="group" aria-label="Steuerkreuz">
        {PAD_MOVES.map(([dir, arrow]) => (
          <button
            key={dir}
            className={`world-dpad-btn world-dpad-btn--${dir}`}
            {...held(dir)}
            aria-label={dir}
          >
            {arrow}
          </button>
        ))}
      </div>
      <button className="world-sprint" aria-label="Sprinten" {...held('sprint')}>
        Sprint
      </button>
    </>
  );
}

/** The control cluster over the world: the pad, the action buttons, chat and talk. */
function WorldControls({ refs, live, view, wheelOpen, setWheelOpen }: ControlsProps) {
  /** what this player carries now; while there is something, a touch screen offers to drop it */
  const load = view.map === null ? undefined : carriedItem(view.map, view.you.id);
  const interactGlyph = useGlyph('interact');
  const chatGlyph = useGlyph('chat');
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
          ⚡<span className="world-key"> [{interactGlyph}]</span>
        </button>
      </div>
      <button
        className="world-chat-toggle"
        aria-label="Schnellchat"
        onClick={() => setWheelOpen((open) => !open)}
        aria-expanded={wheelOpen}
      >
        💬<span className="world-key"> [{chatGlyph}]</span>
      </button>
      {/* Held to talk, on a touch screen with the microphone on; the talk key on a keyboard. */}
      <TalkButton className="world-talk">🎤</TalkButton>
    </div>
  );
}

/**
 * The quick-chat phrases, one button each, with the digit that says it. Opened from a
 * controller, the first phrase takes the focus: the D-pad picks one, A says it, B shuts the
 * wheel (input/focus.ts takes it for a menu over the world).
 */
function ChatWheel({ send, setWheelOpen }: { send: Props['send']; setWheelOpen: SetWheel }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (inputDevice().device === 'pad') {
      first.current?.focus();
    }
  }, []);
  const say = (phrase: ChatPhrase): void => {
    send({ kind: 'chat', phrase });
    setWheelOpen(false);
  };
  return (
    <div className="chat-wheel" role="menu">
      {CHAT_PHRASE_IDS.map((phrase, i) => (
        <button
          key={phrase}
          ref={i === 0 ? first : undefined}
          role="menuitem"
          onClick={() => say(phrase)}
        >
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
  const reduced = useReducedMotion();
  // The escape (escape.ts) and the ending (finale.ts), as this screen lives them.
  const escapeSince = useEscapeSince(view.map?.exit ?? null, view.startedAt);
  const live = useLatest<Live>({
    view,
    darkSince,
    locked: inputLocked,
    station,
    finale,
    intro: props.intro ?? null,
    escapeSince,
    reduced,
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
  useWorldLoop({ props, refs, live, alarm: alarmRef, setWheelOpen, setControlsReach });
  return { refs, live, tip, alarmClass, wheelOpen, setWheelOpen, controlsReach };
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
  const { refs, live, tip, alarmClass, wheelOpen, setWheelOpen, controlsReach } = useWorld(props);
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
          wheelOpen={wheelOpen}
          setWheelOpen={setWheelOpen}
        />
      )}
      {wheelOpen && <ChatWheel send={props.send} setWheelOpen={setWheelOpen} />}
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
