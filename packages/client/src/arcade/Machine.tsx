import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioEngine } from '../world/audio.js';
import { HEIGHT, WIDTH } from './rules.js';
import { MOVE_KEYS } from './input.js';
import { Session, BANNER_MS } from './session.js';
import { Hud, Chips, BannerView, TouchPad } from './MachineHud.js';
import { Card } from './MachineCard.js';
import { InfoPanel } from './MachineInfo.js';
import { MachineMenu } from './MachineMenu.js';
import { TITLE } from './texts.js';
import './machine.css';

/**
 * The break-room machine, open over the lab: „Ferret vs Ducks" in a frame of the plant's look,
 * with the reference's menu, field, HUD, cards and Info. While a game runs the field is the page.
 * The machine sends nothing anywhere: it plays into the lab's mix (sound.ts) and keeps its bests
 * in this browser (scores.ts). Closing it — „Zurück", Esc with nothing running, or the door
 * (door.ts) — pauses the game, which waits for the next time.
 */

/** The one sitting at the machine for the page's life (session.ts). */
let sitting: Session | null = null;
function session(): Session {
  sitting ??= new Session(() => {
    const engine = audioEngine();
    return engine === null ? null : { ctx: engine.ctx, destination: engine.sfx };
  });
  return sitting;
}

/** Whether the key's target is a control that takes Enter itself. */
const onControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && ['INPUT', 'BUTTON', 'A'].includes(target.tagName);

/** The keys over the Info menu: Esc and I close it. True where the key was taken. */
function infoKey(s: Session, e: KeyboardEvent): boolean {
  if (!s.info.open) return false;
  if (e.code === 'Escape' || e.code === 'KeyI') {
    e.preventDefault();
    s.closeInfo();
  }
  return true;
}

/**
 * The machine's keys, heard before the lab's (capture): I the Info, Enter the card's first way,
 * P and Esc pause a running game, Esc with none running leaves, and the moves and fire while
 * one runs. Every key the machine takes is the machine's alone (`preventDefault`).
 */
function onKeyDown(s: Session, e: KeyboardEvent, leave: () => void): void {
  if (infoKey(s, e)) return;
  const g = s.game;
  const running = g !== null && g.state !== 'paused' && g.state !== 'game-over' && g.state !== 'turn-change';
  const take = (act: () => void): void => {
    e.preventDefault();
    act();
  };
  if (e.code === 'KeyI' && !e.repeat) take(() => s.openInfo());
  else if (e.code === 'Escape' && !running) take(leave);
  else if (e.code === 'Enter' && !onControl(e.target)) take(() => s.primary());
  else if ((e.code === 'KeyP' || e.code === 'Escape') && g && !e.repeat) take(() => s.togglePause());
  else if (g?.state === 'playing' && MOVE_KEYS.includes(e.code)) take(() => s.input.key(e.code, true));
}

/** The canvas at one canvas pixel per device pixel, drawing in the field's 800 × 680 units. */
function fit(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(WIDTH / 4, Math.round(box.width * (window.devicePixelRatio || 1)));
  if (canvas.width !== width) {
    canvas.width = width;
    canvas.height = Math.round((width * HEIGHT) / WIDTH);
  }
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

/** The frame loop while the machine stands open; the canvas zeroed as it closes. */
function useFrames(s: Session, canvas: React.RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    let id = 0;
    const frame = (now: number): void => {
      if (el && ctx) fit(el, ctx);
      s.fx.reduced = document.documentElement.dataset['motion'] === 'reduce';
      const touch = s.choice.controls === 'touch' && s.settings.values.autofire;
      s.frame(now, ctx, touch);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(id);
      if (el) el.width = el.height = 0;
    };
  }, [s, canvas]);
}

/** The machine's keys on the window, and the game paused as the page loses the player. */
function useMachineKeys(s: Session, leave: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent): void => onKeyDown(s, e, leave);
    const up = (e: KeyboardEvent): void => s.input.key(e.code, false);
    const away = (): void => {
      if (document.hidden || !document.hasFocus()) s.leave();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', away);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', away);
    };
  }, [s, leave]);
}

/** The banner of a new wave, taken down after BANNER_MS. */
function useBanner(s: Session, seq: number | undefined): void {
  useEffect(() => {
    if (seq === undefined) return undefined;
    const timer = setTimeout(() => {
      s.banner = null;
      s.changed();
    }, BANNER_MS);
    return () => clearTimeout(timer);
  }, [s, seq]);
}

/** The control that had the focus as the machine opened gets it back as it closes. */
function useFocusBack(): void {
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
}

/** Where a finger on the field points, in field units. */
function fieldX(canvas: HTMLCanvasElement, e: React.PointerEvent): number {
  const box = canvas.getBoundingClientRect();
  return ((e.clientX - box.left) / box.width) * WIDTH;
}

export default function Machine({ onLeave }: { onLeave: () => void }) {
  const s = session();
  useSyncExternalStore(s.subscribe, s.getVersion);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [leave] = useState(() => () => {
    s.leave();
    onLeave();
  });
  useFrames(s, canvas);
  useMachineKeys(s, leave);
  useBanner(s, s.banner?.seq);
  useFocusBack();
  useEffect(() => () => s.leave(), [s]);
  const g = s.game;
  const touch = g !== null && s.choice.controls === 'touch';
  const steer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'mouse' || g?.state !== 'playing') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    s.input.steer(e.pointerId, fieldX(e.currentTarget, e));
  };
  return (
    <div
      className={`arcade${g ? ' arcade--playing' : ''}${touch ? ' arcade--touch' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Spielautomat: ${TITLE}`}
    >
      <Hud s={s} onLeave={leave} />
      <div className="arcade-stage">
        <div className="arcade-field">
          <canvas
            ref={canvas}
            aria-label={`${TITLE}: ein Frettchen verteidigt seinen Bau gegen einen Schwarm Enten`}
            onPointerDown={steer}
            onPointerMove={(e) => {
              if (s.input.drag?.id === e.pointerId) s.input.steer(e.pointerId, fieldX(e.currentTarget, e));
            }}
            onPointerUp={(e) => s.input.release(e.pointerId)}
            onPointerCancel={(e) => s.input.release(e.pointerId)}
          />
          {g !== null && <Chips g={g} />}
          {g !== null && s.banner !== null && g.state === 'playing' && <BannerView banner={s.banner} />}
          {g !== null && <Card s={s} g={g} onLeave={leave} />}
        </div>
        {g === null && <MachineMenu s={s} onLeave={leave} />}
      </div>
      {touch && <TouchPad s={s} />}
      {s.info.open && <InfoPanel s={s} />}
    </div>
  );
}
