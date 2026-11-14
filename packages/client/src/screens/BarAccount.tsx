import { useEffect, useRef } from 'react';
import type { AccountView } from '@escapelab/core';
import { lastColor } from '../pass.js';
import { drawScientist } from '../world/art.js';
import { restingPose } from '../world/figure.js';
import { HERO_FACING } from '../world/menu/hero.js';

/**
 * The account in the top bar (App.tsx `TopBar`), off any room: the player's own figure's head
 * as its avatar, in the colour the account wears, the name, and — where the bar has the room —
 * how many runs the account played; a press opens the settings' „Konto", where the name is typed
 * anew. On a phone the avatar stands alone. The avatar takes a picture of the player's own
 * (`src`) once one can be kept; until then the figure's head stands for it.
 */

/** The colour the profile wears before its player has worn one in a lobby: the crew's first. */
export const FIRST_COLOR = '#2dd4bf';

/** How many runs an account played, in words: „noch kein Einsatz", „1 Einsatz", „3 Einsätze". */
export function runsText(runs: number): string {
  if (runs === 0) {
    return 'noch kein Einsatz';
  }
  return `${runs} ${runs === 1 ? 'Einsatz' : 'Einsätze'}`;
}

/**
 * What the account holds, on one line (the settings' „Konto"): how many runs it played — „Gast"
 * where the server told of none, the line down or the store away.
 */
export function accountLine(account: AccountView | null): string {
  return account === null ? 'Gast' : `Konto · ${runsText(account.runs)}`;
}

/**
 * The colour the profile wears, the hero's and the avatar's: the account's, the one the pass
 * kept from a lobby before the server told one (pass.ts `lastColor`), the crew's first before any.
 */
export function profileColor(account: AccountView | null): string {
  return account?.color ?? lastColor() ?? FIRST_COLOR;
}

/** What the bar says of the account beside its name: its runs, where it played any; else null. */
export function barBadge(account: AccountView | null): string | null {
  return account === null || account.runs === 0 ? null : runsText(account.runs);
}

/** What the bar names the account by: its name, or that it has none yet. */
export function barName(name: string): string {
  const named = name.trim();
  return named === '' ? 'Ohne Namen' : named;
}

/**
 * The square of the figure the avatar shows, figure units from its feet: the dome with its visor
 * and the shoulders under it, the outline and the visor's front within it.
 */
export const AVATAR_HEAD = { x: 0, y: -0.58, across: 0.66 } as const;

/**
 * The figure's head on `ctx`'s canvas, `px` device px square, in `color`: standing still as the
 * menu's hero stands (world/menu/hero.ts), facing the bar's middle at three quarters, its arms
 * down and out of sight, its upper layer alone — no legs, no shadow.
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, color: string, px: number): void {
  const s = px / AVATAR_HEAD.across;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  ctx.setTransform(s, 0, 0, s, px / 2 - AVATAR_HEAD.x * s, px / 2 - AVATAR_HEAD.y * s);
  drawScientist(ctx, {
    color,
    name: '',
    facing: HERO_FACING,
    moving: false,
    walkPhase: 0,
    isYou: false,
    connected: true,
    pose: restingPose(HERO_FACING),
    named: false,
    layer: 'upper',
  });
}

/** How large the avatar stands in the bar, CSS px (menu.css `.avatar`). */
export const AVATAR_PX = 30;

/**
 * The account's avatar: the picture at `src` where there is one; else the figure's head in
 * `color`, drawn once for each colour at the screen's density (at most 2).
 */
export function Avatar({ color, src = null }: { color: string; src?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return;
    }
    const css = canvas.clientWidth || AVATAR_PX;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    canvas.width = px;
    canvas.height = px;
    drawAvatar(ctx, color, px);
  }, [color]);
  if (src !== null) {
    return <img className="avatar" src={src} alt="" />;
  }
  return <canvas ref={canvasRef} className="avatar" aria-hidden="true" />;
}

interface BarAccountProps {
  /** the profile's name as typed (profileName.ts) */
  name: string;
  /** the pass's account as the server told it; null before it did, or without one */
  account: AccountView | null;
  /** opens the settings' „Konto" */
  onOpen: () => void;
}

/** The account in the top bar (see the module's comment): a press opens „Konto". */
export function BarAccount({ name, account, onOpen }: BarAccountProps) {
  const named = barName(name);
  const badge = barBadge(account);
  const label = badge === null ? `Konto: ${named}` : `Konto: ${named}, ${badge}`;
  return (
    <button className="bar-account" aria-label={label} title={label} onClick={onOpen}>
      <Avatar color={profileColor(account)} />
      <span className="bar-account-name">{named}</span>
      {badge !== null && <span className="bar-account-badge">{badge}</span>}
    </button>
  );
}
