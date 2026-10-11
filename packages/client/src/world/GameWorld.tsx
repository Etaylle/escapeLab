import { useEffect, useRef } from 'react';
import type { ClientMessage, PlayerPosition, PlayerView } from '@escapelab/core';
import {
  drawDoor,
  drawPlate,
  drawScientist,
  drawStation,
  makeFloorTile,
  makeWallTile,
} from './art.js';
import { doorSlide, footstep, powerDrain, startAmbience, stationChirp, stopAmbience } from './audio.js';

const PLAYER_COLORS = ['#2dd4bf', '#f472b6', '#fbbf24', '#60a5fa'];
const SPEED = 4.2; // tiles per second
const RADIUS = 0.28; // collision half-size
const INTERACT_RADIUS = 1.5; // prompt + client-side gate (server allows 1.6)
const POS_SEND_MS = 80;

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  inputLocked: boolean;
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
  flash: number;
  lastPenaltySeq: number;
  time: number;
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

/** A door bar is horizontal when its left/right neighbors are barriers. */
function isHorizontalDoor(map: WorldMap, x: number, y: number): boolean {
  const doorCells = new Set(map.doors.map((d) => `${d.x},${d.y}`));
  const barrier = (bx: number, by: number): boolean =>
    map.tiles[by]?.charAt(bx) === '#' || doorCells.has(`${bx},${by}`);
  return barrier(x - 1, y) && barrier(x + 1, y);
}

export function GameWorld({ view, positionsRef, inputLocked, send }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lockedRef = useRef(inputLocked);
  lockedRef.current = inputLocked;
  const sendRef = useRef(send);
  sendRef.current = send;
  const simRef = useRef<Sim | null>(null);

  useEffect(() => {
    if (lockedRef.current) {
      simRef.current?.keys.clear();
    }
  }, [inputLocked]);

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

    const sim: Sim = {
      adopted: false,
      self: { x: 0, y: 0, facing: 0, moving: false },
      others: new Map(),
      keys: new Set(),
      doors: new Map(),
      walkPhase: 0,
      stepAcc: 0,
      cam: { x: 0, y: 0 },
      flash: 0,
      lastPenaltySeq: viewRef.current.penaltySeq,
      time: 0,
    };
    simRef.current = sim;
    startAmbience();

    function tryInteract(): void {
      const map = viewRef.current.map;
      if (map === null || lockedRef.current || viewRef.current.puzzle !== null) {
        return;
      }
      const station = armedStationOf(map);
      if (station === null) {
        return;
      }
      const dist = Math.hypot(sim.self.x - (station.x + 0.5), sim.self.y - (station.y + 0.5));
      if (dist <= INTERACT_RADIUS) {
        stationChirp();
        sendRef.current({ kind: 'interact' });
      }
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
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      sim.keys.delete(e.key.toLowerCase());
    };
    const onBlur = (): void => {
      sim.keys.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const lastSent = { x: NaN, y: NaN, facing: NaN, moving: false };
    const posTimer = setInterval(() => {
      if (!sim.adopted) {
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
      const youId = viewRef.current.you.id;
      if (!sim.adopted) {
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

      // penalty feedback
      if (viewRef.current.penaltySeq > sim.lastPenaltySeq) {
        sim.lastPenaltySeq = viewRef.current.penaltySeq;
        sim.flash = 1;
        powerDrain();
      }
      sim.flash = Math.max(0, sim.flash - dt / 0.9);

      // camera
      const ck = 1 - Math.exp(-dt * 6);
      sim.cam.x += (sim.self.x - sim.cam.x) * ck;
      sim.cam.y += (sim.self.y - sim.cam.y) * ck;
      sim.time += dt;
    }

    function worldToScreen(s: number, w: number, h: number, x: number, y: number): [number, number] {
      return [w / 2 + (x - sim.cam.x) * s, h / 2 + (y - sim.cam.y) * s];
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
      const s = Math.max(40, Math.min(72, h / 9.5));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04070a';
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(s, 0, 0, s, w / 2 - sim.cam.x * s, h / 2 - sim.cam.y * s);

      const x0 = Math.max(0, Math.floor(sim.cam.x - w / 2 / s) - 1);
      const x1 = Math.min(map.width - 1, Math.ceil(sim.cam.x + w / 2 / s) + 1);
      const y0 = Math.max(0, Math.floor(sim.cam.y - h / 2 / s) - 1);
      const y1 = Math.min(map.height - 1, Math.ceil(sim.cam.y + h / 2 / s) + 1);
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

      // avatars: remote first, local on top
      const colorOf = new Map(
        viewRef.current.players.map((p, i) => [p.id, PLAYER_COLORS[i % 4] ?? '#2dd4bf']),
      );
      const metaOf = new Map(viewRef.current.players.map((p) => [p.id, p]));
      for (const [id, other] of sim.others) {
        const meta = metaOf.get(id);
        ctx.save();
        ctx.translate(other.rx, other.ry + 0.3);
        drawScientist(ctx, {
          color: colorOf.get(id) ?? '#2dd4bf',
          name: meta?.name ?? '???',
          facing: other.facing,
          moving: other.moving,
          walkPhase: other.phase,
          isYou: false,
          connected: meta?.connected ?? true,
        });
        ctx.restore();
      }
      const you = metaOf.get(viewRef.current.you.id);
      ctx.save();
      ctx.translate(sim.self.x, sim.self.y + 0.3);
      drawScientist(ctx, {
        color: colorOf.get(viewRef.current.you.id) ?? '#2dd4bf',
        name: you?.name ?? 'DU',
        facing: sim.self.facing,
        moving: sim.self.moving,
        walkPhase: sim.walkPhase,
        isYou: true,
        connected: true,
      });
      ctx.restore();

      renderLighting(map, s, w, h);
      renderScreenText(map, s, w, h, dpr);
    }

    function renderLighting(map: WorldMap, s: number, w: number, h: number): void {
      if (octx == null || ctx == null) {
        return;
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      const base = 0.92 + 0.02 * Math.sin(sim.time * 1.7);
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

      punch(sim.self.x, sim.self.y, 4.6, 1);
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
        ctx.fillStyle = 'rgba(125,143,158,0.5)';
        ctx.fillText(label.text, sx, sy);
      }
      const station = armedStationOf(map);
      if (station !== null && viewRef.current.puzzle === null) {
        const dist = Math.hypot(sim.self.x - (station.x + 0.5), sim.self.y - (station.y + 0.5));
        if (dist <= INTERACT_RADIUS) {
          const [sx, sy] = worldToScreen(s, w, h, station.x + 0.5, station.y - 0.55);
          const text = `[E] ${station.title}`;
          ctx.font = `700 ${12 * dpr}px ui-monospace, Menlo, monospace`;
          const tw = ctx.measureText(text).width + 16 * dpr;
          ctx.fillStyle = 'rgba(7,11,15,0.88)';
          ctx.strokeStyle = '#2dd4bf';
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.roundRect(sx - tw / 2, sy - 11 * dpr, tw, 20 * dpr, 5 * dpr);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#2dd4bf';
          ctx.fillText(text, sx, sy + 4 * dpr);
        }
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
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="world-controls">
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
      </div>
      <p className="world-hint muted">
        Laufen: WASD/Pfeile · Aktivieren: E an der leuchtenden Station · Redet miteinander!
      </p>
    </div>
  );
}
