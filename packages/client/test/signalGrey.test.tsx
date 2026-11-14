import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  greySignLabel,
  SIGNAL_PATTERNS,
  TOKENS,
  type ConsoleId,
  type GreySign,
  type PuzzleView,
  type SignalToken,
} from '@escapelab/core';
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';
import { elementsOf, Sheets, type Screen } from './cascade.js';
import { deviceRun, NO_CLOCK, stationView } from './fixtures.js';

/**
 * The Signalkette's display without colour (core puzzles/signal.ts `greyFrom`): from that
 * stage the signs come up grey, the pattern the one thing that tells them, so it has to read
 * at a glance — every cell of it 18 px or more, a readout's least size, at a laptop's
 * 1280×720 and on a phone held sideways, its ink 4.5:1 against the grey — and nothing of the
 * colour may reach the page: no word, no hue, no sign's id. The device says on its status
 * strip that its display runs without colour; the receiving console's keys stay as they are.
 */

type SignalSeen = Extract<PuzzleView, { kind: 'signal' }>;

/**
 * Stage 1 of a Signalkette with the legend whose display is grey from the first stage — console
 * a sends it — at console `seat`, or as the audience sees it with `seat` null.
 */
function greyAt(seat: ConsoleId | null, fields: Record<string, unknown> = {}): SignalSeen {
  const def = { type: 'signal', id: 'signal', title: 'Signalkette', legend: true, greyFrom: 1 };
  const view = stationView({ ...def, ...fields }, { seat, who: seat === null ? null : 'p1' });
  if (view.kind !== 'signal' || !view.grey) {
    throw new Error('expected a grey stage of the Signalkette');
  }
  return view;
}

function panel(puzzle: PuzzleView): string {
  return renderToStaticMarkup(
    <PuzzlePanel puzzle={puzzle} run={deviceRun()} send={() => undefined} mission={NO_CLOCK} />,
  );
}

/** `token` as a display without colour shows it. */
function greyOf(token: SignalToken): GreySign {
  const [colour = 'rot', shape] = token.split('-') as [keyof typeof SIGNAL_PATTERNS, string];
  return { shape, pattern: SIGNAL_PATTERNS[colour] } as GreySign;
}

/** The sending console in a grey stage with all twelve signs on its strip, once each. */
const twelve = (): SignalSeen => ({ ...greyAt('a'), sequence: TOKENS.map(greyOf), length: 12 });

/** The device's own part of the panel: the Signalkette's markup, the frame round it left out. */
const ownPart = (html: string): string => html.slice(html.indexOf('<div class="signal">'));

/** Every grey sign drawn in `html`: what a screen reader hears, and what it is drawn of. */
function greySigns(html: string): { label: string; inner: string }[] {
  const glyph =
    /<svg class="signal-glyph signal-glyph--grey"[^>]*aria-label="([^"]*)">(.*?)<\/svg>/g;
  return [...html.matchAll(glyph)].map((m) => ({ label: m[1] ?? '', inner: m[2] ?? '' }));
}

/** The status strip's backlit legends: each group's engraving and the legend that burns. */
function modes(html: string): [string, string][] {
  const group =
    /<div class="signal-mode"><span class="device-engraving">([^<]*)<\/span>(.*?)<\/div>/g;
  return [...html.matchAll(group)].map((m) => [
    m[1] ?? '',
    /signal-legend--lit">([^<]*)</.exec(m[2] ?? '')?.[1] ?? '',
  ]);
}

/** A colour named, or one of the four drawn: what a grey stage's device never shows. */
const COLOUR_WORD =
  /\b(rot|rote[mnrs]?|blau|blaue[mnrs]?|grün|grüne[mnrs]?|gruen|gelb|gelbe[mnrs]?)\b/i;
const FOUR = ['#ef4444', '#3b82f6', '#22c55e', '#eab308'];

describe('a display without colour', () => {
  it('draws each sign grey, by its form and pattern, as a screen reader hears it too', () => {
    const sending = greyAt('a');
    const html = panel(sending);
    const signs = greySigns(html);
    const said = (sending.sequence ?? []).map((sign) =>
      typeof sign === 'string' ? sign : greySignLabel(sign),
    );
    expect(signs.map(({ label }) => label)).toEqual(said);
    expect(html).toContain('<ol class="signal-strip signal-strip--grey"');
    expect(html).not.toMatch(/<svg class="signal-glyph"/);
    // One grey for every form, its pattern's marks over it; a plain sign has none.
    const fills = new Set(signs.map(({ inner }) => /fill="(#[0-9a-f]{6})"/.exec(inner)?.[1]));
    expect(fills.size).toBe(1);
    for (const { label, inner } of signs) {
      const pattern = label.split(', ')[1];
      const marks = /signal-marks--([a-z]+)/.exec(inner)?.[1] ?? 'glatt';
      expect({ glatt: 'glatt', dots: 'Punkte', stripes: 'Streifen', ring: 'Ring' }[marks]).toBe(
        pattern,
      );
    }
  });

  it('lets no colour reach the page: no word, none of the four, no sign’s id', () => {
    const shown = [greyAt('a'), greyAt('a', { fleetingFrom: 1 }), greyAt(null), twelve()];
    for (const puzzle of shown) {
      const html = ownPart(panel(puzzle));
      expect(html, `${puzzle.role ?? 'audience'}`).not.toMatch(COLOUR_WORD);
      expect(html).not.toContain('data-token');
      for (const hex of FOUR) {
        expect(html).not.toContain(hex);
      }
      // Every colour the device's own part draws in is a grey: red, green and blue alike.
      for (const [, r, g, b] of html.matchAll(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/g)) {
        expect(r === g && g === b, `#${r}${g}${b}`).toBe(true);
      }
    }
  });

  it('says on the status strip that the display runs without colour, where it shows signs', () => {
    expect(modes(panel(greyAt('a')))).toEqual([
      ['BETRIEB', 'SENDEN'],
      ['ANZEIGE', 'FARBLOS'],
    ]);
    expect(modes(panel(greyAt(null)))).toEqual([
      ['SENDET', 'PULT A'],
      ['ANZEIGE', 'FARBLOS'],
    ]);
    // In colour, the legend is not there at all; nor at the console that takes the stage in.
    expect(modes(panel({ ...greyAt('a'), grey: false }))).toEqual([['BETRIEB', 'SENDEN']]);
    expect(modes(panel(greyAt('b')))).toEqual([['BETRIEB', 'EINGABE']]);
  });

  it('keeps the receiving console as it is, keys and all', () => {
    const receiving = greyAt('b');
    expect(receiving.role).toBe('receiver');
    expect(panel(receiving)).toBe(panel({ ...receiving, grey: false }));
  });

  it('shows a fleeting grey stage one sign at a time, its dark places as large', () => {
    const html = panel(greyAt('a', { fleetingFrom: 1 }));
    expect(html).toContain('<ol class="signal-strip signal-strip--fleeting signal-strip--grey"');
    expect(greySigns(html)).toHaveLength(1);
    const dark = elementsOf(html).filter((node) => node.classes.includes('signal-glyph--dark'));
    expect(dark).toHaveLength(3);
    for (const { screen } of SCREENS) {
      expect(dark.map((node) => sheets.length(node, 'width', screen))).toEqual([64, 64, 64]);
    }
  });
});

// --- what a pattern measures on a screen ------------------------------------------------------

const sheets = new Sheets();

/** The screens a grey sign is measured on: the two the rules name first, then the others. */
const SCREENS: { name: string; screen: Screen }[] = [
  { name: '1280×720', screen: { width: 1280, height: 720, coarse: false } },
  { name: 'a phone held sideways, 932×430', screen: { width: 932, height: 430, coarse: true } },
  { name: '1440×820', screen: { width: 1440, height: 820, coarse: false } },
  { name: 'a phone held sideways, 844×390', screen: { width: 844, height: 390, coarse: true } },
  { name: 'a phone held upright, 420×760', screen: { width: 420, height: 760, coarse: true } },
];

/** A pattern's cell, the least that has to read at a glance: a readout's size (art bible). */
const CELL_PX = 18;
/** A dot across, a stripe's or the ring's width: thick enough not to blur into the grey. */
const MARK_PX = 4;

type Point = [number, number];
type Form = 'kreis' | 'dreieck' | 'quadrat';

const FORMS: Record<string, Form> = { Kreis: 'kreis', Dreieck: 'dreieck', Quadrat: 'quadrat' };

/** How far `p` lies inside a form of the 24-unit glyph, in units: negative outside. */
function depthIn(form: Form, [x, y]: Point): number {
  if (form === 'kreis') {
    return 9 - Math.hypot(x - 12, y - 12);
  }
  if (form === 'quadrat') {
    return Math.min(x - 3.5, 20.5 - x, y - 3.5, 20.5 - y);
  }
  // The triangle's three edges, each as the distance from it towards the inside.
  const corners: Point[] = [
    [12, 2.5],
    [22, 20],
    [2, 20],
  ];
  return Math.min(
    ...corners.map(([ax, ay], i) => {
      const [bx, by] = corners[(i + 1) % 3] ?? [ax, ay];
      return ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay);
    }),
  );
}

const numbers = (text: string, names: string[]): number[] =>
  names.map((name) => Number(new RegExp(`\\b${name}="([\\d.]+)"`).exec(text)?.[1] ?? NaN));

/** What a sign's marks measure, in units: each cell, each mark's width, and how far in it is. */
interface Measured {
  cells: number[];
  widths: number[];
  /** how far the least of its marks keeps in from the form's edge */
  clear: number;
  count: number;
}

function dotsOf(form: Form, marks: string): Measured {
  const dots = [...marks.matchAll(/<circle [^>]*>/g)].map((m) => numbers(m[0], ['cx', 'cy', 'r']));
  const near = dots.map(([x = 0, y = 0], i) =>
    Math.min(...dots.filter((_, j) => j !== i).map(([u = 0, v = 0]) => Math.hypot(x - u, y - v))),
  );
  return {
    cells: near,
    widths: dots.map(([, , r = 0]) => 2 * r),
    clear: Math.min(...dots.map(([x = 0, y = 0, r = 0]) => depthIn(form, [x, y]) - r)),
    count: dots.length,
  };
}

function stripesOf(form: Form, marks: string): Measured {
  const width = numbers(marks, ['stroke-width'])[0] ?? 0;
  const lines = [...marks.matchAll(/<line [^>]*>/g)].map((m) =>
    numbers(m[0], ['x1', 'y1', 'x2', 'y2']),
  );
  // Each stripe lies on x + y = s, rising to the right; neighbours (s₂ − s₁) / √2 apart.
  const sums = lines.map(([x1 = 0, y1 = 0]) => x1 + y1).sort((a, b) => a - b);
  const ends = lines.flatMap(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]): Point[] => [
    [x1, y1],
    [x2, y2],
  ]);
  return {
    cells: sums.slice(1).map((s, i) => (s - (sums[i] ?? 0)) / Math.SQRT2),
    widths: [width],
    clear: Math.min(...ends.map((end) => depthIn(form, end) - width / 2)),
    count: lines.length,
  };
}

function ringOf(form: Form, marks: string): Measured {
  const [cx = 0, cy = 0, r = 0, width = 0] = numbers(marks, ['cx', 'cy', 'r', 'stroke-width']);
  return {
    cells: [2 * r + width],
    widths: [width],
    clear: depthIn(form, [cx, cy]) - r - width / 2,
    count: 1,
  };
}

/** What the marks of a grey sign measure, read off its markup; null for a plain one. */
function measured(label: string, inner: string): Measured | null {
  const [formWord = '', patternWord] = label.split(', ');
  const form = FORMS[formWord];
  if (form === undefined) {
    throw new Error(`"${label}" names no form`);
  }
  const marks = inner.slice(inner.indexOf('signal-marks'));
  switch (patternWord) {
    case 'Punkte':
      return dotsOf(form, marks);
    case 'Streifen':
      return stripesOf(form, marks);
    case 'Ring':
      return ringOf(form, marks);
    default:
      expect(inner, label).not.toContain('signal-marks');
      return null;
  }
}

/** WCAG 2.2's relative luminance of a colour written #rrggbb. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

describe('a grey sign’s pattern', () => {
  const html = panel(twelve());
  const signs = greySigns(html);
  const glyphs = elementsOf(html).filter((node) => node.classes.includes('signal-glyph--grey'));

  it('comes in all four patterns on all three forms, each counted out', () => {
    expect(signs).toHaveLength(12);
    expect(glyphs).toHaveLength(12);
    for (const { label, inner } of signs) {
      const marks = measured(label, inner);
      const pattern = label.split(', ')[1];
      // Several dots, two stripes at least, one ring: none of them mistaken for another.
      const least = { Punkte: 4, Streifen: 2, Ring: 1 }[pattern ?? ''] ?? 0;
      expect(marks?.count ?? 0, label).toBeGreaterThanOrEqual(least);
    }
  });

  it.each(SCREENS)('measures each cell 18 px and more, each mark bold, on $name', ({ screen }) => {
    const sizes = new Set(glyphs.map((node) => sheets.length(node, 'width', screen)));
    expect([...sizes]).toEqual([64]);
    const px = 64 / 24;
    for (const { label, inner } of signs) {
      const marks = measured(label, inner);
      if (marks === null) {
        continue;
      }
      expect(Math.min(...marks.cells) * px, `${label}: a cell`).toBeGreaterThanOrEqual(CELL_PX);
      expect(Math.min(...marks.widths) * px, `${label}: a mark`).toBeGreaterThanOrEqual(MARK_PX);
    }
  });

  it('keeps every mark half a unit clear of its form’s edge', () => {
    for (const { label, inner } of signs) {
      const marks = measured(label, inner);
      expect(marks === null || marks.clear >= 0.5, `${label}: ${marks?.clear}`).toBe(true);
    }
  });

  it('prints the pattern at 4.5:1 or more against the grey', () => {
    for (const { label, inner } of signs.filter(({ label: l }) => !l.endsWith('glatt'))) {
      const [grey = '', ink = ''] = [...inner.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map(
        (m) => m[1],
      );
      expect(contrast(grey, ink), `${label}: ${grey} against ${ink}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
