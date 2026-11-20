import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { audioEngine } from '../../world/audio.js';
import { MACHINE_DB, followDucks } from '../../world/mix.js';
import type { MissionTime } from '../../clock.js';
import { RunLine } from '../RunLine.js';
import { FlushPlay } from './play.js';
import { FlushInfo } from './FlushInfo.js';
import { GAMES, STRIP, drawStrip, overRows, score, setTextScale, statRows, trackWords } from './hud.js';
import { fit, type Fit } from './layout.js';
import { streakFactor } from './modern.js';
import { H, W } from './rules.js';
import type { RuleBook } from './settings.js';
import './flush.css';

/**
 * Ferret Flush on the break-room machine: its field as the page, aimed at with the mouse or a
 * finger — the sight is the game's own, the page neither scrolls nor selects, and a press on the
 * field is the game's alone —, its slim HUD bar, its menus on the field or, on a small screen, as
 * panels, and its Info. „Zurück" leads to the machine's select (`onBack`).
 */

let sitting: FlushPlay | null = null;
/** The one sitting at Ferret Flush for the page's life (play.ts). */
function playOf(): FlushPlay {
  sitting ??= new FlushPlay(() => {
    const engine = audioEngine();
    if (engine === null) return null;
    const follow = (param: AudioParam): (() => void) =>
      followDucks(engine, param, MACHINE_DB, engine.ctx.currentTime);
    return { ctx: engine.ctx, destination: engine.sfx, follow };
  });
  return sitting;
}

/** The keys of the game, by code; while its Info stands open only I, Esc and M. */
type Act = (play: FlushPlay, back: () => void) => void;
const KEYS: Readonly<Record<string, Act>> = {
  Digit1: (p) => p.pick('single'),
  Digit2: (p) => p.pick('pair'),
  Digit3: (p) => p.pick('clay'),
  Enter: (p) => p.confirm(),
  Space: (p) => p.confirm(),
  Escape: (p, back) => escape(p, back),
  KeyP: (p) => p.pause(!p.sitting.paused),
  KeyQ: (p) => p.quit(),
  KeyM: (p) => p.toggleSound(),
  KeyI: (p) => p.showInfo(),
};
const INFO_KEYS: Readonly<Record<string, Act>> = {
  KeyI: (p) => p.hideInfo(),
  Escape: (p) => p.hideInfo(),
  KeyM: (p) => p.toggleSound(),
};

/** Esc: the end back to the three games, the three games back to the select, else pause. */
function escape(play: FlushPlay, back: () => void): void {
  if (play.game.screen === 'over') play.choose('menu');
  else if (play.game.screen === 'title') back();
  else play.pause(!play.sitting.paused);
}

/** A key held with Ctrl, ⌘ or Alt: the browser's, not the game's. */
const combined = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey;

/** Enter or Space on a button: the button's own press. */
const pressing = (e: KeyboardEvent): boolean =>
  (e.code === 'Enter' || e.code === 'Space') &&
  e.target instanceof Element &&
  e.target.closest('button') !== null;

/** The game's keys, heard before the lab's, kept from them; Enter on a button stays the button's. */
function onKey(play: FlushPlay, e: KeyboardEvent, back: () => void): void {
  const act = (play.sitting.info ? INFO_KEYS : KEYS)[e.code];
  if (act === undefined || e.repeat || combined(e) || pressing(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  play.audio.unlock();
  act(play, back);
}

function useKeys(play: FlushPlay, back: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent): void => onKey(play, e, back);
    const away = (): void => {
      if (document.hidden || !document.hasFocus()) play.pause(true);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', away);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', away);
    };
  }, [play, back]);
}

/** The window's place for the field and the HUD, kept up to date. */
function usePlace(): Fit {
  const [place, setPlace] = useState(() => fit(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const resize = (): void => setPlace(fit(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return place;
}

/** A canvas `w × h` CSS px, drawn on at up to three device pixels a pixel, in `units`. */
function size(canvas: HTMLCanvasElement, w: number, h: number, units: readonly [number, number]): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.round(w * ratio);
  const height = Math.round(h * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.getContext('2d')?.setTransform(width / units[0], 0, 0, height / units[1], 0, 0);
}

/** The frames while the game stands open: the field and the strip drawn, canvases zeroed after. */
function useFrames(play: FlushPlay, field: RefObject<HTMLCanvasElement | null>, strip: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    let id = 0;
    const frame = (now: number): void => {
      play.fx.calm = document.documentElement.dataset['motion'] === 'reduce';
      play.frame(now, field.current?.getContext('2d') ?? null);
      const stripCtx = strip.current?.getContext('2d');
      if (stripCtx && play.game.screen !== 'title') drawStrip(stripCtx, play.game, play.fx);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    const canvases = [field.current, strip.current];
    return () => {
      cancelAnimationFrame(id);
      for (const canvas of canvases) if (canvas) canvas.width = canvas.height = 0;
    };
  }, [play, field, strip]);
}

/** Where a pointer is on the field, in its 1280 × 720 units. */
function onField(canvas: HTMLCanvasElement, e: React.PointerEvent): [number, number] {
  const box = canvas.getBoundingClientRect();
  return [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
}

/** The strip of ten targets, the pass mark in words, and the streak and wind of Modern. */
function Track({ play, strip, tall }: { play: FlushPlay; strip: RefObject<HTMLCanvasElement | null>; tall: number }) {
  const { game } = play;
  const streak = game.modern ? streakFactor(game.modern.streak) : 1;
  const wind = game.modern?.wind ?? 0;
  const way = wind > 0 ? '→' : '←';
  return (
    <div className="flush-track">
      <canvas ref={strip} aria-hidden="true" style={{ height: `${tall}px`, width: `${(tall * STRIP.w) / STRIP.h}px` }} />
      <span>{trackWords(game)}</span>
      {streak > 1 && <span className="flush-chip">Serie ×{streak}</span>}
      {wind !== 0 && <span className="flush-chip">{`Wind ${way} ${Math.abs(Math.round(wind))}`}</span>}
    </div>
  );
}

/** The HUD's buttons: Pause while a game is in play, the Info, the sound, the way back. */
function HudButtons({ play, onBack }: { play: FlushPlay; onBack: () => void }) {
  const { game, sitting } = play;
  return (
    <nav className="flush-buttons" aria-label="Spiel">
      {game.screen === 'playing' && (
        <button onClick={() => play.pause(!sitting.paused)}>{sitting.paused ? 'Weiter' : 'Pause'}</button>
      )}
      <button onClick={() => play.showInfo()}>Info</button>
      <button aria-pressed={play.audio.muted} onClick={() => play.toggleSound()}>
        {play.audio.muted ? 'Ton aus' : 'Ton an'}
      </button>
      <button onClick={onBack}>← Zurück</button>
    </nav>
  );
}

/** The strip's height on the page, by where the HUD stands. */
const stripTall = (place: Fit): number =>
  place.hud === 'side' ? 20 : place.hud === 'above' && place.rows > 1 ? 28 : 36;

function Hud({ play, strip, place, onBack }: { play: FlushPlay; strip: RefObject<HTMLCanvasElement | null>; place: Fit; onBack: () => void }) {
  const { game } = play;
  const title = GAMES.find((entry) => entry.mode === game.mode)?.title ?? '';
  const rules = play.rules() === 'modern' ? 'Modern' : 'Klassisch';
  const rows = place.rows > 1 ? ' flush-hud--rows' : '';
  return (
    <header className={`flush-hud flush-hud--${place.hud}${rows}`} hidden={game.screen === 'title'}>
      <div className="flush-round">
        <b>Runde {game.round}</b>
        <span>{`${title} · ${rules}`}</span>
      </div>
      <Track play={play} strip={strip} tall={stripTall(place)} />
      <div className="flush-score">
        <b>{score(play.fx.shown)}</b>
        <span>Rekord {score(Math.max(game.best[game.mode], game.score))}</span>
      </div>
      <HudButtons play={play} onBack={onBack} />
    </header>
  );
}

function RulesSwitch({ play }: { play: FlushPlay }) {
  const rules = play.rules();
  return (
    <fieldset className="flush-rules">
      <legend>Regeln</legend>
      {(['modern', 'classic'] as const satisfies readonly RuleBook[]).map((name) => (
        <button key={name} aria-pressed={rules === name} onClick={() => play.chooseRules(name)}>
          {name === 'modern' ? 'Modern' : 'Klassisch'}
        </button>
      ))}
    </fieldset>
  );
}

function List({ rows, hot = [] }: { rows: readonly [string, string][]; hot?: readonly number[] }) {
  return (
    <dl>
      {rows.flatMap(([name, value], i) => [
        <dt key={`t${i}`}>{name}</dt>,
        <dd key={`d${i}`} className={hot.includes(i) ? 'hot' : undefined}>
          {value}
        </dd>,
      ])}
    </dl>
  );
}

/** The menus as page panels, where the field is too small for its own (layout.ts `compact`). */
function Sheet({ play, onBack }: { play: FlushPlay; onBack: () => void }) {
  const { game, sitting } = play;
  if (sitting.info || !play.compact) return null;
  if (game.screen === 'title') {
    return (
      <section className="flush-sheet">
        <h1>Ferret Flush</h1>
        <p>Ein Schießstand im Sumpf. Ein Spiel antippen.</p>
        <div className="flush-games">
          {GAMES.map((entry) => (
            <button key={entry.mode} onClick={() => play.choose(entry.mode)}>
              <b>{entry.title}</b>
              <em>{game.best[entry.mode] ? `Rekord ${score(game.best[entry.mode])}` : 'Noch kein Ergebnis'}</em>
              <small>
                {entry.note} · Taste {entry.key}
              </small>
            </button>
          ))}
        </div>
        <RulesSwitch play={play} />
        <div className="flush-row">
          <button onClick={() => play.showInfo()}>Info</button>
          <button onClick={onBack}>← Zur Spielauswahl</button>
        </div>
      </section>
    );
  }
  if (game.screen === 'over') {
    return (
      <section className="flush-sheet">
        <h2>Spiel vorbei</h2>
        <List rows={overRows(game)} hot={game.newBest ? [0, 1] : [0]} />
        <div className="flush-row">
          <button className="arcade-primary" onClick={() => play.choose('again')}>
            Nochmal
          </button>
          <button onClick={() => play.choose('menu')}>Andere Spiele</button>
        </div>
        <List rows={statRows(game)} />
        <RulesSwitch play={play} />
        <button onClick={() => play.showInfo()}>Info</button>
      </section>
    );
  }
  return sitting.paused ? (
    <section className="flush-sheet">
      <h2>Pause</h2>
      <p>Die Enten warten.</p>
      <div className="flush-row">
        <button className="arcade-primary" onClick={() => play.pause(false)}>
          Weiter
        </button>
        <button onClick={() => play.choose('menu')}>Andere Spiele</button>
        <button onClick={() => play.showInfo()}>Info</button>
      </div>
    </section>
  ) : null;
}

/** Beside the menus drawn on the field (a wide screen): the rules and the Info. */
function Corner({ play }: { play: FlushPlay }) {
  const { game, sitting } = play;
  const menu = game.screen !== 'playing' || sitting.paused;
  if (!menu || play.compact || sitting.info) return null;
  return (
    <div className="flush-corner">
      {game.screen !== 'playing' && <RulesSwitch play={play} />}
      <button onClick={() => play.showInfo()}>Info</button>
    </div>
  );
}

function Field({ play, canvas, place }: { play: FlushPlay; canvas: RefObject<HTMLCanvasElement | null>; place: Fit }) {
  useEffect(() => {
    if (canvas.current) size(canvas.current, place.width, place.height, [W, H]);
    setTextScale(place.scale);
    play.compact = place.compact;
  }, [canvas, place, play]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => onField(e.currentTarget, e);
  return (
    <canvas
      ref={canvas}
      className="flush-field"
      style={{ width: `${place.width}px`, height: `${place.height}px` }}
      aria-label="Ferret Flush: ein Schießstand im Sumpf. Zielen mit der Maus, ein Klick schießt; die Tasten 1, 2 und 3 wählen ein Spiel, I öffnet die Info."
      onPointerMove={(e) => play.aim(...at(e), true)}
      onPointerLeave={() => play.aim(play.pointer.x, play.pointer.y, false)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        play.press(...at(e), e.pointerType === 'touch');
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Ferret Flush on the machine; `run` the run going on around the player, its clock said. */
export default function FlushMachine({ onBack, run }: { onBack: () => void; run: MissionTime | null }) {
  const play = playOf();
  useSyncExternalStore(play.subscribe, play.getVersion);
  const field = useRef<HTMLCanvasElement>(null);
  const strip = useRef<HTMLCanvasElement>(null);
  const place = usePlace();
  useKeys(play, onBack);
  useFrames(play, field, strip);
  useEffect(() => () => play.leave(), [play]);
  useEffect(() => {
    if (strip.current) {
      const tall = strip.current.getBoundingClientRect().height || 36;
      size(strip.current, (tall * STRIP.w) / STRIP.h, tall, [STRIP.w, STRIP.h]);
    }
  }, [place, play.game.screen]);
  return (
    <div className={`arcade flush flush--${place.hud}`} role="dialog" aria-modal="true" aria-label="Spielautomat: Ferret Flush">
      {run !== null && <RunLine run={run} />}
      <div className="flush-stage">
        <Hud play={play} strip={strip} place={place} onBack={onBack} />
        <div className="flush-box">
          <Field play={play} canvas={field} place={place} />
          <Corner play={play} />
        </div>
      </div>
      <Sheet play={play} onBack={onBack} />
      {play.sitting.info && <FlushInfo play={play} />}
    </div>
  );
}
