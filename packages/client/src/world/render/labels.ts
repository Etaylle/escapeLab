import { LABEL_BELOW, plateCaption, SIGN_LABEL_BELOW, textBox } from '../art.js';
import { coversArmed } from '../interact.js';
import { placeLabels, type PlacedLabels, type PropLabel } from '../labelLayout.js';
import type { Frame } from './frame.js';

/**
 * The labels under the things a frame shows — plates, sources, the sign, the
 * parts lying about — placed clear of each other (labelLayout.ts): the world
 * pass draws each where it was placed (objects.ts), and the room names keep
 * off them (overlays.ts). Worked out once a frame.
 */

/** The sign's label. */
export const SIGN_LABEL = 'LABORKENNUNG';

/**
 * How much a label matters: what calls for the crew now — the source of the armed station,
 * the sign not yet read — then the plates and the parts lying about, then the rest.
 */
const RANK = { calling: 3, plate: 2, item: 2, quiet: 1 } as const;

/** A label as the layout takes it, before its size is measured. */
interface Labelled {
  key: string;
  words: string;
  x: number;
  y: number;
  below: number;
  rank: number;
}

/** Each frame's labels as placed, worked out by the first pass that asks. */
const placed = new WeakMap<Frame, PlacedLabels>();

/** What of a frame's map lies about loose: neither carried nor put in, where light has fallen. */
export function looseAndShown(frame: Frame, item: Frame['map']['items'][number]): boolean {
  return !item.delivered && item.carriedBy === null && frame.light.shown(item.x, item.y);
}

/** The labels of the things `frame` shows, by key `plate:id`, `manual:id`, `sign`, `item:id`. */
function labelled(frame: Frame): Labelled[] {
  const { map, light } = frame;
  const shown: Labelled[] = [];
  for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
    const words = plateCaption(plate).toUpperCase();
    const at = { x: plate.x + 0.5, y: plate.y + 0.5, below: LABEL_BELOW, rank: RANK.plate };
    shown.push({ key: `plate:${plate.id}`, words, ...at });
  }
  for (const manual of map.manuals) {
    const rank = coversArmed(map, manual) ? RANK.calling : RANK.quiet;
    const at = { x: manual.x + 0.5, y: manual.y + 0.5, below: LABEL_BELOW, rank };
    shown.push({ key: `manual:${manual.id}`, words: manual.label, ...at });
  }
  const sign = map.edgeworkSign;
  if (sign !== null) {
    const rank = frame.signSeen ? RANK.quiet : RANK.calling;
    const at = { x: sign.x + 0.5, y: sign.y + 0.5, below: SIGN_LABEL_BELOW, rank };
    shown.push({ key: 'sign', words: SIGN_LABEL, ...at });
  }
  for (const item of map.items.filter((i) => looseAndShown(frame, i))) {
    const at = { x: item.x, y: item.y, below: LABEL_BELOW, rank: RANK.item };
    shown.push({ key: `item:${item.id}`, words: item.label.toUpperCase(), ...at });
  }
  return shown;
}

/** The labels of the things `frame` shows, placed clear of each other; `ctx` measures them. */
export function propLabels(ctx: CanvasRenderingContext2D, frame: Frame): PlacedLabels {
  const known = placed.get(frame);
  if (known !== undefined) {
    return known;
  }
  const labels = labelled(frame).map(({ words, ...label }): PropLabel => ({
    ...label,
    ...textBox(ctx, words, frame.text.label),
  }));
  const result = placeLabels(labels);
  placed.set(frame, result);
  return result;
}

/** Where `key`'s label goes in `labels`: the place it was given, null for none, else `own`. */
export function labelAt(labels: PlacedLabels, key: string, own: number): number | null {
  const spot = labels.spots.get(key);
  return spot === undefined ? own : spot;
}
