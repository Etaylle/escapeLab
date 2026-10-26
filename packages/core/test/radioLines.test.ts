import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, PA_LINES_MAX, radioLines, type Mission } from '../src/index.js';
import { offVoice, WORLD } from './voice.js';

/**
 * Mission control's lines in every shipped mission, as a control room talks on the radio:
 * short, factual and still human — a call sign where it belongs, what is seen, what is next,
 * no praise chatter. A line on the air is anything the reducer can put there (`radioLines`):
 * `radio.start` as the clock starts, each station's `nudges` and `onSolved`, `radio.escape` as
 * the hatch unlocks. The intro's announcement over the lab's loudspeakers (`pa`) is the same
 * desk making a plant's routine announcement, to the plant's own people: its own length, else
 * the radio's rules, and never a word to the crew.
 */

/** The most words one line says, its call sign aside. */
const WORDS_MAX = 22;

/** The most sentences one line has; a short call beside them is no sentence of its own. */
const SENTENCES_MAX = 2;

/** The most words a short call has: radio shorthand, „Reaktor läuft.", „Alle raus, jetzt." */
const CALL_WORDS = 3;

/** The most pieces one line has, sentences and short calls together. */
const PIECES_MAX = 3;

/** The call sign that opens a run's first line: „Leitstelle an Nachtschicht." */
const CALL_SIGN = /^Leitstelle an [A-ZÄÖÜ][\p{L}-]*\.\s+/u;

/** What a person at the desk never calls the crew: they are colleagues, not players. */
const PLAYERS = /\b(Spieler\w*|Crew-?[Mm]itglied\w*|Bediener\w*)/;

/** The vocabulary of the manuals' code tables: it instructs, and the radio never does. */
const CODE_TABLES = /\bE\d{2}\b|\b(Legende|Zeile|Spalte|Muster|Code|Verfahren|Befehl)\w*/;

/** Praise: the desk says what it sees and what comes next, it does not cheer. */
const PRAISE_WORDS = ['gut gemacht', 'sehr gut', 'super', 'toll', 'klasse', 'prima', 'bravo'];
const PRAISE = new RegExp(
  `\\b(${[...PRAISE_WORDS, 'perfekt', 'spitze', 'geschafft', 'Glückwunsch'].join('|')})\\b`,
  'i',
);

const wordsIn = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** What a line says once its call sign is off. */
const messageOf = (line: string): string => line.replace(CALL_SIGN, '');

/** A line's pieces, its call sign aside: cut at a stop a capital or an opening quote follows. */
const piecesOf = (line: string): string[] =>
  messageOf(line).split(/(?<=[.!?])\s+(?=[„A-ZÄÖÜ])/);

/** How many sentences a line has: its pieces longer than a short call. */
const sentencesIn = (line: string): number =>
  piecesOf(line).filter((piece) => wordsIn(piece) > CALL_WORDS).length;

/** What a line on the air must not be, and how to find it. */
const CHECKS: readonly (readonly [string, (line: string) => boolean])[] = [
  [`over ${WORDS_MAX} words`, (line) => wordsIn(messageOf(line)) > WORDS_MAX],
  [`over ${SENTENCES_MAX} sentences`, (line) => sentencesIn(line) > SENTENCES_MAX],
  [`over ${PIECES_MAX} pieces`, (line) => piecesOf(line).length > PIECES_MAX],
  ['no spoken sentence', (line) => !/^[A-ZÄÖÜ].*[.!?]$/u.test(line)],
  ['names the crew as players', (line) => PLAYERS.test(line)],
  ['speaks from the code tables', (line) => CODE_TABLES.test(line)],
  ['praises', (line) => PRAISE.test(line)],
];

/** Every line of `lines` that breaks a check, with the check and the line. */
function offAir(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    CHECKS.filter(([, breaks]) => breaks(line)).map(([what]) => `${what}: „${line}"`),
  );
}

/** Every line `mission` can put on the air, in the order a run hears them. */
const textsOf = (mission: Mission): string[] =>
  radioLines(mission)
    .filter((line) => line.when !== 'pa')
    .map((line) => line.text);

/** Every line of the intro's announcement over the loudspeakers, in its order. */
const announcementOf = (mission: Mission): string[] =>
  radioLines(mission)
    .filter((line) => line.when === 'pa')
    .map((line) => line.text);

/**
 * Every line on the air of `mission` but its start that names the Leitstelle: its call sign
 * comes once. The loudspeakers are no radio: the desk names itself there as a plant's does.
 */
const callsAfterStart = (mission: Mission): string[] =>
  radioLines(mission)
    .filter((line) => line.when !== 'start' && line.when !== 'pa')
    .filter((line) => /\bLeitstelle\b/.test(line.text))
    .map((line) => line.text);

/** Every nudge of `mission` that says more than one sentence: a nudge names the next place. */
const longNudges = (mission: Mission): string[] =>
  radioLines(mission)
    .filter((line) => line.when === 'nudge' && piecesOf(line.text).length > 1)
    .map((line) => line.text);

/**
 * Every line of `mission` but its escape that calls out: the deep, trailer-like voice reads them
 * plain, and only the way out may be urgent.
 */
const callingOut = (mission: Mission): string[] =>
  radioLines(mission)
    .filter((line) => line.when !== 'escape' && line.text.includes('!'))
    .map((line) => line.text);

/** The most words one line over the loudspeakers says. */
const PA_WORDS_MAX = 28;

/** The most sentences one line over the loudspeakers has, short ones counted. */
const PA_SENTENCES_MAX = 3;

/** A plant's announcement welcomes nobody: the people it speaks to work there. */
const WELCOME = /\bwillkommen\b/i;

/** Nor does it set a mood: it says what runs, not how the night feels. */
const MOOD = new RegExp(
  `\\b(${['ruhig', 'angenehm', 'schön', 'friedlich', 'entspannt', 'gemütlich', 'unheimlich']
    .map((word) => `${word}\\w*`)
    .join('|')})\\b`,
  'i',
);

/**
 * What a line over the loudspeakers must not be: longer than an announcement's line — three
 * sentences, 28 words — and otherwise anything the radio's lines must not be, a call-out
 * included, nor open like the radio; nor welcome anybody, nor set a mood.
 */
const PA_CHECKS: readonly (readonly [string, (line: string) => boolean])[] = [
  [`over ${PA_WORDS_MAX} words`, (line) => wordsIn(line) > PA_WORDS_MAX],
  [`over ${PA_SENTENCES_MAX} sentences`, (line) => piecesOf(line).length > PA_SENTENCES_MAX],
  ...CHECKS.filter(([what]) => !/^over /.test(what)),
  ['calls out', (line) => line.includes('!')],
  ['opens like the radio', (line) => CALL_SIGN.test(line)],
  ['welcomes', (line) => WELCOME.test(line)],
  ['sets a mood', (line) => MOOD.test(line)],
];

/**
 * Every line of `lines` that breaks a check of the loudspeakers' rules, or speaks to the crew
 * the way no text of the lab may (voice.ts WORLD), with what it does.
 */
function offSpeaker(lines: readonly string[]): string[] {
  const checked = lines.flatMap((line) =>
    PA_CHECKS.filter(([, breaks]) => breaks(line)).map(([what]) => `${what}: „${line}"`),
  );
  return [...checked, ...offVoice(lines, WORLD)];
}

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

/** The three lines the user approved as the Leitstelle's tone: Blackout's start, lever, escape. */
const APPROVED = [
  'Leitstelle an Nachtschicht. Stromausfall im ganzen Trakt, ich sehe nur noch die Notzellen. ' +
    'Geht zuerst ans Notlicht, der Hauptschalter im Flur braucht zwei Leute.',
  'Notlicht steht, danke. Jetzt der Notstrom: Die Anleitung dafür hängt im Archiv, der Kasten ' +
    'ist im Maschinenraum, das Prüfpult im Flur.',
  'Reaktor läuft. Der Notausgang ist entriegelt, Nordwestecke beim Archiv. Alle raus, jetzt.',
] as const;

describe('the radio-line guard', () => {
  it('finds what a line must not be, and prints the line', () => {
    const long =
      'Bei euch ist der Strom weg, auf meinem Pult blinkt alles rot, also geht jetzt zum ' +
      'Hebel im Flur und legt ihn zu zweit um.';
    const three = 'Der Strom ist weg. Der Hebel hängt im Flur. Legt ihn zu zweit um.';
    const telegram = 'Strom weg. Hebel im Flur. Zu zweit. Sofort.';
    expect(offAir([long, three, telegram, 'Notlicht im Flur'])).toEqual([
      `over 22 words: „${long}"`,
      `over 2 sentences: „${three}"`,
      `over 3 pieces: „${telegram}"`,
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
  });

  it('hears praise, however it is put', () => {
    const cheers = ['Gut gemacht, das Licht brennt.', 'Super, der Strom läuft.', 'Fast geschafft.'];
    expect(offAir(cheers)).toEqual(cheers.map((line) => `praises: „${line}"`));
    expect(offAir(['Das war toll.', 'Sehr gut, weiter.', 'Klasse Arbeit.'])).toHaveLength(3);
    expect(offAir(['Der Stollen ist frei.', 'Die Supermarktkasse piept.'])).toEqual([]);
  });

  it('hears a call-out anywhere but in the escape', () => {
    const loud = {
      radio: { start: 'Los!', escape: 'Raus, jetzt!' },
      puzzles: [{ id: 'p', nudges: ['Hier lang!'], onSolved: 'Gut.' }],
    } as unknown as Mission;
    expect(callingOut(loud)).toEqual(['Los!', 'Hier lang!']);
  });

  it('passes the approved lines: the call sign aside, short calls beside the sentences', () => {
    expect(offAir(APPROVED)).toEqual([]);
    // The call sign is the address, not the message: without its stop it counts, 24 words.
    const unsigned = APPROVED[0].replace('Nachtschicht.', 'Nachtschicht,');
    expect(offAir([unsigned])).toEqual([`over 22 words: „${unsigned}"`]);
    // „Reaktor läuft." and „Alle raus, jetzt." are short calls; four words are a sentence.
    const spelled = APPROVED[2].replace('Alle raus, jetzt.', 'Alle raus, und zwar jetzt.');
    expect(offAir([spelled])).toEqual([]);
    const fourth = `${spelled} Weg frei.`;
    expect(offAir([fourth])).toEqual([`over 3 pieces: „${fourth}"`]);
  });
});

describe('the loudspeaker guard', () => {
  it('finds what an announcement line must not be, and prints the line', () => {
    const long =
      'Durchsage der Leitstelle für Trakt C, es ist 23 Uhr 47 und die Nachtschicht hat soeben ' +
      'übernommen, Reaktor, Zentrifugen und Kühlung laufen wie vorgesehen bis zum frühen ' +
      'Morgen durch.';
    const four = 'Es ist 23 Uhr. Reaktor läuft. Kühlung läuft. Last normal.';
    expect(offSpeaker([long, four])).toEqual([
      `over 28 words: „${long}"`,
      `over 3 sentences: „${four}"`,
    ]);
    expect(offSpeaker(['Achtung! Probealarm.'])).toEqual(['calls out: „Achtung! Probealarm."']);
    expect(offSpeaker(['Leitstelle an Nachtschicht. Reaktor läuft.'])).toEqual([
      'opens like the radio: „Leitstelle an Nachtschicht. Reaktor läuft."',
    ]);
    expect(offSpeaker(['Willkommen in Trakt C.', 'Es ist eine ruhige Nacht.'])).toEqual([
      'welcomes: „Willkommen in Trakt C."',
      'sets a mood: „Es ist eine ruhige Nacht."',
    ]);
  });

  it('hears a word to the crew: an order, an address, the players named', () => {
    expect(offSpeaker(['Geht zum Hebel im Flur.'])).toEqual([
      'befiehlt: „Geht zum Hebel im Flur."',
    ]);
    expect(offSpeaker(['Meldet euch an der Pforte.'])).toEqual([
      'spricht mit ihr an: „Meldet euch an der Pforte."',
    ]);
    expect(offSpeaker(['Die Spieler melden sich am Pult.'])).toEqual([
      'names the crew as players: „Die Spieler melden sich am Pult."',
      'nennt einen Spieler: „Die Spieler melden sich am Pult."',
    ]);
  });

  it('lets a plant’s routine announcement pass: time, systems, load, its own staff', () => {
    expect(
      offSpeaker([
        'Durchsage der Leitstelle für Trakt B. Es ist 6 Uhr, die Frühschicht hat übernommen.',
        'Herr Brandt, bitte die Werkstatt anrufen.',
        'Die Nachtschicht gibt die Ausweise an der Pforte ab.',
      ]),
    ).toEqual([]);
  });
});

const byId = missions.map((m) => [m.id, m] as const);

describe.each(byId)('the radio in mission %s', (_id, mission) => {
  it(`speaks as a control room: ${WORDS_MAX} words, ${SENTENCES_MAX} sentences, no praise`, () => {
    expect(offAir(textsOf(mission))).toEqual([]);
  });

  it(`announces over the loudspeakers as a plant does: ${PA_WORDS_MAX} words a line`, () => {
    expect(offSpeaker(announcementOf(mission))).toEqual([]);
  });

  it('gives the call sign in the run’s first line and in no other', () => {
    expect(callsAfterStart(mission)).toEqual([]);
  });

  it('names the next place in one sentence where it nudges', () => {
    expect(longNudges(mission)).toEqual([]);
  });

  it('calls out in no line but the escape', () => {
    expect(callingOut(mission)).toEqual([]);
  });

  it('has a line for every station: its own nudge, or the line that sends the crew there', () => {
    const silent = mission.puzzles.filter((puzzle, i) => {
      const before = i === 0 ? mission.radio.start : mission.puzzles[i - 1]?.onSolved;
      return puzzle.nudges.length === 0 && before === undefined;
    });
    expect(silent.map((puzzle) => puzzle.id)).toEqual([]);
  });
});

describe('the Leitstelle over Blackout’s loudspeakers', () => {
  const blackout = missions.find((m) => m.id === 'blackout');
  const lines = blackout === undefined ? [] : announcementOf(blackout);

  it('makes the shift’s announcement in four to six lines', () => {
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(Math.min(6, PA_LINES_MAX));
  });

  it('opens with who speaks and the time, and gives its own people a routine word', () => {
    expect(lines[0]).toMatch(/^Durchsage der Leitstelle\b/);
    expect(lines[0]).toMatch(/\b23 Uhr 47\b/);
    expect(blackout?.intro?.time).toMatch(/23:47$/);
    // The page the blackout cuts off: said twice, as a page is.
    const [page, again] = (lines.at(-1) ?? '').split(/(?<=\.)\s+/);
    expect(page).toBe(again);
  });
});

describe.each(['blackout', 'systemcheck'])('the Leitstelle through %s', (id) => {
  const mission = missions.find((m) => m.id === id);

  it('opens the run with its call sign', () => {
    expect(mission?.radio.start).toMatch(CALL_SIGN);
  });

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

describe('the lines a mission can put on the air', () => {
  it('come in the order a run hears them, each with its moment and its station', () => {
    const blackout = missions.find((m) => m.id === 'blackout');
    if (blackout === undefined) throw new Error('missions/blackout.json is missing');
    const lines = radioLines(blackout);
    const ids = blackout.puzzles.map((puzzle) => puzzle.id);
    const station = (puzzleId: string): string[] => {
      const last = puzzleId === ids.at(-1);
      return last ? ['nudge', 'nudge'] : ['nudge', 'nudge', 'solved'];
    };
    const pa = (blackout.intro?.pa ?? []).map(() => 'pa');
    expect(pa).toHaveLength(5);
    expect(lines.map((line) => line.when)).toEqual([
      ...pa,
      'start',
      ...ids.flatMap(station),
      'escape',
    ]);
    expect(lines[0]).toEqual({ text: blackout.intro?.pa[0], when: 'pa', puzzleId: null });
    expect(lines[pa.length]).toEqual({ text: blackout.radio.start, when: 'start', puzzleId: null });
    expect(lines.at(-1)).toEqual({ text: blackout.radio.escape, when: 'escape', puzzleId: null });
    const first = blackout.puzzles[0];
    expect(lines.slice(pa.length + 1, pa.length + 4)).toEqual([
      { text: first?.nudges[0], when: 'nudge', puzzleId: first?.id },
      { text: first?.nudges[1], when: 'nudge', puzzleId: first?.id },
      { text: first?.onSolved, when: 'solved', puzzleId: first?.id },
    ]);
  });

  it('leaves out what a mission does not say', () => {
    const quiet = missions.map(
      (m) => ({ ...m, intro: undefined, radio: {}, puzzles: [] }) as unknown as Mission,
    );
    expect(quiet.flatMap(radioLines)).toEqual([]);
  });
});
