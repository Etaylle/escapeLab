import { createContext } from 'react';
import type { Edgework, ManualBlock, ManualSection } from '@escapelab/core';

/**
 * Writing while reading: what a source, the Serverraum's terminal, the sign or a note of the
 * last shift holds, taken down into the notepad in one go — each a capture of its own under a
 * line naming where it comes from and what („Klemmbrett · Legende", „Terminal · Dienste"), at
 * most eleven lines under it, holding the data a player needs there and nothing else: a table's
 * columns aligned under their names, a long list of pairs two to a line — the Morsetafel only
 * with the letters that tell the words of its Frequenztabelle apart —, a rules list numbered as
 * printed, the Laborkennung on one line, a note as it was written. The notepad keeps one capture
 * of each: taken again, it replaces the first and says so (notes.ts `withCapture`).
 */

/** What the notepad takes down whole from a printed page: a rules list or a table. */
export type NotableBlock = Extract<ManualBlock, { kind: 'rules' | 'table' }>;

/** How a capture's lines are set: a table's columns aligned and never wrapped, or running text. */
export type CaptureForm = 'table' | 'text';

/** A capture as the notepad takes it: where it comes from and what, and the lines under that. */
export interface Capture {
  /** what tells one capture from another: a second one of the same replaces the first */
  key: string;
  /** the line naming where it comes from and what: „Klemmbrett · Legende" */
  head: string;
  /** the lines under the head, as its template sets them */
  lines: string[];
  form: CaptureForm;
}

/** A capture before the place it is taken at names it: the part of the place, and its lines. */
export interface Taken {
  /** what it is of the place — „Legende", „Dienste", „Laborkennung" */
  part: string;
  /** what tells it from the place's other parts */
  key: string;
  lines: string[];
  form: CaptureForm;
}

/** Where captures are taken — a source, the terminal, the sign, a note — as the lab names it. */
export interface Place {
  /** what tells it from every other place in the lab */
  id: string;
  /** „Klemmbrett", „Terminal", „Schild" */
  name: string;
}

/** How many lines a capture holds under its head, at most: twelve with the head. */
export const CAPTURE_LINES = 11;

/**
 * How wide a table may run aligned, in characters: what the notepad holds in the world's corner
 * on a phone 420 px wide, at 15 px a character of the pencil's. A wider one — a table of
 * sentences — is set as running text.
 */
export const TABLE_WIDTH = 38;

/** `taken` as captured at `place`, under the line naming both; under its part alone at none. */
export function captureAt(place: Place | null, taken: Taken): Capture {
  return {
    key: `${place?.id ?? '-'}/${taken.key}`,
    head: place === null ? taken.part : `${place.name} · ${taken.part}`,
    lines: taken.lines,
    form: taken.form,
  };
}

/**
 * The notepad within reach of a reading overlay or a device: what a „Notieren" control hands
 * it — true where it replaced a capture of the same — and the pad shown or hidden, on a touch
 * screen, where no N key is, by a tab.
 */
export interface NotepadHand {
  noteDown: (capture: Capture) => boolean;
  toggle: () => void;
}

/** The notepad's hand where one is: in the game, at a source or a device; none elsewhere. */
export const NotepadContext = createContext<NotepadHand | null>(null);

/** The place captures are taken at, where the page does not name its own: an open source. */
export const NotingPlace = createContext<Place | null>(null);

/** A label on the map as a name: „KLEMMBRETT" is the Klemmbrett, „SÜD-FLUR" the Süd-Flur. */
export function placeName(label: string): string {
  const capital = (_: string, before: string, first: string): string =>
    before + first.toUpperCase();
  return label.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, capital);
}

/** The station a printed block is read for: its index in the mission. */
export interface NotedStation {
  index: number;
}

/** Whether a printed block is one the notepad takes down. */
export function notable(block: ManualBlock): block is NotableBlock {
  return block.kind === 'rules' || block.kind === 'table';
}

/**
 * Rows of cells in columns: each padded to its column's widest, `gap` between — two blanks
 * unless told otherwise — none after.
 */
export function alignedLines(rows: readonly (readonly string[])[], gap = '  '): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join(gap)
      .trimEnd(),
  );
}

/** Pairs two to a line, the first half down the left, the rest down the right, aligned. */
function twoWide(pairs: readonly (readonly [string, string])[]): string[] {
  const half = Math.ceil(pairs.length / 2);
  const right = pairs.slice(half);
  return alignedLines(pairs.slice(0, half).map((pair, i) => [...pair, ...(right[i] ?? [])]));
}

/**
 * A table of pairs: the rows of a table of two columns, or of one printed with its pairs side
 * by side (Buchstabe, Morse, Buchstabe, Morse) — the left ones first; null for any other.
 */
function pairsOf(block: NotableBlock & { kind: 'table' }): [string, string][] | null {
  const { head, rows } = block;
  if (head.length === 2) {
    return rows.map(([key = '', value = '']) => [key, value]);
  }
  const sideBySide = head.length === 4 && head[0] === head[2] && head[1] === head[3];
  if (!sideBySide) {
    return null;
  }
  const left = rows.map(([key = '', value = '']): [string, string] => [key, value]);
  const right = rows.flatMap(([, , key, value]): [string, string][] =>
    key === undefined || key === '' ? [] : [[key, value ?? '']],
  );
  return [...left, ...right];
}

/** The words of a station's word table — the Funkfeuer's Frequenztabelle („Wort"); none without. */
function tableWords(manual: readonly ManualSection[]): string[] {
  const table = manual
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === 'table' && block.head[0] === 'Wort');
  return table?.kind === 'table' ? table.rows.map(([word = '']) => word) : [];
}

/** The shortest start that tells every one of `words` apart: three letters for the Funkfeuer's. */
function tellingLength(words: readonly string[]): number {
  const longest = Math.max(0, ...words.map((word) => word.length));
  for (let length = 1; length < longest; length++) {
    if (new Set(words.map((word) => word.slice(0, length))).size === words.length) {
      return length;
    }
  }
  return longest;
}

/**
 * The pairs of a table of letters a player needs: where the station's rules hold words
 * (`tableWords`), only the letters their telling starts are made of — every word is known by
 * them (the Funkfeuer: „Die ersten drei Buchstaben bestimmen das Wort") —; all of them
 * otherwise.
 */
function lettersNeeded(
  pairs: [string, string][],
  manual: readonly ManualSection[],
): [string, string][] {
  const words = tableWords(manual);
  const letters = pairs.every(([key]) => /^\p{Lu}$/u.test(key));
  if (words.length === 0 || !letters) {
    return pairs;
  }
  const length = tellingLength(words);
  const used = new Set(words.flatMap((word) => [...word.slice(0, length)]));
  return pairs.filter(([letter]) => used.has(letter));
}

/** A rules list's lines, numbered as printed. */
export function numbered(items: readonly string[]): string[] {
  return items.map((item, i) => `${i + 1}. ${item}`);
}

/** `row` without its cells at `drop`. */
const without = (row: readonly string[], drop: readonly number[]): string[] =>
  row.filter((_, i) => !drop.includes(i));

/**
 * A table whose rows come in pairs alike but in one column of two values and in the last —
 * the Kippschalterbank's Stellungstabelle, a switch with the star and one without —, set a pair
 * a row: the last column once for either value („Stern nein", „Stern ja"). Null for any other.
 */
function pairedRows(block: NotableBlock & { kind: 'table' }): string[][] | null {
  const { head, rows } = block;
  const last = head.length - 1;
  if (head.length < 3 || rows.length < 2 || rows.length % 2 !== 0) {
    return null;
  }
  const pairs = rows.flatMap((one, i) => (i % 2 === 0 ? [[one, rows[i + 1] ?? []] as const] : []));
  const [first = [], second = []] = rows;
  /** Whether rows pair on column `c`: its two values in turn, the rest alike but the last. */
  const pairsOn = (c: number): boolean =>
    first[c] !== second[c] &&
    pairs.every(
      ([one, other]) =>
        one[c] === first[c] &&
        other[c] === second[c] &&
        same(without(one, [c, last]), without(other, [c, last])),
    );
  const column = head.slice(0, last).findIndex((_, c) => pairsOn(c));
  if (column < 0) {
    return null;
  }
  const named = (row: readonly string[]): string => `${head[column] ?? ''} ${row[column] ?? ''}`;
  return [
    [...without(head, [column, last]), named(first), named(second)],
    ...pairs.map(([one, other]) => [
      ...without(one, [column, last]),
      one[last] ?? '',
      other[last] ?? '',
    ]),
  ];
}

/**
 * A table's rows under its head as the pad sets them: every column as printed — the Signalkette
 * legend's two „Muster" too, so that either console finds its row by a sign's pattern at once —
 * or, too long for a capture, a pair of rows a row where they pair (`pairedRows`).
 */
function tableRows(block: NotableBlock & { kind: 'table' }): (readonly string[])[] {
  const printed = [block.head, ...block.rows];
  return printed.length > CAPTURE_LINES ? (pairedRows(block) ?? printed) : printed;
}

/** `rows` aligned two blanks apart, else one, within the pad (`TABLE_WIDTH`); null for neither. */
function fittedLines(rows: readonly (readonly string[])[]): string[] | null {
  for (const gap of ['  ', ' ']) {
    const lines = alignedLines(rows, gap);
    if (lines.every((line) => line.length <= TABLE_WIDTH)) {
      return lines;
    }
  }
  return null;
}

/**
 * A printed block's lines by its template: a rules list numbered; a table of more pairs than a
 * capture has lines two to a line (the Frequenztabelle; the Morsetafel by the letters needed);
 * any other table its columns aligned under their names (the Netzplan; the Signalkette's legend,
 * its five columns one blank apart to stay within the pad), its rows paired where it runs too
 * long (`tableRows`) — or, where even one blank apart runs wider than the pad (`TABLE_WIDTH`), a
 * table of sentences, a line a row, its cells parted by „ · " (the Serverraum's codes).
 */
function blockLines(
  block: NotableBlock,
  manual: readonly ManualSection[],
): Pick<Taken, 'lines' | 'form'> {
  if (block.kind === 'rules') {
    return { lines: numbered(block.items), form: 'text' };
  }
  const pairs = pairsOf(block);
  const needed = pairs === null ? null : lettersNeeded(pairs, manual);
  if (needed !== null && needed.length > CAPTURE_LINES) {
    return { lines: twoWide(needed), form: 'table' };
  }
  const rows = tableRows(block);
  const lines = fittedLines(rows);
  return lines !== null
    ? { lines, form: 'table' }
    : { lines: rows.map((row) => row.join(' · ')), form: 'text' };
}

/**
 * What a block is of its section: the section's heading — „Legende", „Schnittfolge" — where it
 * is the section's only one the notepad takes; among several, a table by its first column's
 * name („Code", „Mit Vokal") and a rules list as „Regeln".
 */
function partOf(section: ManualSection, block: NotableBlock): string {
  if (section.blocks.filter(notable).length <= 1) {
    return section.heading;
  }
  return block.kind === 'rules' ? 'Regeln' : (block.head[0] ?? section.heading);
}

/** A printed block of a station's rules (`manual`) as the notepad takes it at a source. */
export function blockTaken(
  station: NotedStation,
  manual: readonly ManualSection[],
  section: ManualSection,
  block: NotableBlock,
): Taken {
  const part = partOf(section, block);
  return { part, key: `${station.index}/${part}`, ...blockLines(block, manual) };
}

/** A part of a block on a book's page: a run of a rules list's items, or of a table's rows. */
export type BlockPart =
  | { kind: 'rules'; items: readonly string[]; start: number }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] };

const same = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Whether `part` is a run of `block`'s items or rows (pages.ts breaks the long ones). */
function holds(block: NotableBlock, part: BlockPart): boolean {
  if (block.kind === 'rules' && part.kind === 'rules') {
    const from = part.start - 1;
    return same(block.items.slice(from, from + part.items.length), part.items);
  }
  if (block.kind === 'table' && part.kind === 'table' && same(block.head, part.head)) {
    return block.rows.some((_, from) =>
      same(block.rows.slice(from, from + part.rows.length), part.rows),
    );
  }
  return false;
}

/**
 * The printed block a book's page holds a part of — a rules list or a table broken across
 * pages — with the section it stands in, so that the whole of it is noted from any of its
 * pages; null where none of the station's blocks holds it.
 */
export function ownerOf(
  manual: readonly ManualSection[],
  part: BlockPart,
): { section: ManualSection; block: NotableBlock } | null {
  for (const section of manual) {
    const block = section.blocks.find(
      (candidate): candidate is NotableBlock => notable(candidate) && holds(candidate, part),
    );
    if (block !== undefined) {
      return { section, block };
    }
  }
  return null;
}

/** A part of a book's page as the notepad takes it: the whole block it is of; null for none. */
export function notedPart(
  station: NotedStation & { manual: readonly ManualSection[] },
  part: BlockPart,
): Taken | null {
  const owner = ownerOf(station.manual, part);
  return owner === null ? null : blockTaken(station, station.manual, owner.section, owner.block);
}

/** The sign's place: the Laborkennung is read there. */
export const SIGN: Place = { id: 'schild', name: 'Schild' };

/**
 * The Laborkennung on one line, by the names the rules give it: the serial, the control lamps
 * lit or not, the emergency cells — „UZKM9-8 · FRQ an, CAR aus, SIG an · 3 Notstromzellen".
 */
export function edgeworkTaken(edgework: Edgework): Taken {
  const lamps = edgework.indicators.map((lamp) => `${lamp.id} ${lamp.lit ? 'an' : 'aus'}`);
  const line = [edgework.serial, lamps.join(', '), `${edgework.cells} Notstromzellen`].join(' · ');
  return { part: 'Laborkennung', key: 'laborkennung', lines: [line], form: 'text' };
}

/** The notes of the last shift on a station, as they were written, one a line. */
export function shiftNotesTaken(station: NotedStation, notes: readonly string[]): Taken {
  return {
    part: 'Notizen der letzten Schicht',
    key: `${station.index}/notizen`,
    lines: [...notes],
    form: 'text',
  };
}

/** A note of the last shift pinned up, as it was written, under the room it hangs in. */
export function pinnedNoteTaken(note: { index: number; text: string }, room: string | null): Taken {
  return {
    part: room === null ? 'Notiz' : placeName(room),
    key: `notiz/${note.index}`,
    lines: [note.text],
    form: 'text',
  };
}
