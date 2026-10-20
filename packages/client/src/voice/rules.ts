import { canSee, type SightMap } from '@escapelab/core';
import type { Spot } from '../world/movement.js';

/**
 * The crew's voice by rule, apart from the browser: how loud a crew member
 * sounds from where they stand, which of two players opens the link between
 * them, when somebody counts as speaking, and what a new view of the room does
 * to the links. voice/mesh.ts applies these to the real connections.
 */

/** Within this many tiles a crew member sounds at full volume. */
export const FULL_WITHIN = 4;
/** At this many tiles the fade reaches its floor. */
export const FADE_TO = 10;
/** The floor of the fade: nobody in the same run falls silent. */
export const FAR_GAIN = 0.15;
/** Through a wall or a shut door a voice keeps this share: the two have to raise theirs. */
export const WALL_SHARE = 0.35;

/**
 * How loud a crew member sounds `distance` tiles away: in full within
 * FULL_WITHIN, fading linearly to FAR_GAIN at FADE_TO and staying there
 * further off; with no line of sight between the two, WALL_SHARE of that.
 */
export function voiceGain(distance: number, inSight: boolean): number {
  const span = FADE_TO - FULL_WITHIN;
  const fade = (Math.min(Math.max(distance, FULL_WITHIN), FADE_TO) - FULL_WITHIN) / span;
  const gain = 1 - fade * (1 - FAR_GAIN);
  return inSight ? gain : gain * WALL_SHARE;
}

/**
 * How loud `to` sounds to whoever stands at `from`, both in tiles, on `map`
 * with the doors `shut` (keys "x,y"): by their distance and whether a wall or
 * a shut door stands between them, by the sight lines everybody uses.
 */
export function gainBetween(
  map: SightMap,
  from: Spot,
  to: Spot,
  shut: ReadonlySet<string>,
): number {
  return voiceGain(Math.hypot(to.x - from.x, to.y - from.y), canSee(map, from, to, shut));
}

/** Of two players, the one with the lower id opens the link between them; the other answers. */
export function ownsLink(self: string, peer: string): boolean {
  return self < peer;
}

/** A level this loud (the peak of a stretch of samples, full scale 1) starts somebody speaking… */
export const SPEAK_ON = 0.04;
/** …and one this loud keeps them at it. */
export const SPEAK_KEEP = 0.02;
/** This long below SPEAK_KEEP, in ms, and they have stopped: a breath between words is no stop. */
export const SPEAK_RELEASE_MS = 400;

/** Whether somebody speaks, and when their voice was last loud enough for it (ms). */
export interface Speech {
  readonly speaking: boolean;
  readonly loudAt: number;
}

export const SILENT: Speech = { speaking: false, loudAt: Number.NEGATIVE_INFINITY };

/**
 * Speech after hearing `level` at `now` (ms): it starts at SPEAK_ON, is kept
 * by anything from SPEAK_KEEP up and ends SPEAK_RELEASE_MS after the last
 * level that kept it. Returns `was` itself while nothing changes but time.
 */
export function heard(was: Speech, level: number, now: number): Speech {
  if (level >= (was.speaking ? SPEAK_KEEP : SPEAK_ON)) {
    return { speaking: true, loudAt: now };
  }
  if (was.speaking && now - was.loudAt >= SPEAK_RELEASE_MS) {
    return { speaking: false, loudAt: was.loudAt };
  }
  return was;
}

/** How loud a stretch of samples got: its peak, full scale 1; 0 for none. */
export function peakOf(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  }
  return peak;
}

/** Another member of the room as the voice sees them. */
export interface Peer {
  readonly id: string;
  readonly connected: boolean;
}

/** What to do with the links after a view of the room: close some, then open some. */
export interface LinkPlan {
  /** peers whose link goes: they left, dropped out, or came back and want a fresh one */
  close: string[];
  /** peers this end opens a link to now, by making the offer */
  open: string[];
}

/**
 * What a new view of the room does to the links. `peers` are the others in
 * the room as the view has them, `seen` who of them were connected in the
 * view before, `linked` whom a link already joins this end with, and `owns`
 * whether this end opens the link with a peer. A peer who is gone or dropped
 * out loses their link. One who comes, or comes back, gets a fresh one: the
 * old link closes, and the owner opens the new one while the other end waits
 * for its offer. A peer this end owns but has no link with gets one — after
 * a link failed, say.
 */
export function linkPlan(
  peers: readonly Peer[],
  seen: ReadonlySet<string>,
  linked: ReadonlySet<string>,
  owns: (peer: string) => boolean,
): LinkPlan {
  const close: string[] = [];
  const open: string[] = [];
  const here = new Set<string>();
  for (const { id, connected } of peers) {
    if (!connected) {
      continue;
    }
    here.add(id);
    const fresh = !seen.has(id);
    if (fresh && linked.has(id)) {
      close.push(id);
    }
    if (owns(id) && (fresh || !linked.has(id))) {
      open.push(id);
    }
  }
  close.push(...[...linked].filter((id) => !here.has(id)));
  return { close, open };
}
