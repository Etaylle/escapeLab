import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpectatorView } from '@escapelab/core';
import { DemoScreen } from '../src/screens/Demo.js';
import { SpectateScreen } from '../src/screens/Spectate.js';

/**
 * The demo room's own screen keeps the server awake for as long as it stands (keepAwake.ts), and
 * no other audience's does: its effects run here as the page runs them, each one's cleanup kept.
 */

const awake = vi.hoisted(() => ({ kept: 0, stopped: 0, cleanups: [] as (() => void)[] }));

vi.mock('../src/keepAwake.js', () => ({
  keepAwake: () => {
    awake.kept += 1;
    return () => {
      awake.stopped += 1;
    };
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      awake.cleanups.push(cleanup);
    }
  },
}));

const noop = (): void => undefined;

const LOBBY = {
  phase: 'lobby',
  missionTitle: 'Blackout im Labor',
  difficulty: 'normal',
  currentPuzzleIndex: 0,
  puzzleCount: 6,
  penaltySeq: 0,
  pausedAt: null,
  startedAt: null,
  deadlineAt: null,
  lights: { out: false, outAt: null },
  players: [],
  panels: [],
  events: [],
  away: [],
  puzzle: null,
  edgework: null,
  map: null,
} as unknown as SpectatorView;

/** What every audience's screen is handed. */
const WORLD = {
  view: LOBBY,
  finale: null,
  positionsRef: { current: { run: null, players: {} } },
  dronesRef: { current: {} },
  pingsRef: { current: [] },
  chatsRef: { current: [] },
  leaveRoom: noop,
};

/** The audience's screen shown, the demo room's own or another room's; then taken down again. */
function shown(demo: boolean): void {
  const location = { origin: 'https://escapelab.test', pathname: '/' };
  vi.stubGlobal('window', { location, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: noop });
  renderToStaticMarkup(
    demo ? (
      <DemoScreen
        {...WORLD}
        feed={{ shot: null, views: {} }}
        send={noop}
        listen={() => noop}
        line={{ status: 'open', retry: null, wake: noop, giveUp: noop }}
      />
    ) : (
      <SpectateScreen {...WORLD} />
    ),
  );
  awake.cleanups.splice(0).forEach((cleanup) => cleanup());
}

afterEach(() => {
  vi.unstubAllGlobals();
  awake.kept = 0;
  awake.stopped = 0;
});

describe('the audience’s screen and the server’s sleep', () => {
  it('keeps the server awake while the demo room is watched, and stops as the screen goes', () => {
    shown(true);
    expect([awake.kept, awake.stopped]).toEqual([1, 1]);
  });

  it('asks nothing of the server for any other room', () => {
    shown(false);
    expect([awake.kept, awake.stopped]).toEqual([0, 0]);
  });
});
