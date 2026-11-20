/**
 * Pause and the Info menu of Ferret Flush (the reference's src/session.js), with no page in them.
 * Opening Info pauses a game in play; closing it goes on only with a game that Info paused
 * itself, so Info opened from the pause screen returns to the pause screen.
 */
import type { Game } from './rules.js';

export interface Sitting {
  paused: boolean;
  info: boolean;
  infoPaused: boolean;
}

export function createSitting(): Sitting {
  return { paused: false, info: false, infoPaused: false };
}

/** Pauses or goes on; only a game in play can be paused. Returns whether anything changed. */
export function setPaused(sitting: Sitting, game: Game, value: boolean): boolean {
  if (game.screen !== 'playing' || sitting.paused === value) return false;
  sitting.paused = value;
  if (!value) sitting.infoPaused = false;
  return true;
}

export function openInfo(sitting: Sitting, game: Game): boolean {
  if (sitting.info) return false;
  sitting.info = true;
  sitting.infoPaused = setPaused(sitting, game, true);
  return true;
}

export function closeInfo(sitting: Sitting, game: Game): boolean {
  if (!sitting.info) return false;
  sitting.info = false;
  if (sitting.infoPaused) setPaused(sitting, game, false);
  sitting.infoPaused = false;
  return true;
}

/** A game that ends or goes back to the first screen is no longer paused. */
export function settle(sitting: Sitting, game: Game): void {
  if (game.screen !== 'playing') sitting.paused = false;
}
