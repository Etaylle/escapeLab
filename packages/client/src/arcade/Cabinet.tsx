import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { MissionTime } from '../clock.js';
import { pageStorage } from './scores.js';
import { GAME_IDS, lastGame, rememberGame, selectStep, type GameId } from './select.js';
import { RunLine } from './RunLine.js';
import './cabinet.css';

/**
 * The break-room machine itself: its first screen, the select — both games as two large cards,
 * a picture each drawn by the game's own code —, and the game chosen. Each game comes in a chunk
 * of its own the first time it is chosen; its picture as well, a moment after the select shows.
 * „Zurück" from a game leads back here, from here out of the machine (`onLeave`); the door
 * (door.ts) closes it from any of its screens. The game played last is the one lit.
 */

const DUCKS = lazy(() => import('./Machine.js'));
const FLUSH = lazy(() => import('./flush/FlushMachine.js'));

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

const CARDS: Readonly<Record<GameId, { name: string; line: string; draw: () => Promise<Draw> }>> = {
  ducks: {
    name: 'Ferret vs Ducks',
    line: 'Ein Frettchen verteidigt seinen Bau gegen einen Schwarm Enten.',
    draw: () => import('./preview.js').then((m) => m.drawPreview),
  },
  flush: {
    name: 'Ferret Flush',
    line: 'Ein Schießstand im Sumpf: drei Patronen, zehn Ziele je Runde.',
    draw: () => import('./flush/preview.js').then((m) => m.drawPreview),
  },
};

/** A card's picture: drawn by the game's own code once its little chunk is there, then moving. */
function Picture({ id }: { id: GameId }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frame = 0;
    let gone = false;
    const el = canvas.current;
    void CARDS[id].draw().then((draw) => {
      const ctx = el?.getContext('2d');
      if (gone || !el || !ctx) return;
      const step = (now: number): void => {
        draw(ctx, el.width, el.height, now / 1000);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      if (el) el.width = el.height = 0;
    };
  }, [id]);
  return <canvas ref={canvas} className="arcade-card-picture" width={320} height={180} aria-hidden="true" />;
}

/** What a key does on the select: Esc leaves, Enter off a card takes the lit one, else a step. */
function selectAct(
  e: KeyboardEvent,
  at: number,
  ways: { light: (i: number) => void; take: (id: GameId) => void; leave: () => void },
): (() => void) | null {
  if (e.code === 'Escape') return ways.leave;
  const id = GAME_IDS[at];
  if (e.code === 'Enter') {
    return e.target instanceof HTMLButtonElement || id === undefined ? null : () => ways.take(id);
  }
  const step = selectStep(at, e.code);
  return step === null ? null : () => ways.light(step);
}

/** The select's keys, heard before the lab's: ←/→ or 1/2 light a card, Enter takes it, Esc leaves. */
function useSelectKeys(at: number, light: (i: number) => void, take: (id: GameId) => void, leave: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const act = selectAct(e, at, { light, take, leave });
      if (act === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      act();
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [at, light, take, leave]);
}

function Select({ last, take, onLeave, run }: { last: GameId; take: (id: GameId) => void; onLeave: () => void; run: MissionTime | null }) {
  const [at, setAt] = useState(Math.max(0, GAME_IDS.indexOf(last)));
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const light = (i: number): void => {
    setAt(i);
    cards.current[i]?.focus({ preventScroll: true });
  };
  useEffect(() => cards.current[at]?.focus({ preventScroll: true }), [at]);
  useSelectKeys(at, light, take, onLeave);
  return (
    <div className="arcade arcade-select" role="dialog" aria-modal="true" aria-label="Spielautomat">
      <header className="arcade-select-head">
        <span className="arcade-kicker">PAUSENRAUM · SPIELAUTOMAT</span>
        <h1>Spielauswahl</h1>
        <button className="arcade-back" onClick={onLeave}>
          ← Zurück
        </button>
      </header>
      {run !== null && <RunLine run={run} />}
      <div className="arcade-cards">
        {GAME_IDS.map((id, i) => (
          <button
            key={id}
            ref={(el) => {
              cards.current[i] = el;
            }}
            className="arcade-game-card"
            aria-current={i === at}
            onFocus={() => setAt(i)}
            onClick={() => take(id)}
          >
            <Picture id={id} />
            <b>{CARDS[id].name}</b>
            <span>{CARDS[id].line}</span>
            <small>Taste {i + 1}</small>
          </button>
        ))}
      </div>
      <p className="arcade-hint">← → oder 1 · 2 wählen, Enter startet, Esc führt zurück ins Labor.</p>
    </div>
  );
}

/** The machine over the lab; `run` the run going on around the player, its clock said. */
export default function Cabinet({ onLeave, run }: { onLeave: () => void; run: MissionTime | null }) {
  const [last, setLast] = useState(() => lastGame(pageStorage()));
  const [game, setGame] = useState<GameId | null>(null);
  const take = (id: GameId): void => {
    rememberGame(pageStorage(), id);
    setLast(id);
    setGame(id);
  };
  const back = (): void => setGame(null);
  if (game === null) return <Select last={last} take={take} onLeave={onLeave} run={run} />;
  return (
    <Suspense fallback={<div className="arcade arcade-select" aria-busy="true" />}>
      {game === 'ducks' ? <DUCKS onLeave={back} run={run} /> : <FLUSH onBack={back} run={run} />}
    </Suspense>
  );
}
