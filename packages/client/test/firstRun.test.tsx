import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionInfo, PlayerView } from '@escapelab/core';
import {
  FIRST_RUN_HINT,
  FIRST_RUN_LINE,
  firstDifficulty,
  hasWon,
  isTutorial,
  markWon,
  WON_KEY,
} from '../src/firstRun.js';
import { createRoomMessage, JoinScreen, MissionCard } from '../src/screens/Join.js';
import { Levels, LobbyScreen } from '../src/screens/Lobby.js';

const noop = (): void => undefined;

/** The browser's storage as far as the flag goes, in memory. */
function memory(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

/** Storage that refuses everything, as a browser with site data switched off. */
const refusing = {
  getItem: (): string | null => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: (): void => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: (): void => undefined,
};

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
};
const tutorial: MissionInfo = {
  ...blackout,
  id: 'systemcheck',
  title: 'Tutorial: Systemcheck',
  timeLimitSec: 420,
  puzzleCount: 4,
};

describe('a device’s first run', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is over once this device has seen a run won, and the browser keeps that', () => {
    const store = memory();
    expect(hasWon(store)).toBe(false);
    markWon(store);
    expect(store.data.get(WON_KEY)).toBe('1');
    expect(WON_KEY).toBe('escapelab.won');
    expect(hasWon(store)).toBe(true);
  });

  it('lasts where the browser keeps nothing, without a word thrown', () => {
    expect(hasWon(null)).toBe(false);
    expect(hasWon(refusing)).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    expect(() => markWon(refusing)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('opens its rooms on „entspannt" until then, on normal after', () => {
    expect(firstDifficulty(false)).toBe('entspannt');
    expect(firstDifficulty(true)).toBe('normal');
    expect(createRoomMessage('Anna', 'blackout', '', 'entspannt')).toEqual({
      kind: 'create-room',
      name: 'Anna',
      missionId: 'blackout',
      difficulty: 'entspannt',
    });
    expect(createRoomMessage('Anna', null, '?seed=4', 'normal')).toEqual({
      kind: 'create-room',
      name: 'Anna',
      seed: 4,
      difficulty: 'normal',
    });
  });

  it('knows the tutorial by its title', () => {
    expect(isTutorial(tutorial)).toBe(true);
    expect(isTutorial(blackout)).toBe(false);
  });
});

describe('the lobby’s difficulty for a first crew', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says why „entspannt" stands picked, under the levels, while it does', () => {
    const first = renderToStaticMarkup(<Levels current="entspannt" pick={noop} firstRun />);
    expect(FIRST_RUN_LINE).toBe(
      'Erster Einsatz: entspannt vorgewählt — ohne Alarmlimit, mehr Zeit.',
    );
    expect(first).toContain(`<p class="muted lobby-first-run">${FIRST_RUN_LINE}</p>`);
    // Picked otherwise, or a device that has won before: no word of it.
    expect(renderToStaticMarkup(<Levels current="normal" pick={noop} firstRun />)).not.toContain(
      'lobby-first-run',
    );
    expect(renderToStaticMarkup(<Levels current="entspannt" pick={noop} />)).not.toContain(
      'lobby-first-run',
    );
  });

  /** Anna's lobby, as host, of a room opened on `difficulty`. */
  function lobby(difficulty: PlayerView['difficulty'], isHost = true): string {
    const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost };
    const view = {
      phase: 'lobby',
      missionId: 'blackout',
      missionTitle: 'Blackout im Labor',
      difficulty,
      storyText: 'Stromausfall.',
      crewSize: { min: 2, max: 3 },
      you: anna,
      players: [{ ...anna, connected: true }],
      palette: [],
      timeLimitSec: 1215,
      alarms: { count: 0, limit: null },
    } as unknown as PlayerView;
    return renderToStaticMarkup(
      <LobbyScreen view={view} send={noop} leaveRoom={noop} missions={[blackout]} stats={[]} />,
    );
  }

  it('shows the host of a device without a won run the line, and nobody once it has won', () => {
    vi.stubGlobal('window', { localStorage: memory() });
    expect(lobby('entspannt')).toContain(FIRST_RUN_LINE);
    expect(lobby('entspannt', false)).not.toContain(FIRST_RUN_LINE);
    vi.stubGlobal('window', { localStorage: memory({ [WON_KEY]: '1' }) });
    expect(lobby('entspannt')).not.toContain(FIRST_RUN_LINE);
  });
});

describe('the join screen for a first crew', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sticks „Erster Einsatz? Hier starten" on a card that asks for it', () => {
    const card = (first: boolean): string =>
      renderToStaticMarkup(
        <MissionCard
          mission={tutorial}
          stats={undefined}
          selected={false}
          first={first}
          onSelect={noop}
        />,
      );
    expect(FIRST_RUN_HINT).toBe('Erster Einsatz? Hier starten');
    expect(card(true)).toContain(`<span class="mission-first">${FIRST_RUN_HINT}</span>`);
    expect(card(false)).not.toContain('mission-first');
  });

  /** The join screen with the missions, on a device whose storage holds `entries`. */
  function join(entries: Record<string, string>): string {
    vi.stubGlobal('window', { location: { search: '' }, localStorage: memory(entries) });
    return renderToStaticMarkup(
      <JoinScreen
        send={noop}
        connected
        missions={[blackout, tutorial]}
        rooms={[]}
        stats={[]}
        openHandbook={noop}
        openHistory={noop}
      />,
    );
  }

  it('points a device without a won run at the tutorial, and only at it', () => {
    const first = join({});
    expect(first.match(/class="mission-first"/g)).toHaveLength(1);
    const tutorialCard = first.slice(first.indexOf('Tutorial: Systemcheck') - 400);
    expect(tutorialCard).toContain(FIRST_RUN_HINT);
    expect(join({ [WON_KEY]: '1' })).not.toContain(FIRST_RUN_HINT);
  });
});
