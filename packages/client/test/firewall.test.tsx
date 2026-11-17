import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIREWALL_PAUSE_MS,
  generateEdgework,
  SAME_LINE_GAP,
  moduleFor,
  puzzleDefSchema,
  type ConsoleId,
  type PuzzleState,
  type PuzzleView,
} from '@escapelab/core';
import { NotepadContext } from '../src/noting.js';
import { TEXT_SCALE } from '../src/settings.js';
import { elementsOf, lengthOf, Sheets, type Screen, type Styled } from './cascade.js';
import { deviceRun, lcg, mapWith, NO_CLOCK } from './fixtures.js';

vi.mock('../src/puzzles/sounds.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn() : value,
    ]),
  );
});

const sounds = await import('../src/puzzles/sounds.js');
const { FirewallPanel, firewallSounds, onLine } = await import('../src/puzzles/FirewallPanel.js');
const { keysIn, keysOf } = await import('../src/hooks.js');
const view = await import('../src/puzzles/firewallView.js');
const { StationModal } = await import('../src/screens/Game.js');

type Firewall = Extract<PuzzleView, { kind: 'firewall' }>;

const noop = (): void => undefined;
/** The wave starts at T0, both consoles manned; the server's clock reads T0 + `at` in a test. */
const T0 = 1_700_000_000_000;
/** A moment of the first wave with packets on the lines and none in the Kern yet, ms. */
const MID = 12_000;
const DEF = puzzleDefSchema.parse({ type: 'firewall', id: 'pf', title: 'Paketfilter' });
const FALL_MS = 14_000;

/**
 * The station's state `ms` into its first wave, both consoles manned from T0 and the Freigabe
 * pressed then.
 */
function stateAt(ms: number): PuzzleState {
  const station = moduleFor(DEF.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const ctx = (at: number, manned: boolean) => ({
    edgework,
    alarms: 0,
    remainingSec: 600,
    at,
    crew: ['p1', 'p2'],
    console: manned ? ('a' as const) : null,
    atConsoles: manned ? { a: ['p1'], b: ['p2'] } : { a: [], b: [] },
    readers: [],
  });
  const fresh = station.init(DEF, rng, ctx(T0, false));
  const manned = station.elapse?.(DEF, fresh, ctx(T0, true)).state ?? fresh;
  const started = station.apply(DEF, manned, { start: true }, 'p1', ctx(T0, true)).state;
  return station.elapse?.(DEF, started, ctx(T0 + ms, true)).state ?? started;
}

/** The Paketfilter `ms` into its wave as console `seat` shows it; null for the audience. */
function seen(
  seat: ConsoleId | null,
  ms: number,
  change: (s: PuzzleState) => PuzzleState = (s) => s,
) {
  const station = moduleFor(DEF.type);
  const state = change(stateAt(ms));
  const playerId = seat === null ? null : 'p1';
  const viewer = { playerId, operating: seat !== null, reading: false, console: seat };
  const shown = station.view(DEF, state, viewer, {
    edgework: generateEdgework(lcg(7)),
    alarms: 0,
    crew: ['p1', 'p2'],
    operators: ['p1', 'p2'],
  });
  const plate = seat === null ? null : station.plate(DEF, seat);
  const common = { index: 0, total: 1, title: 'Paketfilter', manual: null, console: seat, plate };
  return { ...shown, ...common, atOtherConsole: null } as Firewall;
}

/** `state` with every packet come on so far marked at console b. */
const allMarked = (state: PuzzleState): PuzzleState => {
  const fw = state as Extract<PuzzleState, { type: 'firewall' }>;
  return { ...fw, marks: fw.packets.slice(0, fw.entered).map((p) => p.id) };
};

/** The markup of the key that is packet `id`'s card in `html`; empty where it has none. */
function cardOf(html: string, id: string): string {
  const cards = html.split('class="firewall-card');
  const from = cards.find((card) => card.includes(`data-packet="${id}"`)) ?? '';
  return from.split('</button>')[0] ?? '';
}

/** The two lines the card of packet `id` prints in `html`, each as its parts read together. */
function printed(html: string, id: string): string[] {
  const fields = cardOf(html, id).split('class="firewall-field').slice(1);
  // each field's markup runs into the tag that opens what follows it
  return fields.map((field) => field.slice(field.indexOf('>') + 1).replace(/<[^>]*(>|$)|✓/g, ''));
}

const panel = (puzzle: Firewall): string =>
  renderToStaticMarkup(
    <FirewallPanel puzzle={puzzle} change={null} send={noop} mission={NO_CLOCK} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The server's clock, as the page reads it, at `ms` into the wave. */
const clockAt = (ms: number): void => {
  vi.setSystemTime(T0 + ms);
};

describe('the scope’s clock', () => {
  const puzzle = seen('a', MID);
  const blips = puzzle.packets ?? [];
  const [first] = blips;

  it('shows a packet on its line from its moment to the Kern, a second’s slack either side', () => {
    expect(first).toBeDefined();
    const enter = T0 + (first?.enterMs ?? 0);
    expect(view.onTheLines(puzzle, enter - 1000).map((b) => b.id)).not.toContain(first?.id);
    expect(view.onTheLines(puzzle, enter + 1000).map((b) => b.id)).toContain(first?.id);
    expect(view.onTheLines(puzzle, enter + FALL_MS - 1000).map((b) => b.id)).toContain(first?.id);
    expect(view.onTheLines(puzzle, enter + FALL_MS + 1000).map((b) => b.id)).not.toContain(
      first?.id,
    );
  });

  it('measures how far down a packet has come, from 0 at the top to 1 in the Kern', () => {
    const at = (first?.enterMs ?? 0) + FALL_MS / 2;
    expect(first && view.progressOf(first, at, FALL_MS)).toBe(0.5);
    expect(first && view.progressOf(first, -5000, FALL_MS)).toBe(0);
    expect(first && view.progressOf(first, 10 ** 9, FALL_MS)).toBe(1);
  });

  it('names the lowest packet on a line: the one longest on it', () => {
    const live = view.onTheLines(puzzle, T0 + MID);
    for (const line of view.LINES) {
      const onIt = live.filter((b) => b.line === line);
      expect(view.lowestOn(live, line)?.id ?? null).toBe(onIt[0]?.id ?? null);
    }
  });

  it('renders anew as the next packet reaches the Kern, and never while the wave is held', () => {
    const now = T0 + MID;
    const live = view.onTheLines(puzzle, now);
    const arrivals = live.map((b) => T0 + b.enterMs + FALL_MS);
    expect(view.nextChange(puzzle, now)).toBe(Math.min(...arrivals));
    const held = { ...puzzle, clock: { startedAt: T0, heldAt: T0 + 5000 } };
    expect(view.nextChange(held, now)).toBeNull();
    // in the breath before the first packet, each whole second
    const breath = seen('a', 1500);
    expect(view.nextChange(breath, T0 + 1500)).toBe(T0 + 2000);
  });

  it('steps a cursor along the packets on the lines, line by line, and round', () => {
    const live = view.onTheLines(puzzle, T0 + MID);
    const ids = [...live].sort((p, q) => p.line - q.line || p.enterMs - q.enterMs).map((b) => b.id);
    const [first = '', second = ''] = ids;
    expect(ids.length).toBeGreaterThan(1);
    expect(view.cursorStep(live, null, 1)).toBe(first);
    expect(view.cursorStep(live, first, 1)).toBe(second);
    expect(view.cursorStep(live, first, -1)).toBe(ids.at(-1));
    expect(view.cursorStep([], null, 1)).toBeNull();
  });
});

describe('the status line', () => {
  it('counts the breath down before a wave, the wave and its drops while it runs', () => {
    expect(view.statusOf(seen('a', 0), T0 + 1200)).toBe('Welle 1 von 3 in 3 s.');
    const running = seen('a', MID);
    expect(view.statusOf(running, T0 + MID)).toBe('Welle 1 von 3 · 0 gesperrt');
  });

  it('waits for the Freigabe, says what called a wave off, and that a clean wave goes on', () => {
    const at = { ...seen('a', 0), packets: [] };
    const ready = { ...at, waiting: true };
    expect(view.statusOf(ready, T0)).toBe('Bereit · Welle 1 starten');
    const fault = { ...ready, event: { n: 2, kind: 'fault' as const, at: T0, line: null } };
    const called = 'Fehlquittierung: Welle abgebrochen. Neue Welle wartet auf Freigabe.';
    expect(view.statusOf(fault, T0)).toBe(called);
    const cleared = { n: 3, kind: 'cleared' as const, at: T0, line: null };
    const clean = { ...at, wave: 2, cleared: 1, event: cleared };
    expect(view.statusOf(clean, T0)).toBe('Welle 1 sauber. Welle 2 in 4 s.');
    expect(FIREWALL_PAUSE_MS).toBe(4000);
  });

  it('says whose console stands empty while the wave holds, as the other modules word it', () => {
    const held = { ...seen('a', MID), vacant: ['b' as const] };
    expect(view.statusOf(held, T0 + MID)).toBe('Analysepult unbesetzt · Pakete halten');
    const away = { ...seen('b', MID), vacant: ['a' as const] };
    expect(view.statusOf(away, T0 + MID)).toBe('Sperrpult unbesetzt · Pakete halten');
    // never that the viewer's own console stands empty: the run stands still, for maintenance
    const paused = { ...held, vacant: ['a' as const, 'b' as const] };
    expect(view.statusOf(paused, T0 + MID)).toBe('Pakete halten');
    expect(view.statusOf({ ...held, vacant: ['a' as const] }, T0 + MID)).toBe('Pakete halten');
  });
});

describe('the Sperrpult', () => {
  it('shows five lines with plain points, the gate under one, no header anywhere', () => {
    clockAt(MID);
    const puzzle = seen('a', MID);
    const html = panel(puzzle);
    expect(html.match(/<button[^>]*class="firewall-line/g)).toHaveLength(5);
    expect(html.match(/class="firewall-gate"/g)).toHaveLength(1);
    const shown = view.onTheLines(puzzle, T0 + MID);
    expect(html.match(/class="firewall-blip/g)).toHaveLength(shown.length);
    const state = stateAt(MID) as Extract<PuzzleState, { type: 'firewall' }>;
    for (const packet of state.packets) {
      expect(html).not.toContain(packet.header.source);
    }
    expect(html).toContain('SPERREN');
  });

  it('rings and ticks a marked packet, and names the ringed lowest one on its line', () => {
    clockAt(MID);
    const html = panel(seen('a', MID, allMarked));
    const marked = html.match(/class="firewall-blip firewall-blip--marked"/g) ?? [];
    expect(marked.length).toBeGreaterThan(0);
    expect(html.match(/class="firewall-tick">✓</g)).toHaveLength(marked.length);
    expect(html).toContain(', unterstes Paket markiert"');
  });

  it('times each packet’s fall from where the wave stands, paused while it is held', () => {
    clockAt(MID);
    const puzzle = seen('a', MID);
    const html = panel(puzzle);
    const [first] = view.onTheLines(puzzle, T0 + MID);
    expect(html).toContain(`--fall-delay:${(first?.enterMs ?? 0) - MID}ms`);
    expect(html).toContain('--fall-ms:14000ms');
    expect(html).toContain('--fall-steps:14');
    expect(html).not.toContain('firewall-track--held');
    const held = { ...puzzle, clock: { startedAt: T0, heldAt: T0 + MID } };
    clockAt(MID + 20_000);
    const frozen = panel(held);
    expect(frozen).toContain(`--fall-delay:${(first?.enterMs ?? 0) - MID}ms`);
    expect(frozen).toContain('firewall-track--held');
    const left = panel({ ...held, vacant: ['b'] });
    expect(left).toContain('firewall-scope firewall-scope--held');
    expect(left).toContain('>HALT</p>');
    expect(left).toContain('Analysepult unbesetzt · Pakete halten');
    expect(html).not.toContain('firewall-scope--held');
  });
});

describe('the Analysepult', () => {
  it('shows the same packets as cards with their headers, each a key with its mark', () => {
    clockAt(MID);
    const puzzle = seen('b', MID, allMarked);
    const html = panel(puzzle);
    const live = view.onTheLines(puzzle, T0 + MID);
    expect(html.match(/<button[^>]*class="firewall-card/g)).toHaveLength(live.length);
    for (const blip of live) {
      expect(printed(html, blip.id)).toEqual([
        blip.header?.source,
        `${blip.header?.port}/${blip.header?.protocol}`,
      ]);
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(live.length);
    expect(html).not.toContain('SPERREN');
    expect(html).not.toContain('firewall-gate');
  });

  it('shows the audience the cards and their marks, nothing to press', () => {
    clockAt(MID);
    const html = panel(seen(null, MID, allMarked));
    expect(html).toContain('firewall--watched');
    expect(html).toContain('firewall-card firewall-card--marked');
    expect(html).not.toMatch(/<button/);
  });
});

describe('the sounds of a change', () => {
  const before = seen('a', MID);
  const at = (kind: 'drop' | 'cleared' | 'fault' | 'void') => ({
    before,
    after: { ...before, event: { n: (before.event?.n ?? 0) + 1, kind, at: T0, line: 0 } },
    alarm: kind === 'fault',
    seq: 1,
  });

  it('pops a packet taken out, chimes a clean wave, leaves a fault to the kit’s klaxon', () => {
    firewallSounds(at('drop'));
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
    firewallSounds(at('cleared'));
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
    firewallSounds(at('fault'));
    firewallSounds(at('void'));
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
    expect(sounds.stageChime).toHaveBeenCalledTimes(1);
    firewallSounds({ ...at('drop'), after: before });
    expect(sounds.lampPop).toHaveBeenCalledTimes(1);
  });
});

/** Phones held upright, the smallest to the largest. */
const UPRIGHT: Screen[] = [
  { width: 360, height: 640, coarse: true },
  { width: 390, height: 844, coarse: true },
  { width: 430, height: 932, coarse: true },
];

describe('the type and the targets on a phone, held sideways or upright', () => {
  const sheets = new Sheets();
  const PHONES: Screen[] = [
    { width: 844, height: 390, coarse: true },
    { width: 932, height: 430, coarse: true },
    ...UPRIGHT,
  ];

  /** The device of the Paketfilter at console `seat` as the station modal shows it. */
  function station(seat: ConsoleId): Styled[] {
    clockAt(MID);
    return elementsOf(
      renderToStaticMarkup(
        <NotepadContext value={{ noteDown: () => true, toggle: noop }}>
          <StationModal
            puzzle={seen(seat, MID, allMarked)}
            run={deviceRun()}
            map={mapWith({})}
            edgework={null}
            mission={NO_CLOCK}
            send={noop}
            onStepBack={noop}
          />
        </NotepadContext>,
      ),
    );
  }

  const px = (node: Styled, properties: string[], screen: Screen): number =>
    Math.max(
      0,
      ...properties.map((p) => sheets.length(node, p, screen)).filter((n) => !Number.isNaN(n)),
    );

  it.each(['a', 'b'] as const)('makes every control at console %s 44 px', (seat) => {
    const nodes = station(seat);
    for (const screen of PHONES) {
      const controls = nodes.filter(
        (n) => n.tag === 'button' && n.classes.some((c) => c.startsWith('firewall-')),
      );
      expect(controls.length).toBeGreaterThan(0);
      const short = controls.filter(
        (n) =>
          px(n, ['min-height', 'height'], screen) < 44 ||
          px(n, ['min-width', 'width'], screen) < 44,
      );
      const cards = short.filter((n) => n.classes.includes('firewall-card'));
      // a card spans its line: as wide as the line's 88 px column, less its margins
      expect(short.filter((n) => !cards.includes(n)).map((n) => n.classes.join('.'))).toEqual([]);
      expect(cards.every((n) => px(n, ['min-height'], screen) >= 44)).toBe(true);
    }
  });

  it.each(['a', 'b'] as const)('sets every word on its scope at console %s 14 px', (seat) => {
    const nodes = station(seat);
    for (const screen of PHONES) {
      const words = nodes.filter(
        (n) =>
          n.text.trim() !== '' &&
          [n, n.parent].some((at) => at?.classes.some((c) => c.startsWith('firewall-')) === true),
      );
      expect(words.length).toBeGreaterThan(0);
      // the make engraved in the status line's metal is the kit's engraving, 11 px
      const read = words.filter((n) => !n.classes.includes('device-engraving'));
      const small = read.filter((n) => sheets.fontSize(n, screen) < 14);
      expect(small.map((n) => `${n.classes.join('.')} ${sheets.fontSize(n, screen)}`)).toEqual([]);
    }
  });

  it('steps the packets once a second under reduced motion, from the same stylesheet', () => {
    const css = readFileSync(new URL('../src/puzzles/firewall.css', import.meta.url), 'utf8');
    const calm = css.slice(css.indexOf(":where([data-motion='reduce'])"));
    // each step taken as its second begins: a packet is never drawn higher than it is
    expect(calm).toMatch(
      /\.firewall-track \{\s*animation-timing-function: steps\(var\(--fall-steps\), start\);/,
    );
  });
});

/** The stylesheets read as a page whose settings set the text's scale to `scale`. */
class ScaledSheets extends Sheets {
  constructor(private readonly scale: number) {
    super();
  }

  override custom(node: Styled, name: string, screen: Screen): string | undefined {
    return name === '--text-scale' ? String(this.scale) : super.custom(node, name, screen);
  }
}

describe('the scope’s geometry', () => {
  const SCREENS: Screen[] = [
    { width: 1280, height: 720, coarse: false },
    { width: 1440, height: 820, coarse: false },
    { width: 844, height: 390, coarse: true },
    { width: 932, height: 430, coarse: true },
  ];

  /** The Analysepult as the station modal shows it, its cards on the lines. */
  function cards(): Styled[] {
    clockAt(MID);
    return elementsOf(
      renderToStaticMarkup(
        <NotepadContext value={{ noteDown: () => true, toggle: noop }}>
          <StationModal
            puzzle={seen('b', MID)}
            run={deviceRun()}
            map={mapWith({})}
            edgework={null}
            mission={NO_CLOCK}
            send={noop}
            onStepBack={noop}
          />
        </NotepadContext>,
      ),
    );
  }

  it.each(SCREENS)('never lays two cards of one line over each other at $width', (screen) => {
    const nodes = cards();
    const lines = nodes.find((n) => n.classes.includes('firewall-lines'));
    const card = nodes.find((n) => n.classes.includes('firewall-card'));
    if (lines === undefined || card === undefined) {
      throw new Error('expected the lines and a card');
    }
    // every text size the settings offer (settings.ts TEXT_SCALE)
    for (const scale of Object.values(TEXT_SCALE)) {
      const scaled = new ScaledSheets(scale);
      const high = scaled.length(lines, 'height', screen);
      const item = scaled.length(card, 'min-height', screen);
      expect(item, `scale ${scale}`).toBeGreaterThanOrEqual(44);
      // the card's two lines, 3 px of padding and a marked card's 2 px border over and under
      const font = scaled.fontSize(card, screen);
      expect(2 * 1.2 * font + 6 + 4, `scale ${scale}`).toBeLessThanOrEqual(item + 0.01);
      // two packets of a line come SAME_LINE_GAP of a fall apart, the track the line less a card
      expect((high - item) * SAME_LINE_GAP, `scale ${scale}`).toBeGreaterThanOrEqual(item - 0.01);
    }
  });

  it('numbers the lines over them, where no card ever covers a number', () => {
    const nodes = cards();
    const numbers = nodes.filter((n) => n.classes.includes('firewall-line-no'));
    expect(numbers.map((n) => n.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(numbers.every((n) => n.parent?.classes.includes('firewall-numbers'))).toBe(true);
  });
});

describe('the scope on a phone held upright', () => {
  /** A scope's markup read as elements: console `seat`'s, the audience's for null. */
  function scope(seat: ConsoleId | null, change?: (s: PuzzleState) => PuzzleState): Styled[] {
    clockAt(MID);
    return elementsOf(panel(seen(seat, MID, change)));
  }

  /** The one of `nodes` that wears `name`. */
  function part(nodes: Styled[], name: string): Styled {
    const found = nodes.find((n) => n.classes.includes(name));
    if (found === undefined) {
      throw new Error(`expected ${name}`);
    }
    return found;
  }

  it.each(UPRIGHT)('holds two cards of four lines on one line at $width', (screen) => {
    for (const nodes of [scope('b'), scope(null)]) {
      const lines = part(nodes, 'firewall-lines');
      const card = part(nodes, 'firewall-card');
      for (const scale of Object.values(TEXT_SCALE)) {
        const scaled = new ScaledSheets(scale);
        const high = scaled.length(lines, 'height', screen);
        const item = scaled.length(card, 'min-height', screen);
        expect(item, `scale ${scale}`).toBeGreaterThanOrEqual(44);
        // four lines at 1.1, 1 px of padding and the 1 px border over and under them
        const font = scaled.fontSize(card, screen);
        expect(scaled.declared(card, 'line-height', screen)?.value).toBe('1.1');
        expect(4 * 1.1 * font + 2 + 2, `scale ${scale}`).toBeLessThanOrEqual(item + 0.01);
        expect((high - item) * SAME_LINE_GAP, `scale ${scale}`).toBeGreaterThanOrEqual(item - 0.01);
      }
    }
  });

  /** The least width a line of `grid` is given at text size `scale`, and the gap between two. */
  function leastLine(grid: Styled, screen: Screen, scale: number) {
    const scaled = new ScaledSheets(scale);
    const columns = scaled.declared(grid, 'grid-template-columns', screen)?.value;
    const least = /^repeat\(5, minmax\((.+), 1fr\)\)$/.exec(String(columns))?.[1];
    if (least === undefined) {
      throw new Error(`five lines of a least width expected, not ${columns}`);
    }
    const em = scaled.fontSize(grid, screen);
    return {
      em,
      column: lengthOf(least, { screen, em, custom: () => undefined }),
      gap: scaled.length(grid, 'gap', screen),
    };
  }

  const ROWS = (['a', 'b'] as const).flatMap((seat) =>
    ['firewall-lines', 'firewall-numbers'].map((row) => ({ seat, row })),
  );

  it.each(UPRIGHT)('sets five lines side by side in a window $width wide', (screen) => {
    for (const { seat, row } of ROWS) {
      const grid = part(scope(seat), row);
      // every text size the settings offer: a line's least width grows with a card's type
      for (const scale of Object.values(TEXT_SCALE)) {
        const { em, column, gap } = leastLine(grid, screen, scale);
        // the station's frame takes 29 px of each side at these widths (devices.css: the
        // modal's 10, the panel's 6, the face's 10; firewall.css: the bezel's 8, the scope 8
        // into it, its own 3): the lines at their least, with their gaps, stand in the rest
        expect(5 * column + 4 * gap, `${row} ${seat} ${scale}`).toBeLessThanOrEqual(
          screen.width - 2 * 29,
        );
        // a line is a finger wide at least, and a card's holds five figures of its type
        // (0.602 em each in the device's face), its border and its padding
        expect(column).toBeGreaterThanOrEqual(seat === 'b' ? 5 * 0.602 * em + 6 : 44);
        expect(column).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('breaks a card into four lines upright only, the stroke gone, the mark in its edge', () => {
    const sheets = new Sheets();
    const nodes = scope('b', allMarked);
    const piece = part(nodes, 'firewall-part');
    const stroke = part(nodes, 'firewall-stroke');
    const marked = part(nodes, 'firewall-card--marked');
    const shown = (node: Styled, screen: Screen) => sheets.declared(node, 'display', screen)?.value;
    for (const screen of UPRIGHT) {
      expect(shown(piece, screen)).toBe('block');
      expect(shown(stroke, screen)).toBe('none');
      // nothing of the mark's room taken from the header's width, its ring inside the border
      expect(sheets.length(marked, 'padding-right', screen)).toBe(2);
      expect(sheets.declared(marked, 'box-shadow', screen)?.value).toMatch(/^inset /);
    }
    const others: Screen[] = [
      { width: 1280, height: 720, coarse: false },
      { width: 844, height: 390, coarse: true },
    ];
    for (const screen of others) {
      expect(shown(piece, screen)).toBeUndefined();
      expect(shown(stroke, screen)).toBeUndefined();
    }
  });
});

describe('what the scope draws', () => {
  it('draws no packet the server dropped, and bursts only where a drop was reported', () => {
    clockAt(MID);
    const puzzle = seen('a', MID);
    const [first] = view.onTheLines(puzzle, T0 + MID);
    if (first === undefined) {
      throw new Error('expected a packet on the lines');
    }
    const out = (b: (typeof first)) => (b.id === first.id ? { ...b, dropped: true } : b);
    const dropped = (puzzle.packets ?? []).map(out);
    const after = { ...puzzle, packets: dropped };
    expect(view.onTheLines(after, T0 + MID).map((b) => b.id)).not.toContain(first.id);
    const report = (kind: 'drop' | 'void') => ({ n: 9, kind, at: T0 + MID, line: first.line });
    const live = view.onTheLines(after, T0 + MID);
    const burstOf = (kind: 'drop' | 'void') =>
      onLine({ ...after, event: report(kind) }, live, first.line, T0 + MID + 100).burst;
    expect(burstOf('drop')?.id).toBe(first.id);
    expect(burstOf('void')).toBeUndefined();
    const late = onLine({ ...after, event: report('drop') }, live, first.line, T0 + MID + 700);
    expect(late.burst).toBeUndefined();
  });

  it('starts every fall anew as the page comes back into view', () => {
    const puzzle = seen('a', MID);
    const [blip] = puzzle.packets ?? [];
    const clock = puzzle.clock;
    if (blip === undefined || clock === null) {
      throw new Error('expected a packet and a clock');
    }
    expect(view.fallKey(blip, clock, 0)).toBe(view.fallKey(blip, clock, 0));
    expect(view.fallKey(blip, clock, 1)).not.toBe(view.fallKey(blip, clock, 0));
    expect(view.fallKey(blip, { ...clock, heldAt: T0 }, 0)).not.toBe(view.fallKey(blip, clock, 0));
  });

  it('prints a card in two lines, Quelle over port and protocol, marked with its tick', () => {
    clockAt(MID);
    const puzzle = seen('b', MID, allMarked);
    const html = panel(puzzle);
    const [first] = view.onTheLines(puzzle, T0 + MID);
    const header = first?.header;
    expect(printed(html, first?.id ?? '')).toEqual([
      header?.source,
      `${header?.port}/${header?.protocol}`,
    ]);
    const cardsHtml = html.split('class="firewall-card').slice(1);
    expect(cardsHtml.length).toBeGreaterThan(0);
    expect(cardsHtml.every((card) => card.includes('class="firewall-tick">✓<'))).toBe(true);
  });

  it('sets each line of a card in two parts: the Quelle broken after its network', () => {
    clockAt(MID);
    const puzzle = seen('b', MID);
    const html = panel(puzzle);
    const live = view.onTheLines(puzzle, T0 + MID);
    expect(live.length).toBeGreaterThan(0);
    for (const blip of live) {
      const card = cardOf(html, blip.id);
      const parts = [...card.matchAll(/class="firewall-part">([^<]*)</g)].map((m) => m[1] ?? '');
      const [net = '', host = '', port, protocol] = parts;
      const source = blip.header?.source ?? '';
      // „141.7" over „.9.98": the network's two numbers, then the rest, its dot leading
      expect(net).toBe(source.split('.').slice(0, 2).join('.'));
      expect(net + host).toBe(source);
      expect(host.startsWith('.')).toBe(true);
      expect([port, protocol]).toEqual([String(blip.header?.port), blip.header?.protocol]);
      // no part longer than five figures: what a 360 px phone's line holds at the largest text
      expect(Math.max(...parts.map((part) => part.length))).toBeLessThanOrEqual(5);
    }
  });

  it('shows the Freigabe key only as a press while the wave waits, BEREIT across the scope', () => {
    clockAt(MID);
    const running = panel(seen('a', MID));
    expect(running).toMatch(/<button[^>]*class="firewall-arm"[^>]*disabled/);
    expect(running).not.toContain('>BEREIT<');
    const clock = { startedAt: T0, heldAt: T0 };
    const waiting = panel({ ...seen('a', MID), waiting: true, clock });
    expect(waiting).not.toMatch(/<button[^>]*class="firewall-arm"[^>]*disabled/);
    expect(waiting).toContain('>FREIGABE<');
    expect(waiting).toContain('>BEREIT<');
  });
});

describe('the keys a console listens for', () => {
  it('keeps the space bar a key of its own beside enter and the arrows', () => {
    const heard = keysIn(keysOf([' ', 'enter', 'arrowleft', 'a']));
    expect([...heard].sort()).toEqual([' ', 'a', 'arrowleft', 'enter']);
    expect(keysIn(keysOf(['arrowleft', 'a']))).toEqual(keysIn(keysOf(['arrowleft', 'a'])));
  });
});

describe('the scope held', () => {
  const sheets = new Sheets();
  const PHONE: Screen = { width: 844, height: 390, coarse: true };

  /** Console `seat`'s device with the other console empty, as the station modal shows it. */
  function held(seat: 'a' | 'b'): Styled[] {
    clockAt(MID);
    const puzzle = { ...seen(seat, MID, allMarked), vacant: [seat === 'a' ? 'b' : 'a'] as const };
    return elementsOf(
      renderToStaticMarkup(
        <NotepadContext value={{ noteDown: () => true, toggle: noop }}>
          <StationModal
            puzzle={{ ...puzzle, vacant: [...puzzle.vacant] }}
            run={deviceRun()}
            map={mapWith({})}
            edgework={null}
            mission={NO_CLOCK}
            send={noop}
            onStepBack={noop}
          />
        </NotepadContext>,
      ),
    );
  }

  /** How opaque `node` is drawn: the product of its own opacity and every ancestor's. */
  function opacityOf(node: Styled): number {
    let product = 1;
    for (let at: Styled | null = node; at !== null; at = at.parent) {
      const won = sheets.declared(at, 'opacity', PHONE)?.value;
      product *= won === undefined ? 1 : Number(won);
    }
    return product;
  }

  it('keeps every card fully readable while the Analysepult marks at leisure', () => {
    const cards = held('b').filter((n) => n.classes.includes('firewall-card'));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.map(opacityOf)).toEqual(cards.map(() => 1));
  });

  it('dims the Sperrpult’s points where they stand', () => {
    const blips = held('a').filter((n) => n.classes.includes('firewall-blip'));
    expect(blips.length).toBeGreaterThan(0);
    expect(blips.map(opacityOf)).toEqual(blips.map(() => 0.45));
  });

  it('sets its word over the lines’ numbers at the scope’s head, never across a card', () => {
    const nodes = held('b');
    const bar = nodes.find((n) => n.classes.includes('firewall-held'));
    const scope = nodes.find((n) => n.classes.includes('firewall-scope'));
    if (bar === undefined || scope === undefined) {
      throw new Error('expected the scope and its word');
    }
    expect(bar.text).toBe('HALT');
    // the bar's top where the numbers' row begins, as high as that row
    const value = (node: Styled | undefined, property: string, screen: Screen = PHONE) =>
      node === undefined ? undefined : sheets.declared(node, property, screen)?.value;
    for (const screen of [PHONE, { width: 1280, height: 720, coarse: false }, ...UPRIGHT]) {
      expect(value(bar, 'top', screen)).toBe('var(--pad-top)');
      expect(value(scope, 'padding', screen)).toMatch(/^var\(--pad-top\) /);
    }
    const numbers = nodes.find((n) => n.classes.includes('firewall-numbers'));
    expect(value(numbers, 'line-height')).toBe('1.2');
    expect(value(bar, 'line-height')).toBe('1.2');
    expect(value(bar, 'padding')).toBe('0');
  });
});

describe('the Freigabe', () => {
  const ready = (): Firewall => ({
    ...seen('a', 0),
    waiting: true,
    clock: { startedAt: T0, heldAt: T0 },
    packets: [],
  });
  const fault = { n: 4, kind: 'fault' as const, at: T0, line: null };

  it('opens a second after a fault, never while the Analysepult stands empty', () => {
    expect(view.armable(ready(), T0)).toBe(true);
    const called = { ...ready(), event: fault };
    expect(view.armable(called, T0 + 999)).toBe(false);
    expect(view.armable(called, T0 + 1000)).toBe(true);
    expect(view.ARM_LOCK_MS).toBe(1000);
    expect(view.armable({ ...ready(), vacant: ['b'] }, T0 + 5000)).toBe(false);
    expect(view.armable({ ...ready(), waiting: false }, T0)).toBe(false);
    // the device renders anew as it opens
    expect(view.nextChange(called, T0 + 200)).toBe(T0 + 1000);
  });

  it('stands as a key to press only while it is open', () => {
    clockAt(500);
    const shut = panel({ ...ready(), event: fault });
    expect(shut).toMatch(/<button[^>]*class="firewall-arm"[^>]*disabled/);
    clockAt(1500);
    expect(panel({ ...ready(), event: fault })).not.toMatch(
      /<button[^>]*class="firewall-arm"[^>]*disabled/,
    );
    expect(panel({ ...ready(), vacant: ['b'] })).toMatch(
      /<button[^>]*class="firewall-arm"[^>]*disabled/,
    );
  });
});
