import { overlaps, type Box } from './viewport.js';

/**
 * The labels under the lab's things, kept apart. Each thing prints its name
 * under it in the world's text (art.ts); where two names would lie on each
 * other — on a phone „HALTEN · TÜR" under the Flur's plate ran into
 * „KLEMMBRETT" under the clipboard beside it — the one that matters less moves
 * a line further down, and where that line is taken too it is left out: the
 * thing itself, its glow and the E prompt still say what it is. Pure; tiles.
 */

/** A label under a thing, before it is placed; tiles. */
export interface PropLabel {
  key: string;
  /** the thing's anchor, the label's middle */
  x: number;
  y: number;
  /** how far under the anchor the label's top hangs where nothing is in its way */
  below: number;
  width: number;
  height: number;
  /** how much it matters now: a higher one keeps its place, a lower one gives way */
  rank: number;
}

/** Room kept between two labels, tiles. */
const LABEL_AIR = 0.04;
/** The places a label may take: its own, then one line further down. */
const LINES = 2;

/** The box `label` covers with its top `top` under its anchor, its air round it. */
function boxOf(label: PropLabel, top: number): Box {
  const half = label.width / 2 + LABEL_AIR / 2;
  return {
    left: label.x - half,
    top: label.y + top - LABEL_AIR / 2,
    right: label.x + half,
    bottom: label.y + top + label.height + LABEL_AIR / 2,
  };
}

/** The labels as placed: where each one's top hangs, by key, and the boxes they cover. */
export interface PlacedLabels {
  /** the top under its thing's anchor, tiles; null for a label left out */
  spots: Map<string, number | null>;
  /** what the placed labels cover, their air round them, tiles */
  boxes: Box[];
}

/**
 * Where each label's top hangs under its thing's anchor. The labels go in
 * order of rank, ties in the order given, and each takes the first of its
 * places that no label placed before it covers; one with none left is left
 * out.
 */
export function placeLabels(labels: readonly PropLabel[]): PlacedLabels {
  const order = labels
    .map((label, i) => ({ label, i }))
    .sort((a, b) => b.label.rank - a.label.rank || a.i - b.i);
  const boxes: Box[] = [];
  const spots = new Map<string, number | null>();
  for (const { label } of order) {
    let spot: number | null = null;
    for (let line = 0; line < LINES && spot === null; line++) {
      // A line further down leaves the air of both labels between them, and as much again.
      const top = label.below + line * (label.height + 2 * LABEL_AIR);
      const box = boxOf(label, top);
      if (!boxes.some((other) => overlaps(box, other))) {
        boxes.push(box);
        spot = top;
      }
    }
    spots.set(label.key, spot);
  }
  return { spots, boxes };
}
