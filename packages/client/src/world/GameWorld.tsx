import { useEffect, useRef, useState } from 'react';
import {
  chatText,
  CHAT_PHRASE_IDS,
  type ChatPhrase,
  type ClientMessage,
  type DronePosition,
  type PlayerPosition,
  type PlayerView,
} from '@escapelab/core';
import {
  drawCarryable,
  drawDropZone,
  drawDroneBody,
  drawDroneCone,
  drawSabotagePanel,
} from './hazards.js';
import {
  drawDoor,
  drawPlate,
  drawScientist,
  drawStation,
  makeFloorTile,
  makeWallTile,
} from './art.js';
import {
  countdownBeep,
  doorSlide,
  footstep,
  pingBlip,
  setTension,
  powerDrain,
  startAmbience,
  stationChirp,
  stopAmbience,
} from './audio.js';

const FALLBACK_COLOR = '#2dd4bf';
const SPEED = 4.2; // tiles per second
const RADIUS = 0.28; // collision half-size
const INTERACT_RADIUS = 1.5; // prompt + client-side gate (server allows 1.6)
const ITEM_RADIUS = 0.9; // pick-up and drop-off reach (server allows 0.95)
const POS_SEND_MS = 80;
const PING_LIFETIME_MS = 3200;

const CHAT_LIFETIME_MS = 4200;

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
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  inputLocked: boolean;
  /** audience view: whole map revealed, no controls, no own avatar */
  spectator: boolean;
  /** opens the info panel, which owns the briefing and the key list */
  onToggleInfo: () => void;
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
  adopted: boolean;
  self: { x: number; y: number; facing: number; moving: boolean };
  others: Map<string, OtherAvatar>;
  keys: Set<string>;
  doors: Map<string, { t: number; target: number }>;
  walkPhase: number;
  stepAcc: number;
  cam: { x: number; y: number };
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

function armedStationOf(map: WorldMap): { x: number; y: number; title: string } | null {
  const station = map.stations.find((s) => s.status === 'armed');
  return station === undefined ? null : { x: station.x, y: station.y, title: station.title };
}

/**
 * What pressing E would do where the player stands — the same priority the
 * server applies, so the prompt never promises something it cannot do.
 */
function contextAction(
  map: WorldMap,
  self: { x: number; y: number },
  youId: string,
): { label: string; x: number; y: number } | null {
  const near = (x: number, y: number, r = ITEM_RADIUS): boolean =>
    Math.hypot(self.x - x, self.y - y) <= r;

  const mine = map.items.find((item) => item.carriedBy === youId && !item.delivered);
  if (mine !== undefined) {
    return near(mine.deliverTo.x + 0.5, mine.deliverTo.y + 0.5)
      ? {
          label: `[E] ${mine.label} einsetzen`,
          x: mine.deliverTo.x + 0.5,
          y: mine.deliverTo.y - 0.45,
        }
      : null;
  }

  const loose = map.items.find(
    (item) => !item.delivered && item.carriedBy === null && near(item.x, item.y),
  );
  if (loose !== undefined) {
    return { label: `[E] ${loose.label} aufnehmen`, x: loose.x, y: loose.y - 0.95 };
  }

  const station = armedStationOf(map);
  if (station !== null && near(station.x + 0.5, station.y + 0.5, INTERACT_RADIUS)) {
    return { label: `[E] ${station.title}`, x: station.x + 0.5, y: station.y - 0.55 };
  }
  return null;
}


/**
 * The one sentence a newcomer needs right now. Each tip is shown once per
 * session, so a second run is not cluttered with things you already know.
 */
function coachTip(map: WorldMap, youId: string, carrying: boolean): { id: string; text: string } | null {
  if (map.sabotage !== null) {
    return { id: 'sabotage', text: 'Notfall! Jede Person an ein eigenes Ventil — sofort losrennen.' };
  }
  if (carrying) {
    return {
      id: 'carry',
      text: 'Du trägst etwas: Bring es zur markierten Fläche und drücke E. Mit Q legst du es ab.',
    };
  }
  if (map.exit !== null && map.exit.open) {
    return { id: 'exit', text: 'Der Notausgang ist offen — ihr müsst alle gemeinsam dort ankommen.' };
  }
  if (map.plates.some((plate) => plate.pressed)) {
    return {
      id: 'plate',
      text: 'Solange jemand auf der Platte steht, bleibt die Tür offen — nicht runtergehen!',
    };
  }
  void youId;
  return null;
}

/** Escape hatch: dim grey while locked, pulsing green once it opens. */
function drawExit(ctx: CanvasRenderingContext2D, open: boolean, pulse: number): void {
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
  onToggleInfo,
  send,
}: Props) {
  const [wheelOpen, setWheelOpen] = useState(false);
  const [tip, setTip] = useState<{ id: string; text: string } | null>(null);
  const seenTips = useRef(new Set<string>());
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
  const simRef = useRef<Sim | null>(null);

  useEffect(() => {
    if (lockedRef.current) {
      simRef.current?.keys.clear();
    }
  }, [inputLocked]);

  // Coach marks react to the view, not to the render loop.
  useEffect(() => {
    if (spectator || view.map === null) {
      setTip(null);
      return undefined;
    }
    const carrying = view.map.items.some(
      (item) => item.carriedBy === view.you.id && !item.delivered,
    );
    const next = coachTip(view.map, view.you.id, carrying);
    if (next === null || seenTips.current.has(next.id)) {
      setTip(null);
      return undefined;
    }
    seenTips.current.add(next.id);
    setTip(next);
    const timer = setTimeout(() => setTip(null), 6500);
    return () => clearTimeout(timer);
  }, [view, spectator]);


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
    const touchPad = window.matchMedia('(pointer: coarse)');

    // The objective bar and the control cluster are HTML overlays lying on the
    // canvas, and both change height with their contents. Anything the canvas
    // draws near those edges has to keep clear, so we track them instead of
    // assuming a height.
    const stageTop = canvas.closest('.stage')?.querySelector('.stage-top') ?? null;
    const controls = controlsRef.current;
    let safeTopCss = 0;
    let safeBottomCss = 0;
    const height = (el: Element | null): number => (el instanceof HTMLElement ? el.offsetHeight : 0);
    const overlayObserver = new ResizeObserver(() => {
      safeTopCss = height(stageTop);
      safeBottomCss = height(controls);
    });
    for (const el of [stageTop, controls]) {
      if (el !== null) {
        overlayObserver.observe(el);
      }
    }

    const sim: Sim = {
      adopted: false,
      self: { x: 0, y: 0, facing: 0, moving: false },
      others: new Map(),
      keys: new Set(),
      doors: new Map(),
      walkPhase: 0,
      stepAcc: 0,
      cam: { x: 0, y: 0 },
      draw: { x: 0, y: 0 },
      scale: 48,
      flash: 0,
      lastPenaltySeq: viewRef.current.penaltySeq,
      time: 0,
      seenPings: new WeakSet<MapPing>(),
      minimap: true,
      sabotageWasOn: false,
      lastBeepAt: Number.POSITIVE_INFINITY,
    };
    simRef.current = sim;
    startAmbience();

    /** Fires the one context action; the server decides what it means here. */
    function tryInteract(): void {
      const map = viewRef.current.map;
      if (map === null || lockedRef.current || viewRef.current.puzzle !== null) {
        return;
      }
      if (contextAction(map, sim.self, viewRef.current.you.id) === null) {
        return;
      }
      stationChirp();
      sendRef.current({ kind: 'interact' });
    }

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
        if (!lockedRef.current) {
          sendRef.current({ kind: 'drop-item' });
        }
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

    const lastSent = { x: NaN, y: NaN, facing: NaN, moving: false };
    const posTimer = setInterval(() => {
      if (!sim.adopted || spectator) {
        return;
      }
      const { x, y, facing, moving } = sim.self;
      const changed =
        Math.abs(x - lastSent.x) > 0.01 ||
        Math.abs(y - lastSent.y) > 0.01 ||
        Math.abs(facing - lastSent.facing) > 0.05 ||
        moving !== lastSent.moving;
      if (changed) {
        Object.assign(lastSent, { x, y, facing, moving });
        sendRef.current({
          kind: 'pos',
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          facing: Math.round(facing * 100) / 100,
          moving,
        });
      }
    }, POS_SEND_MS);

    let raf = 0;
    let prev = performance.now();

    function step(dt: number, map: WorldMap): void {
      // Spectators own no avatar, so every streamed position is "someone else".
      const youId = spectator ? '' : viewRef.current.you.id;
      if (spectator) {
        sim.adopted = true;
        sim.cam.x = map.width / 2;
        sim.cam.y = map.height / 2;
      } else if (!sim.adopted) {
        const seeded = positionsRef.current[youId];
        if (seeded !== undefined) {
          sim.self.x = seeded.x;
          sim.self.y = seeded.y;
        } else {
          sim.self.x = map.yourSpawn.x + 0.5;
          sim.self.y = map.yourSpawn.y + 0.5;
        }
        sim.cam.x = sim.self.x;
        sim.cam.y = sim.self.y;
        sim.adopted = true;
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
      for (const [id, pos] of Object.entries(positionsRef.current)) {
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
        if (positionsRef.current[id] === undefined) {
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

      // camera: follow your avatar, or sit still over the whole lab
      if (!spectator) {
        const ck = 1 - Math.exp(-dt * 6);
        sim.cam.x += (sim.self.x - sim.cam.x) * ck;
        sim.cam.y += (sim.self.y - sim.cam.y) * ck;
      }
      sim.time += dt;
    }

    function worldToScreen(s: number, w: number, h: number, x: number, y: number): [number, number] {
      return [w / 2 + (x - sim.draw.x) * s, h / 2 + (y - sim.draw.y) * s];
    }

    /**
     * Keep the view inside the map; centre it when the map is the smaller one.
     * `biasY` pushes the camera down in device pixels, which lifts the
     * character that much higher in the frame — on a phone the on-screen pad
     * would otherwise sit right on top of them.
     */
    function clampCamera(map: WorldMap, s: number, w: number, h: number, biasY: number): void {
      const halfW = w / 2 / s;
      const halfH = h / 2 / s;
      const bias = biasY / s;
      sim.draw.x =
        map.width <= halfW * 2 ? map.width / 2 : Math.min(map.width - halfW, Math.max(halfW, sim.cam.x));
      // The lower bound travels with the bias, so the lift still works down at
      // the bottom wall — at the cost of a strip of void below the lab.
      sim.draw.y =
        map.height <= halfH * 2
          ? map.height / 2 + bias
          : Math.min(map.height - halfH + bias, Math.max(halfH, sim.cam.y + bias));
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
      // Zoom so the lab always covers the canvas: no black bars beside it.
      const cover = Math.max(w / map.width, h / map.height);
      const s = spectator
        ? Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)))
        : // Cover the canvas, but stop before the lab turns into giant tiles
          // on very wide windows.
          Math.min(170, Math.max(cover, Math.min(88, h / 10.5)));
      clampCamera(map, s, w, h, touchPad.matches && !spectator ? 60 * dpr : 0);
      sim.scale = s;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04070a';
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.draw.x * s, h / 2 - sim.draw.y * s);

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

      for (const plate of map.plates) {
        ctx.save();
        ctx.translate(plate.x + 0.5, plate.y + 0.5);
        drawPlate(ctx, { pressed: plate.pressed, label: plate.label });
        ctx.restore();
      }
      for (const door of map.doors) {
        ctx.save();
        ctx.translate(door.x + 0.5, door.y + 0.5);
        drawDoor(ctx, {
          openT: sim.doors.get(door.id)?.t ?? (door.open ? 1 : 0),
          horizontal: isHorizontalDoor(map, door.x, door.y),
        });
        ctx.restore();
      }
      const pulse = (Math.sin(sim.time * 4) + 1) / 2;
      for (const station of map.stations) {
        ctx.save();
        ctx.translate(station.x + 0.5, station.y + 0.5);
        drawStation(ctx, { status: station.status, pulse, title: station.title });
        ctx.restore();
      }
      if (map.exit !== null) {
        ctx.save();
        ctx.translate(map.exit.x + 0.5, map.exit.y + 0.5);
        drawExit(ctx, map.exit.open, pulse);
        ctx.restore();
      }
      for (const panel of map.sabotage?.panels ?? []) {
        ctx.save();
        ctx.translate(panel.x + 0.5, panel.y + 0.5);
        drawSabotagePanel(ctx, panel.occupied, pulse);
        ctx.restore();
      }
      for (const item of map.items) {
        ctx.save();
        ctx.translate(item.deliverTo.x + 0.5, item.deliverTo.y + 0.5);
        drawDropZone(ctx, item.delivered, pulse);
        ctx.restore();
        if (!item.delivered && item.carriedBy === null) {
          ctx.save();
          ctx.translate(item.x, item.y);
          drawCarryable(ctx, pulse, false);
          ctx.restore();
        }
      }

      // drone cones go under the avatars so figures stay readable inside them
      for (const drone of Object.values(dronesRef.current)) {
        ctx.save();
        ctx.translate(drone.x, drone.y);
        drawDroneCone(ctx, drone, pulse);
        ctx.restore();
      }

      // avatars: remote first, local on top
      const colorOf = new Map(
        viewRef.current.players.map((p) => [p.id, p.color]),
      );
      const metaOf = new Map(viewRef.current.players.map((p) => [p.id, p]));
      for (const [id, other] of sim.others) {
        const meta = metaOf.get(id);
        ctx.save();
        ctx.translate(other.rx, other.ry + 0.3);
        drawScientist(ctx, {
          color: colorOf.get(id) ?? FALLBACK_COLOR,
          name: meta?.name ?? '???',
          facing: other.facing,
          moving: other.moving,
          walkPhase: other.phase,
          isYou: false,
          connected: meta?.connected ?? true,
        });
        ctx.restore();
      }
      if (!spectator) {
        const you = metaOf.get(viewRef.current.you.id);
        ctx.save();
        ctx.translate(sim.self.x, sim.self.y + 0.3);
        drawScientist(ctx, {
          color: colorOf.get(viewRef.current.you.id) ?? FALLBACK_COLOR,
          name: you?.name ?? 'DU',
          facing: sim.self.facing,
          moving: sim.self.moving,
          walkPhase: sim.walkPhase,
          isYou: true,
          connected: true,
        });
        ctx.restore();
      }

      for (const drone of Object.values(dronesRef.current)) {
        ctx.save();
        ctx.translate(drone.x, drone.y);
        drawDroneBody(ctx, drone, pulse);
        ctx.restore();
      }

      // carried objects ride above their carrier's head
      for (const item of map.items) {
        if (item.delivered || item.carriedBy === null) {
          continue;
        }
        const carrier =
          item.carriedBy === viewRef.current.you.id
            ? { x: sim.self.x, y: sim.self.y }
            : sim.others.get(item.carriedBy);
        if (carrier === undefined) {
          continue;
        }
        ctx.save();
        ctx.translate('rx' in carrier ? carrier.rx : carrier.x, ('ry' in carrier ? carrier.ry : carrier.y) - 0.75);
        drawCarryable(ctx, pulse, true);
        ctx.restore();
      }

      if (!spectator) {
        renderLighting(map, s, w, h);
        renderMinimap(map, w, h, dpr);
      }
      renderPings(s, w, h, dpr);
      renderScreenText(map, s, w, h, dpr);
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

    /** Corner minimap: layout, doors, objective, exit and everyone's dot. */
    function renderMinimap(map: WorldMap, w: number, h: number, dpr: number): void {
      if (ctx == null || !sim.minimap) {
        return;
      }
      // Scales with the window, but never so small it stops being readable
      // or so large it eats a phone screen.
      const targetCss = Math.min(190, Math.max(110, (w / dpr) * 0.16));
      // Top right, clear of the clock above it and of the edge markers and
      // room signage along the bottom.
      const oy = 84 * dpr;
      // A short window has less room below the clock than beside it, and both
      // the minimap and the control cluster hug the right edge.
      const roomBelow = (h - oy - (safeBottomCss + 14) * dpr) / map.height;
      const cell = Math.max(3, Math.min(Math.round((targetCss * dpr) / map.width), Math.floor(roomBelow)));
      const mw = map.width * cell;
      const mh = map.height * cell;
      const ox = w - mw - 14 * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = '#070b0f';
      ctx.strokeStyle = '#24323f';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.roundRect(ox - 5 * dpr, oy - 5 * dpr, mw + 10 * dpr, mh + 10 * dpr, 6 * dpr);
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
      if (map.exit !== null) {
        ctx.fillStyle = map.exit.open ? '#4ade80' : '#2c3947';
        ctx.fillRect(ox + map.exit.x * cell, oy + map.exit.y * cell, cell, cell);
      }
      for (const drone of Object.values(dronesRef.current)) {
        ctx.fillStyle = drone.alerted ? '#f87171' : '#fbbf24';
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

    function renderLighting(map: WorldMap, s: number, w: number, h: number): void {
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

      const punch = (wx: number, wy: number, radius: number, strength: number): void => {
        const [sx, sy] = worldToScreen(s, w, h, wx, wy);
        const r = radius * s;
        const g = octx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(0,0,0,${strength})`);
        g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.55})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = g;
        octx.fillRect(sx - r, sy - r, r * 2, r * 2);
      };

      // Your lamp: a close radial glow plus a flashlight cone in facing direction.
      punch(sim.self.x, sim.self.y, 3.2, 1);
      {
        const [sx, sy] = worldToScreen(s, w, h, sim.self.x, sim.self.y);
        const coneR = 7.5 * s;
        octx.save();
        octx.beginPath();
        octx.moveTo(sx, sy);
        octx.arc(sx, sy, coneR, sim.self.facing - 0.5, sim.self.facing + 0.5);
        octx.closePath();
        octx.clip();
        const g = octx.createRadialGradient(sx, sy, 0, sx, sy, coneR);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.6, 'rgba(0,0,0,0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = g;
        octx.fillRect(sx - coneR, sy - coneR, coneR * 2, coneR * 2);
        octx.restore();
      }
      for (const other of sim.others.values()) {
        punch(other.rx, other.ry, 2.8, 0.9);
      }
      for (const station of map.stations) {
        if (station.status === 'armed') {
          punch(station.x + 0.5, station.y + 0.5, 2.4, 0.85);
        } else if (station.status === 'done') {
          punch(station.x + 0.5, station.y + 0.5, 1.1, 0.4);
        }
      }
      for (const plate of map.plates) {
        if (plate.pressed) {
          punch(plate.x + 0.5, plate.y + 0.5, 1.0, 0.5);
        }
      }
      if (map.exit !== null && map.exit.open) {
        punch(map.exit.x + 0.5, map.exit.y + 0.5, 2.6, 0.9);
      }
      for (const panel of map.sabotage?.panels ?? []) {
        punch(panel.x + 0.5, panel.y + 0.5, 2.4, 0.9);
      }
      for (const item of map.items) {
        if (!item.delivered && item.carriedBy === null) {
          punch(item.x, item.y, 1.6, 0.7);
        }
        punch(item.deliverTo.x + 0.5, item.deliverTo.y + 0.5, 1.4, 0.6);
      }
      // Drone cones light their own path, which is what makes them readable.
      for (const drone of Object.values(dronesRef.current)) {
        const [sx, sy] = worldToScreen(s, w, h, drone.x, drone.y);
        const half = (drone.halfAngleDeg * Math.PI) / 180;
        const r = drone.range * s;
        octx.save();
        octx.beginPath();
        octx.moveTo(sx, sy);
        octx.arc(sx, sy, r, drone.facing - half, drone.facing + half);
        octx.closePath();
        octx.clip();
        const g = octx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, 'rgba(0,0,0,0.9)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = g;
        octx.fillRect(sx - r, sy - r, r * 2, r * 2);
        octx.restore();
        punch(drone.x, drone.y, 1.1, 0.75);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(overlay, 0, 0);
      if (sim.flash > 0) {
        ctx.fillStyle = `rgba(248,60,60,${0.26 * sim.flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    function renderScreenText(map: WorldMap, s: number, w: number, h: number, dpr: number): void {
      if (ctx == null) {
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = 'center';
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      for (const label of map.labels) {
        const [sx, sy] = worldToScreen(s, w, h, label.x + 0.5, label.y + 0.5);
        // Room names are signage, not world objects: keep them readable by
        // nudging them inside the frame instead of letting them be cut off.
        const half = ctx.measureText(label.text).width / 2 + 10 * dpr;
        if (sy < -20 || sy > h + 20) {
          continue;
        }
        ctx.fillStyle = 'rgba(125,143,158,0.5)';
        ctx.fillText(label.text, Math.min(w - half, Math.max(half, sx)), sy);
      }
      if (map.exit !== null && map.exit.open) {
        const [ex, ey] = worldToScreen(s, w, h, map.exit.x + 0.5, map.exit.y - 0.45);
        ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('NOTAUSGANG → ALLE HIERHER!', ex, ey);
      }
      // Anything you need to walk to gets an arrow at the screen edge while
      // it is out of sight — in the dark that is the only way to find it.
      const edgeMarker = (wx: number, wy: number, color: string, label: string): void => {
        const [px, py] = worldToScreen(s, w, h, wx, wy);
        // Every target of an arrow punches its own hole in the darkness, so
        // once it is on screen it speaks for itself — drawing the arrow anyway
        // would stamp it on top of the thing it points at.
        if (px >= 0 && px <= w && py >= 0 && py <= h) {
          return;
        }
        const margin = 34 * dpr;
        const top = Math.max(margin, (safeTopCss + 16) * dpr);
        const cx = Math.min(w - margin, Math.max(margin, px));
        const cy = Math.min(h - margin, Math.max(top, py));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(py - h / 2, px - w / 2));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(13 * dpr, 0);
        ctx.lineTo(-8 * dpr, 9 * dpr);
        ctx.lineTo(-8 * dpr, -9 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (label !== '') {
          const tiles = Math.round(Math.hypot(wx - sim.self.x, wy - sim.self.y));
          ctx.fillStyle = color;
          ctx.font = `700 ${11 * dpr}px ui-monospace, Menlo, monospace`;
          ctx.textAlign = 'center';
          // Caption below the arrow, except near the bottom where that would
          // push it off the frame.
          ctx.fillText(`${label} ${tiles}m`, cx, py > h / 2 ? cy - 20 * dpr : cy + 26 * dpr);
        }
      };

      for (const panel of map.sabotage?.panels ?? []) {
        edgeMarker(panel.x + 0.5, panel.y + 0.5, panel.occupied ? '#2dd4bf' : '#f87171', 'VENTIL');
      }
      if (map.sabotage === null) {
        const carried = map.items.find(
          (item) => item.carriedBy === viewRef.current.you.id && !item.delivered,
        );
        if (carried !== undefined) {
          edgeMarker(carried.deliverTo.x + 0.5, carried.deliverTo.y + 0.5, '#60a5fa', 'ABGABE');
        } else if (map.exit !== null && map.exit.open) {
          edgeMarker(map.exit.x + 0.5, map.exit.y + 0.5, '#4ade80', 'AUSGANG');
        } else {
          const goal = armedStationOf(map);
          const loose = map.items.find((item) => !item.delivered && item.carriedBy === null);
          if (loose !== undefined) {
            edgeMarker(loose.x, loose.y, '#60a5fa', 'TEIL');
          }
          if (goal !== null) {
            edgeMarker(goal.x + 0.5, goal.y + 0.5, '#2dd4bf', 'STATION');
          }
        }
      }
      const action =
        viewRef.current.puzzle === null
          ? contextAction(map, sim.self, viewRef.current.you.id)
          : null;
      if (action !== null) {
        const [sx, sy] = worldToScreen(s, w, h, action.x, action.y);
        ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        const tw = ctx.measureText(action.label).width + 16 * dpr;
        ctx.fillStyle = 'rgba(7,11,15,0.88)';
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.roundRect(sx - tw / 2, sy - 11 * dpr, tw, 20 * dpr, 5 * dpr);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#2dd4bf';
        ctx.fillText(action.label, sx, sy + 4 * dpr);
      }
      renderChatBubbles(s, w, h, dpr);

      // A standing reminder while hands are full.
      const carrying = map.items.find(
        (item) => item.carriedBy === viewRef.current.you.id && !item.delivered,
      );
      if (carrying !== undefined) {
        ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = '#60a5fa';
        ctx.fillText(`📦 ${carrying.label} — [Q] ablegen`, w / 2, h - 16 * dpr);
      }
    }

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const map = viewRef.current.map;
      if (map !== null) {
        step(dt, map);
        render(map);
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
      simRef.current = null;
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

  const touchInteract = (): void => {
    const map = view.map;
    const sim = simRef.current;
    if (map === null || sim === null || inputLocked || view.puzzle !== null) {
      return;
    }
    const station = armedStationOf(map);
    if (station !== null) {
      const dist = Math.hypot(sim.self.x - (station.x + 0.5), sim.self.y - (station.y + 0.5));
      if (dist <= INTERACT_RADIUS) {
        stationChirp();
        send({ kind: 'interact' });
      }
    }
  };

  return (
    <div className="world-wrap">
      <canvas ref={canvasRef} className={`world-canvas ${spectator ? 'world-canvas--wide' : ''}`} />
      {tip !== null && <div className="coach">{tip.text}</div>}
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
        <button className="world-interact" onClick={touchInteract}>
          ⚡ [E]
        </button>
        <button
          className="world-chat-toggle"
          onClick={() => setWheelOpen((open) => !open)}
          aria-expanded={wheelOpen}
        >
          💬 [C]
        </button>
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
