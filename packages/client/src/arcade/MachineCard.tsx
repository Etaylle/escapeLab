import { useEffect, useRef } from 'react';
import { current, type Game } from './rules.js';
import type { Session } from './session.js';
import { DIFFICULTY_LABELS, REASONS } from './texts.js';

/**
 * The machine's cards over its field (the reference's overlay): the game paused, a wave won, the
 * next player's turn, the game over with its bests and its numbers. The first way is Enter's.
 */

const pct = (hits: number, shots: number): number => (shots ? Math.round((100 * hits) / shots) : 0);

/** What the end of a game says: why, each score, a new best, the winner of two. */
export function gameOverCopy(g: Game, best: number, initialBest: number): string {
  const top = Math.max(...g.players.map((p) => p.score));
  const lines = [
    REASONS[g.reason] ?? g.reason,
    ...g.players.map((p, i) => `Spieler ${i + 1}: ${p.score} Punkte`),
    top > initialBest ? 'NEUER PERSÖNLICHER REKORD!' : `Rekord: ${best}`,
  ];
  const [a, b] = g.players;
  if (a && b) {
    lines.push(a.score === b.score ? 'Unentschieden – federleicht.' : `Spieler ${a.score > b.score ? 1 : 2} gewinnt!`);
  }
  return lines.join('\n');
}

/** Each player's numbers at the end: the wave reached, the share of hits, the longest chain. */
export function statsOf(g: Game): string {
  return g.players
    .map((p, i) => `S${i + 1}: Welle ${p.wave} · ${pct(p.hits, p.shotCount)} % Treffer · beste Kette ${p.bestChain}`)
    .join('\n');
}

interface Face {
  title: string;
  copy: string;
  primary: string | null;
}

/** What the card says in each state of the game; null where none stands. */
export function faceOf(s: Pick<Session, 'initialBest' | 'scores'>, g: Game): Face | null {
  const p = current(g);
  switch (g.state) {
    case 'paused':
      return { title: 'Kurze Pfotenpause.', copy: 'Der Bau kann warten.\nP drückt weiter, Esc führt zurück ins Labor.', primary: 'Weiter' };
    case 'wave-clear':
      return { title: 'Schwarm besiegt!', copy: `Welle ${p.wave} geschafft.\nFrische Deckungen. Mehr Federn im Anflug.`, primary: null };
    case 'turn-change':
      return { title: `Spieler ${g.active + 1} ist dran.`, copy: `${p.lives} Leben · ${p.score} Punkte · Welle ${p.wave}\nDas Feld wartet.`, primary: 'Bereit' };
    case 'game-over':
      return { title: 'Das war’s, Schwarm.', copy: gameOverCopy(g, s.scores().values[g.difficulty], s.initialBest), primary: 'Nochmal' };
    default:
      return null;
  }
}

/** The card's ways besides its first: start anew while paused, the Info, the menu, the lab. */
function CardWays({ s, paused, onLeave }: { s: Session; paused: boolean; onLeave: () => void }) {
  return (
    <>
      {paused && <button onClick={() => s.start()}>Neu starten</button>}
      <button onClick={() => s.openInfo()}>ⓘ Info</button>
      <button onClick={() => s.toMenu()}>Zum Automatenmenü</button>
      <button className="arcade-quiet" onClick={onLeave}>
        Zurück ins Labor
      </button>
    </>
  );
}

export function Card({ s, g, onLeave }: { s: Session; g: Game; onLeave: () => void }) {
  const face = faceOf(s, g);
  const first = useRef<HTMLButtonElement>(null);
  const state = g.state;
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, [state]);
  if (face === null) return null;
  return (
    <div className="arcade-overlay">
      <div className="arcade-card">
        <span className="arcade-kicker">
          SPIELER {g.active + 1} / {DIFFICULTY_LABELS[g.difficulty].toUpperCase()} / {g.classic ? 'KLASSISCH' : 'MODERN'}
        </span>
        <h2>{face.title}</h2>
        <p>{face.copy}</p>
        {state === 'game-over' && <p className="arcade-stats-line">{statsOf(g)}</p>}
        {face.primary !== null && (
          <button ref={first} className="arcade-primary" onClick={() => s.primary()}>
            {face.primary} <span aria-hidden="true">→</span>
          </button>
        )}
        {state !== 'wave-clear' && <CardWays s={s} paused={state === 'paused'} onLeave={onLeave} />}
      </div>
    </div>
  );
}
