import type { ConsoleId } from '@escapelab/core';

/** A console of a two-console station as the lab names it: „Pult A", „Pult B". */
export function consoleName(id: ConsoleId): string {
  return `Pult ${id.toUpperCase()}`;
}
