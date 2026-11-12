import { achievement, dailyLabel, type AchievementId, type Grade } from '@escapelab/core';
import { clock, dateText } from '../runStats.js';
import type { Ending } from '../world/finale.js';

/**
 * The run's card as a picture to keep: 1200 × 630, the size a link's preview takes — the
 * mission, what the run came to, its time and rank, the crew by name in their colours, the
 * Erfolge it earned on brass, the day, in the lab's own type: monospace, capitals spaced out.
 * Drawn on a canvas (`drawShareCard`, any 2D context) and saved as a PNG (`saveShareCard`).
 */

/** The card's size, pixels. */
export const SHARE_SIZE = { width: 1200, height: 630 } as const;

/** What the card shows of a run that is over. */
export interface ShareCard {
  ending: Ending;
  missionTitle: string;
  /** how long it took, ms; null where it had no start or no end */
  usedMs: number | null;
  grade: Grade | null;
  stations: { solved: number; total: number };
  crew: readonly { name: string; color: string }[];
  achievements: readonly AchievementId[];
  /** when it ended, epoch ms */
  finishedAt: number;
  /** the Tagesschicht's day it played, „2026-10-31"; null for any other run */
  daily: string | null;
}

/** What each ending is called on the card, as the title card has it. */
const WORDS: Readonly<Record<Ending, string>> = {
  won: 'GESCHAFFT',
  'lost:time': 'ZEIT ABGELAUFEN',
  'lost:alarms': 'NOTVERSORGUNG ABGESCHALTET',
  'lost:abandoned': 'EINSATZ ABGEBROCHEN',
};

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MARGIN = 64;
const INK = {
  won: ['#0a1730', '#0f2a33'],
  lost: ['#2a0a0b', '#080203'],
  accent: '#2dd4bf',
  word: '#f4fff8',
  red: '#f87171',
  label: '#94a3b8',
  text: '#e2e8f0',
  faint: '#64748b',
  brass: '#b59552',
  brassLit: '#d8bd7c',
  engraved: '#2a2010',
  amber: '#fbbf24',
} as const;
const RANKS: Readonly<Record<Grade['rank'], string>> = {
  S: '#fbbf24',
  A: '#2dd4bf',
  B: '#60a5fa',
  C: '#94a3b8',
};

/** How a line of the card is set: `size` px, `weight`, letters `spacing` px apart. */
interface TextStyle {
  size: number;
  weight?: number;
  spacing?: number;
  color: string;
  align?: CanvasTextAlign;
}

/** Text at (x, y) in the lab's type, as `style` sets it. */
function text(
  ctx: CanvasRenderingContext2D,
  words: string,
  [x, y]: readonly [number, number],
  style: TextStyle,
): void {
  ctx.font = `${style.weight ?? 600} ${style.size}px ${MONO}`;
  ctx.letterSpacing = `${style.spacing ?? 0}px`;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align ?? 'left';
  ctx.fillText(words, x, y);
}

/** The largest size up to `size` at which `words` fit `width` px in the lab's type. */
function fitted(ctx: CanvasRenderingContext2D, words: string, size: number, width: number): number {
  for (let at = size; at > 24; at -= 4) {
    ctx.font = `800 ${at}px ${MONO}`;
    if (ctx.measureText(words).width <= width) {
      return at;
    }
  }
  return 24;
}

/** The ground: dark blue-green for a run won, the red of the dark lab for one lost. */
function ground(ctx: CanvasRenderingContext2D, won: boolean): void {
  const { width, height } = SHARE_SIZE;
  const [top, bottom] = won ? INK.won : INK.lost;
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(24, 24, width - 48, height - 48, 22);
  ctx.stroke();
}

/** The head: the game's name, the day and — on the Tagesschicht — which; the mission; the word. */
function head(ctx: CanvasRenderingContext2D, card: ShareCard): void {
  const right = SHARE_SIZE.width - MARGIN;
  text(ctx, 'ESCAPELAB', [MARGIN, 88], { size: 22, weight: 700, spacing: 6, color: INK.accent });
  const date: TextStyle = { size: 22, color: INK.label, align: 'right' };
  text(ctx, dateText(card.finishedAt), [right, 88], date);
  if (card.daily !== null) {
    const day = `TAGESSCHICHT ${dailyLabel(card.daily)}`;
    text(ctx, day, [right, 120], { ...date, size: 18, weight: 700, spacing: 3, color: INK.amber });
  }
  const mission = card.missionTitle.toUpperCase();
  text(ctx, mission, [MARGIN, 172], { size: 26, spacing: 8, color: '#9fb4c8' });
  const word = WORDS[card.ending];
  const won = card.ending === 'won';
  const size = fitted(ctx, word, 104, SHARE_SIZE.width - 2 * MARGIN);
  if (won) {
    ctx.shadowColor = 'rgba(134, 239, 172, 0.55)';
    ctx.shadowBlur = 28;
  }
  text(ctx, word, [MARGIN - 4, 172 + size + 8], {
    size,
    weight: 800,
    spacing: 10,
    color: won ? INK.word : INK.red,
  });
  ctx.shadowBlur = 0;
}

/** The time large, and the rank beside it — or, for a run lost, the stations it got through. */
function facts(ctx: CanvasRenderingContext2D, card: ShareCard): void {
  const top = 400;
  const large: TextStyle = { size: 72, weight: 700, color: INK.text };
  const label: TextStyle = { size: 18, spacing: 4, color: INK.label };
  if (card.usedMs !== null) {
    text(ctx, clock(card.usedMs / 1000), [MARGIN, top], large);
    text(ctx, 'ZEIT', [MARGIN, top + 34], label);
  }
  const x = MARGIN + 260;
  if (card.grade !== null) {
    const tint = RANKS[card.grade.rank];
    ctx.strokeStyle = tint;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, top - 66, 84, 84);
    const rank: TextStyle = { size: 64, weight: 800, color: tint, align: 'center' };
    text(ctx, card.grade.rank, [x + 42, top], rank);
    text(ctx, 'RANG', [x, top + 34], label);
    return;
  }
  const { solved, total } = card.stations;
  text(ctx, `${solved}/${total}`, [x, top], large);
  text(ctx, 'STATIONEN', [x, top + 34], label);
}

/** How far right the crew's row may run, px: clear of the plaques' column (`plaques`). */
export const CREW_RIGHT = 680;
/** The sizes the crew's names are tried at, largest first; at the last they are cut short. */
const SMALLEST_CREW = 18;
const CREW_SIZES = [28, 24, 21, SMALLEST_CREW];

/** The crew row's measures at `size` px: a dot's radius, from a dot to its name, to the next. */
function crewSpacing(size: number): { dot: number; lead: number; gap: number } {
  const k = size / 28;
  return { dot: 9 * k, lead: 28 * k, gap: 36 * k };
}

/** `name` cut short with „…" to `width` px, in the font `ctx` has. */
function cutTo(ctx: CanvasRenderingContext2D, name: string, width: number): string {
  if (ctx.measureText(name).width <= width) {
    return name;
  }
  let cut = name;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/**
 * The largest size the crew's `names` fit at left of the plaques, and the names — at the
 * smallest, each cut short to an equal share of the row where even that is too wide.
 */
function crewFit(ctx: CanvasRenderingContext2D, names: readonly string[]) {
  const room = CREW_RIGHT - MARGIN;
  ctx.letterSpacing = '0px';
  for (const size of CREW_SIZES) {
    ctx.font = `600 ${size}px ${MONO}`;
    const { lead, gap } = crewSpacing(size);
    const widths = names.map((name) => lead + ctx.measureText(name).width + gap);
    const width = widths.reduce((sum, each) => sum + each, -gap);
    if (width <= room) {
      return { size, names };
    }
  }
  const { lead, gap } = crewSpacing(SMALLEST_CREW);
  const share = (room + gap) / names.length - lead - gap;
  return { size: SMALLEST_CREW, names: names.map((name) => cutTo(ctx, name, share)) };
}

/** The crew by name, each behind a dot of their colour, the row left of the plaques. */
function crew(ctx: CanvasRenderingContext2D, card: ShareCard): void {
  const y = 530;
  const fit = crewFit(ctx, card.crew.map((mate) => mate.name));
  const { dot, lead, gap } = crewSpacing(fit.size);
  let x = MARGIN;
  card.crew.forEach((mate, i) => {
    const name = fit.names[i] ?? mate.name;
    ctx.fillStyle = mate.color;
    ctx.beginPath();
    ctx.arc(x + dot, y - dot - 1, dot, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, name, [x + lead, y], { size: fit.size, color: INK.text });
    x += lead + ctx.measureText(name).width + gap;
  });
  text(ctx, 'FORSCHUNGSANLAGE KALTENBRUNN', [MARGIN, 584], {
    size: 15,
    spacing: 5,
    color: INK.faint,
  });
}

/** The Erfolge on brass, one under the other in the card's right half. */
function plaques(ctx: CanvasRenderingContext2D, card: ShareCard): void {
  const x = 700;
  const width = SHARE_SIZE.width - MARGIN - x;
  card.achievements.forEach((id, i) => {
    const y = 316 + i * 42;
    const plate = ctx.createLinearGradient(0, y, 0, y + 34);
    plate.addColorStop(0, INK.brassLit);
    plate.addColorStop(1, INK.brass);
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(x, y, width, 34, 4);
    ctx.fill();
    ctx.fillStyle = INK.engraved;
    for (const screw of [x + 10, x + width - 10]) {
      ctx.beginPath();
      ctx.arc(screw, y + 17, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const title = achievement(id).title.toUpperCase();
    text(ctx, title, [x + width / 2, y + 23], {
      size: 16,
      weight: 700,
      spacing: 2,
      color: INK.engraved,
      align: 'center',
    });
  });
}

/** The card of `card`'s run on `ctx`, SHARE_SIZE large. */
export function drawShareCard(ctx: CanvasRenderingContext2D, card: ShareCard): void {
  ground(ctx, card.ending === 'won');
  head(ctx, card);
  facts(ctx, card);
  crew(ctx, card);
  plaques(ctx, card);
}

/** What the picture is saved as: „escapelab-blackout-im-labor-2026-10-31.png". */
export function shareFileName(card: Pick<ShareCard, 'missionTitle' | 'finishedAt'>): string {
  const slug = card.missionTitle
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const day = new Date(card.finishedAt);
  const date = [day.getFullYear(), day.getMonth() + 1, day.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  return `escapelab-${slug}-${date}.png`;
}

/** `blob` saved as `name` through the browser's download. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The card drawn on a canvas of its own and saved as a PNG through the browser's download —
 * rejected, saying why, where the browser draws or encodes no picture; whatever goes wrong on
 * the way rejects too, the browser's own reason as the cause.
 */
export async function saveShareCard(card: ShareCard): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_SIZE.width;
  canvas.height = SHARE_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Dieser Browser zeichnet kein Bild.');
  }
  try {
    drawShareCard(ctx, card);
  } catch (cause) {
    throw new Error('Dieser Browser zeichnet das Bild nicht.', { cause });
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) {
    throw new Error('Das Bild ließ sich nicht erzeugen.');
  }
  download(blob, shareFileName(card));
}
