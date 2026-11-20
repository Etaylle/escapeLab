import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RUN_OVER_LINE,
  closeArcade,
  closingLine,
  doorNow,
  openArcade,
  waitOf,
  type Wait,
  type WaitFacts,
} from '../../src/arcade/door.js';
import { ArcadeButton, WaitContext } from '../../src/arcade/ArcadeDoor.js';
import { Session } from '../../src/arcade/session.js';
import { current } from '../../src/arcade/rules.js';
import { DUCK_DB, duckKnots, levelOn } from '../../src/world/mix.js';

/**
 * The break-room machine's door: where it may open, the moment it closes by itself and what the
 * plant says then, the game paused as it closes, the lab's music let back up, nothing sent from
 * it, and the machine itself kept out of the page's first load.
 */

const RUN: WaitFacts = {
  offRoom: false,
  phase: 'playing',
  lineLost: false,
  maintenance: false,
  missing: false,
};

afterEach(() => closeArcade());

describe('where the machine may open', () => {
  it('opens off any room, in a lobby, and in a run only while the player waits', () => {
    expect(waitOf({ ...RUN, offRoom: true, phase: null })).toBe('menu');
    expect(waitOf({ ...RUN, phase: 'lobby' })).toBe('lobby');
    expect(waitOf({ ...RUN, lineLost: true })).toBe('line');
    expect(waitOf({ ...RUN, maintenance: true, missing: true })).toBe('pause');
    expect(waitOf({ ...RUN, missing: true })).toBe('crew');
    expect(waitOf(RUN)).toBe(null);
    expect(waitOf({ ...RUN, phase: 'won', missing: true })).toBe(null);
    expect(waitOf({ ...RUN, phase: null })).toBe(null);
  });

  it('cannot be opened while a run is live and nothing is waited for', () => {
    openArcade(waitOf(RUN));
    expect(doorNow().open).toBe(false);
    const button = (wait: Wait) =>
      renderToStaticMarkup(
        <WaitContext value={wait}>
          <ArcadeButton />
        </WaitContext>,
      );
    expect(button(null)).toBe('');
    expect(button('crew')).toBe('<button class="arcade-open">Arcade</button>');
    openArcade('crew');
    expect(doorNow().open).toBe(true);
  });
});

describe('the machine closing by itself', () => {
  const lines = (from: Wait, to: Wait, phase: WaitFacts['phase']) => closingLine(from, to, phase);

  it('closes as the host starts the run, the line comes back, the plant runs, the crew is back', () => {
    expect(lines('lobby', null, 'playing')).toBe('Die Schicht beginnt.');
    expect(lines('lobby', 'crew', 'playing')).toBe('Die Schicht beginnt.');
    expect(lines('line', null, 'playing')).toBe('Die Leitung steht wieder.');
    expect(lines('pause', null, 'playing')).toBe('Die Anlage läuft wieder.');
    expect(lines('crew', null, 'playing')).toBe('Der Einsatz geht weiter.');
    expect(lines('crew', null, 'lost')).toBe(RUN_OVER_LINE);
  });

  it('stays open from one wait of a run to the next, and closes without a word as a room goes', () => {
    expect(lines('line', 'pause', 'playing')).toBeUndefined();
    expect(lines('crew', 'line', 'playing')).toBeUndefined();
    expect(lines('lobby', 'lobby', 'lobby')).toBeUndefined();
    expect(lines('lobby', 'menu', null)).toBe(null);
    expect(lines('menu', 'lobby', 'lobby')).toBe(null);
  });

  it('takes the machine down with the line, and the line goes once read', () => {
    openArcade('lobby');
    closeArcade('Die Schicht beginnt.');
    expect(doorNow()).toEqual({ open: false, line: 'Die Schicht beginnt.' });
    closeArcade();
    expect(doorNow()).toEqual({ open: false, line: null });
  });
});

describe('a game at the machine as it closes', () => {
  const memory = () => {
    const db = new Map<string, string>();
    return { getItem: (k: string) => db.get(k) ?? null, setItem: (k: string, v: string) => void db.set(k, v) };
  };

  it('pauses mid-game, waits paused for the next time, and plays on from there', () => {
    const s = new Session(() => null, memory());
    s.start();
    const g = s.game;
    if (g === null) throw new Error('no game');
    // The flock holds its fire: the game is to stand in play, not end in a hit.
    current(g).fire = -1000;
    for (let t = 0; t <= 2000; t += 16) s.frame(t, null, false);
    expect(g.state).toBe('playing');
    const at = g.time;
    s.leave();
    expect(g.state).toBe('paused');
    for (let t = 2016; t <= 4000; t += 16) s.frame(t, null, false);
    expect(g.time).toBe(at);
    s.primary();
    for (let t = 4016; t <= 5000; t += 16) s.frame(t, null, false);
    expect(g.state).toBe('playing');
    expect(g.time).toBeGreaterThan(at);
    expect(current(g).lives).toBe(3);
  });
});

describe('the lab’s music under the machine', () => {
  it('goes 30 dB down and the beds 18 while it stands open, and back to full after', () => {
    const open = new Map([['arcade', { from: 1, until: 5 }]] as const);
    const music = duckKnots(open, DUCK_DB.music, 0, 1);
    const beds = duckKnots(open, DUCK_DB.ambience, 0, 1);
    expect(levelOn(music, 3)).toBeCloseTo(10 ** (-30 / 20), 9);
    expect(levelOn(beds, 3)).toBeCloseTo(10 ** (-18 / 20), 9);
    expect(levelOn(music, 6)).toBe(1);
    expect(levelOn(beds, 6)).toBe(1);
  });
});

const SRC = new URL('../../src/', import.meta.url);

/** The source of module `m` (a path under src/ without its ending). */
function sourceOf(m: string): string {
  for (const ending of ['.ts', '.tsx']) {
    try {
      return readFileSync(new URL(`${m}${ending}`, SRC), 'utf8');
    } catch {
      // Not this ending: the other.
    }
  }
  throw new Error(`no module ${m}`);
}
/** The modules `m` imports by value (not types, not `import()`), as paths under src/. */
function staticImports(m: string): string[] {
  const found = [...sourceOf(m).matchAll(/^import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?'(\.[^']+)'/gm)];
  return found
    .map(([, spec = '']) => new URL(spec, new URL(m, SRC)).pathname.slice(SRC.pathname.length))
    .filter((path) => !path.endsWith('.css'))
    .map((path) => path.replace(/\.js$/, ''));
}
/** Every module loaded with `entry` by static imports, followed only where `follow` says. */
function graphOf(entry: string, follow: (m: string) => boolean = () => true): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const next = queue.pop() ?? '';
    if (seen.has(next)) continue;
    seen.add(next);
    if (follow(next)) queue.push(...staticImports(next));
  }
  return seen;
}

describe('the machine as the page carries it', () => {
  it('comes in a chunk of its own: the page’s first load holds its door alone', () => {
    const entry = [...graphOf('main')].filter((m) => m.startsWith('arcade/'));
    expect(entry.sort()).toEqual(['arcade/ArcadeDoor', 'arcade/door']);
    expect(sourceOf('arcade/ArcadeDoor')).toContain("lazy(() => import('./Machine.js'))");
  });

  it('sends nothing: it reaches the lab only for its sound, never the line or the server', () => {
    const inMachine = (m: string): boolean => m.startsWith('arcade/');
    const machine = [...graphOf('arcade/Machine', inMachine), ...graphOf('arcade/ArcadeDoor', inMachine)];
    expect(machine).toContain('arcade/session');
    expect([...new Set(machine.filter((m) => !inMachine(m)))].sort()).toEqual([
      'world/audio',
      'world/mix',
    ]);
    for (const m of machine.filter(inMachine)) {
      expect(sourceOf(m), m).not.toMatch(/\bsend\(|ClientMessage|@escapelab\/core/);
    }
  });
});
