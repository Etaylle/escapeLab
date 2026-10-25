import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkMission,
  initialState,
  MAX_NOTES,
  NOTE_READ,
  NOTE_TEXT_MAX,
  noteKey,
  noteSpot,
  parseClientMessage,
  parseMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * A corridor with a keypad at its east end and the book by the spawns, and
 * two notes of the last crew: one pinned to the north wall at (4,0), read
 * from the floor below it, one lying on the floor at (7,2).
 *
 *   0123456789
 * 0 ####N#####   note on the wall (4,0), read from (4,1)
 * 1 #........#   spawns (1,1) (1,2); keypad (8,1)
 * 2 #.....N..#   book (2,2); note on the floor (7,2)
 * 3 ##########
 */
const WALL_NOTE = 'Um 23:47 kam der Knall.';
const FLOOR_NOTE = 'Gemeldet war es.';

function raw(notes: object[] = [
  { x: 4, y: 0, text: WALL_NOTE },
  { x: 7, y: 2, text: FLOOR_NOTE },
]) {
  return {
    id: 'notizen',
    title: 'Notizen',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'keypad', id: 'code', title: 'Code' }],
    map: {
      tiles: ['##########', '#........#', '#........#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations: [{ puzzleId: 'code', x: 8, y: 1 }],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['code'],
          spots: [{ x: 2, y: 2 }],
        },
      ],
      notes,
    },
  };
}

const mission: Mission = parseMission(raw());

/** What the validation says about the notes of `notes`, path first. */
function issuesFor(notes: object[]): string[] {
  const checked = checkMission(raw(notes));
  return checked.ok ? [] : checked.issues;
}

describe('notes on the map', () => {
  it('reads a note from the floor it lies on, or the floor its wall faces, south first', () => {
    const tiles = ['#####', '#...#', '##.##', '#...#', '#####'];
    expect(noteSpot({ tiles }, { x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
    expect(noteSpot({ tiles }, { x: 2, y: 0 })).toEqual({ x: 2, y: 1 });
    // (1,2): floor north and south of it — the south face, the one the view looks at.
    expect(noteSpot({ tiles }, { x: 1, y: 2 })).toEqual({ x: 1, y: 3 });
    expect(noteSpot({ tiles }, { x: 1, y: 4 })).toEqual({ x: 1, y: 3 });
    // (2,1) of a map with floor only west and east of it: east before west.
    const sideways = { tiles: ['#####', '#.#.#', '#####'] };
    expect(noteSpot(sideways, { x: 2, y: 1 })).toEqual({ x: 3, y: 1 });
    const westOnly = { tiles: ['#####', '#.###', '#####'] };
    expect(noteSpot(westOnly, { x: 2, y: 1 })).toEqual({ x: 1, y: 1 });
    expect(noteSpot({ tiles: ['###', '###', '###'] }, { x: 1, y: 1 })).toBeNull();
    expect(noteSpot({ tiles: ['  #', ' .#'] }, { x: 0, y: 0 })).toBeNull();
    expect(noteSpot({ tiles }, { x: 9, y: 9 })).toBeNull();
  });

  it('keeps notes the file gives, and none where it gives none', () => {
    expect(mission.map.notes).toEqual([
      { x: 4, y: 0, text: WALL_NOTE },
      { x: 7, y: 2, text: FLOOR_NOTE },
    ]);
    const bare = raw();
    expect(parseMission({ ...bare, map: { ...bare.map, notes: undefined } }).map.notes).toEqual([]);
  });

  it('turns away a note nobody can read, naming it by its place in the file', () => {
    // (0,0) is a corner: wall with no floor beside it.
    expect(issuesFor([{ x: 0, y: 0, text: 'x' }])).toEqual([
      'map.notes.0: the note at 0,0 lies where nobody can read it — pin it to a wall beside ' +
        'the floor or lay it on the floor',
    ]);
    expect(issuesFor([{ x: 30, y: 1, text: 'x' }])).toEqual([
      expect.stringMatching(/^map\.notes\.0: the note at 30,1 lies where nobody can read it/),
    ]);
  });

  it('turns away two notes on one tile, and more than the map may carry', () => {
    expect(issuesFor([
      { x: 7, y: 2, text: 'a' },
      { x: 7, y: 2, text: 'b' },
    ])).toEqual(['map.notes.1: two notes at 7,2 — one a tile']);
    const many = Array.from({ length: MAX_NOTES + 1 }, (_, i) => ({
      x: 1 + (i % 8),
      y: 1 + Math.floor(i / 8),
      text: 'n',
    }));
    expect(issuesFor(many)).toEqual([expect.stringMatching(/^map\.notes: Too big/)]);
  });

  it('holds a note to some words and at most NOTE_TEXT_MAX characters', () => {
    expect(issuesFor([{ x: 4, y: 0, text: '' }])).toEqual([
      expect.stringMatching(/^map\.notes\.0\.text: Too small/),
    ]);
    const long = 'x'.repeat(NOTE_TEXT_MAX + 1);
    expect(issuesFor([{ x: 4, y: 0, text: long }])).toEqual([
      expect.stringMatching(/^map\.notes\.0\.text: Too big/),
    ]);
    expect(issuesFor([{ x: 4, y: 0, text: 'x'.repeat(NOTE_TEXT_MAX) }])).toEqual([]);
  });

  it('keeps furniture off a note lying on the floor', () => {
    const bare = raw();
    const checked = checkMission({
      ...bare,
      map: { ...bare.map, decor: [{ kind: 'barrel', x: 7, y: 2 }] },
    });
    expect(checked.ok ? [] : checked.issues).toEqual([
      '(root): map: decor "barrel" at 7,2 stands on a note of the last crew — furniture goes ' +
        'on free floor',
    ]);
  });
});

/** The run started, the lights out, Anna (p1) and Ben (p2) standing where `notes` says. */
function atNotes(notes: Record<string, string[]>, notesSeen: number[] = [0, 1]): GameState {
  return standing(lightsOut(started(mission)), { notes, notesSeen });
}

const read = (playerId: string, note: number, at = T0 + 2000): Action => ({
  type: 'read-note',
  playerId,
  note,
  at,
});

describe('reading a note', () => {
  it('logs the first read of a note once, and costs nothing', () => {
    const before = atNotes({ [noteKey(1)]: ['p1'] });
    const after = applyAction(before, read('p1', 1));
    expect(after.events.at(-1)).toEqual({
      at: T0 + 2000,
      kind: 'note',
      label: NOTE_READ,
      seconds: null,
    });
    expect(NOTE_READ).toBe('Notiz gelesen');
    expect(after.notesRead).toEqual([1]);
    expect(after.deadlineAt).toBe(before.deadlineAt);
    expect([after.penaltySeq, after.hintsUsed]).toEqual([0, 0]);
    expect(after.credits).toEqual(before.credits);
    // Read again — by anybody — it changes nothing.
    expect(applyAction(after, read('p1', 1, T0 + 3000))).toBe(after);
  });

  it('logs every note on its own, kept in index order', () => {
    const both = atNotes({ [noteKey(0)]: ['p2'], [noteKey(1)]: ['p1'] });
    const after = [read('p1', 1), read('p2', 0, T0 + 2500)].reduce(applyAction, both);
    expect(after.notesRead).toEqual([0, 1]);
    expect(after.events.filter((e) => e.kind === 'note')).toHaveLength(2);
  });

  it('turns away a read away from the note, of a note the map lacks, and outside a run', () => {
    const state = atNotes({ [noteKey(0)]: ['p2'] });
    expect(() => applyAction(state, read('p1', 0))).toThrow('Nur direkt davor.');
    expect(() => applyAction(state, read('p2', 5))).toThrow('Diese Notiz gibt es hier nicht.');
    expect(() => applyAction(initialState(mission), read('p2', 0))).toThrow(
      'Nur während des Einsatzes.',
    );
    const paused = applyAction(state, { type: 'set-paused', paused: true, at: T0 + 1500 });
    expect(() => applyAction(paused, read('p2', 0))).toThrow(/Pausiert/);
  });

  it('loses a run read after the clock ran out', () => {
    const state = atNotes({ [noteKey(0)]: ['p2'] });
    const late = applyAction(state, read('p2', 0, (state.deadlineAt ?? 0) + 1));
    expect(late.phase).toBe('lost');
  });

  it('forgets the notes found and read when the next run starts', () => {
    const state = applyAction(atNotes({ [noteKey(1)]: ['p1'] }), read('p1', 1));
    const lost = applyAction(state, { type: 'time-expired', at: (state.deadlineAt ?? 0) + 1 });
    const willing = applyAction(lost, { type: 'set-ready', playerId: 'p2', ready: true });
    const rematch: Action = { type: 'rematch', playerId: 'p1', at: T0 + 900_000, seed: 3 };
    const again = applyAction(willing, rematch);
    expect([again.notesFound, again.notesRead]).toEqual([[], []]);
    expect(again.presence.notes).toEqual({});
  });
});

describe('notes in the views', () => {
  it('shows the crew the notes it has come across, the audience every one, never the words', () => {
    const found = standing(lightsOut(started(mission)), { notesSeen: [1] });
    expect(viewFor(found, 'p1').map?.notes).toEqual([{ index: 1, x: 7, y: 2, read: false }]);
    expect(viewForSpectator(found).map?.notes).toEqual([
      { index: 0, x: 4, y: 0, read: false },
      { index: 1, x: 7, y: 2, read: false },
    ]);
    const nobodyThere = JSON.stringify([viewFor(found, 'p1'), viewForSpectator(found)]);
    expect(nobodyThere).not.toContain(FLOOR_NOTE);
    expect(nobodyThere).not.toContain(WALL_NOTE);
  });

  it('keeps found notes found as the crew walks on, and marks a note read for all', () => {
    const seen = standing(lightsOut(started(mission)), { notesSeen: [0], notes: { '0': ['p2'] } });
    const walkedOn = standing(seen, { notesSeen: [] });
    expect(walkedOn.notesFound).toEqual([0]);
    const read0 = applyAction(seen, read('p2', 0));
    expect(viewFor(read0, 'p1').map?.notes).toEqual([{ index: 0, x: 4, y: 0, read: true }]);
  });

  it('gives a note’s words only to who stands at it, the first one in map order', () => {
    const state = atNotes({ [noteKey(0)]: ['p1'], [noteKey(1)]: ['p1', 'p2'] });
    expect(viewFor(state, 'p1').noteHere).toEqual({ index: 0, text: WALL_NOTE });
    expect(viewFor(state, 'p2').noteHere).toEqual({ index: 1, text: FLOOR_NOTE });
    const away = atNotes({ [noteKey(1)]: ['p2'] });
    expect(viewFor(away, 'p1').noteHere).toBeNull();
    expect(JSON.stringify(viewFor(away, 'p1'))).not.toContain(FLOOR_NOTE);
    expect(JSON.stringify(viewForSpectator(away))).not.toContain(FLOOR_NOTE);
  });
});

describe('the read-note message', () => {
  it('names a note by its index among the map’s notes, and nothing past the most there are', () => {
    expect(parseClientMessage(JSON.stringify({ kind: 'read-note', note: 2 }))).toEqual({
      kind: 'read-note',
      note: 2,
    });
    for (const note of [-1, MAX_NOTES, 1.5, '1']) {
      expect(() => parseClientMessage(JSON.stringify({ kind: 'read-note', note }))).toThrow();
    }
  });
});
