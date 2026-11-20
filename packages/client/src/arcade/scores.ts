/**
 * What the machine keeps in this browser (the reference's src/storage.js): the best score per
 * difficulty, Modern and Classic apart, and its own settings. Storage may be missing, refused or
 * hold anything: the machine plays on with what it has in memory.
 */
import type { Difficulty } from './rules.js';

export type Rules = 'modern' | 'classic';
export const SCORE_KEYS: Readonly<Record<Rules, string>> = {
  modern: 'escapelab-arcade-best-modern',
  classic: 'escapelab-arcade-best-classic',
};
export const SETTINGS_KEY = 'escapelab-arcade-settings';

/** What the machine reads and writes: localStorage, or anything with its two calls. */
export type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readJson(storage: Store | null, key: string): unknown {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null') as unknown;
  } catch {
    // A broken record reads as none.
    return null;
  }
}
function writeJson(storage: Store | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Refused storage keeps the value in memory alone.
  }
}
const field = (data: unknown, name: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;

export class Scores {
  values: Record<Difficulty, number> = { Easy: 0, Normal: 0, Hard: 0 };

  constructor(
    private readonly storage: Store | null,
    private readonly key: string,
  ) {
    const data = readJson(storage, key);
    for (const name of Object.keys(this.values) as Difficulty[]) {
      const value = field(data, name);
      if (Number.isSafeInteger(value) && (value as number) >= 0) this.values[name] = value as number;
    }
  }

  /** Keeps `score` where it beats the best; true where it did. */
  record(difficulty: Difficulty, score: number): boolean {
    if (score <= this.values[difficulty]) return false;
    this.values[difficulty] = score;
    writeJson(this.storage, this.key, this.values);
    return true;
  }
}

export interface MachineSettings {
  rules: Rules;
  music: number;
  effects: number;
  autofire: boolean;
}
export const DEFAULT_SETTINGS: Readonly<MachineSettings> = {
  rules: 'modern',
  music: 0.5,
  effects: 0.8,
  autofire: true,
};
const share = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 1;
const VALID: Readonly<Record<keyof MachineSettings, (v: unknown) => boolean>> = {
  rules: (v) => v === 'modern' || v === 'classic',
  music: share,
  effects: share,
  autofire: (v) => typeof v === 'boolean',
};

export class Settings {
  values: MachineSettings = { ...DEFAULT_SETTINGS };

  constructor(private readonly storage: Store | null) {
    const data = readJson(storage, SETTINGS_KEY);
    for (const name of Object.keys(VALID) as (keyof MachineSettings)[]) {
      const value = field(data, name);
      if (VALID[name](value)) Object.assign(this.values, { [name]: value });
    }
  }

  set<K extends keyof MachineSettings>(name: K, value: MachineSettings[K]): void {
    if (!VALID[name](value)) throw new Error(`arcade: invalid setting ${name}: ${String(value)}`);
    this.values[name] = value;
    writeJson(this.storage, SETTINGS_KEY, this.values);
  }
}

/** The page's localStorage, where the browser lets it be reached; null otherwise. */
export function pageStorage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // A browser that refuses storage plays with scores for this visit alone.
    return null;
  }
}
