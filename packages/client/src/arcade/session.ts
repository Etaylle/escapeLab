/**
 * One sitting at the machine (the reference's src/main.js without its page): the game, its fixed
 * clock, the controls, the effects, the sound, the bests and the settings, and what the screen
 * shows of them. It lives as long as the page, so that a game left — by „Zurück", or because what
 * the player waited for came — waits paused for the next time the machine opens. It knows no
 * room and no line: nothing here reaches the lab but the sound, through one outlet (sound.ts).
 */
import { FixedClock } from './clock.js';
import { Fx } from './fx.js';
import { InfoMenu } from './info.js';
import { Input } from './input.js';
import { enhanced, formationName, isBossWave, multiplier, BOOSTS, PICKUP_KINDS } from './modern.js';
import { render, type View } from './render.js';
import { Scores, Settings, SCORE_KEYS, pageStorage, type Rules, type Store } from './scores.js';
import { ArcadeAudio, type Outlet } from './sound.js';
import { waveNews } from './texts.js';
import {
  createGame,
  current,
  emit,
  pause,
  resume,
  type Actions,
  type Difficulty,
  type Game,
  type GameEvent,
} from './rules.js';

export type Controls = 'keyboard' | 'touch';

export interface Choice {
  difficulty: Difficulty;
  players: 1 | 2;
  controls: Controls;
}

/** The wave banner over the field: its wave, its two lines, and a count to restart it by. */
export interface Banner {
  wave: number;
  title: string;
  line: string;
  seq: number;
}

/** The effects the screen draws as the game's original did, by cue. */
const BURSTS: Readonly<Record<string, number>> = { explosion: 0.55, impact: 0.55, death: 1.2, bonus: 1.2 };
/** What drawing remembers of an event of the modern rules: the flock's step, who fired, a hit. */
const MARKS: Readonly<Record<string, (s: Session, g: Game, value: number) => void>> = {
  march: (s, g) => (s.view.marchAt = g.time),
  'duck-fire': (s, g, id) => s.view.firedAt.set(id, g.time),
  'boss-hit': (s) => (s.view.bossHurt = 0.15),
  'wave-start': (s, _g, wave) => (s.banner = s.bannerOf(wave)),
};
/** How long a banner stands, ms. */
export const BANNER_MS = 2600;

export class Session {
  game: Game | null = null;
  choice: Choice = { difficulty: 'Normal', players: 1, controls: 'keyboard' };
  readonly input = new Input();
  readonly clock = new FixedClock();
  readonly fx = new Fx();
  readonly info = new InfoMenu();
  readonly audio: ArcadeAudio;
  readonly settings: Settings;
  readonly books: Readonly<Record<Rules, Scores>>;
  readonly view: View = {
    modern: true,
    alpha: 1,
    previous: null,
    fx: this.fx,
    facing: 1,
    marchAt: -1,
    firedAt: new Map(),
    bossHurt: 0,
  };
  /** the best on the game's difficulty as it started: a new best is said at its end */
  initialBest = 0;
  banner: Banner | null = null;
  /** counts every change the screen around the field shows */
  version = 0;
  private shown = '';
  private lastFrame = 0;
  private readonly listeners = new Set<() => void>();

  constructor(outlet: Outlet, storage: Store | null = pageStorage()) {
    this.audio = new ArcadeAudio(outlet);
    this.settings = new Settings(storage);
    this.books = {
      modern: new Scores(storage, SCORE_KEYS.modern),
      classic: new Scores(storage, SCORE_KEYS.classic),
    };
    this.audio.setVolume('music', this.settings.values.music);
    this.audio.setVolume('effects', this.settings.values.effects);
    this.view.modern = this.settings.values.rules === 'modern';
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;

  /** Tells the screen something it shows has changed. */
  changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  rules(): Rules {
    if (this.game) return this.game.classic ? 'classic' : 'modern';
    return this.settings.values.rules;
  }
  scores(): Scores {
    return this.books[this.rules()];
  }

  setRules(rules: Rules): void {
    this.settings.set('rules', rules);
    if (!this.game) this.view.modern = rules === 'modern';
    this.changed();
  }

  start(): void {
    this.audio.stop();
    this.input.clear();
    const classic = this.settings.values.rules === 'classic';
    const g = createGame(this.choice.difficulty, this.choice.players, { classic });
    this.game = g;
    this.audio.rich = !classic;
    this.view.modern = !classic;
    this.view.firedAt.clear();
    this.fx.clear();
    this.initialBest = this.scores().values[g.difficulty];
    this.clock.reset();
    emit(g, 'clear');
    this.banner = classic ? null : this.bannerOf(1);
    this.changed();
  }

  /** Enter, or the card's first button: start, resume, or take the turn. */
  primary(): void {
    const g = this.game;
    if (!g || g.state === 'game-over') this.start();
    else if (g.state === 'paused') this.togglePause();
    else if (g.state === 'turn-change') {
      this.input.clear();
      g.state = 'playing';
      current(g).x = 400;
      this.clock.reset();
      this.changed();
    }
  }

  togglePause(): void {
    const g = this.game;
    if (!g) return;
    this.input.clear();
    if (g.state === 'paused') resume(g);
    else {
      pause(g);
      this.audio.stop();
    }
    this.clock.reset();
    this.changed();
  }

  /** Back to the machine's own menu, the game dropped. */
  toMenu(): void {
    this.input.clear();
    this.audio.stop();
    this.audio.stopMusic();
    this.game = null;
    this.clock.reset();
    this.fx.clear();
    this.banner = null;
    this.view.modern = this.settings.values.rules === 'modern';
    this.changed();
  }

  /** The machine closes, or the page loses the player: the game pauses and every sound stops. */
  leave(): void {
    this.input.clear();
    if (this.game) pause(this.game);
    this.info.hide(null);
    this.audio.stop();
    this.audio.stopMusic();
    this.clock.reset();
    this.changed();
  }

  /** The machine's sound out of the lab's mix: for a page that goes. */
  close(): void {
    this.leave();
    this.audio.close();
  }

  openInfo(): void {
    if (!this.info.show(this.game)) return;
    this.input.clear();
    this.audio.stop();
    this.clock.reset();
    this.changed();
  }

  closeInfo(): void {
    if (!this.info.hide(this.game)) return;
    this.clock.reset();
    this.changed();
  }

  bannerOf(wave: number): Banner {
    const [title, line] = waveNews(wave, isBossWave(wave), formationName(wave));
    return { wave, title, line, seq: (this.banner?.seq ?? 0) + 1 };
  }

  /** Sound and pictures for what the simulation reported during the last steps. */
  private react(g: Game, e: GameEvent): void {
    this.audio.play(e.type);
    const life = BURSTS[e.type];
    if (life !== undefined) g.effects.push({ ...e, life });
    if (g.classic) return;
    this.clock.freeze(this.fx.spawn(e));
    MARKS[e.type]?.(this, g, typeof e.value === 'number' ? e.value : 0);
  }

  private syncMusic(g: Game | null): void {
    const wanted = g !== null && !g.classic && ['playing', 'death', 'wave-clear'].includes(g.state);
    if (wanted && !this.audio.music.playing) this.audio.music.start();
    if (!wanted && this.audio.music.playing) this.audio.music.stop();
  }

  /** What the screen around the field shows, as one string: a change asks for a new draw. */
  private shownKey(g: Game): string {
    const p = current(g);
    const boosts = PICKUP_KINDS.map((k) => Math.ceil(p.boosts[k])).join(',');
    const scores = g.players.map((q) => `${q.score}/${q.lives}`).join(',');
    return `${g.state}|${g.active}|${p.wave}|${scores}|${p.chain}|${boosts}`;
  }

  /** One frame at page time `now` (ms): the game advanced, its events sounded and drawn. */
  frame(now: number, ctx: CanvasRenderingContext2D | null, autofire: boolean): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const g = this.game;
    const actions = g ? this.play(g, now, dt, autofire) : this.input.actions;
    this.syncMusic(g);
    if (ctx) render(ctx, g, now / 1000, actions, this.view);
  }

  /** The game advanced to `now` with what is held, its events taken, the screen told. */
  private play(g: Game, now: number, dt: number, autofire: boolean): Actions {
    const actions = this.input.actionsFor(current(g).x, autofire);
    if (actions.left !== actions.right) this.view.facing = actions.left ? -1 : 1;
    this.clock.tick(now, g, actions);
    for (const e of g.events) this.react(g, e);
    g.events = [];
    for (const p of g.players) this.scores().record(g.difficulty, p.score);
    if (g.state !== 'paused') this.fx.update(dt);
    this.view.bossHurt = Math.max(0, this.view.bossHurt - dt);
    this.view.alpha = this.clock.alpha;
    this.view.previous = this.clock.previous;
    const key = this.shownKey(g);
    if (key !== this.shown) {
      this.shown = key;
      this.changed();
    }
    return actions;
  }
}

/** The combo and the boosts running, as the chips over the field show them; null for none. */
export function chipsOf(g: Game | null): { multiplier: number; chain: number; boosts: [string, number, number][] } | null {
  if (!g || g.classic || g.state === 'game-over') return null;
  const p = current(g);
  if (!enhanced(p)) return null;
  return {
    multiplier: multiplier(p.chain),
    chain: p.chain,
    boosts: PICKUP_KINDS.filter((k) => p.boosts[k] > 0).map((k) => [k, Math.ceil(p.boosts[k]), p.boosts[k] / BOOSTS[k]]),
  };
}
