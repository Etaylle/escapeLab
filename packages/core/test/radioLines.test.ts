import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, type Mission } from '../src/index.js';

/**
 * Mission control's lines in every shipped mission: the night-shift operator at the lab's
 * control desk, talking to colleagues over a crackling radio — one or two spoken sentences
 * that say where something is the way a person would, never a status display, never a rules
 * list. A line is anything the reducer can put on the air (actions.ts): `radio.start` as the
 * clock starts, each station's `onSolved` and `nudges`, `radio.escape` as the hatch unlocks.
 */

/** The most words one line says: a breath or two at the desk. */
const WORDS_MAX = 28;

/** The most sentences one line has. */
const SENTENCES_MAX = 2;

/** What a person at the desk never calls the crew: they are colleagues, not players. */
const PLAYERS = /\b(Spieler\w*|Crew-?[Mm]itglied\w*|Bediener\w*)/;

/** The vocabulary of the manuals' code tables: it instructs, and the radio never does. */
const CODE_TABLES = /\bE\d{2}\b|\b(Legende|Zeile|Spalte|Muster|Code|Verfahren|Befehl)\w*/;

const wordsIn = (line: string): number =>
  line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** A line cut into sentences: at a stop that a capital or an opening quote follows. */
const sentencesOf = (line: string): string[] => line.split(/(?<=[.!?])\s+(?=[„A-ZÄÖÜ])/);

/** What a line on the air must not be, and how to find it. */
const CHECKS: readonly (readonly [string, (line: string) => boolean])[] = [
  [`over ${WORDS_MAX} words`, (line) => wordsIn(line) > WORDS_MAX],
  [`over ${SENTENCES_MAX} sentences`, (line) => sentencesOf(line).length > SENTENCES_MAX],
  ['no spoken sentence', (line) => !/^[A-ZÄÖÜ].*[.!?]$/u.test(line)],
  ['names the crew as players', (line) => PLAYERS.test(line)],
  ['speaks from the code tables', (line) => CODE_TABLES.test(line)],
];

/** Every line of `lines` that breaks a check, with the check and the line. */
function offAir(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    CHECKS.filter(([, breaks]) => breaks(line)).map(([what]) => `${what}: „${line}"`),
  );
}

/** Every line `mission` can put on the air, in the order a run hears them. */
function linesOf(mission: Mission): string[] {
  const lines = [
    mission.radio.start,
    ...mission.puzzles.flatMap((puzzle) => [...puzzle.nudges, puzzle.onSolved]),
    mission.radio.escape,
  ];
  return lines.filter((line): line is string => line !== undefined);
}

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

describe('the radio-line guard', () => {
  it('finds what a line must not be, and prints the line', () => {
    const long =
      'Leitstelle hier, bei euch ist der Strom weg, und auf meinem Pult blinkt alles rot, ' +
      'also geht jetzt zum Hebel im Flur und legt ihn zu zweit um, aber bitte gleichzeitig.';
    expect(offAir([long, 'Strom weg. Hebel im Flur. Zu zweit.', 'Notlicht im Flur'])).toEqual([
      `over 28 words: „${long}"`,
      'over 2 sentences: „Strom weg. Hebel im Flur. Zu zweit."',
      'no spoken sentence: „Notlicht im Flur"',
    ]);
    expect(
      offAir(['Spieler 1 an Pult A.', 'Ein Crew-Mitglied liest vor.', 'Der Bediener drückt.']),
    ).toHaveLength(3);
    expect(offAir(['E23 am Rack.', 'Seht in der Legende nach.', 'Nehmt Zeile zwei.'])).toEqual([
      'speaks from the code tables: „E23 am Rack."',
      'speaks from the code tables: „Seht in der Legende nach."',
      'speaks from the code tables: „Nehmt Zeile zwei."',
    ]);
    expect(offAir(['Hört ihr mich? Der Hebel hängt im Flur, unter der roten Lampe.'])).toEqual([]);
  });
});

const byId = missions.map((m) => [m.id, m] as const);

describe.each(byId)('the radio in mission %s', (_id, mission) => {
  it(`speaks each line as a person: ${SENTENCES_MAX} sentences, ${WORDS_MAX} words at most`, () => {
    expect(offAir(linesOf(mission))).toEqual([]);
  });

  it('has a line for every station: its own nudge, or the line that sends the crew there', () => {
    const silent = mission.puzzles.filter((puzzle, i) => {
      const before = i === 0 ? mission.radio.start : mission.puzzles[i - 1]?.onSolved;
      return puzzle.nudges.length === 0 && before === undefined;
    });
    expect(silent.map((puzzle) => puzzle.id)).toEqual([]);
  });
});

describe.each(['blackout', 'systemcheck'])('the Leitstelle through %s', (id) => {
  const mission = missions.find((m) => m.id === id);

  it('opens the run, names the place of every station, follows every solve and the escape', () => {
    expect(mission?.radio.start).toBeDefined();
    expect(mission?.radio.escape).toBeDefined();
    const puzzles = mission?.puzzles ?? [];
    expect(puzzles.length).toBeGreaterThan(3);
    for (const [i, puzzle] of puzzles.entries()) {
      expect(puzzle.nudges.length, `${puzzle.id}: a nudge`).toBeGreaterThanOrEqual(1);
      // The last solve leaves the air to the escape line, which would cut a line of its own short.
      const last = i === puzzles.length - 1;
      expect(puzzle.onSolved === undefined, `${puzzle.id}: a line on its solve`).toBe(last);
    }
  });
});
