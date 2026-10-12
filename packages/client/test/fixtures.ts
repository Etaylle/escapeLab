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
