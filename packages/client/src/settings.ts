import { useSyncExternalStore } from 'react';
import { useMedia } from './hooks.js';
import { setVolumes } from './world/audio.js';

/**
 * The player's settings on this device, as the panel sets them (screens/Settings.tsx): how
 * loud the radio, the effects and the music play, the key held to talk, how large the text
 * stands, and whether things move less. They are kept in the browser's storage and act where
 * they belong: on the audio's buses (world/audio.ts), on the talk key (voice/useVoice.ts),
 * and on the page's root — the text's scale as `--text-scale`, which the HUD, the book, the
 * devices and the notepad set their text by, and the motion as `data-motion`, which every
 * sheet's calmer rules hang on. „System" motion follows the browser's own
 * `prefers-reduced-motion`, live.
 */

export type TextSize = 'small' | 'normal' | 'large';
/** Less motion: off, on, or as the browser asks („System"). */
export type Motion = 'off' | 'on' | 'system';

/** The three volumes, each a whole number from 0 to 100. */
export interface Volumes {
  /** mission control's voice and the radio's chirp */
  radio: number;
  /** every other sound of the lab and the devices: steps, doors, beds, alarms */
  effects: number;
  music: number;
}

export interface Settings {
  volumes: Volumes;
  /** the key held to talk, as KeyboardEvent names it, lower-cased */
  talkKey: string;
  textSize: TextSize;
  motion: Motion;
}

export const DEFAULT_SETTINGS: Settings = {
  volumes: { radio: 100, effects: 100, music: 70 },
  talkKey: 'v',
  textSize: 'normal',
  motion: 'system',
};

/** Where the settings are kept in the browser's storage. */
export const SETTINGS_KEY = 'escapelab.settings';

/** How large the text stands at each size, against its normal size. */
export const TEXT_SCALE: Readonly<Record<TextSize, number>> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
};

const TEXT_SIZES: readonly TextSize[] = ['small', 'normal', 'large'];
const MOTIONS: readonly Motion[] = ['off', 'on', 'system'];

/** The media query of a browser that asks for less motion. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Storage as the settings use it: the browser's local storage, or a stand-in in a test. */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The keys the game takes for itself, as KeyboardEvent names them lower-cased: walking and
 * sprinting, E, Enter and Space, Q, M, C, I, H and ?, N, the quick chat's 1–8, Esc, and the
 * keys a field or the browser keeps.
 */
const TAKEN = new Set([
  ...['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'],
  ...['e', 'enter', ' ', 'q', 'm', 'c', 'i', 'h', '?', 'n', 'escape', 'tab'],
  ...['1', '2', '3', '4', '5', '6', '7', '8', 'backspace', 'delete'],
]);

/** What a key would be as the talk key: fine, taken by the game, or no key to hold. */
export type KeyVerdict = 'ok' | 'taken' | 'unfit';

/**
 * Whether `key` (as KeyboardEvent names it) can be the talk key: a key of one character or
 * F1–F12 that the game does not take already. Modifiers alone are no talk key: the talk key
 * is held without them.
 */
export function talkKeyVerdict(key: string): KeyVerdict {
  const named = key.toLowerCase();
  if (TAKEN.has(named)) {
    return 'taken';
  }
  const one = [...named].length === 1 && named.trim() !== '';
  return one || /^f([1-9]|1[0-2])$/.test(named) ? 'ok' : 'unfit';
}

/** A key as the screen names it: V, F2, Ö. */
export function keyName(key: string): string {
  return key.toUpperCase();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `value` as a volume: a number held to 0–100 and rounded; null for anything else. */
function volumeOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : null;
}

/** One of `allowed`, where `value` is one; else `fallback`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** What `store` keeps under SETTINGS_KEY, parsed; null for nothing, or nothing readable. */
function stored(store: SettingsStore | null): Record<string, unknown> | null {
  let text: string | null = null;
  try {
    text = store?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    // Storage blocked: the defaults apply, as on a first visit.
    return null;
  }
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    console.warn(`[escapelab] the stored settings are no JSON, the defaults apply: ${text}`);
    return null;
  }
}

/** The settings `store` keeps, each one missing or malformed at its default. */
export function readSettings(store: SettingsStore | null): Settings {
  const raw = stored(store) ?? {};
  const volumes = isRecord(raw['volumes']) ? raw['volumes'] : {};
  const fallback = DEFAULT_SETTINGS;
  const talkKey = raw['talkKey'];
  return {
    volumes: {
      radio: volumeOf(volumes['radio']) ?? fallback.volumes.radio,
      effects: volumeOf(volumes['effects']) ?? fallback.volumes.effects,
      music: volumeOf(volumes['music']) ?? fallback.volumes.music,
    },
    talkKey:
      typeof talkKey === 'string' && talkKeyVerdict(talkKey) === 'ok'
        ? talkKey.toLowerCase()
        : fallback.talkKey,
    textSize: oneOf(raw['textSize'], TEXT_SIZES, fallback.textSize),
    motion: oneOf(raw['motion'], MOTIONS, fallback.motion),
  };
}

/** Keeps `settings` in `store`; false where the browser refuses it (storage full or off). */
export function writeSettings(store: SettingsStore | null, settings: Settings): boolean {
  if (store === null) {
    return false;
  }
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    // Storage refused: the settings hold for this visit and are gone on the next.
    return false;
  }
}

/** Whether things move less: „An", or „System" where the browser asks for it (`system`). */
export function motionReduced(motion: Motion, system: boolean): boolean {
  return motion === 'on' || (motion === 'system' && system);
}

/** The page's root, as far as the settings set it: its style and its data. */
export interface SettingsRoot {
  style: { setProperty(name: string, value: string): void };
  dataset: DOMStringMap;
}

/**
 * The look of `settings` on the page's root: the text's scale as `--text-scale`, and the
 * motion as `data-motion` — „reduce" or „full" — with the browser asking for less (`system`).
 */
export function applyLook(settings: Settings, root: SettingsRoot, system: boolean): void {
  root.style.setProperty('--text-scale', String(TEXT_SCALE[settings.textSize]));
  root.dataset['motion'] = motionReduced(settings.motion, system) ? 'reduce' : 'full';
}

/** The volumes on the audio's buses, as shares of full. */
export function applyVolumes(volumes: Volumes): void {
  setVolumes({
    radio: volumes.radio / 100,
    effects: volumes.effects / 100,
    music: volumes.music / 100,
  });
}

/** The browser's local storage; null where the page may not have it. */
function localSettings(): SettingsStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the browser asks for less motion; without a window, nothing asks. */
function systemReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION).matches
  );
}

let current: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();
/** Whether the panel waits for the next key, the new talk key: meanwhile no key talks. */
let rebinding = false;

/** The settings as they stand now. */
export function getSettings(): Settings {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies `settings` where they act: the audio's buses, and the page's root where there is one. */
function apply(settings: Settings): void {
  applyVolumes(settings.volumes);
  if (typeof document !== 'undefined') {
    applyLook(settings, document.documentElement, systemReduced());
  }
}

/**
 * Reads this device's settings and applies them, and follows the browser's motion
 * preference from then on. Once, as the page starts (main.tsx).
 */
export function startSettings(): void {
  current = readSettings(localSettings());
  apply(current);
  window.matchMedia(REDUCED_MOTION).addEventListener('change', () => apply(current));
}

/** Changes the settings by `patch`: kept on this device, applied, and every screen told. */
export function changeSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  writeSettings(localSettings(), current);
  apply(current);
  for (const listener of listeners) {
    listener();
  }
}

/** The settings, kept up to date. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Whether things move less now, by the settings and the browser. */
export function reducedMotion(): boolean {
  return motionReduced(current.motion, systemReduced());
}

/** Whether things move less, kept up to date with the settings and the browser. */
export function useReducedMotion(): boolean {
  const { motion } = useSettings();
  return motionReduced(motion, useMedia(REDUCED_MOTION));
}

/** Whether the panel waits for a new talk key. */
export function isRebinding(): boolean {
  return rebinding;
}

/** The panel starts or stops waiting for a new talk key. */
export function setRebinding(waiting: boolean): void {
  rebinding = waiting;
}
