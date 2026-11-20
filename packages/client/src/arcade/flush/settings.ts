/**
 * What Ferret Flush keeps in this browser (the reference's src/settings.js): the best score of
 * each game, Classic and Modern apart, the sound choice and the settings of its Info. The
 * storage is passed in, so this runs in tests; anything odd falls back to its default.
 */
import { MODES, type Mode } from './rules.js';
import type { Store } from '../scores.js';

export type RuleBook = 'classic' | 'modern';

export const KEYS = {
  best: { classic: 'escapelab-flush-best-classic', modern: 'escapelab-flush-best-modern' },
  muted: 'escapelab-flush-muted',
  settings: 'escapelab-flush-settings',
} as const;

export interface FlushSettings {
  rules: RuleBook;
  music: number;
  effects: number;
  touchAim: boolean;
}

export const DEFAULTS: Readonly<FlushSettings> = {
  rules: 'modern',
  music: 0.5,
  effects: 0.8,
  touchAim: true,
};

function read(storage: Store | null, key: string): unknown {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null') as unknown;
  } catch {
    // No storage, or something else wrote there: start from nothing.
    return null;
  }
}

/** Writes a value; false where the browser keeps nothing (a private window, a full disk). */
export function write(storage: Store | null, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return storage !== null;
  } catch {
    return false;
  }
}

const field = (data: unknown, name: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;

/** The best score of each game under one rule book: whole numbers of zero or more. */
export function loadBest(storage: Store | null, rules: RuleBook): Record<Mode, number> {
  const kept = read(storage, KEYS.best[rules]);
  const best = { single: 0, pair: 0, clay: 0 };
  for (const mode of Object.keys(MODES) as Mode[]) {
    best[mode] = Math.max(0, Number(field(kept, mode)) || 0);
  }
  return best;
}

/** A volume between 0 and 1, or the default for anything else. */
function share(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/** The settings, each one checked: anything odd falls back to its default. */
export function loadSettings(storage: Store | null): FlushSettings {
  const kept = read(storage, KEYS.settings);
  const touchAim = field(kept, 'touchAim');
  return {
    rules: field(kept, 'rules') === 'classic' ? 'classic' : DEFAULTS.rules,
    music: share(field(kept, 'music'), DEFAULTS.music),
    effects: share(field(kept, 'effects'), DEFAULTS.effects),
    touchAim: typeof touchAim === 'boolean' ? touchAim : DEFAULTS.touchAim,
  };
}

export function loadMuted(storage: Store | null): boolean {
  return read(storage, KEYS.muted) === true;
}
