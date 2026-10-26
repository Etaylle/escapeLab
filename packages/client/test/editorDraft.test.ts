import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkMission,
  isCustomMissionId,
  moduleFor,
  parseMission,
  type FieldSpec,
} from '@escapelab/core';
import {
  copyOf,
  customIdOf,
  defaultFields,
  defaultPenalty,
  draftFromJson,
  draftToJson,
  fieldsFromJson,
  fieldsToJson,
  freeId,
  newDraft,
  newPuzzle,
  slugOf,
  STATION_TYPES,
  twoConsoles,
  type Draft,
  type StationType,
} from '../src/editor/draft.js';

const MISSIONS = new URL('../../../missions/', import.meta.url);
const shipped = readdirSync(MISSIONS)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const data = JSON.parse(readFileSync(new URL(name, MISSIONS), 'utf8')) as unknown;
    return { name, data };
  });

function loaded(data: unknown): Draft {
  const result = draftFromJson(data);
  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }
  return result.draft;
}

/** An object without one of its keys. */
function without(object: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));
}

/**
 * The smallest sound lab around a new puzzle of `type`: one room, two
 * starts, its station — at two consoles far apart where it has two — a
 * book with its rules unless the whole crew works it, and the sign.
 */
function labFor(type: StationType): Draft {
  const puzzle = newPuzzle(type, []);
  const blank = newDraft();
  const stations = twoConsoles(type)
    ? [
        { puzzleId: puzzle.id, x: 2, y: 3, console: 'a' as const },
        { puzzleId: puzzle.id, x: 9, y: 3, console: 'b' as const },
      ]
    : [{ puzzleId: puzzle.id, x: 6, y: 3 }];
  const book = {
    id: 'buch',
    kind: 'book' as const,
    label: 'HANDBUCH',
    puzzleIds: [puzzle.id],
    spots: [{ x: 6, y: 5 }],
    needsKey: '',
  };
  return {
    ...blank,
    title: `Probe ${type}`,
    puzzles: [puzzle],
    map: {
      ...blank.map,
      tiles: [
        '#'.repeat(12),
        ...Array.from({ length: 5 }, () => `#${'.'.repeat(10)}#`),
        '#'.repeat(12),
      ],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations,
      manuals: moduleFor(type).wholeCrew ? [] : [book],
      edgeworkSign: { x: 10, y: 1 },
    },
  };
}

describe('slugOf and customIdOf', () => {
  it('spell umlauts out, drop accents and join words with dashes', () => {
    expect(slugOf('Blackout im Labor')).toBe('blackout-im-labor');
    expect(slugOf('Größte Übung — Äther')).toBe('groesste-uebung-aether');
    expect(slugOf('  Café  No. 7!  ')).toBe('cafe-no-7');
    expect(slugOf('Tutorial: Systemcheck (Kopie)')).toBe('tutorial-systemcheck-kopie');
  });

  it('keep whole words up to 48 characters, and say nothing for a title without any', () => {
    expect(slugOf('ein '.repeat(30))).toBe(Array.from({ length: 12 }, () => 'ein').join('-'));
    expect(slugOf('x'.repeat(80))).toBe('x'.repeat(48));
    expect(slugOf('— ? —')).toBe('');
  });

  it('make ids the server takes: custom-, then the slug', () => {
    const titles = ['Probe', 'Größte Übung', '— ? —', 'ä'.repeat(70), 'Kettenreaktion (Kopie)'];
    for (const title of titles) {
      expect(isCustomMissionId(customIdOf(title)), title).toBe(true);
    }
    expect(customIdOf('Probe')).toBe('custom-probe');
    expect(customIdOf('')).toBe('custom-mission');
  });

  it('freeId takes the name while it is free, then numbers on', () => {
    expect(freeId('tuer', [])).toBe('tuer');
    expect(freeId('tuer', ['tuer'])).toBe('tuer-2');
    expect(freeId('tuer', ['tuer', 'tuer-2', 'tuer-3'])).toBe('tuer-4');
  });
});

describe('a new draft', () => {
  it('is a blank 20 × 13 lab of wall with one keypad, for two, ten minutes', () => {
    const draft = newDraft();
    expect(draft.map.tiles).toHaveLength(13);
    expect(draft.map.tiles.every((row) => row === '#'.repeat(20))).toBe(true);
    expect(draft.puzzles.map((p) => [p.type, p.id, p.title])).toEqual([
      ['keypad', 'tastenfeld', 'Tastenfeld'],
    ]);
    expect(draftToJson(draft)).toMatchObject({
      id: 'custom-neue-mission',
      players: { min: 2, max: 2 },
      timeLimitSec: 600,
      radio: {},
      puzzles: [{ type: 'keypad', id: 'tastenfeld', title: 'Tastenfeld', hints: [], lights: [] }],
    });
  });

  it('offers every module that stands at a station, and no relay', () => {
    expect(STATION_TYPES).toHaveLength(12);
    expect(STATION_TYPES).toContain('servers');
    expect(STATION_TYPES).not.toContain('relay');
  });
});

describe('draft ↔ JSON', () => {
  it.each(shipped)('reads $name and writes back the same mission under a custom id', ({ data }) => {
    const draft = loaded(data);
    const original = parseMission(data);
    const again = parseMission(draftToJson(draft));
    expect({ ...again, id: original.id }).toEqual(original);
    expect(again.id).toBe(customIdOf(original.title));
  });

  it('keeps what the editor does not show: drones, the emergency, listOrder, intro, lamps', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data;
    const json = draftToJson(loaded(blackout)) as {
      listOrder: number;
      intro: unknown;
      map: {
        drones: Record<string, unknown>[];
        sabotage: Record<string, unknown>;
        lamps: unknown[];
      };
    };
    expect(json.listOrder).toBe(10);
    expect(json.intro).toEqual((blackout as { intro?: unknown } | undefined)?.intro);
    expect(json.intro).toMatchObject({ place: 'Trakt C', time: 'Nachtschicht · 23:47' });
    expect(json.map.drones[0]).toMatchObject({ speed: 1.7, frozenByPlate: 'kameraplatte' });
    expect(json.map.sabotage).toMatchObject({
      mode: 'relay',
      required: 6,
      afterSolved: 3,
      panels: [],
    });
    expect(json.map.lamps).toHaveLength(5);
  });
});

describe('a puzzle’s own fields and penalty, draft ↔ JSON', () => {
  it('reads a module’s own fields and the penalty into the puzzle, and writes them back', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data;
    const draft = loaded(blackout);
    expect(draft.puzzles.map((p) => [p.type, p.penaltySec, p.fields])).toEqual([
      ['button-sync', null, { windowMs: 2000, style: 'lever' }],
      ['circuit', 30, { wires: { min: 4, max: 6 }, shorts: 3, burnoutSec: 60 }],
      ['signal', null, { stages: 4, length: 4, legend: true, fleetingFrom: 3 }],
      ['servers', null, { crashed: 4, trap: true }],
      ['morse', null, {}],
      ['button-sync', null, { windowMs: 2000, style: 'button' }],
    ]);
    const json = draftToJson(draft) as { puzzles: Record<string, unknown>[] };
    expect(json.puzzles[0]).toMatchObject({ type: 'button-sync', style: 'lever' });
    expect(json.puzzles[1]).toMatchObject({ wires: { min: 4, max: 6 }, penaltySec: 30 });
    // Left out of the file, the penalty is left to the module: no key, no number.
    expect(json.puzzles[3]).toMatchObject({ type: 'servers', crashed: 4, trap: true });
    expect(json.puzzles[3]).not.toHaveProperty('penaltySec');
    expect(defaultPenalty('servers')).toBe(20);
    expect(defaultPenalty('maze')).toBe(15);
  });

  it('reads a field that can be off and is left out as off, and leaves it out again', () => {
    const json = draftToJson(labFor('button-sync')) as { puzzles: Record<string, unknown>[] };
    const bare = { ...json, puzzles: json.puzzles.map((p) => without(p, 'windowMs')) };
    const signal = draftToJson(labFor('signal')) as { puzzles: Record<string, unknown>[] };
    const never = { ...signal, puzzles: signal.puzzles.map((p) => without(p, 'fleetingFrom')) };
    const sync = loaded(bare).puzzles[0];
    expect(sync?.fields).toEqual({ windowMs: null, style: 'button' });
    expect(draftToJson(loaded(bare))).toEqual(bare);
    expect(loaded(never).puzzles[0]?.fields).toMatchObject({ fleetingFrom: null });
    // The schema's "off" for fleetingFrom is null, and so the file says it.
    const written = draftToJson(loaded(never)) as { puzzles: Record<string, unknown>[] };
    expect(written.puzzles[0]?.['fleetingFrom']).toBeNull();
  });

  it('turns away a puzzle field neither every puzzle nor its module knows', () => {
    const json = draftToJson(labFor('maze')) as { puzzles: Record<string, unknown>[] };
    const odd = { ...json, puzzles: json.puzzles.map((p) => ({ ...p, walls: 12, seed: 3 })) };
    expect(draftFromJson(odd)).toEqual({
      ok: false,
      problems: [
        'Rätsel „leitungsnetz“: unbekanntes Feld „walls“.',
        'Rätsel „leitungsnetz“: unbekanntes Feld „seed“.',
      ],
    });
  });
});

describe('draft ↔ JSON: rooms’ kinds and furniture', () => {
  it('reads each room’s kind and every piece of furniture, and writes them back', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data as {
      map: { labels: unknown[]; decor: unknown[] };
    };
    const draft = loaded(blackout);
    expect(draft.map.labels[0]).toEqual({ text: 'ARCHIV', x: 4, y: 2, kind: 'archive' });
    expect(draft.map.decor[0]).toEqual({ kind: 'cart', x: 1, y: 5, variant: null });
    expect(draft.map.decor[1]).toEqual({ kind: 'shelf', x: 2, y: 2, variant: 0 });
    const json = draftToJson(draft) as { map: { labels: unknown[]; decor: unknown[] } };
    expect(json.map.labels).toEqual(blackout.map.labels);
    expect(json.map.decor).toEqual(blackout.map.decor);
  });

  it('leaves out a plain room’s kind and a look left to the tile, and reads them back so', () => {
    const blank = newDraft();
    const draft: Draft = {
      ...blank,
      map: {
        ...blank.map,
        labels: [{ text: 'LAGER', x: 2, y: 2, kind: '' }],
        decor: [
          { kind: 'barrel', x: 3, y: 3, variant: null },
          { kind: 'rack', x: 4, y: 3, variant: 2 },
        ],
      },
    };
    const json = draftToJson(draft) as { map: { labels: unknown[]; decor: unknown[] } };
    expect(json.map.labels).toEqual([{ text: 'LAGER', x: 2, y: 2 }]);
    expect(json.map.decor).toEqual([
      { kind: 'barrel', x: 3, y: 3 },
      { kind: 'rack', x: 4, y: 3, variant: 2 },
    ]);
    expect(loaded(json).map).toEqual(draft.map);
  });

  it('starts a new draft with no furniture, and reads a file without any as none', () => {
    expect(newDraft().map.decor).toEqual([]);
    const json = draftToJson(newDraft()) as { map: Record<string, unknown> };
    const map = Object.fromEntries(Object.entries(json.map).filter(([key]) => key !== 'decor'));
    expect(map).not.toHaveProperty('decor');
    expect(loaded({ ...json, map }).map.decor).toEqual([]);
  });
});

describe('draft ↔ JSON: notes of the last shift', () => {
  it('reads every note with its words, and writes them back as they came', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data as {
      map: { notes: unknown[] };
    };
    const draft = loaded(blackout);
    expect(draft.map.notes).toHaveLength(3);
    expect(draft.map.notes[0]).toEqual({ x: 12, y: 6, text: expect.stringMatching(/23:47/) });
    const json = draftToJson(draft) as { map: { notes: unknown[] } };
    expect(json.map.notes).toEqual(blackout.map.notes);
  });

  it('starts a new draft with no notes, and leaves them out of the file then', () => {
    expect(newDraft().map.notes).toEqual([]);
    const json = draftToJson(newDraft()) as { map: Record<string, unknown> };
    expect(json.map).not.toHaveProperty('notes');
    expect(loaded(json).map.notes).toEqual([]);
  });
});

describe('draft ↔ JSON, unsound and broken', () => {
  it('leaves out of the file what the draft leaves empty', () => {
    const draft = newDraft();
    const json = draftToJson({
      ...draft,
      puzzles: draft.puzzles.map((p) => ({ ...p, hints: ['Erst links.', ' ', ''], onSolved: '' })),
      map: {
        ...draft.map,
        doors: [{ id: 't', x: 1, y: 1, opensBy: { kind: 'plate', plateId: 'p', untilSolved: '' } }],
        items: [{ id: 'k', label: 'KISTE', x: 2, y: 2, requiredFor: '' }],
        stations: [{ puzzleId: 'tastenfeld', x: 3, y: 3 }],
      },
    }) as { puzzles: Record<string, unknown>[]; map: Record<string, Record<string, unknown>[]> };
    expect(json.puzzles[0]?.['hints']).toEqual(['Erst links.']);
    expect(json.puzzles[0]).not.toHaveProperty('onSolved');
    expect(json.map['doors']?.[0]?.['opensBy']).toEqual({ kind: 'plate', plateId: 'p' });
    expect(json.map['items']?.[0]).toEqual({ id: 'k', label: 'KISTE', x: 2, y: 2 });
    expect(json.map['stations']?.[0]).toEqual({ puzzleId: 'tastenfeld', x: 3, y: 3 });
    expect(json.map).not.toHaveProperty('exit');
  });

  it('reads an unsound export back, unsound as it was', () => {
    const json = draftToJson(newDraft());
    const draft = loaded(json);
    expect(draftToJson(draft)).toEqual(json);
  });

  it('turns away what is no mission file, naming the field with the wrong type', () => {
    expect(draftFromJson([1, 2])).toEqual({
      ok: false,
      problems: [expect.stringContaining('kein')],
    });
    expect(draftFromJson(null).ok).toBe(false);
    const wrong = { ...draftToJson(newDraft()), timeLimitSec: 'zehn' };
    const result = draftFromJson(wrong);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems).toEqual([expect.stringMatching(/^timeLimitSec: /)]);
    const quiz = [{ type: 'quiz', id: 'q', title: 'Q' }];
    const unknownModule = { ...draftToJson(newDraft()), puzzles: quiz };
    expect(draftFromJson(unknownModule).ok).toBe(false);
  });

  it('turns away a relay at a station', () => {
    const relay = {
      ...draftToJson(newDraft()),
      puzzles: [
        {
          type: 'relay',
          id: 'notfall',
          title: 'Notfall',
          players: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
          required: 4,
          durationSec: 40,
        },
      ],
    };
    const result = draftFromJson(relay);
    expect(result.ok ? [] : result.problems).toEqual([expect.stringContaining('„notfall“')]);
  });

  it('copies a shipped mission under a title, and so an id, of its own', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data;
    const copy = copyOf(loaded(blackout));
    expect(copy.title).toBe('Blackout im Labor (Kopie)');
    expect(draftToJson(copy)['id']).toBe('custom-blackout-im-labor-kopie');
  });
});

describe.each(STATION_TYPES)('a new %s puzzle', (type) => {
  it('starts with every field of its module at the default, the penalty left to it', () => {
    const puzzle = newPuzzle(type, []);
    expect(puzzle.penaltySec).toBeNull();
    expect(puzzle.fields).toEqual(defaultFields(type));
    expect(Object.keys(puzzle.fields)).toEqual(moduleFor(type).fields.map((f) => f.key));
  });

  it('makes a mission file the game takes, and reads back as it was', () => {
    const draft = labFor(type);
    const json = draftToJson(draft);
    const check = checkMission(json);
    expect(check.ok ? [] : check.issues).toEqual([]);
    expect(loaded(json)).toEqual(draft);
  });
});

describe('a module’s own fields in the file', () => {
  const specs: FieldSpec[] = [
    { key: 'size', label: 'Größe', help: 'h.', kind: 'int', min: 4, max: 8, default: 6 },
    {
      key: 'window',
      label: 'Fenster',
      help: 'h.',
      kind: 'int',
      min: 1,
      max: 9,
      default: 3,
      off: 'omit',
    },
    { key: 'from', label: 'Ab', help: 'h.', kind: 'int', min: 1, max: 6, default: 3, off: 'null' },
    { key: 'legend', label: 'Legende', help: 'h.', kind: 'bool', default: false },
    {
      key: 'mode',
      label: 'Art',
      help: 'h.',
      kind: 'choice',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      default: 'a',
    },
    {
      key: 'wires',
      label: 'Drähte',
      help: 'h.',
      kind: 'range',
      min: 3,
      max: 6,
      default: { min: 3, max: 6 },
    },
  ];

  it('reads each left-out key as the file means it: off where it can be, else the default', () => {
    expect(fieldsFromJson(specs, { type: 'x', size: 7, legend: true })).toEqual({
      size: 7,
      window: null,
      from: null,
      legend: true,
      mode: 'a',
      wires: { min: 3, max: 6 },
    });
  });

  it('writes the listed fields only, and an empty one that can be off as null or no key', () => {
    const fields = {
      size: 5,
      window: null,
      from: null,
      legend: false,
      mode: 'b',
      wires: { min: 4, max: 5 },
      stray: 1,
    };
    expect(fieldsToJson(specs, fields)).toEqual({
      size: 5,
      from: null,
      legend: false,
      mode: 'b',
      wires: { min: 4, max: 5 },
    });
    expect(fieldsToJson(specs, { ...fields, window: 4, from: 2 })).toMatchObject({
      window: 4,
      from: 2,
    });
  });

  it('copies what it reads and writes, so the draft and the file never share an object', () => {
    const file = { wires: { min: 4, max: 6 } };
    const fields = fieldsFromJson(specs, file);
    expect(fields['wires']).toEqual(file.wires);
    expect(fields['wires']).not.toBe(file.wires);
    expect(fieldsToJson(specs, fields)['wires']).not.toBe(fields['wires']);
  });
});
