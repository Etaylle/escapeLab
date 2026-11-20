/**
 * The machine's Info menu and a game (the reference's src/info.js): opening it pauses a running
 * game, and closing it resumes only a game it paused itself, so that one opened from the pause
 * card returns to the pause card.
 */
import { pause, resume, type Game } from './rules.js';

export class InfoMenu {
  open = false;
  pausedGame = false;

  show(game: Game | null): boolean {
    if (this.open) return false;
    this.open = true;
    const before = game?.state;
    if (game) pause(game);
    this.pausedGame = game !== null && before !== 'paused' && game.state === 'paused';
    return true;
  }

  hide(game: Game | null): boolean {
    if (!this.open) return false;
    this.open = false;
    if (this.pausedGame && game?.state === 'paused') resume(game);
    this.pausedGame = false;
    return true;
  }
}
