import { LABEL_BELOW, plateCaption, SIGN_LABEL_BELOW, textBox } from '../art.js';
import { coversArmed } from '../interact.js';
import { placeLabels, type PlacedLabels, type PropLabel } from '../labelLayout.js';
import { toScreen, type Frame } from './frame.js';

/**
 * The labels under the things a frame shows — plates, sources, the sign, the
 * parts lying about — placed clear of each other (labelLayout.ts): the world
 * pass draws each where it was placed (objects.ts), and the room names keep
 * off them (overlays.ts). A source, the sign or a part has its label only as
 * far as this player has found it (labelFade.ts): what is not found takes no
 * room. Worked out once a frame.
 */

/** The sign's label. */
export const SIGN_LABEL = 'LABORKENNUNG';
/** The sign as a find. */
export const SIGN = { of: 'sign' } as const;

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
  /** how far it shows, above 0: as far as its thing is found */
  alpha: number;
}

/** Each frame's labels as placed, worked out by the first pass that asks. */
const placed = new WeakMap<Frame, PlacedLabels>();

/** What of a frame's map lies about loose: neither carried nor put in, where light has fallen. */
export function looseAndShown(frame: Frame, item: Frame['map']['items'][number]): boolean {
  return !item.delivered && item.carriedBy === null && frame.light.shown(item.x, item.y);
}

/** Whether a source shows this frame: where light has fallen on it, or the crew knows of it. */
export function sourceShows(frame: Frame, manual: Frame['map']['manuals'][number]): boolean {
  return manual.known || frame.light.shown(manual.x, manual.y);
}

/** The labels of the plates where light has fallen: theirs whoever found what. */
function plateLabels(frame: Frame): Labelled[] {
  return frame.map.plates
    .filter((p) => frame.light.shown(p.x, p.y))
    .map((plate) => ({
      key: `plate:${plate.id}`,
      words: plateCaption(plate).toUpperCase(),
      x: plate.x + 0.5,
      y: plate.y + 0.5,
      below: LABEL_BELOW,
      rank: RANK.plate,
      alpha: 1,
    }));
}

/** The labels of the sources that show, as far as this player has found them. */
function sourceLabels(frame: Frame): Labelled[] {
  const { map } = frame;
  return map.manuals
    .filter((m) => sourceShows(frame, m))
    .map((manual) => ({
      key: `manual:${manual.id}`,
      words: manual.label,
      x: manual.x + 0.5,
      y: manual.y + 0.5,
      below: LABEL_BELOW,
      rank: coversArmed(map, manual) ? RANK.calling : RANK.quiet,
      alpha: frame.labels({ of: 'source', id: manual.id }),
    }));
}

/** The sign's label as far as this player has found it — whole once read — and the parts'. */
function signAndPartLabels(frame: Frame): Labelled[] {
  const { map } = frame;
  const sign = map.edgeworkSign;
  const signs: Labelled[] =
    sign === null
      ? []
      : [
          {
            key: 'sign',
            words: SIGN_LABEL,
            x: sign.x + 0.5,
            y: sign.y + 0.5,
            below: SIGN_LABEL_BELOW,
            rank: frame.signSeen ? RANK.quiet : RANK.calling,
            alpha: frame.signSeen ? 1 : frame.labels(SIGN),
          },
        ];
  const parts = map.items
    .filter((i) => looseAndShown(frame, i))
    .map((item) => ({
      key: `item:${item.id}`,
      words: item.label.toUpperCase(),
      x: item.x,
      y: item.y,
      below: LABEL_BELOW,
      rank: RANK.item,
      alpha: frame.labels({ of: 'item', id: item.id }),
    }));
  return [...signs, ...parts];
}

/**
 * The labels of the things `frame` shows, by key `plate:id`, `manual:id`, `sign`, `item:id`;
 * none for a thing not found yet.
 */
function labelled(frame: Frame): Labelled[] {
  return [...plateLabels(frame), ...sourceLabels(frame), ...signAndPartLabels(frame)].filter(
    (label) => label.alpha > 0,
  );
}

/** The labels of the things `frame` shows, placed clear of each other; `ctx` measures them. */
export function propLabels(ctx: CanvasRenderingContext2D, frame: Frame): PlacedLabels {
  const known = placed.get(frame);
  if (known !== undefined) {
    return known;
  }
  const labels = labelled(frame).map(
    ({ key, words, x, y, below, rank }): PropLabel => ({
      key,
      x,
      y,
      below,
      rank,
      ...textBox(ctx, words, frame.text.label),
    }),
  );
  const result = placeLabels(labels);
  placed.set(frame, result);
  return result;
}

/** Where `key`'s label goes in `labels`: the place it was given, null for none, else `own`. */
export function labelAt(labels: PlacedLabels, key: string, own: number): number | null {
  const spot = labels.spots.get(key);
  return spot === undefined ? own : spot;
}

/** A name this frame draws under a thing: its words, its thing's anchor in tiles and on screen. */
export interface ShownLabel {
  text: string;
  x: number;
  y: number;
  /** device pixels on the canvas */
  sx: number;
  sy: number;
  /** how far it shows, above 0 */
  alpha: number;
  /** its anchor lies on the canvas, below the objective bar */
  onScreen: boolean;
}

/** The names `frame` draws under things, for the walkthrough's count (`__escapelab.labels`). */
export function labelsShown(frame: Frame): ShownLabel[] {
  const { w, h, top } = frame.viewport;
  return labelled(frame).map((label) => {
    const [sx, sy] = toScreen(frame, label.x, label.y);
    const onScreen = sx >= 0 && sx <= w && sy >= top && sy <= h;
    return { text: label.words, x: label.x, y: label.y, sx, sy, alpha: label.alpha, onScreen };
  });
}
