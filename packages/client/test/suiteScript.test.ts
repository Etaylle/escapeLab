import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loudnessOf, parseWav, wavBytes, type Pcm } from '../scripts/pcm.js';
import {
  checkCatalog,
  costOf,
  hashOf,
  isSuite,
  keepTake,
  noisyTakes,
  optionsOf,
  planLines,
  planOf,
  readCatalog,
  readManifest,
  readTakes,
  recordingsOf,
  remakeCommands,
  renderWith,
  runWith,
  suiteFlawsOf,
  suiteRequest,
  takesPerRun,
  type CatalogEntry,
  type CatalogItem,
  type Manifest,
  type ManifestEntry,
  type Studio,
  type TakeRecord,
} from '../scripts/sfx.js';
import {
  barMs,
  BEATS_PER_BAR,
  chunksOf,
  LEAD_BARS,
  motifOf,
  piecesOf,
  SEAM_S,
  spansOf,
  SPARE_S,
  suiteMs,
  tailBars,
  type SuiteEntry,
  type SuiteSection,
} from '../scripts/suite.js';
import * as music from '../src/world/music.js';
import { answering, benchOf, placesIn, runOf, studioOf } from './sfxFakes.js';

/**
 * A suite (scripts/suite.ts): music made as one generation of Eleven Music, a plan of named
 * sections, and cut into the pieces the game plays — its plan, its takes and keeping one whole,
 * against a client of the tests' own; no request leaves.
 */

/**
 * A section of the tests' suites: a loop or a piece played once, in a few bars — a loop playing
 * the motif's cell, a piece played once its first phrase, unless told.
 */
function section(
  id: string,
  name: string,
  bars: number,
  loop: boolean,
  more: Partial<SuiteSection> = {},
): SuiteSection {
  return {
    id,
    name,
    bars,
    loop,
    motif: loop ? 'cell' : 'phrase',
    lines: [],
    styles: [`${name.toLowerCase()} section`, 'steady'],
    avoid: loop ? ['ending'] : [],
    usedBy: ['src/world/music.ts#STEMS'],
    ...more,
  };
}

/** A small suite at 120 bpm, a bar of 2 s: a piece played once, two loops, a closing piece. */
const SMALL: SuiteEntry = {
  id: 'test-score',
  kind: 'suite',
  key: 'A minor',
  bpm: 120,
  motif: {
    cell: 'from the fifth, a leap up a sixth, then a sigh down a step',
    fall: 'falling by step to rest on the fifth',
    answer: 'from the sixth up to the fourth, then by step to the tonic',
  },
  styles: ['felt piano and chamber strings', 'great production quality'],
  avoid: ['lyrics'],
  target: { measure: 'loudness', dbfs: -19 },
  sections: [
    section('test-open', 'Opening', 2, false),
    section('test-round', 'Night Shift', 2, true),
    section('test-turn', 'Pressure', 2, true),
    section('test-close', 'Dawn', 2, false, {
      key: 'C major',
      motif: 'whole',
      lines: ['{a long held final chord}', '(aah)'],
    }),
  ],
};

/** Each of SMALL's sections at a loudness of its own: its tone's amplitude. */
const AMPS = [0.1, 0.2, 0.4, 0.05];

/**
 * A take of `suite` as Eleven Music might answer it, as a WAV at 8 kHz: each section a 441 Hz
 * tone at its amplitude, in both channels — `shortMs` short of the plan where told.
 */
function takeOf(suite: SuiteEntry, amps: readonly number[], shortMs = 0): Uint8Array<ArrayBuffer> {
  const rate = 8000;
  const spans = spansOf(suite);
  const total = Math.round((((spans.at(-1)?.toMs ?? 0) - shortMs) / 1000) * rate);
  const wave = Float32Array.from({ length: total }, (_, i) => {
    const ms = (i / rate) * 1000;
    const at = spans.findIndex((span) => ms >= span.fromMs && ms < span.toMs);
    return (amps[at] ?? 0) * Math.sin((2 * Math.PI * 441 * i) / rate);
  });
  return wavBytes({ rate, channels: [wave, Float32Array.from(wave)] });
}

/** A sound of the catalog beside the suite: an effect. */
const CLACK: CatalogEntry = {
  id: 'test-clack',
  kind: 'oneshot',
  prompt: 'A steel latch snapping shut on a cabinet door, close-up and dry.',
  durationSeconds: 0.6,
  loop: false,
  target: { measure: 'peak', dbfs: -3 },
  usedBy: ['src/world/audio.ts#leverChunk'],
};

/** The score's shape at 90 bpm, as long as the game's: 184 bars, some 491 s. */
const LONG: SuiteEntry = {
  ...SMALL,
  id: 'test-long',
  bpm: 90,
  sections: [
    section('long-menu', 'Main Theme', 32, true),
    section('long-lobby', 'Interlude', 20, true),
    section('long-title', 'Opening', 15, false),
    section('long-calm', 'Night Shift', 24, true),
    section('long-tense', 'Pressure', 24, true),
    section('long-critical', 'Last Minute', 24, true),
    section('long-lost', 'Lights Out', 15, false),
    section('long-won', 'Dawn', 15, false),
  ],
};

describe('a suite’s plan', () => {
  it('lies in whole bars, a loop with its tail, each section after the one before', () => {
    expect(barMs(120)).toBe(2000);
    expect(spansOf(SMALL).map(({ section: c, fromMs, toMs }) => [c.id, fromMs, toMs])).toEqual([
      ['test-open', 0, 4000],
      ['test-round', 4000, 14_000],
      ['test-turn', 14_000, 24_000],
      ['test-close', 24_000, 28_000],
    ]);
    // At 90 bpm a bar is 2⅔ s: each section starts on a bar line, rounded to the millisecond.
    const bar = barMs(90);
    let bars = 0;
    for (const span of spansOf(LONG)) {
      expect(Math.abs(span.fromMs - bars * bar)).toBeLessThanOrEqual(0.5);
      bars += Math.round((span.toMs - span.fromMs) / bar);
    }
    expect(bars).toBe(169 + 5 * tailBars(90)); // 184 bars
    expect(spansOf(LONG).at(-1)?.toMs).toBe(Math.round(bars * bar));
    // One after the other, no millisecond between: the chunks' lengths add up to where each lies.
    const spans = spansOf(LONG);
    expect(spans[0]?.fromMs).toBe(0);
    spans.slice(1).forEach((span, i) => expect(span.fromMs).toBe(spans[i]?.toMs));
  });

  it('gives a loop a tail for the game’s lead bar, its seam and a spare second', () => {
    expect(tailBars(90)).toBe(3);
    for (const bpm of [60, 72, 80, 90, 100, 120, 140]) {
      const past = (tailBars(bpm) - LEAD_BARS) * barMs(bpm);
      expect(past, `${bpm} bpm`).toBeGreaterThanOrEqual((SEAM_S + SPARE_S) * 1000);
      expect(past - barMs(bpm), `${bpm} bpm`).toBeLessThan((SEAM_S + SPARE_S) * 1000);
    }
    // As the game crosses its passes (music.ts): the same bar, seam and lead bar.
    expect([BEATS_PER_BAR, SEAM_S, LEAD_BARS]).toEqual([
      music.BEATS_PER_BAR,
      music.SEAM_S,
      music.SEAM_LEAD_BARS,
    ]);
  });

});

describe('a suite’s request', () => {
  it('is one request of chunks: each section’s name, lines, length, own styles first', () => {
    const { cell, fall, answer } = SMALL.motif;
    const [tempo, styles] = [['120 BPM', '4/4 time'], SMALL.styles];
    const request = suiteRequest(SMALL);
    expect(Object.keys(request)).toEqual(['compositionPlan', 'modelId', 'outputFormat']);
    expect([request.modelId, request.outputFormat]).toEqual(['music_v2_5', 'mp3_44100_192']);
    const chunks = (request.compositionPlan as { chunks: unknown[] }).chunks;
    expect(chunks[0]).toEqual({
      text: '[Opening]',
      durationMs: 4000,
      positiveStyles: ['opening section', 'steady', 'A minor', ...tempo, cell, fall, ...styles],
      negativeStyles: ['lyrics'],
    });
    expect(chunks[1]).toMatchObject({
      durationMs: 10_000,
      positiveStyles: ['night shift section', 'steady', 'A minor', ...tempo, cell, ...styles],
      negativeStyles: ['lyrics', 'ending'],
    });
    // A section's own key stands where the suite's would; the whole motif where it plays it.
    expect(chunks[3]).toEqual({
      text: '[Dawn]\n{a long held final chord}\n(aah)',
      durationMs: 4000,
      positiveStyles: ['dawn section', 'steady', 'C major', ...tempo, cell, fall, answer]
        .concat(styles),
      negativeStyles: ['lyrics'],
    });
  });

  it('is hashed by all that makes it — its pieces by their suite’s — and nothing else', () => {
    const hash = hashOf(SMALL);
    const [first, ...rest] = SMALL.sections;
    if (first === undefined) throw new Error('no section');
    const changed = [
      { ...SMALL, bpm: 121 },
      { ...SMALL, key: 'D minor' },
      { ...SMALL, motif: { ...SMALL.motif, cell: 'a falling fifth' } },
      { ...SMALL, sections: [{ ...first, bars: 3 }, ...rest] },
      { ...SMALL, sections: [{ ...first, motif: 'whole' as const }, ...rest] },
      { ...SMALL, sections: [{ ...first, loop: true }, ...rest] },
      { ...SMALL, sections: [{ ...first, lines: ['{solo piano}'] }, ...rest] },
    ];
    expect(new Set([hash, ...changed.map((suite) => hashOf(suite))]).size).toBe(8);
    const renamed = { ...first, id: 'test-other', usedBy: ['src/world/menuSound.ts#THEME'] };
    expect(hashOf({ ...SMALL, id: 'test-again', sections: [renamed, ...rest] })).toBe(hash);
    expect(recordingsOf([SMALL]).map((piece) => hashOf(piece))).toEqual([hash, hash, hash, hash]);
  });

  it('makes a piece of each section: a loop a stem at the suite’s tempo, the rest themes', () => {
    const pieces = recordingsOf([SMALL, CLACK]);
    expect(pieces.map((piece) => [piece.id, piece.kind, piece.durationSeconds, piece.bpm])).toEqual(
      [
        ['test-open', 'theme', 4, undefined],
        ['test-round', 'stem', 10, 120],
        ['test-turn', 'stem', 10, 120],
        ['test-close', 'theme', 4, undefined],
        ['test-clack', 'oneshot', 0.6, undefined],
      ],
    );
    expect(pieces[1]).toMatchObject({
      loop: true,
      target: SMALL.target,
      usedBy: ['src/world/music.ts#STEMS'],
      of: { suite: SMALL, bars: 2, fromMs: 4000 },
    });
  });
});

describe('a suite in the catalog', () => {
  const flaws = (over: Partial<SuiteEntry>): string[] => suiteFlawsOf({ ...SMALL, ...over });
  const withSection = (over: Partial<SuiteSection>): string[] =>
    flaws({ sections: [{ ...section('test-a', 'A', 2, false), ...over }] });

  it('keeps every rule as written, and its pieces’ ids come once in all the catalog', () => {
    expect(suiteFlawsOf(SMALL)).toEqual([]);
    expect(() => checkCatalog([SMALL, CLACK])).not.toThrow();
    expect(() => checkCatalog([SMALL, { ...CLACK, id: 'test-turn' }])).toThrow(
      /test-turn: its id comes twice/,
    );
    const stem: CatalogEntry = {
      ...CLACK,
      id: 'test-calm',
      kind: 'stem',
      prompt: 'Instrumental underscore for a dark lab at night, A minor, 90 BPM, made to loop.',
      durationSeconds: 72,
      loop: true,
      bpm: 90,
      target: { measure: 'rms', dbfs: -20 },
    };
    // A stem is a section of a suite, never a sound of its own; its tempo is its suite's.
    expect(() => checkCatalog([stem, SMALL])).toThrow(
      'sfx: audio/catalog.json —\n' +
        '  test-calm: its kind "stem" is not oneshot, bed, sting: a stem or a theme is a section ' +
        "of a suite\n  test-calm: a sound of its own has no bpm: a tempo is its suite's",
    );
  });

  it('tells each section of the motif as far as it plays it: its cell, a phrase, the whole', () => {
    const { cell, fall, answer } = SMALL.motif;
    const [open, round, , close] = SMALL.sections;
    if (open === undefined || round === undefined || close === undefined) throw new Error('short');
    expect(motifOf(SMALL, round)).toEqual([cell]);
    expect(motifOf(SMALL, open)).toEqual([cell, fall]);
    expect(motifOf(SMALL, close)).toEqual([cell, fall, answer]);
  });

  it('holds no lyric: a line is a direction in braces or a wordless voice in parentheses', () => {
    expect(withSection({ lines: ['{solo cello answers}', '(ooh, aah)'] })).toEqual([]);
    for (const lyric of ['I walk the halls alone', '(Hello)', '{open', '']) {
      expect(withSection({ lines: [lyric] }), lyric).toEqual([
        expect.stringMatching(/^test-a: a line is neither a direction in braces nor a wordless/),
      ]);
    }
    // Thirty lines at most, its name in brackets among them.
    expect(withSection({ lines: Array.from({ length: 29 }, () => '(aah)') })).toEqual([]);
    expect(withSection({ lines: Array.from({ length: 30 }, () => '(aah)') })).toHaveLength(1);
  });

  it('asks nothing Eleven Music refuses: chunks of 3 to 120 s, 600 s in all, 50 styles', () => {
    expect(withSection({ bars: 61 })).toEqual(['[A] lasts 122000 ms, outside 3000–120000']);
    expect(withSection({ bars: 1 })).toEqual([
      '[A] lasts 2000 ms, outside 3000–120000',
      'it lasts 2 s, outside 3–600 s',
    ]);
    const many = Array.from({ length: 46 }, (_, i) => `style ${i}`);
    expect(withSection({ styles: many })).toEqual(['[A] has more than 50 styles']);
    const long = Array.from({ length: 6 }, (_, i) => section(`test-${i}`, `S${i}`, 55, false));
    expect(flaws({ sections: long })).toEqual(['it lasts 660 s, outside 3–600 s']);
    expect(flaws({ sections: [] })).toEqual(['it has to have 1 to 30 sections']);
  });

  it('names a whole of the wrong shape before its sections', () => {
    expect(flaws({ target: { measure: 'rms', dbfs: -20 } })).toEqual([
      'its target has to be {"measure":"loudness","dbfs":-19}',
    ]);
    expect(flaws({ styles: ['x'.repeat(121)], bpm: 300 })).toEqual([
      'its tempo, 300 bpm, lies outside 40–200',
      'its styles and avoid are not lists of phrases of 120 chars at most',
    ]);
    const unanswered = { cell: SMALL.motif.cell, fall: SMALL.motif.fall } as SuiteEntry['motif'];
    expect(flaws({ motif: unanswered })).toEqual([
      'its motif is no cell, fall and answer, each a phrase of 120 chars at most',
    ]);
    expect(withSection({ motif: 'all' as never })).toEqual([
      'test-a: its motif has to be cell, phrase, whole: how much of it it plays',
    ]);
    expect(withSection({ bars: 2.5, name: '[A]' })).toEqual([
      'test-a: its name is no phrase of 100 chars without brackets',
      'test-a: its bars are no whole number',
    ]);
  });
});

describe('a suite’s cost', () => {
  it('runs by its whole plan’s seconds, and as many takes a run as the cap holds', () => {
    expect(costOf(SMALL)).toBe(504); // 28 s at 18 credits a second
    expect(costOf(SMALL, 3)).toBe(1512);
    expect(takesPerRun(SMALL)).toBe(3);
    expect(costOf(LONG)).toBe(8833); // 490.667 s
    expect(takesPerRun(LONG)).toBe(2);
  });

  it('stops a run over the cap before it asks, naming the runs within it', async () => {
    const huge: SuiteEntry = {
      ...LONG,
      id: 'test-huge',
      sections: Array.from({ length: 5 }, (_, i) => section(`huge-${i}`, `H${i}`, 45, false)),
    };
    const { client, pieces } = answering({ music: [takeOf(SMALL, AMPS)] });
    const places = placesIn();
    const bench = benchOf(client, places);
    const three = optionsOf(['--candidates', '3', '--only', 'test-huge']);
    const jobs = planOf([huge], { sfx: {}, music: {} }, () => false, three);
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const refusal =
      "sfx: the music would cost about 32400 credits, over 18000 — make a suite's takes in " +
      'runs within it: --candidates 1 --only test-huge, and again for more, numbered on';
    const run = renderWith(jobs, { sfx: {}, music: {} }, { count: 3, candidates: '' }, bench);
    await expect(run).rejects.toThrow(refusal);
    // A dry run refuses it as well, before any account is opened.
    const { studio, opened } = studioOf(client, places);
    const dry = optionsOf(['--dry-run', '--candidates', '3', '--only', 'test-huge']);
    await expect(runWith(dry, [huge], studio)).rejects.toThrow(refusal);
    quiet.mockRestore();
    expect([pieces, opened()]).toEqual([[], 0]);
  });

  it('prices the rest after the first take and stops over the cap, that take kept', async () => {
    const places = placesIn();
    // A take the dry run prices at 504 credits costs the account 10 000: two would pass the cap.
    const { client, pieces } = answering({ music: [takeOf(SMALL, AMPS)], spend: 10_000 });
    const { studio } = studioOf(client, places);
    const said: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void said.push(line));
    const run = runWith(optionsOf(['--candidates', '2', '--only', 'test-score']), [SMALL], studio);
    await expect(run).rejects.toThrow('sfx: that is over the 18000 the music may spend');
    log.mockRestore();
    expect(said).toContain(
      'sfx: the first take of test-score cost 10000 credits (357.1 a second, 504 expected); ' +
        'the music come to about 20000',
    );
    expect(pieces).toHaveLength(1);
    expect(readTakes(places.takes, SMALL.id)?.takes.map((take) => take.n)).toEqual([1]);
  });

  it('is said in the plan with each of its pieces, a loop’s bars that go round', () => {
    const named = optionsOf(['--only', 'test-score']);
    const jobs = planOf([SMALL], { sfx: {}, music: {} }, () => false, named);
    expect(planLines(jobs, 2)).toEqual([
      'sfx: music — 1 of 1 to make, 2 takes each, into takes/ for the ear, 28.0 s a take, ' +
        'about 1008 credits (cap 18000)',
      '  test-score  28.0 s  suite, A minor, 120 bpm, 4 pieces',
      '    test-open  4.0 s  2 bars, once',
      '    test-round  10.0 s  5 bars, 2 of them round and round',
      '    test-turn  10.0 s  5 bars, 2 of them round and round',
      '    test-close  4.0 s  2 bars, once',
    ]);
    expect(planLines(jobs, 1)[0]).toBe(
      'sfx: music — 1 of 1 to make, 1 take each, into takes/ for the ear, 28.0 s, ' +
        'about 504 credits (cap 18000)',
    );
  });
});

/** The music's entries of `places` and the files of its folder. */
const musicIn = (places: ReturnType<typeof placesIn>): { manifest: Manifest; files: string[] } => ({
  manifest: readManifest(places, 'music'),
  files: existsSync(places.dirs.music) ? readdirSync(places.dirs.music).sort() : [],
});

/** One take of SMALL in `places`, each section at `amps`, its sound `shortMs` short of the plan. */
async function suiteTakeIn(places: ReturnType<typeof placesIn>, amps = AMPS, shortMs = 0) {
  const { client } = answering({ music: [takeOf(SMALL, amps, shortMs)] });
  const bench = benchOf(client, places);
  await runOf([SMALL], 1, bench, ['--only', SMALL.id]);
  return bench;
}

/** The first take of SMALL listed in `places`; fails where there is none. */
function firstTake(places: ReturnType<typeof placesIn>): TakeRecord {
  const [take] = readTakes(places.takes, SMALL.id)?.takes ?? [];
  if (take === undefined) throw new Error('no take of the suite listed');
  return take;
}

describe('a suite’s takes', () => {
  it('go into takes/ even made once, said where they lie, nothing public', async () => {
    const places = placesIn();
    const { client, pieces, asked } = answering({ music: [takeOf(SMALL, AMPS)] });
    const said = await sayOver(['--only', 'test-score'], studioOf(client, places).studio);
    const waiting = `sfx: none of this music is kept yet; its takes wait in ${places.takes}:`;
    expect(said).toContain(waiting);
    expect(said).toContain('  node scripts/sfx.ts --keep test-score=<n>');
    expect(pieces).toEqual([suiteRequest(SMALL)]);
    // The plan is waited for as long as the service takes to compose it, not the SDK's 240 s.
    expect(asked).toEqual([{ timeoutInSeconds: 900 }]);
    expect(readdirSync(join(places.takes, SMALL.id)).sort()).toEqual(['1.mp3', 'index.json']);
    expect(existsSync(places.dirs.music)).toBe(false);
    expect(firstTake(places)).toMatchObject({
      n: 1,
      hash: hashOf(SMALL),
      settings: { modelId: 'music_v2_5', outputFormat: 'mp3_44100_192', planMs: 28_000 },
      ms: 28_000,
      misses: [],
    });
  });

  it('list each piece where the plan cuts it, measured, brought to −19 LUFS', async () => {
    const places = placesIn();
    await suiteTakeIn(places);
    const cut = firstTake(places).pieces ?? [];
    expect(cut.map((p) => [p.id, p.fromMs, p.ms, p.loop, p.startMs, p.misses])).toEqual([
      ['test-open', 0, 4000, false, 0, []],
      ['test-round', 4000, 10_000, true, 0, []],
      ['test-turn', 14_000, 10_000, true, 0, []],
      ['test-close', 24_000, 4000, false, 0, []],
    ]);
    for (const p of cut) expect(Number(p.loudness) + 20 * Math.log10(p.gain)).toBeCloseTo(-19, 2);
    // Twice the amplitude, half the gain.
    const [, round, turn] = cut.map((p) => [p.gain, p.peak] as const);
    expect(Number(round?.[0]) / Number(turn?.[0])).toBeCloseTo(2, 2);
    expect(turn?.[1]).toBeCloseTo(0.4, 2);
  });

  it('miss their length where a take runs off its plan, its last piece cut short', async () => {
    const places = placesIn();
    await suiteTakeIn(places, AMPS, 2000);
    const take = firstTake(places);
    expect(take.misses).toEqual(['length']);
    expect(take.pieces?.at(-1)).toMatchObject({ id: 'test-close', ms: 2000, misses: ['length'] });
  });

  it('are made of the whole suite only: --only refuses a section, naming its suite', () => {
    const only = optionsOf(['--only', 'test-turn,test-clack']);
    expect(() => planOf([SMALL, CLACK], { sfx: {}, music: {} }, () => true, only)).toThrow(
      'sfx: --only test-turn — a section of a suite is made with the whole of it: ' +
        '--only test-score',
    );
  });

  it('wait for the ear: a run not naming the suite leaves it, --only makes more', async () => {
    const places = placesIn();
    const { client, pieces } = answering({ music: [takeOf(SMALL, AMPS)] });
    const { studio } = studioOf(client, places);
    await sayOver(['--candidates', '2', '--only', 'test-score'], studio);
    for (const args of [[], ['music']]) {
      const said = await sayOver(args, studio);
      expect(said, args.join(' ')).toContain(
        'sfx: test-score is left as it is, its takes waiting: --keep test-score=<n> keeps ' +
          'one, --candidates 3 --only test-score makes new ones',
      );
    }
    expect(pieces).toHaveLength(2);
    await sayOver(['--only', 'test-score'], studio);
    expect(readTakes(places.takes, SMALL.id)?.takes.map((take) => take.n)).toEqual([1, 2, 3]);
  });

  it('are made only where --only names the suite: a run of all leaves it, said', async () => {
    const places = placesIn();
    const { client, pieces } = answering({ music: [takeOf(SMALL, AMPS)] });
    const { studio, opened } = studioOf(client, places);
    for (const args of [[], ['music'], ['--candidates', '2']]) {
      expect(await sayOver(args, studio), args.join(' ')).toContain(
        'sfx: test-score is made only where --only names it, never by a run of everything: ' +
          '--candidates 3 --only test-score makes its takes',
      );
    }
    expect([pieces.length, opened(), existsSync(places.takes)]).toEqual([0, 0, false]);
  });

  it('are made again by the suite’s own command, where a piece of it fails', () => {
    expect(remakeCommands([CLACK, SMALL], ['test-turn', 'test-clack', 'test-round'])).toEqual([
      'pnpm --filter client sfx -- --candidates 5 --only test-clack',
      'pnpm --filter client sfx -- --candidates 3 --only test-score',
    ]);
    expect(remakeCommands([LONG], ['long-menu'])).toEqual([
      'pnpm --filter client sfx -- --candidates 2 --only test-long',
    ]);
  });
});

/**
 * Runs the script with `args` over SMALL in `studio`, quietly; returns what it said, and fails
 * where it said anything on the error stream or set the exit code.
 */
async function sayOver(
  args: readonly string[],
  studio: Studio,
  catalog: readonly CatalogItem[] = [SMALL],
): Promise<string[]> {
  const said: string[] = [];
  const exit = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void said.push(line));
  const error = vi.spyOn(console, 'error');
  try {
    await runWith(optionsOf(args), catalog, studio);
    expect([error.mock.calls, process.exitCode]).toEqual([[], exit]);
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = exit;
  }
  return said;
}

/** The PCM of the file `name` in the music's folder of `places`. */
const pcmOf = (places: ReturnType<typeof placesIn>, name: string): Pcm =>
  parseWav(readFileSync(join(places.dirs.music, name)));

/** A recording that `file` held before, from a request of long ago. */
const old = (file: string): ManifestEntry => ({
  file,
  ms: 1000,
  gain: 1,
  startMs: 0,
  floor: 0,
  rms: 0.1,
  loop: false,
  hash: '000000000000',
  source: 'elevenlabs',
});

describe('keeping a suite’s take', () => {
  it('cuts it into its pieces where the plan puts them, each encoded and measured', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    const { group, kept } = keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench);
    expect(group).toBe('music');
    const { manifest, files } = musicIn(places);
    expect(files).toEqual([
      'manifest.json',
      'test-close.m4a',
      'test-open.m4a',
      'test-round.m4a',
      'test-turn.m4a',
    ]);
    expect(manifest).toEqual(kept);
    expect(existsSync(join(places.takes, SMALL.id))).toBe(false);
    const round = kept['test-round'] as ManifestEntry;
    expect(round).toEqual({
      file: 'test-round.m4a',
      ms: 10_000,
      gain: expect.any(Number),
      startMs: 0,
      floor: expect.any(Number),
      rms: expect.closeTo(0.2 / Math.SQRT2, 2),
      loudness: expect.any(Number),
      loop: true,
      hash: hashOf(SMALL),
      bpm: 120,
      bars: 2,
      suite: SMALL.id,
      source: 'elevenlabs',
    });
    expect(kept['test-open']).toMatchObject({ loop: false, startMs: 0, suite: SMALL.id });
    expect(kept['test-open']?.bpm).toBeUndefined();
    // Each piece is its own section's sound: the tone at that section's amplitude.
    expect(loudnessOf(pcmOf(places, 'test-turn.m4a')).peak).toBeCloseTo(0.4, 2);
    expect(loudnessOf(pcmOf(places, 'test-close.m4a')).peak).toBeCloseTo(0.05, 2);
  });

  it('fades each piece in and out over 10 ms where cut, and brings all to −19 LUFS', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    const { kept } = keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench);
    const [left = new Float32Array(0)] = pcmOf(places, 'test-round.m4a').channels;
    // Its first and last millisecond under 0.01, where its tone, cut bare, would reach 0.2.
    const loudest = (span: Float32Array): number => Math.max(...[...span].map(Math.abs));
    expect(loudest(left.subarray(0, 8))).toBeLessThan(0.01);
    expect(loudest(left.subarray(-8))).toBeLessThan(0.01);
    expect(loudest(left.subarray(4000, 4100))).toBeCloseTo(0.2, 2);
    for (const entry of Object.values(kept)) {
      expect((entry.loudness ?? NaN) + 20 * Math.log10(entry.gain), entry.file).toBeCloseTo(-19, 2);
    }
  });

  it('keeps the loops’ bars: alike in length, each from a bar line of the suite', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    const [take] = readTakes(places.takes, SMALL.id)?.takes ?? [];
    const { kept } = keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench);
    const loops = Object.values(kept).filter((entry) => entry.loop);
    expect(loops.map((entry) => [entry.ms, entry.bars, entry.bpm])).toEqual([
      [10_000, 2, 120],
      [10_000, 2, 120],
    ]);
    for (const piece of take?.pieces ?? []) expect(piece.fromMs % barMs(SMALL.bpm)).toBe(0);
  });

  it('deletes the files its pieces played before, and nobody else’s', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    mkdirSync(places.dirs.music, { recursive: true });
    const before = {
      'test-round': old('test-round.mp3'),
      'test-turn': old('shared.mp3'),
      'test-sting': old('shared.mp3'),
    };
    for (const file of ['test-round.mp3', 'shared.mp3']) {
      writeFileSync(join(places.dirs.music, file), 'old');
    }
    writeFileSync(join(places.dirs.music, 'manifest.json'), JSON.stringify(before));
    keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench);
    const { manifest, files } = musicIn(places);
    expect(files).not.toContain('test-round.mp3');
    expect(files).toContain('shared.mp3'); // the sting plays it still
    expect(manifest['test-sting']).toEqual(before['test-sting']);
    expect(manifest['test-turn']?.file).toBe('test-turn.m4a');
  });

});

describe('a suite’s take kept, refused or measured anew', () => {
  it('refuses a piece alone, a take off its plan and a silent piece, moving nothing', async () => {
    const refusal = (bench: ReturnType<typeof benchOf>, id: string): string => {
      try {
        keepTake({ id, n: 1 }, [SMALL], bench);
      } catch (error) {
        return (error as Error).message;
      }
      return 'kept';
    };
    const short = placesIn();
    const off = await suiteTakeIn(short, AMPS, 2000);
    expect(refusal(off, 'test-round')).toBe(
      'sfx: --keep test-round=1 — test-round is a piece of test-score, kept whole: ' +
        '--keep test-score=<n>',
    );
    expect(refusal(off, SMALL.id)).toBe(
      "sfx: --keep test-score=1 — it lasts 26.0 s, not the plan's 28.0 s: its pieces would " +
        'not lie where the plan puts them',
    );
    expect(existsSync(short.dirs.music)).toBe(false);
    const quiet = placesIn();
    const silent = await suiteTakeIn(quiet, [0.1, 0.2, 0, 0.05]);
    expect(refusal(silent, SMALL.id)).toBe(
      'sfx: --keep test-score=1 — test-turn came back silent: keep another take',
    );
    expect(musicIn(quiet)).toEqual({ manifest: {}, files: [] });
    expect(readTakes(quiet.takes, SMALL.id)?.takes).toHaveLength(1);
  });

  it('writes its manifest before it deletes what its pieces played before', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    // An old file the keep cannot delete: a folder where test-round.mp3 stood.
    mkdirSync(join(places.dirs.music, 'test-round.mp3'), { recursive: true });
    const before = { 'test-round': old('test-round.mp3') };
    writeFileSync(join(places.dirs.music, 'manifest.json'), JSON.stringify(before));
    expect(() => keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench)).toThrow(/EISDIR/);
    expect(readManifest(places, 'music')['test-round']?.file).toBe('test-round.m4a');
  });

  it('is measured anew by a run that makes nothing, its entries as kept', async () => {
    const places = placesIn();
    const bench = await suiteTakeIn(places);
    const { kept } = keepTake({ id: SMALL.id, n: 1 }, [SMALL], bench);
    const { client, pieces } = answering({});
    const { studio, opened } = studioOf(client, places);
    const said = await sayOver(['music'], studio);
    // Its pieces are counted in the folder, as .m4a beside the MP3s.
    const counted = /^sfx: public\/music holds 4 files, \d+ kB$/;
    expect(said.filter((line) => counted.test(line))).toHaveLength(1);
    expect([pieces.length, opened()]).toEqual([0, 0]);
    expect(readManifest(places, 'music')).toEqual(kept);
  });

  it('names a piece whose floor is heard, and none made from an older plan', () => {
    const entry = (hash: string, floorDbfs: number): ManifestEntry => ({
      file: 'test-open.m4a',
      ms: 4000,
      gain: 10,
      startMs: 0,
      floor: 10 ** (floorDbfs / 20),
      rms: 0.01,
      loudness: -40,
      loop: false,
      hash,
      suite: SMALL.id,
      source: 'elevenlabs',
    });
    const heard = { sfx: {}, music: { 'test-open': entry(hashOf(SMALL), -65) } };
    expect(noisyTakes([SMALL], heard)).toEqual([
      { id: 'test-open', gain: 10, heardDbfs: -45 },
    ]);
    const older = { sfx: {}, music: { 'test-open': entry('000000000000', -65) } };
    expect(noisyTakes([SMALL], older)).toEqual([]);
  });
});

/** The score as the catalog writes it: the suite the game's music is cut from. */
const SCORE = readCatalog().find(isSuite);

describe('the score in the catalog', () => {
  if (SCORE === undefined) throw new Error('audio/catalog.json holds no suite');
  const sections = new Map(SCORE.sections.map((each) => [each.id, each]));
  const said = (id: string): string => JSON.stringify(sections.get(id) ?? {}).toLowerCase();

  it('is one suite in A minor at 90 bpm, its pieces in the order a crew hears them', () => {
    expect(() => checkCatalog(readCatalog())).not.toThrow();
    expect([SCORE.id, SCORE.key, SCORE.bpm, SCORE.target]).toEqual([
      'score',
      'A minor',
      90,
      { measure: 'loudness', dbfs: -19 },
    ]);
    expect([...sections.keys()]).toEqual([
      'menu-theme',
      'lobby',
      'title',
      'calm',
      'tense',
      'critical',
      'end-lost',
      'end-won',
    ]);
  });

  it('lasts some 491 s: loops of 32, 20 and three times 24 bars, the rest 40 s each', () => {
    const pieces = piecesOf(SCORE);
    const ms = pieces.map((piece) => Math.round(piece.durationSeconds * 1000));
    // Each on a bar line rounded to the millisecond: the lobby's 23 bars take 61 334 ms.
    expect(ms).toEqual([93_333, 61_334, 40_000, 72_000, 72_000, 72_000, 40_000, 40_000]);
    const loops = pieces.filter((piece) => piece.loop).map((piece) => [piece.id, piece.of.bars]);
    expect(loops).toEqual([
      ['menu-theme', 32],
      ['lobby', 20],
      ['calm', 24],
      ['tense', 24],
      ['critical', 24],
    ]);
    expect(suiteMs(SCORE)).toBe(490_667);
    expect([costOf(SCORE), costOf(SCORE, 3), takesPerRun(SCORE)]).toEqual([8833, 26_497, 2]);
  });

  it('holds the run’s three stems alike: as long, as many bars, each from a bar line', () => {
    const bar = barMs(SCORE.bpm);
    const run = (piece: { readonly usedBy: readonly string[] }): boolean =>
      piece.usedBy.includes('src/world/music.ts#STEMS');
    const stems = piecesOf(SCORE).filter(run);
    expect(stems.map((piece) => [piece.id, piece.durationSeconds, piece.of.bars])).toEqual([
      ['calm', 72, 24],
      ['tense', 72, 24],
      ['critical', 72, 24],
    ]);
    for (const piece of stems) {
      const bars = piece.of.fromMs / bar;
      expect(Math.abs(piece.of.fromMs - Math.round(bars) * bar), piece.id).toBeLessThan(0.5);
    }
  });

  it('gives every section the tempo and its key — the dawn’s own C major', () => {
    for (const [i, chunk] of chunksOf(SCORE).entries()) {
      const key = SCORE.sections[i]?.id === 'end-won' ? 'C major' : 'A minor';
      expect(chunk.positiveStyles, chunk.text).toEqual(
        expect.arrayContaining([key, '90 BPM', '4/4 time']),
      );
      expect(chunk.positiveStyles.length, chunk.text).toBeLessThanOrEqual(50);
    }
  });

  it('sings no word: a wordless voice in the main theme and at dawn alone, none in the run', () => {
    const voiced = SCORE.sections.filter((each) => each.lines.some((line) => line.startsWith('(')));
    expect(voiced.map((each) => each.id)).toEqual(['menu-theme', 'end-won']);
    for (const id of ['menu-theme', 'end-won']) expect(said(id)).toMatch(/wordless female voice/);
    for (const id of ['lobby', 'title', 'calm', 'tense', 'critical', 'end-lost']) {
      expect(sections.get(id)?.avoid, id).toContain('voice');
    }
    expect(SCORE.avoid).toEqual(expect.arrayContaining(['lyrics', 'spoken words']));
  });

  it('keeps drums out of the menu, the lobby, the opening and the endings', () => {
    for (const id of ['menu-theme', 'lobby', 'title', 'calm', 'end-lost', 'end-won']) {
      expect(sections.get(id)?.avoid, id).toEqual(expect.arrayContaining(['drums', 'percussion']));
      expect(JSON.stringify(sections.get(id)?.styles), id).not.toMatch(/drum|percussion/);
    }
    expect(said('tense')).toMatch(/ticking percussion/);
    expect(said('critical')).toMatch(/pounding low cinematic drums/);
  });

  it('names no composer, no game and no piece it could copy', () => {
    const all = JSON.stringify(SCORE).toLowerCase();
    expect(all).not.toMatch(/expedition|clair|obscur|testard|lorien|lumi[eè]re|in the style of/);
  });
});

describe('the score’s tempo and motif', () => {
  if (SCORE === undefined) throw new Error('audio/catalog.json holds no suite');
  const otherTempo =
    /\b(?:slow(?:ly|er|ing)?|fast(?:er)?|quick(?:er|ly)?|accelerando|ritardando|rallentando)\b/i;

  it('is asked of every section, none asking for a slower or a faster one', () => {
    for (const chunk of chunksOf(SCORE)) {
      const asked = [chunk.text, ...chunk.positiveStyles].join(' | ');
      expect(asked, chunk.text.split('\n')[0]).not.toMatch(otherTempo);
      expect(chunk.positiveStyles, chunk.text.split('\n')[0]).toContain('90 BPM');
    }
    // Quiet is sparse and held long, the last minute's drive a feel: the tempo stays.
    const said = JSON.stringify(SCORE.sections);
    expect(said).toMatch(/opening[^]*long held notes at the same tempo/i);
    expect(said).toMatch(/double-time feel at the same tempo/);
    expect(SCORE.avoid).toContain('tempo changes');
  });

  it('tells each section of the motif as far as it plays it, no further', () => {
    const { cell, fall, answer } = SCORE.motif;
    const told = chunksOf(SCORE).map((chunk, i) => [
      SCORE.sections[i]?.id,
      [cell, fall, answer].map((part) => chunk.positiveStyles.includes(part)),
    ]);
    expect(told).toEqual([
      ['menu-theme', [true, true, true]],
      ['lobby', [true, true, true]],
      ['title', [true, true, false]], // its first phrase alone
      ['calm', [true, false, false]], // the leap alone, never the whole melody
      ['tense', [true, false, false]],
      ['critical', [true, false, false]],
      ['end-lost', [true, true, false]],
      ['end-won', [true, true, true]],
    ]);
    expect(JSON.stringify(SCORE)).not.toMatch(/returns in every section/);
  });

  it('writes the motif from the fifth, with its rhythm and its cadences', () => {
    const { cell, fall, answer } = SCORE.motif;
    // From the fifth, not the tonic: begun on the tonic, a sixth up and a sigh down is Tristan's.
    expect(cell).toMatch(/from the fifth, a leap up a sixth held three beats, then a sigh down/);
    expect(fall).toMatch(/in half notes to rest on the fifth, held a whole bar: a half cadence/);
    expect(answer).toMatch(/from the sixth, a leap up to the fourth .* full close on the tonic/);
  });
});
