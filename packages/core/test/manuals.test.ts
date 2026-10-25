import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVER_FIGURE, MODULES, parseMission } from '../src/index.js';
import type { ManualBlock, ManualSection, Mission, PuzzleContext } from '../src/index.js';
import { BUILD, LOG, OPERATION, WORKSHOP } from '../src/puzzles/printed.js';
import { relayDefFor } from '../src/puzzles/relay.js';
import { mulberry32 } from '../src/rng.js';
import { offVoice, sentencesOf } from './voice.js';

/**
 * Every module's printed page is a document the lab wrote for its own people
 * — a Betriebsanleitung, never an instruction to a player: the title line
 * with type and year over the machine's purpose, Aufbau under the drawing of
 * the device, Betrieb with what a fault costs, the tables the machine
 * follows, an excerpt from its log and the workshop's notes. That holds for
 * every variant a def can name, since the pages follow the def's variant
 * fields. The notes in the margins of every mission keep to the same voice:
 * the papers' rules in voice.ts.
 */

// --- the voice ---------------------------------------------------------------------------

/** Every string a page prints: headings, running text, rules, cells, captions, the log. */
function printedTexts(manual: readonly ManualSection[]): string[] {
  return manual.flatMap(({ heading, blocks }) => [
    heading,
    ...blocks.flatMap((block): string[] => {
      switch (block.kind) {
        case 'p':
          return [block.text];
        case 'rules':
          return block.items;
        case 'table':
          return [...block.head, ...block.rows.flat()];
        case 'columns':
          return [];
        case 'example':
          return [block.title, ...block.lines];
        case 'figure':
          return [block.caption];
      }
    }),
  ]);
}

describe('the voice guard', () => {
  it('finds what a page must not say, and prints the sentence', () => {
    const lines = [
      'Drücke die Taste. Das Pult nimmt sie an.',
      'Wer am Pult steht, bekommt die Folge vorgelesen.',
      'Die Crew trennt das Kabel; dann sagt ihr Bescheid.',
      'Das Gegenpult quittiert, und die Folge bleibt, wie eingegeben.',
      'Stelle 3 der Uhr zeigt die Ziffer: merken oder notieren.',
      'Man sieht es am Pult, lies es dort ab!',
    ];
    expect(offVoice(lines)).toEqual([
      'befiehlt: „Drücke die Taste."',
      'gibt eine Regieanweisung: „Wer am Pult steht, bekommt die Folge vorgelesen."',
      'coacht das Gespräch: „Wer am Pult steht, bekommt die Folge vorgelesen."',
      'spricht mit ihr an: „Die Crew trennt das Kabel; dann sagt ihr Bescheid."',
      'nennt einen Spieler: „Die Crew trennt das Kabel; dann sagt ihr Bescheid."',
      'nennt einen Menschen: „Man sieht es am Pult, lies es dort ab!"',
      'befiehlt: „Man sieht es am Pult, lies es dort ab!"',
      'ruft aus: „Man sieht es am Pult, lies es dort ab!"',
    ]);
  });
});

// --- the documents -------------------------------------------------------------------------

/** The title line: the machine, its type and its year. */
const TITLE_LINE =
  /^[A-ZÄÖÜ][\p{L} -]+, Typ ([A-Z]{1,3}-\d{1,2}) \(Baujahr (19[5-9]\d|20[01]\d)\)$/u;

/** The most running text a page carries, in words; tables, rules, figures and the log aside. */
const WORDS_MAX = 170;

/** The most sentences one part of the running text has. */
const SENTENCES_MAX = 4;

/** The longest note in a mission's margin: it has to fit beside the rules. */
const NOTE_MAX_CHARS = 120;

/** Each module's variants beyond its defaults: every field its printed pages read. */
const VARIANTS: Record<string, object[]> = {
  'button-sync': [
    { windowMs: 1000 },
    { windowMs: 2500 },
    { style: 'lever' },
    { style: 'lever', windowMs: 3000 },
  ],
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
  keypad: [{ penaltySec: 45 }, { penaltySec: 1 }],
  signal: [
    { stages: 2, length: 3 },
    { stages: 6, length: 6 },
    { fleetingFrom: 2 },
    { legend: true },
    { legend: true, fleetingFrom: 3 },
    { legend: true, stages: 6, length: 6, fleetingFrom: 1 },
  ],
  servers: [{ penaltySec: 45 }, { crashed: 5, trap: false }],
  circuit: [{ wires: { min: 4, max: 4 } }, { shorts: 2, burnoutSec: 90 }, { shorts: 5 }],
};

/** Defs, by a label, for the modules that need more than a type, an id and a title. */
const OWN_DEFS: Record<string, Record<string, object>> = {
  relay: Object.fromEntries([
    ...[2, 6].map((crew) => [
      `${crew} Spieler`,
      relayDefFor(
        Array.from({ length: crew }, (_, i) => ({ id: `p${i}`, name: `Spieler ${i + 1}` })),
        { label: 'Alarm', hint: 'h', durationSec: 45, penaltySec: 60, windowSec: 12 },
      ),
    ]),
    [
      'eine Anweisung in einer Sekunde',
      relayDefFor(
        [
          { id: 'p0', name: 'A' },
          { id: 'p1', name: 'B' },
        ],
        { label: 'Alarm', hint: 'h', durationSec: 45, penaltySec: 1, windowSec: 1, required: 1 },
      ),
    ],
  ]),
};

interface Case {
  label: string;
  type: string;
  def: object;
  manual: ManualSection[];
  penaltySec: number;
  /** the drawing Aufbau opens on: the module's own, or the main switch for a lever */
  drawing: string;
}

/** The drawing a def's page shows under Aufbau. */
const drawingOf = (type: string, def: object): string =>
  'style' in def && def.style === 'lever' ? LEVER_FIGURE : type;

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
  return defs.map(([variant, def]) => ({
    label: `${module.type} ${variant}`,
    type: module.type,
    def,
    manual: module.manual(def as never),
    penaltySec: (def as { penaltySec: number }).penaltySec,
    drawing: drawingOf(module.type, def),
  }));
});

const blocksOf = (manual: readonly ManualSection[]): ManualBlock[] =>
  manual.flatMap((section) => section.blocks);

const kinds = (blocks: readonly ManualBlock[]): string[] => blocks.map((block) => block.kind);

/** The running text of a page: every paragraph, in order. */
const runningText = (manual: readonly ManualSection[]): string[] =>
  blocksOf(manual).flatMap((block) => (block.kind === 'p' ? [block.text] : []));

const wordsIn = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** What Betrieb has to say a fault costs: the def's seconds, or that nothing here costs time. */
function costLine(type: string, penaltySec: number): RegExp {
  if (type === 'button-sync') {
    return /Die Überwachung meldet hier nichts: Kein (Druck|Hebel) kostet Einsatzzeit\./;
  }
  const unit = penaltySec === 1 ? 'Sekunde' : 'Sekunden';
  return new RegExp(
    `(meldet die Überwachung|die Überwachung meldet) Alarm und zieht ${penaltySec} ${unit} ` +
      'Einsatzzeit ab',
    'i',
  );
}

/** A neutral moment for setting up a module; init needs one, the printed pages never. */
const SETUP: PuzzleContext = {
  edgework: { serial: 'K7G3B-2', indicators: [], cells: 1 },
  alarms: 0,
  remainingSec: 600,
  at: 0,
  crew: ['p0', 'p1'],
  console: null,
  atConsoles: { a: [], b: [] },
  readers: [],
};

describe('the printed pages', () => {
  it('cover every module the game knows', () => {
    expect(new Set(cases.map(({ type }) => type))).toEqual(new Set(MODULES.map((m) => m.type)));
  });

  it('give every machine a type plate of its own', () => {
    const plates = new Map<string, string>();
    for (const { label, type, def, manual } of cases) {
      const machine = `${type} ${drawingOf(type, def)}`;
      const plate = TITLE_LINE.exec(manual[0]?.heading ?? '')?.[1] ?? label;
      expect(plates.get(plate) ?? machine, `${label}: ${plate}`).toBe(machine);
      plates.set(plate, machine);
    }
  });
});

describe.each(cases)('$label', ({ type, def, manual, penaltySec, drawing }) => {
  const module = MODULES.find((m) => m.type === type);
  const [title, build, operation] = manual;
  const workshop = manual.at(-1);

  it('opens on the title line with type and year, the purpose under it', () => {
    expect(title?.heading).toMatch(TITLE_LINE);
    expect(kinds(title?.blocks ?? [])).toEqual(['p']);
  });

  it('sets out Aufbau under the drawing of the device, Betrieb with what a fault costs', () => {
    expect(build?.heading).toBe(BUILD);
    expect(build?.blocks).toEqual([
      {
        kind: 'figure',
        of: drawing,
        caption: expect.stringMatching(/^Abb\. 1 — \S+( \S+){1,2}$/),
      },
      { kind: 'p', text: expect.any(String) },
    ]);
    expect(operation?.heading).toBe(OPERATION);
    const [running] = operation?.blocks ?? [];
    expect(running?.kind === 'p' ? running.text : '').toMatch(costLine(type, penaltySec));
  });

  it('prints the tables between Betrieb and the log, and no running text among them', () => {
    const law = manual.slice(3, -1);
    for (const section of law) {
      const own = section.blocks.filter((block) => block.kind !== 'example');
      expect(own.length, section.heading).toBeGreaterThan(0);
      expect(kinds(own).filter((kind) => kind === 'p' || kind === 'example')).toEqual([]);
    }
    expect(kinds(operation?.blocks ?? []).slice(0, 1)).toEqual(['p']);
    expect(kinds(operation?.blocks ?? []).slice(1)).toEqual(law.length === 0 ? ['example'] : []);
    // Every drawing past the device's is numbered on, and stands with the tables.
    const later = law.flatMap((section) => section.blocks).filter((b) => b.kind === 'figure');
    expect(later.map((figure) => figure.kind === 'figure' && figure.caption.slice(0, 7))).toEqual(
      later.map((_, i) => `Abb. ${i + 2} `),
    );
  });

  it('closes the tables on the log, a past operation entry by entry, in order of time', () => {
    const logs = blocksOf(manual).filter((block) => block.kind === 'example');
    expect(logs).toHaveLength(1);
    expect(manual.at(-2)?.blocks.at(-1)).toEqual(logs[0]);
    const [log] = logs;
    expect(log?.kind === 'example' && log.title).toBe(LOG);
    const lines = log?.kind === 'example' ? log.lines : [];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.filter((line) => !/^\d\d:\d\d \S.*\.$/.test(line))).toEqual([]);
    const times = lines.map((line) => line.slice(0, 5));
    expect([...times].sort()).toEqual(times);
  });

  it('ends on one or two notes from the workshop', () => {
    expect(workshop?.heading).toBe(WORKSHOP);
    const notes = workshop?.blocks ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.length).toBeLessThanOrEqual(2);
    expect(kinds(notes).filter((kind) => kind !== 'p')).toEqual([]);
  });

  it(`keeps each part to ${SENTENCES_MAX} sentences and the page to ${WORDS_MAX} words`, () => {
    const texts = runningText(manual);
    const long = texts.filter((text) => sentencesOf(text).length > SENTENCES_MAX);
    expect(long).toEqual([]);
    const words = texts.reduce((total, text) => total + wordsIn(text), 0);
    expect(words).toBeLessThanOrEqual(WORDS_MAX);
  });

  it('writes its rules as the machine’s law: conditions, „Andernfalls" only last', () => {
    for (const block of blocksOf(manual)) {
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

  it('speaks of the machine and never to a player', () => {
    expect(offVoice(printedTexts(manual))).toEqual([]);
  });

  it('hangs on the def alone: a copy prints the same, and no run changes it', () => {
    expect(module?.manual(structuredClone(def) as never)).toEqual(manual);
    for (let seed = 0; seed < 5; seed++) {
      module?.init(def as never, mulberry32(seed), SETUP);
      expect(module?.manual(def as never)).toEqual(manual);
    }
  });
});

// --- the notes in the margins ------------------------------------------------------------

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

describe.each(missions.map((m) => [m.id, m] as const))('the notes in mission %s', (_id, mission) => {
  const notes = mission.puzzles.flatMap((puzzle) => puzzle.hints);

  it(`are notes somebody in the lab left, ${NOTE_MAX_CHARS} characters at most`, () => {
    expect(notes.filter((note) => [...note].length > NOTE_MAX_CHARS)).toEqual([]);
    expect(notes.filter((note) => !/^[A-ZÄÖÜ][\p{L}. -]*: \S/u.test(note))).toEqual([]);
  });

  it('keep to the voice of the papers', () => {
    expect(offVoice(notes)).toEqual([]);
  });

  it('can each be asked for: a station with notes has its rules lying somewhere', () => {
    // Notes are asked for at a source covering the open station; a station the whole crew
    // presses needs no source, and then it has no notes either.
    const unreachable = mission.puzzles
      .filter((puzzle) => puzzle.hints.length > 0)
      .filter((puzzle) => !mission.map.manuals.some((m) => m.puzzleIds.includes(puzzle.id)))
      .map((puzzle) => puzzle.id);
    expect(unreachable).toEqual([]);
  });
});
