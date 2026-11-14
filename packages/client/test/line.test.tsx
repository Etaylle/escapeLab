import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { GameScreen, worldHeld, worldLocked } from '../src/screens/Game.js';
import {
  LineLostCard,
  lineLost,
  ON_THE_LINE,
  retryLine,
  type GameLine,
} from '../src/screens/Line.js';
import { mapWith } from './fixtures.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const T0 = 1_700_000_000_000;
const noop = (): void => undefined;

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: false, isHost: false };

/** Anna's view of a run on, Ben with her. */
function running(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'playing',
    missionId: 'systemcheck',
    missionTitle: 'Tutorial: Systemcheck',
    difficulty: 'normal',
    storyText: 'Los.',
    cast: { pa: 'anlage', operator: 'helmut', lead: null },
    crewSize: { min: 2, max: 2 },
    chat: [],
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: T0 + 300_000,
    startedAt: T0,
    finishedAt: null,
    timeLimitSec: 420,
    lights: { out: true, outAt: T0 },
    currentPuzzleIndex: 0,
    puzzleCount: 4,
    away: [],
    pausedAt: null,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
    ...parts,
  };
}

/** The own line as the game screen hears of it, down unless told otherwise. */
function lineOf(parts: Partial<GameLine> = {}): GameLine {
  return { status: 'closed', retry: { attempt: 2, at: null }, wake: noop, giveUp: noop, ...parts };
}

function screen(view: PlayerView, line: GameLine): string {
  return renderToStaticMarkup(
    <GameScreen
      view={view}
      roomCode="KX4P"
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      send={noop}
      listen={() => noop}
      refusal={null}
      finale={null}
      line={line}
    />,
  );
}

describe('the own line down in a run', () => {
  it('is down while its socket is not open, or its room on the way back, in a run only', () => {
    const up = { status: 'open', retry: null } as const;
    expect(lineLost(lineOf(), running())).toBe(true);
    expect(lineLost(lineOf({ status: 'connecting' }), running())).toBe(true);
    expect(lineLost(up, running())).toBe(false);
    expect(lineLost(lineOf(), running({ phase: 'lobby' }))).toBe(false);
    expect(lineLost(lineOf(), running({ phase: 'won' }))).toBe(false);
    expect(lineLost(lineOf(), null)).toBe(false);
    // The socket open, its comeback waiting for the room: down for the world all the same.
    const waiting = { status: 'open', retry: { attempt: 1, at: null, restoring: true } } as const;
    expect(lineLost(waiting, running())).toBe(true);
    expect(lineLost(waiting, running({ phase: 'lobby' }))).toBe(false);
  });

  it('says the next try: its number, and its wait while it waits', () => {
    expect(retryLine(null, T0)).toBe('Verbinde neu');
    expect(retryLine({ attempt: 1, at: null }, T0)).toBe('Verbinde neu · Versuch 1');
    expect(retryLine({ attempt: 3, at: T0 + 3200 }, T0)).toBe('Verbinde neu · Versuch 3 · in 4 s');
    expect(retryLine({ attempt: 3, at: T0 + 1 }, T0)).toBe('Verbinde neu · Versuch 3 · in 1 s');
    expect(retryLine({ attempt: 3, at: T0 }, T0)).toBe('Verbinde neu · Versuch 3');
  });

  it('stands over the world as a card with the ways on', () => {
    const html = screen(running(), lineOf());
    expect(html).toContain('<div class="overlay pause line-lost" role="alert">');
    expect(html).toContain('VERBINDUNG VERLOREN');
    expect(html).toContain('<p class="line-retry">Verbinde neu · Versuch 2</p>');
    for (const way of ['Jetzt versuchen', 'Seite neu laden', 'Einsatz aufgeben']) {
      expect(html).toContain(way);
    }
    expect(screen(running(), lineOf({ status: 'open', retry: null }))).not.toContain('line-lost');
  });

  it('says the server goes down for a restart, with the usual counter and ways', () => {
    const html = screen(running(), lineOf({ retry: { attempt: 2, at: null, restart: true } }));
    expect(html).toContain('WARTUNG · Der Server startet neu');
    expect(html).not.toContain('VERBINDUNG VERLOREN');
    expect(html).toContain('<p class="line-retry">Verbinde neu · Versuch 2</p>');
    for (const way of ['Jetzt versuchen', 'Seite neu laden', 'Einsatz aufgeben']) {
      expect(html).toContain(way);
    }
  });

  it('says the room is on its way back while a new server waits for it, the reload the way', () => {
    const retry = { attempt: 1, at: null, restoring: true } as const;
    const html = screen(running(), lineOf({ status: 'open', retry }));
    expect(html).toContain('EINSATZ WIRD WIEDERHERGESTELLT');
    expect(html).toContain('<p class="line-retry">Der letzte Stand trifft gleich ein</p>');
    expect(html).toContain('Seite neu laden');
    // Nothing to try, and no seat to give up until the room is back.
    for (const way of ['Jetzt versuchen', 'Einsatz aufgeben', 'VERBINDUNG VERLOREN', 'WARTUNG']) {
      expect(html).not.toContain(way);
    }
    // Waiting after a restart, too: the room's way back is the news.
    const restarted = lineOf({ status: 'open', retry: { ...retry, restart: true } });
    expect(screen(running(), restarted)).toContain('EINSATZ WIRD WIEDERHERGESTELLT');
    expect(worldHeld(null, lineOf({ status: 'open', retry }), running())).toBe(true);
  });

  it('stands instead of the maintenance card: a standstill is no news to the one cut off', () => {
    const away = [{ id: 'p2', name: 'Ben', since: T0, waivableAt: T0 + 60_000 }];
    const view = running({ away, pausedAt: T0 });
    expect(screen(view, lineOf())).not.toContain('<span class="kicker">WARTUNG</span>');
    expect(screen(view, lineOf({ status: 'open', retry: null }))).toContain(
      '<span class="kicker">WARTUNG</span>',
    );
  });

  it('tries again at a press', () => {
    let woken = 0;
    const line = lineOf({ wake: () => (woken += 1) });
    press(buttonsOf(elementsOf(() => <LineLostCard line={line} />), 'line-try')[0]);
    expect(woken).toBe(1);
  });

  it('takes the world’s keys while it stands: whatever is pressed goes nowhere', () => {
    const open = { reading: null, note: null };
    const held = worldHeld(null, lineOf(), running());
    expect(held).toBe(true);
    expect(worldLocked(running(), open, null, held)).toBe(true);
    const up = worldHeld(null, ON_THE_LINE, running());
    expect(up).toBe(false);
    expect(worldLocked(running(), open, null, up)).toBe(false);
  });
});
