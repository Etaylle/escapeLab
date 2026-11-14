import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KnownSource, KnownStation, PlayerView } from '@escapelab/core';
import { askNoteText } from '../src/screens/Book.js';
import { ClockFact, clockSizeText, crewTags } from '../src/screens/Crew.js';
import { clockStat } from '../src/screens/End.js';
import { StageTop, type ColdOpen } from '../src/screens/Game.js';
import { coversArmed } from '../src/world/interact.js';
import { armedGoal } from '../src/world/known.js';
import { mapWith } from './fixtures.js';

/** A station's spot the crew knows of, `status` as the view tells it. */
function station(
  puzzleId: string,
  x: number,
  status: KnownStation['status'] = 'armed',
): KnownStation {
  return { puzzleId, x, y: 1, title: `Station ${puzzleId}`, status, found: true, known: true };
}

/** A book the crew knows of, printing the rules of `puzzleIds`. */
function book(puzzleIds: string[]): KnownSource {
  return {
    id: 'buch',
    kind: 'book',
    x: 1,
    y: 2,
    label: 'HANDBUCH',
    puzzleIds,
    opened: true,
    needsKey: null,
    found: true,
    known: true,
  };
}

/** Three stations still to solve, all armed, while a free-order run waits for its pick. */
const picking = mapWith({ stations: [station('a', 3), station('b', 7), station('c', 11)] });

describe('free order: what the goal names', () => {
  it('counts the stations left while several stand armed for the crew to pick from', () => {
    expect(armedGoal({ puzzleCount: 5, currentPuzzleIndex: 2 }, picking)).toBe('Noch 3 Stationen');
  });

  it('names the one armed station, at both its consoles, and nothing while none is', () => {
    const consoles = mapWith({
      stations: [
        { ...station('a', 3), console: 'a' },
        { ...station('a', 9), console: 'b' },
        station('b', 12, 'locked'),
      ],
    });
    expect(armedGoal({ puzzleCount: 2, currentPuzzleIndex: 0 }, consoles)).toBe('Station a');
    expect(armedGoal({ puzzleCount: 1, currentPuzzleIndex: 1 }, mapWith({}))).toBeNull();
  });

  it('stands on the objective bar while no station is open', () => {
    const view = {
      phase: 'playing',
      currentPuzzleIndex: 1,
      puzzleCount: 4,
      puzzle: null,
      players: [],
      alarms: { count: 0, limit: null },
      deadlineAt: null,
      pausedAt: null,
      events: [],
    } as unknown as PlayerView;
    const dark: ColdOpen = {
      darkSince: 0,
      dark: true,
      intro: false,
      flashUntil: null,
      gates: { sign: 0, line: 0 },
    };
    const html = renderToStaticMarkup(
      <StageTop view={view} map={picking} coldOpen={dark} notice={null} alarmVisible={false} />,
    );
    expect(html).toContain('Noch 3 Stationen');
  });
});

describe('free order: the stations armed at once', () => {
  it('reads every source covering one of them as covering the armed station', () => {
    expect(coversArmed(picking, book(['c']))).toBe(true);
    expect(coversArmed(picking, book(['z']))).toBe(false);
  });

  it('tags a crew member at any of them as at the console', () => {
    const at = { stationId: 'b', manualId: null };
    const tags = crewTags(picking, { id: 'p2', connected: true }, at, undefined);
    expect(tags).toContainEqual({ text: 'am Pult', tone: 'pult' });
    const away = { ...at, stationId: 'z' };
    expect(crewTags(picking, { id: 'p2', connected: true }, away, undefined)).toEqual([]);
  });
});

describe('a mission without a clock, on the interface', () => {
  it('says so where the menu and the lobby give a mission’s minutes', () => {
    expect(clockSizeText(0)).toBe('ohne Uhr');
    expect(clockSizeText(900)).toBe('15 min');
  });

  it('leaves a clock’s minutes a text node of their own in a line of facts, as before', () => {
    // renderToString parts adjacent text nodes with <!-- -->. The browser shapes node by node:
    // „15" + „ min ·" lays the line out to the pixel as before, „15 min" + „ ·" does not.
    expect(renderToString(<ClockFact timeLimitSec={900} />)).toBe('15<!-- --> min ·');
    expect(renderToString(<ClockFact timeLimitSec={0} />)).toBe('ohne Uhr<!-- --> ·');
  });

  it('gives a won run the time it took instead of what it left', () => {
    const clockless = { timeLimitSec: 0, finishedAt: 500_000, deadlineAt: null } as PlayerView;
    expect(clockStat(clockless, 312_000)).toEqual({ ms: 312_000, label: 'Zeit' });
    const timed = { timeLimitSec: 900, finishedAt: 500_000, deadlineAt: 620_000 } as PlayerView;
    expect(clockStat(timed, 400_000)).toEqual({ ms: 120_000, label: 'Restzeit' });
  });

  it('asks for a note of the last shift without a price where no clock runs', () => {
    expect(askNoteText(0)).toBe('Notiz der letzten Schicht erbitten');
    expect(askNoteText(20)).toBe('Notiz der letzten Schicht erbitten · −20 s');
  });
});
