import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lufsOf, parseWav, wavBytes, type Pcm } from '../scripts/pcm.js';
import {
  allowedUrl,
  attributionOf,
  buildPack,
  optionsOf,
  PACK_CAP,
  packFlaws,
  packsAsked,
  runWith,
  sourceFile,
  LEAD_KEPT_MS,
  TAIL_MS,
  type Bench,
  type Made,
  type Places,
  type Plan,
  type PlanPack,
  type PlanPiece,
} from '../scripts/packs.js';
import { SLOTS, type FoundPiece, type PackFile, type Slot } from '../src/world/packFile.js';
import { wavOf } from './sfxFakes.js';

/**
 * The pack script (scripts/packs.ts) run against a host of the test's own: every file a WAV of
 * known loudness at 4 kHz, decoded as it is, a piece "encoded" as a WAV; folders of its own.
 * Nothing leaves the machine.
 */

const RATE = 4000;
/** How long a test that builds whole packs may take: a loaded machine takes its time. */
const BUILDS = { timeout: 30_000 };

/** `seconds` of a 441 Hz tone at `amplitude`, after `quietMs` of silence, at RATE. */
function tone(seconds: number, amplitude: number, quietMs = 0): number[] {
  const quiet = Math.round((RATE * quietMs) / 1000);
  return Array.from({ length: Math.round(RATE * seconds) }, (_, i) =>
    i < quiet ? 0 : amplitude * Math.sin((2 * Math.PI * 441 * i) / RATE),
  );
}

/** The file a test's host serves for the piece of `slot` in pack `id`. */
const urlOf = (id: string, slot: Slot): string =>
  `https://opengameart.org/sites/default/files/${id}%20${slot}.wav`;

/** A planned piece for `slot` of pack `id`: a loop 66 s round, or a piece of 35 s played once. */
function plannedPiece(id: string, slot: Slot): PlanPiece {
  const once = ['title', 'end-won', 'end-lost'].includes(slot);
  const credit = {
    source: { url: urlOf(id, slot) },
    page: `https://opengameart.org/content/${id}-${slot}`,
    title: `${slot} theme`,
    author: 'Ada Example',
    licence: 'CC BY 4.0' as const,
    notice: 'ada.example',
  };
  if (once) return { ...credit, trim: [5000, 40_000] };
  // In the file: 5 s in, a span of 80 s; looped from 7 s to 75 s over 2 s — 66 s round.
  return { ...credit, trim: [5000, 85_000], loop: { crossfade: [7000, 75_000, 2000] } };
}

/** A change to a planned piece: a field set, or taken away (undefined). */
type Change = { readonly [K in keyof PlanPiece]?: PlanPiece[K] | undefined };

/** A pack of the test's plan, a piece for every place, changed where `pieces` says. */
function plannedPack(id: string, pieces: Partial<Record<Slot, Change>> = {}): PlanPack {
  const all = Object.fromEntries(
    SLOTS.map((slot) => [slot, { ...plannedPiece(id, slot), ...pieces[slot] }]),
  ) as Record<Slot, PlanPiece>;
  return { id, title: 'Schicht X · Probe', composers: ['Ada Example'], pieces: all };
}

/** Folders of a run's own, in a temporary folder. */
function placesIn(): Places {
  const root = mkdtempSync(join(tmpdir(), 'escapelab-packs-test-'));
  return {
    plan: join(root, 'packs.plan.json'),
    packs: join(root, 'audio-packs'),
    music: join(root, 'music-packs'),
    takes: join(root, 'takes-packs'),
  };
}

/** What the test's host serves: each URL's samples, and an HTTP status where one fails. */
interface Host {
  readonly files: Map<string, number[]>;
  readonly failing: Map<string, number>;
  readonly asked: string[];
}

/** A host serving every piece of `packs` — a tone at 0.1 for as long as its span reaches. */
function hostFor(packs: readonly PlanPack[]): Host {
  const files = new Map<string, number[]>();
  for (const pack of packs) {
    for (const slot of SLOTS) {
      const piece = pack.pieces[slot];
      if ('url' in piece.source) files.set(piece.source.url, tone(piece.trim[1] / 1000 + 2, 0.1));
    }
  }
  return { files, failing: new Map(), asked: [] };
}

/** A run's bench in `places`, its files from `host`: decoded and "encoded" as WAVs. */
function benchOf(places: Places, host: Host): Bench {
  return {
    places,
    get: (url) => {
      host.asked.push(url);
      const status = host.failing.get(url) ?? (host.files.has(url) ? 200 : 404);
      const samples = host.files.get(url) ?? [];
      const body = status === 200 ? wavOf(RATE, [samples]) : null;
      return Promise.resolve(new Response(body, { status }));
    },
    decode: (path) => parseWav(readFileSync(path)),
    encode: (pcm, path) => writeFileSync(path, wavBytes(pcm)),
  };
}

const read = (path: string): PackFile => JSON.parse(readFileSync(path, 'utf8')) as PackFile;

let said: string[] = [];

beforeEach(() => {
  said = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => said.push(line));
  vi.spyOn(console, 'error').mockImplementation((line: string) => said.push(line));
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('the command line', () => {
  it('takes a dry run and the packs to build, and refuses anything else', () => {
    expect(optionsOf([])).toEqual({ dryRun: false, only: [] });
    expect(optionsOf(['--dry-run', '--only', 'macleod,zhelanov'])).toEqual({
      dryRun: true,
      only: ['macleod', 'zhelanov'],
    });
    expect(() => optionsOf(['--keep'])).toThrow('no such option --keep');
  });

  it('names a pack the plan does not have, and the ones it has', () => {
    const plan: Plan = { packs: [plannedPack('ada')] };
    expect(packsAsked(plan, [])).toHaveLength(1);
    expect(() => packsAsked(plan, ['bea'])).toThrow('the plan has no pack bea — it has ada');
  });
});

describe('the plan’s rules', () => {
  it('pass a pack of eight pieces from the hosts it may name, each with its credit', () => {
    expect(packFlaws(plannedPack('ada'))).toEqual([]);
  });

  it('name every rule a piece breaks, with its place', () => {
    const broken = plannedPack('ada', {
      lobby: { loop: { crossfade: [7000, 60_000, 2000] } },
      title: { loop: { crossfade: [6000, 30_000, 2000] } },
      calm: { licence: 'CC BY-NC 4.0' as never, loop: undefined },
      tense: { source: { url: 'https://cdn.pixabay.com/audio/x.mp3' } },
      critical: { loop: { crossfade: [5500, 70_000, 1000] } },
      'end-won': { trim: [0, 50_000] },
      'end-lost': { source: { manual: '../ada/x.wav', from: 'https://ada.example' } },
    });
    expect(packFlaws(broken)).toEqual([
      'ada/lobby: it goes round in 51000 ms, not 60–120 s',
      'ada/title: it loops, and it plays once',
      'ada/calm: its licence CC BY-NC 4.0 is none of CC0, CC BY 3.0, CC BY 4.0',
      'ada/calm: it has no loop',
      'ada/tense: https://cdn.pixabay.com/audio/x.mp3 is on none of opengameart.org, ' +
        'files.freemusicarchive.org, freemusicarchive.org, incompetech.com, huggingface.co, ' +
        'clement-panchout.itch.io',
      'ada/critical: its crossfade of 1000 ms is under 1500',
      'ada/critical: it loops from 500 ms, under the 1000 a pass leads',
      'ada/end-won: it lasts 50000 ms, not 30–45 s',
      'ada/end-lost: ../ada/x.wav lies outside takes/packs/',
    ]);
    const missing = plannedPack('ada');
    delete (missing.pieces as Partial<Record<Slot, PlanPiece>>)['menu-theme'];
    expect(packFlaws(missing)).toEqual(['ada/menu-theme: no piece']);
  });

  it('fade a piece played once within its halves, and leave a loop’s fades to the game', () => {
    const faded = plannedPack('ada', {
      title: { fades: { inMs: 1500, outMs: 4000 } },
      'end-won': { fades: { outMs: 20_000 } },
      calm: { fades: { inMs: 1500 } },
    });
    expect(packFlaws(faded)).toEqual([
      'ada/calm: it fades, and the game fades its loops',
      'ada/end-won: a fade runs past its half',
    ]);
  });

  it('hold a planned loop to 60–120 s round, and leave its reach to the seam’s search', () => {
    const short = plannedPack('ada', { calm: { loop: { crossfade: [7000, 66_000, 2000] } } });
    expect(packFlaws(short)).toEqual(['ada/calm: it goes round in 57000 ms, not 60–120 s']);
    // 64 s round, sought 8 s either way: the search keeps to 60 s and more itself.
    const reaching = plannedPack('ada', {
      calm: { loop: { crossfade: [7000, 73_000, 2000], seekMs: 8000 } },
    });
    expect(packFlaws(reaching)).toEqual([]);
  });

  it('fetch over https from the hosts the plan may name, and from no other', () => {
    expect(allowedUrl('https://incompetech.com/music/royalty-free/mp3-royaltyfree/Loss.mp3')).toBe(
      true,
    );
    expect(allowedUrl('http://incompetech.com/Loss.mp3')).toBe(false);
    expect(allowedUrl('https://pixabay.com/music/x')).toBe(false);
    expect(allowedUrl('not a url')).toBe(false);
  });
});

describe('the attribution', () => {
  it('names the piece, its author and the page’s notice, its page, licence and edit', () => {
    const piece = plannedPiece('ada', 'calm');
    const macleod: PlanPiece = {
      ...piece,
      title: 'Time Passes',
      author: 'Kevin MacLeod',
      notice: 'incompetech.com',
      page: 'https://incompetech.com/music/royalty-free/index.html',
    };
    expect(attributionOf(macleod)).toBe(
      '„Time Passes“ – Kevin MacLeod (incompetech.com) · ' +
        'https://incompetech.com/music/royalty-free/index.html · ' +
        'Creative Commons Attribution 4.0 International: ' +
        'https://creativecommons.org/licenses/by/4.0/ · bearbeitet: Schnitt, Schleife, Pegel',
    );
    const krux: PlanPiece = {
      source: piece.source,
      page: piece.page,
      trim: piece.trim,
      licence: 'CC0',
      title: 'Motions',
      author: 'Rafael Krux',
    };
    expect(attributionOf(krux)).toBe(
      '„Motions“ – Rafael Krux · https://opengameart.org/content/ada-calm · ' +
        'CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/ · ' +
        'bearbeitet: Schnitt, Schleife, Pegel',
    );
  });
});

describe('a pack built', BUILDS, () => {
  it('fetches each file once, cuts, measures, encodes the pieces, writes pack.json', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const host = hostFor([pack]);
    const [outcome] = await runWith(optionsOf([]), { packs: [pack] }, benchOf(places, host));
    expect(outcome && 'built' in outcome).toBe(true);
    expect(host.asked).toHaveLength(8);
    const file = read(join(places.packs, 'ada', 'pack.json'));
    expect(file).toEqual((outcome as Made).built);
    expect(Object.keys(file.pieces)).toEqual([...SLOTS]);
    expect(readdirSync(join(places.music, 'ada')).sort()).toEqual(
      SLOTS.map((slot) => `${slot}.m4a`).sort(),
    );
    // A second run fetches nothing anew: every file is had already.
    await runWith(optionsOf([]), { packs: [pack] }, benchOf(places, host));
    expect(host.asked).toHaveLength(8);
    expect(readdirSync(places.takes)).toHaveLength(8);
  });

  it('keeps a loop’s file to its seam and a little past, its fade in its own time', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const made = (await buildPack(pack, benchOf(places, hostFor([pack])))) as Made;
    const calm = made.built.pieces.calm as FoundPiece;
    // Planned 7–75 s of the file over 2 s, its span from 5 s: 2–70 s of the piece.
    expect(calm.loop).toEqual({ crossfade: { startMs: 2000, endMs: 70_000, fadeMs: 2000 } });
    expect(calm.ms).toBe(70_000 + TAIL_MS);
    expect(calm.startMs).toBe(0);
    const title = made.built.pieces.title as FoundPiece;
    expect([title.ms, title.loop]).toEqual([35_000, null]);
  });

  it('keeps a sought loop from 3 s before its seam to just past, 60 s round or more', async () => {
    const places = placesIn();
    // Planned 15 s into its file — 10 s into its span — and sought 3 s either way.
    const pack = plannedPack('ada', {
      calm: { loop: { crossfade: [15_000, 77_500, 2000], seekMs: 3000 } },
    });
    const made = (await buildPack(pack, benchOf(places, hostFor([pack])))) as Made;
    const calm = made.built.pieces.calm as FoundPiece;
    const loop = calm.loop as { crossfade: { startMs: number; endMs: number; fadeMs: number } };
    expect(loop.crossfade.startMs).toBe(LEAD_KEPT_MS);
    expect(calm.ms).toBe(loop.crossfade.endMs + TAIL_MS);
    const round = loop.crossfade.endMs - loop.crossfade.fadeMs - loop.crossfade.startMs;
    expect(round).toBeGreaterThanOrEqual(60_000);
    expect(round).toBeLessThanOrEqual(63_500);
  });

  it('brings every piece to −19 LUFS by its gain, measured as encoded', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const host = hostFor([pack]);
    host.files.set(urlOf('ada', 'tense'), tone(87, 0.02));
    const made = (await buildPack(pack, benchOf(places, host))) as Made;
    for (const slot of SLOTS) {
      const piece = made.built.pieces[slot] as FoundPiece;
      const encoded: Pcm = parseWav(readFileSync(join(places.music, 'ada', piece.file)));
      expect(piece.loudness).toBeCloseTo(lufsOf(encoded), 1);
      expect(piece.loudness + 20 * Math.log10(piece.gain)).toBeCloseTo(-19, 1);
    }
    const tense = made.built.pieces.tense as FoundPiece;
    const calm = made.built.pieces.calm as FoundPiece;
    // A fifth of the amplitude: 14 dB quieter, so 14 dB more gain.
    expect(20 * Math.log10(tense.gain / calm.gain)).toBeCloseTo(13.98, 1);
  });

  it('skips the silence a piece played once opens with; a loop starts at once', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const host = hostFor([pack]);
    // 5.4 s of silence: the title's span, from 5 s, opens with 400 ms of it.
    host.files.set(urlOf('ada', 'title'), tone(42, 0.1, 5400));
    const made = (await buildPack(pack, benchOf(places, host))) as Made;
    expect((made.built.pieces.title as FoundPiece).startMs).toBeGreaterThanOrEqual(390);
    expect((made.built.pieces.title as FoundPiece).startMs).toBeLessThanOrEqual(410);
  });

  it('brings a piece played once in and to its end over the fades the plan gives it', async () => {
    const places = placesIn();
    const pack = plannedPack('ada', { 'end-lost': { fades: { inMs: 2000, outMs: 4000 } } });
    await buildPack(pack, benchOf(places, hostFor([pack])));
    const ending = parseWav(readFileSync(join(places.music, 'ada', 'end-lost.m4a')));
    const data = ending.channels[0] ?? new Float32Array(0);
    /** The level of the 50 ms around `ms`: its peak. */
    const peakAt = (ms: number): number => {
      const from = Math.round(((ms - 25) / 1000) * RATE);
      return Math.max(...data.slice(Math.max(0, from), from + RATE / 20).map(Math.abs));
    };
    expect(peakAt(30)).toBeLessThan(0.002);
    expect(peakAt(1000)).toBeCloseTo(0.05, 1);
    expect(peakAt(10_000)).toBeCloseTo(0.1, 2);
    expect(peakAt(33_000)).toBeCloseTo(0.05, 1);
    expect(peakAt(34_980)).toBeLessThan(0.002);
  });

  it('carries each piece’s credit and its attribution into pack.json', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const made = (await buildPack(pack, benchOf(places, hostFor([pack])))) as Made;
    const calm = made.built.pieces.calm as FoundPiece;
    expect(calm).toMatchObject({
      title: 'calm theme',
      author: 'Ada Example',
      source: 'https://opengameart.org/content/ada-calm',
      licence: 'CC BY 4.0',
      attribution: attributionOf(pack.pieces.calm),
      file: 'calm.m4a',
    });
    expect(made.built).toMatchObject({ id: 'ada', title: 'Schicht X · Probe' });
    expect(said).toEqual([]); // buildPack says nothing; the run does
  });
});

describe('a pack refused', BUILDS, () => {
  it('says a fetch that failed, builds nothing of that pack and the rest as asked', async () => {
    const places = placesIn();
    const ada = plannedPack('ada');
    const bea = plannedPack('bea');
    const host = hostFor([ada, bea]);
    host.failing.set(urlOf('ada', 'critical'), 404);
    const outcomes = await runWith(optionsOf([]), { packs: [ada, bea] }, benchOf(places, host));
    expect(outcomes.map((outcome) => 'built' in outcome)).toEqual([false, true]);
    expect(outcomes[0]).toEqual({
      id: 'ada',
      refused: [`ada/critical: ${urlOf('ada', 'critical')} could not be fetched (HTTP 404)`],
    });
    expect(said).toContain('packs: ada not built:');
    expect(existsSync(join(places.packs, 'ada'))).toBe(false);
    expect(existsSync(join(places.music, 'ada'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('asks for a file downloaded by hand where the plan puts it, takes it once there', async () => {
    const places = placesIn();
    const manual = { manual: 'ada/Boss.wav', from: 'https://clement-panchout.itch.io/x' };
    const pack = plannedPack('ada', { critical: { source: manual } });
    const host = hostFor([pack]);
    const first = await buildPack(pack, benchOf(places, host));
    expect(first).toEqual({
      id: 'ada',
      refused: [
        'ada/critical: manual: download https://clement-panchout.itch.io/x by hand into ' +
          'takes/packs/ada/',
      ],
    });
    // Downloaded as its host names it, in a folder of the download's own.
    const download = join(places.takes, 'ada', 'Free Pack (1-50)');
    mkdirSync(download, { recursive: true });
    writeFileSync(join(download, '[ACTION] Space BOSS.wav'), wavOf(RATE, [tone(87, 0.1)]));
    const fragment = { manual: 'ada/space boss', from: manual.from };
    const second = await buildPack(plannedPack('ada', { critical: { source: fragment } }), {
      ...benchOf(places, host),
    });
    expect('built' in second).toBe(true);
    expect(host.asked).not.toContain(expect.stringContaining('oss'));
    writeFileSync(join(download, 'Space Boss (loop).wav'), wavOf(RATE, [tone(87, 0.1)]));
    const twice = await buildPack(plannedPack('ada', { critical: { source: fragment } }), {
      ...benchOf(places, host),
    });
    expect(twice).toEqual({
      id: 'ada',
      refused: ['ada/critical: manual: 2 files in takes/packs/ada/ hold „space boss"'],
    });
  });

  it('refuses a pack over its cap, taking every part back and leaving what was there', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const host = hostFor([pack]);
    const bench = benchOf(places, host);
    await buildPack(pack, bench);
    const before = readFileSync(join(places.packs, 'ada', 'pack.json'), 'utf8');
    // Each piece a WAV with an eighth of the cap behind its data: the eight pass it together.
    const fat: Bench = {
      ...bench,
      encode: (pcm, path) => {
        const wav = wavBytes(pcm);
        const padded = new Uint8Array(wav.length + PACK_CAP / 8);
        padded.set(wav);
        writeFileSync(path, padded);
      },
    };
    const outcome = await buildPack(pack, fat);
    expect(outcome).toMatchObject({
      id: 'ada',
      refused: [expect.stringContaining('over its 9 MB')],
    });
    const names = readdirSync(join(places.music, 'ada'));
    expect(names.some((name) => name.includes('.part'))).toBe(false);
    expect(readFileSync(join(places.packs, 'ada', 'pack.json'), 'utf8')).toBe(before);
  });

  it('refuses a span that runs past its file, saying how long the file lasts', async () => {
    const places = placesIn();
    const pack = plannedPack('ada');
    const host = hostFor([pack]);
    host.files.set(urlOf('ada', 'lobby'), tone(52, 0.1));
    const outcome = await buildPack(pack, benchOf(places, host));
    expect(outcome).toEqual({
      id: 'ada',
      refused: ['ada/lobby: its span ends at 85000 ms, past its file\'s 52000 ms'],
    });
    expect(existsSync(join(places.packs, 'ada'))).toBe(false);
  });

  it('refuses a plan that breaks a rule before it fetches anything', async () => {
    const places = placesIn();
    const pack = plannedPack('ada', { calm: { loop: undefined } });
    const host = hostFor([pack]);
    const outcome = await buildPack(pack, benchOf(places, host));
    expect(outcome).toEqual({ id: 'ada', refused: ['ada/calm: it has no loop'] });
    expect(host.asked).toEqual([]);
  });
});

describe('a dry run', BUILDS, () => {
  it('says where each piece comes from and whether it is had, fetching nothing', async () => {
    const places = placesIn();
    const manual = { manual: 'ada/Boss.wav', from: 'https://clement-panchout.itch.io/x' };
    const pack = plannedPack('ada', { critical: { source: manual } });
    const host = hostFor([pack]);
    mkdirSync(places.takes, { recursive: true });
    const had = join(places.takes, sourceFile(urlOf('ada', 'calm')));
    writeFileSync(had, wavOf(RATE, [tone(1, 0.1)]));
    await runWith(optionsOf(['--dry-run']), { packs: [pack] }, benchOf(places, host));
    expect(host.asked).toEqual([]);
    expect(existsSync(places.packs)).toBe(false);
    expect(said[0]).toBe('packs: ada — Schicht X · Probe');
    expect(said).toContain(`  calm  fetched before from opengameart.org: ${urlOf('ada', 'calm')}`);
    expect(said).toContain(`  tense  to fetch from opengameart.org: ${urlOf('ada', 'tense')}`);
    expect(said).toContain(
      '  critical  manual (missing): takes/packs/ada/Boss.wav from ' +
        'https://clement-panchout.itch.io/x',
    );
    expect(process.exitCode).toBe(0);
  });

  it('says the rules a plan breaks, and fails', async () => {
    const places = placesIn();
    const pack = plannedPack('ada', { calm: { loop: undefined } });
    await runWith(optionsOf(['--dry-run']), { packs: [pack] }, benchOf(places, hostFor([pack])));
    expect(said).toContain('ada/calm: it has no loop');
    expect(process.exitCode).toBe(1);
  });
});

describe('a fetched file’s name', () => {
  it('keeps the start of the address’s hash and its own name made plain, one file a source', () => {
    const one = 'https://opengameart.org/sites/default/files/Solemn%20%28Opening%29_0.mp3';
    const two = 'https://incompetech.com/music/royalty-free/Solemn%20(Opening)_0.mp3';
    expect(sourceFile(one)).toMatch(/^[0-9a-f]{10}-solemn-opening-0\.mp3$/);
    expect(sourceFile(one)).toBe(sourceFile(one));
    expect(sourceFile(two)).not.toBe(sourceFile(one));
  });
});
