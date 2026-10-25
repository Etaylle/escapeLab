import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { draftFromJson, newDraft, type Draft, type Tile } from '../src/editor/draft.js';
import { lineBetween, NO_CHOICE, paint, place, type PlacingTool } from '../src/editor/tools.js';
import { locate, messagesAt, refOfPath, validateDraft } from '../src/editor/validate.js';

const AUTO = NO_CHOICE;

function blackout(): Draft {
  const data = JSON.parse(
    readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
  ) as unknown;
  const loaded = draftFromJson(data);
  if (!loaded.ok) {
    throw new Error(loaded.problems.join('; '));
  }
  return loaded.draft;
}

/** The harness's probe: a 7 × 5 room, then whatever `steps` place in it. */
function probe(...steps: [PlacingTool, Tile][]): Draft {
  let draft = newDraft();
  for (let y = 2; y <= 6; y++) {
    draft = paint(draft, lineBetween({ x: 2, y }, { x: 8, y }), '.');
  }
  for (const [tool, at] of steps) {
    draft = place(draft, tool, at, null, AUTO).draft;
  }
  return draft;
}

const texts = (draft: Draft, severity: string): string[] =>
  validateDraft(draft)
    .findings.filter((f) => f.severity === severity)
    .map((f) => f.text);

describe('the validator', () => {
  it('names what a room with one start and a station still lacks', () => {
    const draft = probe(['spawn', { x: 3, y: 4 }], ['station', { x: 7, y: 3 }]);
    const errors = texts(draft, 'error');
    expect(errors).toContain('map.spawns: Too small: expected array to have >=2 items');
    expect(errors).toContain('map: 1 spawns for up to 2 players — each needs one');
    const uncovered = 'no manual object covers puzzle "tastenfeld"';
    expect(errors.some((e) => e.includes(uncovered))).toBe(true);
    expect(validateDraft(draft).errors).toBe(errors.length);
  });

  it('finds nothing wrong once a second start and a book are in', () => {
    const draft = probe(
      ['spawn', { x: 3, y: 4 }],
      ['station', { x: 7, y: 3 }],
      ['spawn', { x: 4, y: 4 }],
      ['source', { x: 7, y: 5 }],
    );
    expect(validateDraft(draft).errors).toBe(0);
    expect(texts(draft, 'info')).toEqual([
      'Kein Notausgang: Die Mission ist mit dem letzten Rätsel gewonnen.',
    ]);
  });

  it('proves Blackout sound, reachability and all, well within 200 ms', () => {
    const draft = blackout();
    validateDraft(draft);
    const run = validateDraft(draft);
    expect(run.findings).toEqual([]);
    expect(run.ms).toBeLessThan(200);
  });

  it('runs the reachability proofs: a door nobody can open is caught, at its station', () => {
    let draft = blackout();
    draft = {
      ...draft,
      map: {
        ...draft.map,
        doors: draft.map.doors.map((d) =>
          d.id === 'maschinentuer'
            ? { ...d, opensBy: { kind: 'puzzle', puzzleId: 'frequenz' } }
            : d,
        ),
      },
    };
    const findings = validateDraft(draft).findings;
    const stuck = findings.filter((f) => f.text.includes('crew of 2 starting'));
    expect(stuck.length).toBeGreaterThan(0);
    // The proof names the first crew that gets stuck: the one on the first two starts.
    const [first, second] = draft.map.spawns;
    for (const finding of stuck) {
      expect(finding.target).not.toBeNull();
      expect(finding.spots).toContainEqual(first);
      expect(finding.spots).toContainEqual(second);
    }
  });

  it('takes the clock it is given for the duration', () => {
    let tick = 0;
    expect(validateDraft(newDraft(), () => (tick += 7)).ms).toBe(7);
  });
});

describe('where a finding points', () => {
  it('follows a path into the map to the thing there', () => {
    expect(refOfPath(['map', 'stations', 2, 'x'])).toEqual({ kind: 'station', index: 2 });
    expect(refOfPath(['map', 'manuals', 1, 'spots', 3, 'y'])).toEqual({
      kind: 'source',
      index: 1,
      spot: 3,
    });
    expect(refOfPath(['map', 'items', 0, 'deliverTo', 'x'])).toEqual({ kind: 'dropoff', index: 0 });
    expect(refOfPath(['map', 'drones', 1, 'waypoints', 2])).toEqual({
      kind: 'drone',
      index: 1,
      waypoint: 2,
    });
    expect(refOfPath(['map', 'sabotage', 'panels', 1])).toEqual({ kind: 'panel', index: 1 });
    expect(refOfPath(['map', 'exit', 'x'])).toEqual({ kind: 'exit' });
    expect(refOfPath(['puzzles', 0, 'title'])).toEqual({ kind: 'puzzle', index: 0 });
    expect(refOfPath(['title'])).toBeNull();
    expect(refOfPath(['map', 'tiles'])).toBeNull();
  });

  it('selects the piece of furniture a rule names, and lights what it stands in the way of', () => {
    const draft = blackout();
    const message =
      'map: decor "shelf" at 3,2 stands on station "notlicht" — furniture goes on free floor';
    const found = locate(draft, message);
    // The third piece of the map's furniture, a shelf of the Archiv, stands at 3,2.
    expect(found.target).toEqual({ kind: 'decor', index: 2 });
    expect(found.spots).toContainEqual({ x: 3, y: 2 });
    expect(found.spots).toContainEqual({ x: 11, y: 7 });
    expect(refOfPath(['map', 'decor', 4, 'kind'])).toEqual({ kind: 'decor', index: 4 });
  });

  it('reports furniture in the way, at its tile, as the server would', () => {
    const at = { x: 5, y: 4 };
    const draft = place(probe(['spawn', { x: 3, y: 4 }]), 'decor', at, null, AUTO).draft;
    const blocking = { ...draft, map: { ...draft.map, spawns: [...draft.map.spawns, at] } };
    const findings = validateDraft(blocking).findings;
    const finding = findings.find((f) => f.message.includes('decor "shelf"'));
    expect(finding?.target).toEqual({ kind: 'decor', index: 0 });
    expect(finding?.spots).toContainEqual({ x: 5, y: 4 });
  });

  it('reads the things and tiles a map rule names out of its words', () => {
    const draft = blackout();
    const apart =
      'map: consoles a and b of station "notstrom" at 1,12 and 2,7 stand 5.1 tiles apart';
    const both = locate(draft, apart);
    // Console a of the Notstrom-Kasten, after the Notlicht's lever in the list of stations.
    expect(both.target).toEqual({ kind: 'station', index: 1 });
    expect(both.spots).toEqual([
      { x: 1, y: 12 },
      { x: 2, y: 7 },
    ]);
    const carry = 'map: nobody can carry "schluessel" to cabinet "aktenschrank" at 12,11';
    const cabinet = locate(draft, carry);
    expect(cabinet.target).toEqual({ kind: 'item', index: 1 });
    expect(cabinet.spots).toContainEqual({ x: 17, y: 1 });
    expect(cabinet.spots).toContainEqual({ x: 14, y: 15 });
    const nowhere = locate(draft, 'players: min must not be above max');
    expect(nowhere).toEqual({ target: null, spots: [] });
  });

  it('points a field’s message at the field', () => {
    const draft = { ...probe(), title: '' };
    expect(messagesAt(validateDraft(draft), 'title')).toEqual([
      'Too small: expected string to have >=1 characters',
    ]);
  });
});

describe('a note of the last shift', () => {
  const sound = (): Draft =>
    probe(
      ['spawn', { x: 3, y: 4 }],
      ['station', { x: 7, y: 3 }],
      ['spawn', { x: 4, y: 4 }],
      ['source', { x: 7, y: 5 }],
      ['note', { x: 5, y: 1 }],
    );

  it('passes on a wall beside the floor', () => {
    expect(sound().map.notes).toHaveLength(1);
    expect(validateDraft(sound()).errors).toBe(0);
  });

  it('is pointed at where nobody can read it any more, the note selected, its tile lit', () => {
    // The floor below the note painted over: its wall has no floor beside it.
    const walled = paint(sound(), lineBetween({ x: 4, y: 2 }, { x: 6, y: 2 }), '#');
    const finding = validateDraft(walled).findings.find((f) => f.path === 'map.notes.0');
    expect(finding).toMatchObject({
      severity: 'error',
      target: { kind: 'note', index: 0 },
      spots: [{ x: 5, y: 1 }],
    });
    expect(finding?.text).toBe(
      'map.notes.0: the note at 5,1 lies where nobody can read it — pin it to a wall beside the ' +
        'floor or lay it on the floor',
    );
    expect(refOfPath(['map', 'notes', 0, 'text'])).toEqual({ kind: 'note', index: 0 });
  });

  it('names a note too long by its field', () => {
    const draft = sound();
    const long: Draft = {
      ...draft,
      map: { ...draft.map, notes: [{ x: 5, y: 1, text: 'x'.repeat(161) }] },
    };
    expect(messagesAt(validateDraft(long), 'map.notes.0.text')).toEqual([
      expect.stringMatching(/^Too big/),
    ]);
  });
});

describe('warnings and notes', () => {
  it('warns of a door anyone can walk round and a plate that does nothing', () => {
    const draft = probe(['door', { x: 5, y: 4 }], ['plate', { x: 3, y: 3 }]);
    const warnings = validateDraft(draft).findings.filter((f) => f.severity === 'warning');
    expect(warnings.map((f) => f.target)).toEqual([
      { kind: 'door', index: 0 },
      { kind: 'plate', index: 0 },
    ]);
    expect(warnings[0]?.text).toContain('Wandlücke');
  });

  it('keeps quiet about a door in a gap and a plate that holds it', () => {
    let draft = paint(probe(), [{ x: 9, y: 4 }, { x: 10, y: 4 }, { x: 11, y: 4 }], '.');
    draft = place(draft, 'plate', { x: 3, y: 3 }, null, AUTO).draft;
    draft = place(draft, 'door', { x: 9, y: 4 }, null, AUTO).draft;
    draft = {
      ...draft,
      map: {
        ...draft.map,
        doors: draft.map.doors.map((d) => ({
          ...d,
          opensBy: { kind: 'plate', plateId: 'platte', untilSolved: '' },
        })),
      },
    };
    expect(validateDraft(draft).findings.filter((f) => f.severity === 'warning')).toEqual([]);
  });
});
