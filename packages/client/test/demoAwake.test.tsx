import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpectatorView } from '@escapelab/core';
import { SpectateScreen } from '../src/screens/Spectate.js';

/**
 * The audience's screen keeps the server awake while it shows the demo room, and only then
 * (keepAwake.ts): its effects run here as the page runs them, each one's cleanup kept.
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

/** The audience's screen shown, of the demo room or another; then taken down again. */
function shown(demo: boolean): void {
  vi.stubGlobal('window', { location: { origin: 'https://escapelab.test', pathname: '/' } });
  renderToStaticMarkup(
    <SpectateScreen
      view={LOBBY}
      finale={null}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      leaveRoom={noop}
      demo={demo}
    />,
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
