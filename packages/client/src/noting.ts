import { createContext } from 'react';
import type { ManualBlock, ManualSection } from '@escapelab/core';

/**
 * Writing while reading: a rules list or a table at a source — or the Serverraum terminal's
 * code table — taken down into the notepad as plain text in one go, the station it belongs to
 * on its first line, so that nobody has to copy a table out by hand or photograph the page.
 */

/** What the notepad takes down whole: a rules list or a table. */
export type NotableBlock = Extract<ManualBlock, { kind: 'rules' | 'table' }>;

/**
 * The notepad within reach of a reading overlay or a device: what a „Notieren" control hands
 * it, and the pad shown or hidden — on a touch screen, where no N key is, by a tab.
 */
export interface NotepadHand {
  noteDown: (text: string) => void;
  toggle: () => void;
}

/** The notepad's hand where one is: in the game, at a source or a device; none elsewhere. */
export const NotepadContext = createContext<NotepadHand | null>(null);

/** The station a noted block comes from: its index in the mission and its title. */
export interface NotedStation {
  index: number;
  title: string;
}

/** Whether a printed block is one the notepad takes down. */
export function notable(block: ManualBlock): block is NotableBlock {
  return block.kind === 'rules' || block.kind === 'table';
}

/**
 * The first line of a noted block: the station by paragraph and title and the part of its
 * rules the block stands in — „§3 Signalkette · Legende" — the part left out where it only
 * says the title again.
 */
export function notedHead(station: NotedStation, part: string | null): string {
  const named = `§${station.index + 1} ${station.title}`;
  return part === null || part.trim() === '' || part === station.title
    ? named
    : `${named} · ${part}`;
}

/** The word a noted table's rows go by: „Zeile 1: rot · Kreis". */
const ROW = 'Zeile';

/**
 * A table's lines: its columns once, then a line a row. A table whose first column numbers its
 * rows („Zeile") gives each row its own number; any other is numbered from 1.
 */
function tableLines(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const numbered = head[0]?.trim().toLowerCase() === ROW.toLowerCase();
  const columns = numbered ? head.slice(1) : head;
  return [
    `Spalten: ${columns.join(' · ')}`,
    ...rows.map((row, i) => {
      const label = numbered ? (row[0] ?? String(i + 1)) : String(i + 1);
      const cells = numbered ? row.slice(1) : row;
      return `${ROW} ${label}: ${cells.join(' · ')}`;
    }),
  ];
}

/**
 * A rules list or a table as plain text under its first line (`notedHead`): rules numbered as
 * printed, a table as its columns and then its rows.
 */
export function notedText(head: string, block: NotableBlock): string {
  const lines =
    block.kind === 'rules'
      ? block.items.map((item, i) => `${i + 1}. ${item}`)
      : tableLines(block.head, block.rows);
  return [head, ...lines].join('\n');
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
 * pages — with the heading it stands under, so that the whole of it is noted from any of its
 * pages; null where none of the station's blocks holds it.
 */
export function ownerOf(
  manual: readonly ManualSection[],
  part: BlockPart,
): { heading: string; block: NotableBlock } | null {
  for (const section of manual) {
    const block = section.blocks.find(
      (candidate): candidate is NotableBlock => notable(candidate) && holds(candidate, part),
    );
    if (block !== undefined) {
      return { heading: section.heading, block };
    }
  }
  return null;
}

/** A part of a book's page as the notepad takes it: the whole block it is part of; null for none. */
export function notedPart(
  station: NotedStation & { manual: readonly ManualSection[] },
  part: BlockPart,
): string | null {
  const owner = ownerOf(station.manual, part);
  return owner === null ? null : notedText(notedHead(station, owner.heading), owner.block);
}
