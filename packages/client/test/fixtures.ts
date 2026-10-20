import type { MapView } from '@escapelab/core';

/** An empty 20×13 lab; every test adds what it needs. */
export function mapWith(parts: Partial<MapView>): MapView {
  return {
    width: 20,
    height: 13,
    tiles: [],
    yourSpawn: { x: 1, y: 1 },
    doors: [],
    plates: [],
    stations: [],
    manuals: [],
    edgeworkSign: null,
    lamps: [],
    labels: [],
    litRooms: [],
    exit: null,
    items: [],
    sabotage: null,
    ...parts,
  };
}

export type Manual = MapView['manuals'][number];
export type Plate = MapView['plates'][number];
export type Item = MapView['items'][number];

/**
 * Markup with every icon (screens/Icon.tsx) written as its name in brackets,
 * „[check]", so that what a screen says reads in one line.
 */
export function iconsAsWords(html: string): string {
  return html.replace(/<svg class="icon icon-([a-z-]+)"[^>]*>.*?<\/svg>/g, '[$1]');
}

/** A pictograph the platform draws in its own style: an emoji, or a symbol used as one. */
export const PICTOGRAPH = /[\p{Extended_Pictographic}✓✗⧉⬢⏻]/u;
