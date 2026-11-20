/**
 * One sitting at Ferret Flush on the machine (the reference's src/main.js without its page): the
 * game, its fixed clock, the sight, the effects, the sound, the bests and the settings. It lives
 * as long as the page, so a game left — by „Zurück", or because what the player waited for came —
 * waits paused. It knows no room and no line: only its sound reaches the lab (audio.ts).
 */
import { CLASSIC, createGame, isMode, update, type FlushEvent, type Game } from './rules.js';
import { GOLDEN, MODERN, streakFactor } from './modern.js';
import { createFx, react, updateFx, type Fx } from './fx.js';
import { createView, draw, type View } from './draw.js';
import { menuAt } from './hud.js';
import { createFlushAudio, type FlushAudio } from './audio.js';
import { STEP, blend, createClock, holdFor, resetClock, snapshot, tick, type Clock } from './clock.js';
import { closeInfo, createSitting, openInfo, setPaused, settle, type Sitting } from './session.js';
import { KEYS as STORE, loadBest, loadMuted, loadSettings, write, type FlushSettings, type RuleBook } from './settings.js';
import type { Outlet } from '../sound.js';
import { pageStorage, type Store } from '../scores.js';

const RULES = { classic: CLASSIC, modern: MODERN } as const;
const HIT_STOP: Readonly<Record<string, number>> = { hit: 0.045, golden: 0.09, decoy: 0.03 };

export interface Sight {
  x: number;
  y: number;
  inside: boolean;
  hover: string | null;
}

export class FlushPlay {
  readonly settings: FlushSettings;
  readonly bests: Record<RuleBook, Record<'single' | 'pair' | 'clay', number>>;
  readonly game: Game;
  readonly sitting: Sitting = createSitting();
  readonly fx: Fx = createFx();
  /** the marsh and its hour, made with the first frame drawn (its shapes need a page) */
  private view: View | null = null;
  readonly clock: Clock = createClock();
  readonly audio: FlushAudio;
  readonly pointer: Sight = { x: 640, y: 360, inside: false, hover: null };
  /** whether the menus are page panels: the field too small for its own (layout.ts) */
  compact = false;
  version = 0;
  private asked = { fire: false, choose: null as string | null, touch: false };
  private before: ReturnType<typeof snapshot> = new Map();
  private quackIn = 0.6;
  private shown = '';
  private readonly listeners = new Set<() => void>();

  constructor(
    outlet: Outlet,
    private readonly storage: Store | null = pageStorage(),
  ) {
    this.settings = loadSettings(storage);
    this.bests = { classic: loadBest(storage, 'classic'), modern: loadBest(storage, 'modern') };
    const rules = this.settings.rules;
    this.game = createGame({ best: this.bests[rules], rules: RULES[rules] });
    this.audio = createFlushAudio(outlet);
    this.audio.setMuted(loadMuted(storage));
    this.audio.setVolumes(this.settings);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;

  changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  rules(): RuleBook {
    return this.game.screen === 'playing' ? this.game.rules.name : this.settings.rules;
  }

  private saveSettings(): void {
    write(this.storage, STORE.settings, this.settings);
  }

  pause(value: boolean): void {
    if (setPaused(this.sitting, this.game, value)) {
      this.audio.hush(this.sitting.paused);
      this.changed();
    }
  }

  /** Modern or Classic, for the next game: a game in play keeps the rules it began with. */
  chooseRules(name: RuleBook): void {
    if (this.game.screen === 'playing') return;
    this.settings.rules = name;
    this.game.rules = RULES[name];
    this.game.best = this.bests[name];
    this.saveSettings();
    this.changed();
  }

  setVolume(name: 'music' | 'effects', value: number): void {
    this.settings[name] = value;
    this.audio.setVolumes(this.settings);
    this.saveSettings();
  }

  setTouchAim(value: boolean): void {
    this.settings.touchAim = value;
    this.saveSettings();
  }

  showInfo(): void {
    if (!openInfo(this.sitting, this.game)) return;
    this.audio.hush(this.sitting.paused);
    this.changed();
  }

  hideInfo(): void {
    if (!closeInfo(this.sitting, this.game)) return;
    this.audio.hush(this.sitting.paused);
    this.changed();
  }

  toggleSound(): void {
    this.audio.setMuted(!this.audio.muted);
    write(this.storage, STORE.muted, this.audio.muted);
    this.changed();
  }

  /** A choice from a menu: a game on the first screen, „again" or the games at the end. */
  choose(choice: string): void {
    if (choice === 'menu' && this.sitting.paused) this.pause(false);
    if (isMode(choice) && this.game.screen !== 'title') return;
    this.asked.choose = choice;
  }

  /** The sight moves to (x, y) in field units, over the field or off it. */
  aim(x: number, y: number, inside: boolean): void {
    Object.assign(this.pointer, { x, y, inside });
  }

  /** A press on the field: a shot, a menu card, or the end of a pause. */
  press(x: number, y: number, touch: boolean): void {
    this.audio.unlock();
    this.aim(x, y, true);
    if (this.sitting.paused) {
      this.pause(false);
      return;
    }
    this.asked.fire = true;
    this.asked.touch = touch && this.settings.touchAim;
    this.asked.choose = this.compact ? null : menuAt(this.game, x, y);
  }

  /** 1, 2, 3: a game on the first screen. */
  pick(mode: string): void {
    if (this.game.screen === 'title' && isMode(mode)) this.asked.choose = mode;
  }

  /** Enter and Space: the game chosen last on the first screen, the same game at the end. */
  confirm(): void {
    if (this.game.screen === 'title') this.asked.choose = this.game.mode;
    else if (this.game.screen === 'over') this.asked.choose = 'again';
  }

  /** Q while paused: back to the three games. */
  quit(): void {
    if (!this.sitting.paused) return;
    this.pause(false);
    this.asked.choose = 'menu';
  }

  /** How far into the night the marsh is, 0 by day: the stars of its sky. */
  private night(): number {
    return this.view?.sky.stars ?? 0;
  }

  /** The machine closes, or the page loses the player: the game pauses, the sound holds. */
  leave(): void {
    this.pause(true);
    this.asked = { fire: false, choose: null, touch: false };
    this.audio.music(false, 'day');
    this.audio.hush(true);
    resetClock(this.clock);
  }

  /** The sound out of the lab's mix, for good. */
  close(): void {
    this.leave();
    this.audio.close();
  }

  /** Ducks in the air quack now and then, and their wings can be heard. */
  private chatter(dt: number): void {
    const flying = this.game.birds.filter((bird) => bird.type === 'duck' && bird.state !== 'falling');
    for (const duck of flying) {
      if (Math.floor(duck.age * 6) !== Math.floor((duck.age - dt) * 6)) this.audio.flap();
    }
    this.quackIn -= dt;
    if (this.quackIn > 0 || flying.length === 0) return;
    this.quackIn = 0.5 + Math.random() * 0.8;
    const duck = flying[Math.floor(Math.random() * flying.length)];
    if (duck) this.audio.quack(duck.look ?? duck.kind);
  }

  /** A hit holds the modern rules a moment; never where motion is to be reduced. */
  private hitStop(event: FlushEvent): void {
    const stop = HIT_STOP[event.type];
    if (this.fx.calm || this.game.rules !== MODERN || stop === undefined) return;
    holdFor(this.clock, event.look === GOLDEN ? (HIT_STOP['golden'] ?? stop) : stop);
  }

  private heard(): void {
    const game = this.game;
    for (const event of game.events) {
      react(this.fx, event);
      this.audio.play(event);
      this.hitStop(event);
      if (event.type === 'over' && event.newBest) {
        write(this.storage, STORE.best[game.rules.name], game.best);
      }
    }
    game.events.length = 0;
  }

  /** The steps of the rules due in this frame; a click counts in the first of them. */
  private steps(count: number): void {
    const { pointer } = this;
    const hover = pointer.inside && !this.compact ? menuAt(this.game, pointer.x, pointer.y) : null;
    if (hover && hover !== pointer.hover) this.audio.play({ type: 'hover' });
    pointer.hover = hover;
    for (let i = 0; i < count; i++) {
      this.before = snapshot(this.game);
      const { fire, choose, touch } = this.asked;
      update(this.game, STEP, { x: pointer.x, y: pointer.y, fire, choose, touch });
      this.asked.fire = false;
      this.asked.choose = null;
      this.heard();
    }
    settle(this.sitting, this.game);
  }

  private music(): void {
    const { game, sitting } = this;
    const on = game.rules === MODERN && game.screen === 'playing' && !sitting.paused;
    const night = this.night() > 0.4 ? 'night' : 'day';
    this.audio.music(on, game.phase === 'bonus' ? 'bonus' : night);
  }

  /** What the page around the field shows, as one string: a change asks for a new draw. */
  private shownKey(): string {
    const g = this.game;
    const streak = g.modern ? streakFactor(g.modern.streak) : 1;
    const { paused, info } = this.sitting;
    return [g.screen, g.round, Math.round(this.fx.shown), g.mode, streak, g.modern?.wind ?? 0, paused, info].join('|');
  }

  /** One frame at page time `now` (ms): the rules stepped, the effects moved, the field drawn. */
  frame(now: number, ctx: CanvasRenderingContext2D | null): void {
    const beat = tick(this.clock, now);
    const { sitting, game } = this;
    if (sitting.paused || sitting.info) {
      resetClock(this.clock);
      this.asked.fire = false;
      this.asked.choose = null;
    } else {
      this.steps(beat.steps);
      updateFx(this.fx, beat.seconds, game);
      this.chatter(beat.seconds);
      this.audio.ambient(beat.seconds, this.night());
    }
    this.music();
    if (ctx) this.paint(ctx, beat);
    const key = this.shownKey();
    if (key !== this.shown) {
      this.shown = key;
      this.changed();
    }
  }

  /** The sight as drawn: none over a page panel or the Info. */
  private sight(): Sight {
    const { sitting, game } = this;
    const menus = this.compact && (game.screen !== 'playing' || sitting.paused);
    return menus || sitting.info ? { ...this.pointer, inside: false } : this.pointer;
  }

  private paint(ctx: CanvasRenderingContext2D, beat: { alpha: number; seconds: number }): void {
    const { sitting, game } = this;
    const still = sitting.paused;
    const restore = blend(game, this.before, still ? 1 : beat.alpha);
    this.view ??= createView();
    draw(ctx, this.view, game, this.fx, this.sight(), {
      dt: still ? 0 : beat.seconds,
      alpha: still ? 1 : beat.alpha,
      paused: sitting.paused,
      muted: this.audio.muted,
      fullScreen: false,
      compact: this.compact,
    });
    restore();
  }
}

