/**
 * How Ferret Flush's field fills the window (the reference's src/layout.js): as large as its
 * shape allows, with the slim bar of the HUD above it, as a column beside it (a phone held
 * sideways) or laid over the sky at its top, whichever leaves the larger field. The field stays
 * 1280 by 720 units inside, so no rule changes with the size of the screen.
 */
import { W, H } from './rules.js';

/** The height of one row of the HUD bar in CSS pixels. */
export const HUD_ROW = 52;
/** Below this many CSS pixels per unit the canvas menus would print text under 14 px. */
export const COMPACT_BELOW = 0.94;
/** On an upright window narrower than this the HUD has three rows: names, strip, buttons. */
export const NARROW = 640;
/** The width of the HUD as a column beside the field, in CSS pixels. */
export const SIDE = 160;

export type HudPlace = 'above' | 'side' | 'over';

export interface Fit {
  scale: number;
  width: number;
  height: number;
  hud: HudPlace;
  rows: number;
  compact: boolean;
}

/**
 * Where the field goes in a window of `width` by `height` CSS pixels: its scale, its size, the
 * place of the HUD ('above', 'side' or 'over') and whether the menus are compact page panels.
 */
export function fit(width: number, height: number): Fit {
  const rows = width < NARROW && height > width ? 3 : 1;
  const hud = HUD_ROW * rows;
  const over = Math.min(width / W, height / H);
  const above = Math.min(width / W, (height - hud) / H);
  const side = Math.min((width - SIDE) / W, height / H);
  const choices: readonly (readonly [HudPlace, number])[] = [
    ['above', above],
    ['side', side],
    ['over', over],
  ];
  const [place, best] = choices.find(([, scale]) => scale >= over * 0.97) ?? ['over', over];
  const scale = Math.max(0.1, best);
  return {
    scale,
    width: Math.floor(W * scale),
    height: Math.floor(H * scale),
    hud: place,
    rows,
    compact: scale < COMPACT_BELOW,
  };
}
