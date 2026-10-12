import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULES, parseMission } from '../src/index.js';
import type { ManualSection, Mission } from '../src/index.js';
import { relayDefFor } from '../src/puzzles/relay.js';

/**
 * Every module's printed rules in the frame of a technical manual: the device
 * drawn and described first, the rules as full conditional sentences or
 * tables, a worked example, and the penalty line last — for every variant a
 * def can name, since the pages follow the def's variant fields. The notes of
 * the last crew, which lie beside the rules, keep to the same register.
 */

/** What a technical document leaves out: exclamations, a reader addressed, coaching on talk. */
const OFF_REGISTER = [
  /!/,
  /\b(du|dich|dir|dein\w*)\b/i,
  /ansag|beschreib|gefahrlos|redet|vorles|zurückruf|einzähl|notier/i,
  /\bSonst\b/,
];

/** The longest note of the last crew: it has to fit the margin beside the rules. */
const NOTE_MAX_CHARS = 120;

/** Each module's variants beyond its defaults: every field its printed rules read. */
const VARIANTS: Record<string, object[]> = {
  'button-sync': [{ windowMs: 1000 }, { windowMs: 2500 }],
  wiring: [
    { wires: { min: 3, max: 3 } },
    { wires: { min: 3, max: 5 } },
    { wires: { min: 4, max: 6 } },
    { wires: { min: 5, max: 6 } },
    { wires: { min: 6, max: 6 } },
    { penaltySec: 45 },
  ],
  switches: [{ features: 2 }],
  simon: [{ legend: 'einfach' }, { sequenceLength: 3 }, { legend: 'einfach', sequenceLength: 8 }],
  maze: [{ size: 4 }, { size: 8 }],
  keypad: [{ penaltySec: 45 }],
  signal: [
    { stages: 2, length: 3 },
    { stages: 6, length: 6 },
  ],
};

/** Defs, by a label, for the modules that need more than a type, an id and a title. */
const OWN_DEFS: Record<string, Record<string, object>> = {
  relay: Object.fromEntries(
    [2, 6].map((crew) => [
      `${crew} Spieler`,
      relayDefFor(
        Array.from({ length: crew }, (_, i) => ({ id: `p${i}`, name: `Spieler ${i + 1}` })),
        { label: 'Alarm', hint: 'h', durationSec: 45, penaltySec: 60, windowSec: 12 },
      ),
    ]),
  ),
};

type Case = readonly [label: string, type: string, manual: ManualSection[], penaltySec: number];

const cases: Case[] = MODULES.flatMap((module): Case[] => {
  const variants = [{}, ...(VARIANTS[module.type] ?? [])];
  const defs: [string, object][] = Object.entries(
    OWN_DEFS[module.type] ??
      Object.fromEntries(
        variants.map((variant) => [
          JSON.stringify(variant),
          module.defSchema.parse({ type: module.type, id: module.type, title: 'T', ...variant }),
        ]),
      ),
  );
  return defs.map(([variant, def]): Case => {
    const manual = module.manual(def as never);
    // Printed from the def alone: the same pages for a copy of it.
    expect(module.manual(structuredClone(def) as never)).toEqual(manual);
    const { penaltySec } = def as { penaltySec: number };
    return [`${module.type} ${variant}`, module.type, manual, penaltySec];
  });
});

/** What the last line says: what a wrong move costs, or that nothing here raises an alarm. */
function penaltyLine(type: string, penaltySec: number): RegExp {
  switch (type) {
    case 'button-sync':
      return /^Fehlgriff: kein Alarm, keine Zeitstrafe\.$/;
    case 'relay':
      return new RegExp(`^Notfallzeit abgelaufen, .+: Alarm, −${penaltySec} s\\.$`);
    default:
      return new RegExp(`^Fehlgriff: Alarm, −${penaltySec} s\\.( .+\\.)?$`);
  }
}

describe('the printed rules', () => {
  it('cover every module the game knows', () => {
    expect(new Set(cases.map(([, type]) => type))).toEqual(new Set(MODULES.map((m) => m.type)));
  });
});

describe.each(cases)('%s', (_label, type, manual, penaltySec) => {
  const blocks = manual.flatMap((section) => section.blocks);

  it('open on a drawing of the device, then its description', () => {
    const [figure, description] = manual[0]?.blocks ?? [];
    expect(figure).toEqual({
      kind: 'figure',
      of: type,
      caption: expect.stringMatching(/^Abb\. 1 — \S+( \S+){1,2}$/),
    });
    const text = description?.kind === 'p' ? description.text : '';
    expect(text.split(/(?<=\.) (?=[A-ZÄÖÜ„])/).length, text).toBeLessThanOrEqual(3);
    expect(blocks.filter((block) => block.kind === 'figure')).toHaveLength(1);
  });

  it('close on the worked example, then the penalty line', () => {
    const [example, last] = blocks.slice(-2);
    expect(blocks.filter((block) => block.kind === 'example')).toHaveLength(1);
    expect(example).toMatchObject({ kind: 'example', title: 'Beispiel' });
    const lines = example?.kind === 'example' ? example.lines : [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines.filter((line) => !/\.$/.test(line))).toEqual([]);
    expect(last?.kind === 'p' ? last.text : '').toMatch(penaltyLine(type, penaltySec));
  });

  it('set every rule as a conditional sentence, „Andernfalls" only last', () => {
    for (const block of blocks) {
      if (block.kind !== 'rules') {
        continue;
      }
      const ifs = block.items.filter((item) => item.startsWith('Wenn '));
      expect(ifs.filter((item) => !/^Wenn .+, .+\.$/.test(item))).toEqual([]);
      const otherwise = block.items.filter((item) => !item.startsWith('Wenn '));
      expect(otherwise.every((item) => /^Andernfalls .+\.$/.test(item))).toBe(true);
      expect(otherwise.length === 0 || block.items.at(-1) === otherwise[0]).toBe(true);
      expect(otherwise.length).toBeLessThanOrEqual(1);
    }
  });

  it('keep to the voice of a technical document', () => {
    const text = JSON.stringify(manual);
    for (const pattern of OFF_REGISTER) {
      expect(text).not.toMatch(pattern);
    }
  });
});

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

describe.each(missions.map((m) => [m.id, m] as const))('the notes in mission %s', (_id, mission) => {
  it(`keep to the register of the printed rules, ${NOTE_MAX_CHARS} characters at most`, () => {
    const notes = mission.puzzles.flatMap((puzzle) => puzzle.hints);
    const off = notes.filter(
      (note) =>
        [...note].length > NOTE_MAX_CHARS || OFF_REGISTER.some((pattern) => pattern.test(note)),
    );
    expect(off).toEqual([]);
  });
});
