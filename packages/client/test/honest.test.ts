import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMERGENCY_CLEARED,
  type PlayerView,
  type PuzzleView,
  type RunEvent,
} from '@escapelab/core';
import { readerSawSolve } from '../src/screens/Game.js';
import { emergencyCleared } from '../src/world/alarm.js';
import { lightsHeld } from '../src/world/rooms.js';
import { fakeAudio, freshAudio, startsOf } from './fakeAudio.js';
import { mapWith, type Manual } from './fixtures.js';

const at = (kind: RunEvent['kind'], label: string, seconds: number | null = null): RunEvent => ({
  at: 0,
  kind,
  label,
  seconds,
});

describe('the end of an emergency', () => {
  it('is a clearing where the crew cleared it in time', () => {
    const events = [at('sabotage', 'Notfall: Kühlung'), at('sabotage', EMERGENCY_CLEARED)];
    expect(emergencyCleared(events)).toBe(true);
  });

  it('is no clearing where it ran out: its alarm is the last word', () => {
    const missed = [
      at('sabotage', 'Notfall: Kühlung'),
      at('penalty', 'Notfall nicht rechtzeitig behoben', 60),
    ];
    expect(emergencyCleared(missed)).toBe(false);
    // a wrong move during a cleared one does not make it a miss
    const cleared = [
      at('sabotage', 'Notfall: Kühlung'),
      at('penalty', 'Fehlversuch', 20),
      at('sabotage', EMERGENCY_CLEARED),
    ];
    expect(emergencyCleared(cleared)).toBe(true);
  });
});

/** The book of the Notlicht's rules at (2,3), the station armed at (11,7). */
const book: Manual = {
  found: true,
  id: 'buch',
  kind: 'book',
  x: 2,
  y: 3,
  label: 'HANDBUCH',
  puzzleIds: ['notlicht'],
  opened: true,
  needsKey: null,
  known: true,
};

/** A run's view, `solved` stations done, its player reading at `manualId` (null: nowhere). */
function viewAt(solved: number, manualId: string | null): PlayerView {
  return {
    currentPuzzleIndex: solved,
    presence: { stationId: null, console: null, manualId, signSeen: false },
    map: mapWith({
      manuals: [book, { ...book, id: 'tafel', puzzleIds: ['notstrom'] }],
      stations: [
        {
          found: false,
          known: true,
          puzzleId: 'notlicht',
          x: 11,
          y: 7,
          title: 'Notlicht',
          status: solved === 0 ? 'armed' : 'done',
        },
      ],
    }),
  } as unknown as PlayerView;
}

describe('a solve, as the reader at the source has it', () => {
  it('is heard where this player read the solved station’s rules, no device open', () => {
    expect(readerSawSolve(viewAt(0, 'buch'), viewAt(1, 'buch'), false)).toBe(true);
  });

  it('is the operator’s at the console, and nobody’s away from the rules', () => {
    expect(readerSawSolve(viewAt(0, 'buch'), viewAt(1, 'buch'), true)).toBe(false);
    expect(readerSawSolve(viewAt(0, null), viewAt(1, null), false)).toBe(false);
    expect(readerSawSolve(viewAt(0, 'tafel'), viewAt(1, 'tafel'), false)).toBe(false);
    expect(readerSawSolve(viewAt(0, 'buch'), viewAt(0, 'buch'), false)).toBe(false);
  });

  it('lights the room behind open pages at once; only a station’s panel holds it back', () => {
    expect(lightsHeld(false, null)).toBe(false);
    expect(lightsHeld(false, { kind: 'keypad' } as unknown as PuzzleView)).toBe(true);
    expect(lightsHeld(true, { kind: 'keypad' } as unknown as PuzzleView)).toBe(false);
  });
});

describe('the lab’s answers, each its recording', () => {
  beforeEach(() => fakeAudio());
  afterEach(() => vi.unstubAllGlobals());

  it('chimes an emergency cleared, and plays the reader’s chord, a page and a bump', async () => {
    const audio = await freshAudio();
    audio.emergencyOver();
    audio.readerSolve();
    audio.paperSwish();
    audio.wallBump();
    expect(startsOf('stage-chime')).toHaveLength(1);
    expect(startsOf('solved-chord')).toHaveLength(1);
    expect(startsOf('sheet-down')).toHaveLength(1);
    expect(startsOf('wall-thud')).toHaveLength(1);
    // the station's chirp is no answer of these
    expect(startsOf('console-ready')).toHaveLength(0);
  });
});
