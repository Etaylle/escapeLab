import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isCustomMissionId, parseMission } from '@escapelab/core';
import {
  copyOf,
  customIdOf,
  draftFromJson,
  draftToJson,
  freeId,
  newDraft,
  slugOf,
  STATION_TYPES,
  type Draft,
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
    expect(STATION_TYPES).toHaveLength(11);
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

  it('keeps what part 1 does not show: module fields, drones, the emergency, listOrder', () => {
    const blackout = shipped.find(({ name }) => name === 'blackout.json')?.data;
    const json = draftToJson(loaded(blackout)) as {
      listOrder: number;
      puzzles: Record<string, unknown>[];
      map: { drones: Record<string, unknown>[]; sabotage: Record<string, unknown> };
    };
    expect(json.listOrder).toBe(10);
    expect(json.puzzles[0]).toMatchObject({
      type: 'circuit',
      wires: { min: 4, max: 6 },
      shorts: 3,
    });
    expect(json.map.drones[0]).toMatchObject({ speed: 1.7, frozenByPlate: 'kameraplatte' });
    expect(json.map.sabotage).toMatchObject({ mode: 'relay', required: 6, panels: [] });
  });

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
