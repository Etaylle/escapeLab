/**
 * What the machine's screen says, in German: its own plain words for its menus, HUD, cards and
 * Info. The game's proper names stay as Uros named them („Ferret vs Ducks", „The Great Drake").
 * The simulation keeps the original's English reasons (rules.ts), which the Classic test
 * compares; the screen says them here (`REASONS`).
 */
import type { Difficulty, PickupKind } from './rules.js';
import type { Shape } from './modern.js';
import type { Rules } from './scores.js';

export const TITLE = 'Ferret vs Ducks';

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  Easy: 'Leicht',
  Normal: 'Normal',
  Hard: 'Schwer',
};
export const DIFFICULTY_COPY: Readonly<Record<Difficulty, string>> = {
  Easy: 'Ein sanfterer Schwarm. Zum Warmwerden.',
  Normal: 'Das klassische Tempo. Pfoten scharf halten.',
  Hard: 'Schnelle Federn. Keine Zeit zum Ducken.',
};
export const RULES_LABELS: Readonly<Record<Rules, string>> = {
  modern: '✦ Modern',
  classic: '◷ Klassisch',
};
export const RULES_COPY: Readonly<Record<Rules, string>> = {
  modern: 'Welle 1 wie immer; danach Kombos, Extras, Sturzflieger, Helme und ein Boss.',
  classic: 'Genau das Originalspiel: keine Kombos, Extras oder neuen Enten.',
};

/** The original's reasons for a game's end, as the screen says them. */
export const REASONS: Readonly<Record<string, string>> = {
  'The flock crossed the defense line.': 'Der Schwarm hat die Verteidigungslinie überquert.',
  'The flock got through.': 'Der Schwarm ist durchgekommen.',
};

export const PICKUP_LABELS: Readonly<Record<string, string>> = {
  spread: 'STREUSCHUSS',
  shield: 'SCHILD',
  slow: 'ZEITLUPE',
};
export const CHIP_LABELS: Readonly<Record<PickupKind, string>> = {
  spread: 'STREU',
  shield: 'SCHILD',
  slow: 'ZEITLUPE',
};

const WAVE_NEWS: Readonly<Record<number, readonly [string, string]>> = {
  2: [
    'Sturzflieger im Anflug',
    'Ein Sturzflieger, im Sturz getroffen, zählt doppelt. Der Besucher lässt jetzt Extras fallen.',
  ],
  3: ['Enten mit Helm', 'Ein Helm hält einen Treffer mehr aus.'],
};
const SHAPE_NEWS: Readonly<Record<Shape, readonly [string, string]>> = {
  grid: ['Wieder in Reih und Glied', 'Der Schwarm formiert sich neu, schneller.'],
  stagger: ['Versetzter Schwarm', 'Jede zweite Reihe fliegt einen halben Schritt versetzt.'],
  wedge: ['Keilformation', 'Die Mitte des Schwarms fliegt tiefer.'],
};
export const FIRST_WAVE: readonly [string, string] = [
  'Den Bau verteidigen.',
  'Welle 1 spielt nach den klassischen Regeln.',
];
export const BOSS_NEWS: readonly [string, string] = [
  'The Great Drake',
  'Ein Kapitän, der viele Treffer einsteckt. Vorsicht vor seinen Dreifachschüssen.',
];

/** What the banner of wave `wave` says: what is new, else the formation. */
export function waveNews(wave: number, boss: boolean, shape: Shape): readonly [string, string] {
  if (wave === 1) return FIRST_WAVE;
  if (boss) return BOSS_NEWS;
  return WAVE_NEWS[wave] ?? SHAPE_NEWS[shape];
}

/** „01", „12": a number as the HUD counts it. */
export const pad = (n: number, width: number): string => String(n).padStart(width, '0');
