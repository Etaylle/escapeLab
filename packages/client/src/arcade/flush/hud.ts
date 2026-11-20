/**
 * Everything written on Ferret Flush's field (the reference's src/hud.js, its canvas parts): the
 * banners, the first screen with the three games, the pause, the end, and the sight; and the row
 * of ten targets and the shells for the HUD bar. The words are the machine's own, in German;
 * „Ferret Flush" stays its name. The faces are named as the reference names them, and nothing is
 * loaded for them: where a face is missing, the system's stands in.
 */
import { TAU, clamp, ease, ellipse, line, span } from './kit.js';
import { W, H, MODES, SHELLS, flightTime, quotaFor, type Game, type Mark, type Mode } from './rules.js';
import { hitRate } from './modern.js';
import type { Fx } from './fx.js';
import type { Pointer } from './ferret.js';

type Ctx = CanvasRenderingContext2D;

const INK = '#101b2c';
const CREAM = '#fff3d9';
const AMBER = '#ffc24a';
const CORAL = '#ff7d6a';
const RUST = '#e8862f';
const CLAY = '#ea7237';
const FACES = {
  display: '"Lilita One", "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif',
  text: '"Nunito", "Avenir Next", "Segoe UI", system-ui, sans-serif',
};
export const GAMES: readonly { mode: Mode; key: string; title: string; note: string }[] = [
  { mode: 'single', key: '1', title: 'Eine Ente', note: 'Ein Vogel, drei Patronen' },
  { mode: 'pair', key: '2', title: 'Zwei Enten', note: 'Zwei Vögel, drei Patronen' },
  { mode: 'clay', key: '3', title: 'Tontauben', note: 'Zwei Scheiben, drei Patronen' },
];
const CARD = { x: 64, y: 296, w: 262, h: 150, gap: 20 };
const PANEL = { x: W / 2 - 270, y: 142, w: 540, h: 376 };
const BUTTON = { w: 216, h: 56, y: PANEL.y + PANEL.h - 100 };
/** The strip of the HUD bar: ten targets, the pass mark, the time left and the shells. */
export const STRIP = { w: 448, h: 64, first: 22, step: 34, shells: 386 } as const;
const STATS = { y: PANEL.y + PANEL.h + 18, h: 150 };

let displayWeight = 900;
/** The smallest text on the field in its own units, so that it prints at 14 CSS pixels or more. */
let textFloor = 0;

/** Called when the display face has arrived: it has one weight and must not be made bolder. */
export function displayFaceReady(): void {
  displayWeight = 400;
}

/** Sets the smallest text of the banners and points for a field shown `scale` pixels a unit. */
export function setTextScale(scale: number): void {
  textFloor = 14 / scale;
}

const legible = (size: number): number => Math.min(Math.max(size, textFloor), size * 2.6);
const display = (size: number): string => `${displayWeight} ${size}px ${FACES.display}`;
const body = (size: number, weight = 800): string => `${weight} ${size}px ${FACES.text}`;
/** A score as the machine prints it: German grouping, a point every three digits. */
export const score = (value: number): string => Math.round(value).toLocaleString('de-DE');

/** A place on a menu that can be chosen. */
export interface Spot {
  choose: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The places on a menu that can be chosen: the three games, or the two buttons at the end. */
export function menuSpots(screen: Game['screen']): Spot[] {
  if (screen === 'title') {
    return GAMES.map((entry, i) => ({
      choose: entry.mode,
      x: CARD.x + i * (CARD.w + CARD.gap),
      y: CARD.y,
      w: CARD.w,
      h: CARD.h,
    }));
  }
  if (screen !== 'over') return [];
  return [
    { choose: 'again', x: W / 2 - BUTTON.w - 12, y: BUTTON.y, w: BUTTON.w, h: BUTTON.h },
    { choose: 'menu', x: W / 2 + 12, y: BUTTON.y, w: BUTTON.w, h: BUTTON.h },
  ];
}

/** What a click at this point of the picture chooses, or null. */
export function menuAt(game: Pick<Game, 'screen'>, x: number, y: number): string | null {
  const inside = ({ x: left, y: top, w, h }: Spot): boolean =>
    x >= left && x <= left + w && y >= top && y <= top + h;
  return menuSpots(game.screen).find(inside)?.choose ?? null;
}

interface PlateLook {
  radius?: number;
  alpha?: number;
  edge?: string;
  edgeAlpha?: number;
}

function plate(ctx: Ctx, x: number, y: number, w: number, h: number, options: PlateLook = {}): void {
  const { radius = 18, alpha = 0.66, edge = CREAM, edgeAlpha = 0.16 } = options;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.globalAlpha = edgeAlpha;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

interface Writing {
  colour?: string;
  align?: CanvasTextAlign;
  alpha?: number;
  shadow?: boolean;
}

function write(ctx: Ctx, words: string, x: number, y: number, font: string, options: Writing = {}): void {
  const { colour = CREAM, align = 'left', alpha = 1, shadow = false } = options;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) {
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = INK;
    ctx.fillText(words, x, y + 2);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillText(words, x, y);
  ctx.globalAlpha = 1;
}

/** Small capitals with a little air between the letters. */
function label(
  ctx: Ctx,
  words: string,
  x: number,
  y: number,
  { size = 14, ...options }: Writing & { size?: number } = {},
): void {
  const spaced = 'letterSpacing' in ctx;
  if (spaced) ctx.letterSpacing = `${size * 0.13}px`;
  write(ctx, words.toUpperCase(), x, y, body(size, 900), { alpha: 0.72, ...options });
  if (spaced) ctx.letterSpacing = '0px';
}

/** Big words in three layers, like stacked paper: shadow, rust, cream. */
function headline(
  ctx: Ctx,
  words: string,
  x: number,
  y: number,
  size: number,
  { align = 'center', alpha = 1 }: { align?: CanvasTextAlign; alpha?: number } = {},
): void {
  const font = display(size);
  write(ctx, words, x, y + size * 0.085, font, { colour: INK, align, alpha: alpha * 0.5 });
  write(ctx, words, x, y + size * 0.045, font, { colour: RUST, align, alpha });
  write(ctx, words, x, y, font, { align, alpha });
}

function veil(ctx: Ctx, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

/** A small duck or disc: one of the ten targets of a round, or the picture on a card. */
function mark(ctx: Ctx, clay: boolean, x: number, y: number, size: number): void {
  ctx.beginPath();
  if (clay) ctx.ellipse(x, y, 10 * size, 4.6 * size, 0, 0, TAU);
  else {
    ctx.ellipse(x - size, y + size, 9 * size, 6 * size, 0, 0, TAU);
    ctx.moveTo(x + 11 * size, y - 5 * size);
    ctx.arc(x + 6.5 * size, y - 5 * size, 4.5 * size, 0, TAU);
    ctx.moveTo(x + 10 * size, y - 7 * size);
    ctx.lineTo(x + 16.5 * size, y - 5 * size);
    ctx.lineTo(x + 10 * size, y - 3 * size);
    ctx.moveTo(x - 8 * size, y - 2 * size);
    ctx.lineTo(x - 8 * size, y + 4 * size);
    ctx.lineTo(x - 14 * size, y - 5 * size);
  }
  ctx.fill();
}

function shell(ctx: Ctx, x: number, y: number, alpha: number, turn: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#d9483b';
  ctx.beginPath();
  ctx.roundRect(-8, -42, 16, 31, [5, 5, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#f0695c';
  ctx.fillRect(-5, -39, 3.5, 26);
  ctx.fillStyle = '#e2b54a';
  ctx.beginPath();
  ctx.roundRect(-9, -12, 18, 12, [0, 0, 3, 3]);
  ctx.fill();
  ctx.fillStyle = '#b98a2c';
  ctx.fillRect(-9, -4, 18, 3);
  ctx.restore();
}

/** What the first screen's corner knows of the page: the sound, and whether it may go full screen. */
export interface HintFrame {
  muted: boolean;
  fullScreen: boolean;
}

/** The keys, bottom right. Full screen is named only where the browser allows it. */
function hints(ctx: Ctx, frame: HintFrame): void {
  const keys = ['I Info', `M Ton ${frame.muted ? 'aus' : 'an'}`];
  if (frame.fullScreen) keys.push('F Vollbild');
  write(ctx, keys.join('   ·   '), W - 30, H - 20, body(15), { align: 'right', alpha: 0.72 });
}

/** The shells left; a fired one hops out of the row. */
function shells(ctx: Ctx, game: Game, fx: Fx): void {
  const { shells: left } = STRIP;
  const endless = game.phase === 'bonus';
  for (let i = 0; i < SHELLS; i++) {
    const full = endless || i < game.shells;
    shell(ctx, left + i * 27, STRIP.h - 4, full ? 1 : 0.16, 0);
  }
  for (const drop of fx.drops) {
    const p = drop.age / drop.life;
    const x = left + drop.slot * 27 + p * 26;
    shell(ctx, x, STRIP.h - 4 - 50 * Math.sin(p * Math.PI * 0.9), 1 - p, p * 5);
  }
}

const MARK_ALPHA: Readonly<Record<Mark, number>> = { wait: 0.22, live: 0.6, hit: 1, miss: 0.14 };

/** The line under the targets: the time the ducks of a flush will stay. */
function timeLeft(ctx: Ctx, game: Game, perWave: number): void {
  const left = clamp(game.flightLeft / flightTime(game.round, perWave), 0, 1);
  ctx.fillStyle = left < 0.25 ? CORAL : CREAM;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(STRIP.first - 14, 55, (9 * STRIP.step + 28) * left, 4);
  ctx.globalAlpha = 1;
}

/** The ten targets of the round, the pass mark, and the time the ducks will stay. */
function tracker(ctx: Ctx, game: Game, fx: Fx): void {
  const { target, perWave } = MODES[game.mode];
  const quota = quotaFor(game.round);
  game.tracker.forEach((state, i) => {
    const live = state === 'live' ? 0.5 + 0.5 * Math.sin(fx.clock * 9) : 0;
    const pip = fx.pips[i] ?? 0;
    ctx.fillStyle = state === 'hit' ? AMBER : CREAM;
    ctx.globalAlpha = MARK_ALPHA[state] + live * 0.4;
    const size = 1 + pip * 0.35 + live * 0.12;
    mark(ctx, target === 'clay', STRIP.first + i * STRIP.step, 30 - pip * 4, size);
  });
  ctx.globalAlpha = 1;
  const passX = STRIP.first + quota * STRIP.step - STRIP.step / 2;
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 4]);
  line(ctx, passX, 12, passX, 50);
  ctx.setLineDash([]);
  if (game.phase !== 'flight' || target === 'clay') return;
  timeLeft(ctx, game, perWave);
}

/** The picture in the HUD bar, in its own units: STRIP.w by STRIP.h. */
export function drawStrip(ctx: Ctx, game: Game, fx: Fx): void {
  ctx.clearRect(0, 0, STRIP.w, STRIP.h);
  if (game.screen === 'title') return;
  tracker(ctx, game, fx);
  shells(ctx, game, fx);
}

/** What the HUD bar says beside the strip: the pass mark, or the count once it is made. */
export function trackWords(game: Game): string {
  if (game.phase === 'bonus') return 'Lockenten: Patronen ohne Ende';
  const counted = ['tally', 'cleared', 'failed'].includes(game.phase);
  return counted ? `${game.tally.hits} getroffen` : `${quotaFor(game.round)} zum Bestehen`;
}

function drawBanner(ctx: Ctx, banner: NonNullable<Fx['banner']>): void {
  const enter = ease.back(span(banner.age, 0, 0.4));
  const leave = ease.in(span(banner.age, banner.life - 0.3, banner.life));
  const alpha = span(banner.age, 0, 0.15) * (1 - leave);
  const y = 232 - leave * 24;
  headline(ctx, banner.title, W / 2, y, 84 * (0.6 + 0.4 * enter), { alpha });
  const note = legible(22);
  const options: Writing = { align: 'center', alpha, shadow: true };
  write(ctx, banner.note, W / 2, y + 22 + note, body(note), options);
}

/** The big words between rounds and the short ones during a flush. */
export function drawBanners(ctx: Ctx, fx: Fx): void {
  const { banner, toast } = fx;
  if (banner) drawBanner(ctx, banner);
  if (toast) {
    const fade = 1 - span(toast.age, toast.life - 0.25, toast.life);
    const y = 170 - ease.out(span(toast.age, 0, 0.3)) * 14;
    const alpha = span(toast.age, 0, 0.12) * fade;
    headline(ctx, toast.text, W / 2, y, legible(44), { alpha });
  }
}

/** The points of a hit, rising from where it happened. */
export function drawPopups(ctx: Ctx, fx: Fx): void {
  for (const popup of fx.popups) {
    const p = popup.age / popup.life;
    const size = legible(34) * (0.7 + 0.3 * ease.back(span(p, 0, 0.25)));
    headline(ctx, popup.text, popup.x, popup.y - ease.out(p) * 50, size, { alpha: 1 - p * p });
  }
}

function logo(ctx: Ctx, t: number): void {
  ctx.font = display(104);
  let x = 62;
  for (const [i, letter] of [...'FERRET FLUSH'].entries()) {
    const width = ctx.measureText(letter).width;
    headline(ctx, letter, x, 172 + Math.sin(t * 1.6 + i * 0.55) * 4, 104, { align: 'left' });
    x += width + 2;
  }
}

/** A card's key in its corner. */
function keyCap(ctx: Ctx, key: string, x: number, y: number): void {
  ctx.beginPath();
  ctx.roundRect(x - 48, y + 18, 30, 30, 8);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = CREAM;
  ctx.fill();
  write(ctx, key, x - 33, y + 39, body(16, 900), { align: 'center' });
}

function card(ctx: Ctx, game: Game, entry: (typeof GAMES)[number], spot: Spot, hot: boolean, t: number): void {
  const { x, w } = spot;
  const y = spot.y - (hot ? 6 : 0);
  const clay = entry.mode === 'clay';
  const bob = hot ? Math.sin(t * 9) * 3 : 0;
  plate(ctx, x, y, w, spot.h, hot ? { alpha: 0.88, edge: AMBER, edgeAlpha: 1 } : {});
  ctx.fillStyle = clay ? CLAY : AMBER;
  mark(ctx, clay, x + 46, y + 42 + bob, 2);
  if (entry.mode !== 'single') mark(ctx, clay, x + 106, y + 34 - bob, 1.5);
  keyCap(ctx, entry.key, x + w, y);
  write(ctx, entry.title, x + 22, y + 92, display(30));
  write(ctx, entry.note, x + 22, y + 114, body(14, 700), { alpha: 0.85 });
  const best = game.best[entry.mode];
  const words = best ? `Rekord ${score(best)}` : 'Noch kein Ergebnis';
  label(ctx, words, x + 22, y + 135, { colour: AMBER, alpha: best ? 1 : 0.7 });
}

/** The first screen: the name of the game and the three games to choose from. */
export function drawTitle(ctx: Ctx, game: Game, hover: string | null | undefined, t: number, frame: HintFrame): void {
  const shade = ctx.createLinearGradient(0, 0, 940, 0);
  shade.addColorStop(0, 'rgba(16,27,44,0.42)');
  shade.addColorStop(1, 'rgba(16,27,44,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 940, H);
  logo(ctx, t);
  label(ctx, 'Ein Schießstand im Sumpf', 68, 222, { size: 17, alpha: 0.92, shadow: true });
  menuSpots('title').forEach((spot, i) => {
    const entry = GAMES[i];
    if (entry) card(ctx, game, entry, spot, hover === spot.choose, t);
  });
  const how = 'Start: eine Karte anschießen, oder die Taste 1, 2 oder 3.';
  write(ctx, how, 68, CARD.y + CARD.h + 40, body(17), { alpha: 0.95, shadow: true });
  hints(ctx, frame);
}

function button(ctx: Ctx, spot: Spot, hot: boolean): void {
  const main = spot.choose === 'again';
  const y = spot.y - (hot ? 3 : 0);
  const middle = spot.x + spot.w / 2;
  ctx.beginPath();
  ctx.roundRect(spot.x, y, spot.w, spot.h, 16);
  if (main) {
    ctx.fillStyle = hot ? '#ffd476' : AMBER;
    ctx.fill();
  } else {
    ctx.globalAlpha = hot ? 1 : 0.55;
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const words = main ? 'Nochmal' : 'Andere Spiele';
  write(ctx, words, middle, y + 37, display(24), { align: 'center', colour: main ? INK : CREAM });
  label(ctx, main ? 'Enter' : 'Esc', middle, spot.y + spot.h + 24, { align: 'center' });
}

/** The four lines of the end: score, best, round and hits. */
export function overRows(game: Game): [string, string][] {
  const { hits, shots } = game.stats;
  return [
    ['Punkte', score(game.score)],
    [game.newBest ? 'Rekord, und zwar neu' : 'Rekord', score(game.best[game.mode])],
    ['Erreichte Runde', String(game.round)],
    ['Treffer', `${hits} mit ${shots} ${shots === 1 ? 'Patrone' : 'Patronen'}`],
  ];
}

/** The card of numbers under the end of a modern game; none for a classic one. */
export function statRows(game: Game): [string, string][] {
  const record = game.modern;
  if (!record) return [];
  return [
    ['Trefferquote', `${hitRate(game.stats)} %`],
    ['Beste Serie', String(record.bestStreak)],
    ['Goldene Vögel', String(record.golden)],
    ['Runden ohne Fehlschuss', String(record.sureShots)],
    ['Lockenten-Reihe', score(record.bonusPoints)],
    ['Lockenten getroffen', String(record.decoyHits)],
  ];
}

function statCard(ctx: Ctx, rows: readonly [string, string][]): void {
  const { x, w } = PANEL;
  plate(ctx, x, STATS.y, w, STATS.h, { radius: 22, alpha: 0.9 });
  label(ctx, 'Das Spiel in Zahlen', W / 2, STATS.y + 32, { align: 'center', colour: AMBER });
  rows.forEach(([name, value], i) => {
    const left = x + 40 + (i % 2) * (w / 2);
    const rowY = STATS.y + 70 + Math.floor(i / 2) * 30;
    write(ctx, name, left, rowY, body(16, 700), { alpha: 0.82 });
    write(ctx, value, left + w / 2 - 70, rowY, body(17, 900), { align: 'right' });
  });
}

/** The end: the score, and the way back in. */
export function drawOver(ctx: Ctx, game: Game, hover: string | null | undefined): void {
  const { x, y, w, h } = PANEL;
  const rows = overRows(game);
  veil(ctx, 0.5);
  plate(ctx, x, y, w, h, { radius: 26, alpha: 0.92 });
  headline(ctx, 'Spiel vorbei', W / 2, y + 80, 60);
  rows.forEach(([name, value], i) => {
    const rowY = y + 134 + i * 34;
    const colour = i === 0 || (i === 1 && game.newBest) ? AMBER : CREAM;
    write(ctx, name, x + 56, rowY, body(18, 700), { alpha: 0.82 });
    write(ctx, value, x + w - 56, rowY, body(19, 900), { align: 'right', colour });
  });
  for (const spot of menuSpots('over')) button(ctx, spot, hover === spot.choose);
  const stats = statRows(game);
  if (stats.length) statCard(ctx, stats);
}

export function drawPause(ctx: Ctx): void {
  veil(ctx, 0.55);
  headline(ctx, 'Pause', W / 2, 330, 76);
  const how = 'Klick oder P: weiter. Q: zurück zur Spielauswahl.';
  write(ctx, how, W / 2, 384, body(18), { align: 'center' });
}

/** A ring with four ticks, drawn twice: a dark edge so it shows on any sky, then the colour. */
function sightRing(ctx: Ctx, x: number, y: number, r: number, colour: string): void {
  ctx.lineCap = 'round';
  for (const [paint, width, alpha] of [
    [INK, 6.5, 0.4],
    [colour, 2.6, 1],
  ] as const) {
    ctx.strokeStyle = paint;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    for (let i = 0; i < 4; i++) {
      const [dx, dy] = [Math.cos((i * TAU) / 4), Math.sin((i * TAU) / 4)];
      ctx.moveTo(x + dx * (r - 5), y + dy * (r - 5));
      ctx.lineTo(x + dx * (r + 8), y + dy * (r + 8));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function shellDots(ctx: Ctx, left: number, x: number, y: number): void {
  for (let i = 0; i < SHELLS; i++) {
    ctx.fillStyle = i < left ? CREAM : INK;
    ctx.globalAlpha = i < left ? 1 : 0.45;
    ellipse(ctx, x + (i - 1) * 10, y, 3.2, 3.2);
  }
  ctx.globalAlpha = 1;
}

/** The sight: a ring that kicks with each shot, and under it the shells left. */
export function drawSight(ctx: Ctx, game: Game, fx: Fx, pointer: Pointer): void {
  if (!pointer.inside) return;
  const { x, y } = pointer;
  const aiming = game.screen === 'playing' && game.phase === 'flight';
  const r = 17 + fx.kick * 9;
  sightRing(ctx, x, y, r, aiming && game.shells === 0 ? CORAL : CREAM);
  ctx.fillStyle = AMBER;
  ellipse(ctx, x, y, 2.4, 2.4);
  if (aiming) shellDots(ctx, game.shells, x, y + r + 17);
}
