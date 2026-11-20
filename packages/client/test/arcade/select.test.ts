import { describe, expect, it } from 'vitest';
import { LAST_KEY, lastGame, rememberGame, selectStep } from '../../src/arcade/select.js';
import { FlushPlay } from '../../src/arcade/flush/play.js';

/**
 * The machine's select and its second game: the keys that light and take a card, the game played
 * last kept in this browser (guarded), and Ferret Flush left mid-game — by „Zurück", or as the
 * door closes the machine because what the player waited for came — waiting paused.
 */

function memory() {
  const db = new Map<string, string>();
  return {
    db,
    store: { getItem: (k: string) => db.get(k) ?? null, setItem: (k: string, v: string) => void db.set(k, v) },
  };
}

describe('the machine’s select', () => {
  it('steps round with the arrows, jumps with 1 and 2, and takes nothing else', () => {
    expect([selectStep(0, 'ArrowRight'), selectStep(1, 'ArrowRight')]).toEqual([1, 0]);
    expect([selectStep(0, 'ArrowLeft'), selectStep(1, 'ArrowUp')]).toEqual([1, 0]);
    expect([selectStep(1, 'Digit1'), selectStep(0, 'Digit2'), selectStep(0, 'Numpad2')]).toEqual([0, 1, 1]);
    expect([selectStep(0, 'Digit3'), selectStep(0, 'KeyA'), selectStep(0, 'Enter')]).toEqual([null, null, null]);
  });

  it('lights the game played last, the first where none is kept or the store refuses', () => {
    const { db, store } = memory();
    expect(lastGame(store)).toBe('ducks');
    rememberGame(store, 'flush');
    expect(db.get(LAST_KEY)).toBe('flush');
    expect(lastGame(store)).toBe('flush');
    db.set(LAST_KEY, 'chess');
    expect(lastGame(store)).toBe('ducks');
    const refusing = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('denied');
      },
    };
    expect(lastGame(refusing)).toBe('ducks');
    expect(() => rememberGame(refusing, 'flush')).not.toThrow();
    expect(lastGame(null)).toBe('ducks');
  });
});

describe('Ferret Flush on the machine, left mid-game', () => {
  it('pauses as the machine closes or the game is left, and plays on from there', () => {
    const play = new FlushPlay(() => null, memory().store);
    play.choose('single');
    for (let t = 0; t <= 3000; t += 16) play.frame(t, null);
    expect(play.game.screen).toBe('playing');
    const at = play.game.time;
    play.leave();
    expect(play.sitting.paused).toBe(true);
    for (let t = 3016; t <= 5000; t += 16) play.frame(t, null);
    expect(play.game.time).toBe(at);
    play.pause(false);
    for (let t = 5016; t <= 6000; t += 16) play.frame(t, null);
    expect(play.game.time).toBeGreaterThan(at);
    expect(play.game.screen).toBe('playing');
  });

  it('keeps its bests and settings in this browser, Modern and Classic apart', () => {
    const { db, store } = memory();
    const play = new FlushPlay(() => null, store);
    play.chooseRules('classic');
    play.setVolume('music', 0.2);
    expect(JSON.parse(db.get('escapelab-flush-settings') ?? '{}')).toMatchObject({ rules: 'classic', music: 0.2 });
    expect(play.game.best).toBe(play.bests.classic);
    expect(new FlushPlay(() => null, store).settings.rules).toBe('classic');
  });
});
