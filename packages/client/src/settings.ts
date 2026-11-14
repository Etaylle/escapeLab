import { useSyncExternalStore } from 'react';
import { useMedia } from './hooks.js';
import {
  DEFAULT_KEYS,
  DEFAULT_PAD,
  readKeys,
  readPad,
  type KeyBindings,
  type PadBindings,
} from './input/bindings.js';
import type { PadFamily } from './input/pad.js';
import { setVolumes } from './world/audio.js';
import {
  DEFAULT_CHOICE,
  packById,
  setMusicChoice,
  type MusicChoice,
} from './world/musicPacks.js';
import { SLOTS, type Slot } from './world/packFile.js';

/**
 * The player's settings on this device, as the panel sets them (screens/Settings.tsx): how
 * loud the lab plays as a whole and each of the audio's buses — the music, the effects, the
 * radio's voice, the rooms' beds — and which of the buses stand muted; the key for every action
 * and the controller's buttons for the four main ones (input/bindings.ts), the stick's dead zone
 * and the symbols the prompts give its buttons; how large the text stands, whether things move
 * less and how the world's light is drawn; the crew's colours with a pattern each, and how large
 * the spoken lines' words stand; the music pack and the pieces picked for single places of the
 * music. They are kept in the browser's storage and act where they belong: on the audio's buses
 * (world/audio.ts), on the music (world/musicPacks.ts), on the keys the world, the screens and
 * the voice listen for and the prompts name (input/), on the light (world/gl/path.ts), and on the
 * page's root — the text's scale as `--text-scale`, which the HUD, the book, the devices and the
 * notepad set their text by, the spoken lines' as `--subtitle-scale`, the motion as
 * `data-motion`, which every sheet's calmer rules hang on, and the patterns as `data-patterns`.
 * „System" motion follows the browser's own `prefers-reduced-motion`, live. The whole lab's mute
 * is the top bar's sound switch (world/audio.ts `setMuted`), kept beside these.
 */

export type TextSize = 'small' | 'normal' | 'large';
/** Less motion: off, on, or as the browser asks („System"). */
export type Motion = 'off' | 'on' | 'system';
/** How the world's light is drawn: as the machine allows — WebGL where it can — or by Canvas. */
export type LightWay = 'auto' | 'canvas';
/** Which buttons the prompts name: the controller's own, as it reports itself, or one kind. */
export type GlyphChoice = 'auto' | PadFamily;
/** How large the spoken lines' words stand: the radio's banner, the opening's subtitles. */
export type SubtitleSize = 'normal' | 'large' | 'larger';

/** The five volumes, each a whole number from 0 to 100. */
export interface Volumes {
  /** the whole lab at once, at the point the sound switch mutes (Gesamt) */
  master: number;
  music: number;
  /** every sound of the lab and the devices but the rooms' beds: steps, doors, alarms */
  effects: number;
  /** mission control's voice, the radio's chirp, the plant's loudspeakers (Funk) */
  voice: number;
  /** the rooms' beds: the hum, the air, the machines (Umgebung) */
  ambience: number;
}

/** An audio bus a volume sets. */
export type Bus = keyof Volumes;

/** The buses the settings mute on their own: all but the whole lab, whose mute is the switch's. */
export type Muted = Readonly<Record<Exclude<Bus, 'master'>, boolean>>;

export interface Settings {
  volumes: Volumes;
  muted: Muted;
  /** the key of every action, as KeyboardEvent names it, lower-cased (input/bindings.ts) */
  keys: KeyBindings;
  /** the controller's buttons for the four main actions (input/bindings.ts) */
  pad: PadBindings;
  /** how far the stick may lean before it counts, in percent of its full lean (input/pad.ts) */
  deadzone: number;
  glyphs: GlyphChoice;
  textSize: TextSize;
  motion: Motion;
  light: LightWay;
  /** the crew's colours carry a pattern each in the chrome (styles/settings.css) */
  patterns: boolean;
  subtitles: SubtitleSize;
  /** the music pack, and the pieces picked for single places of the music (world/musicPacks.ts) */
  music: MusicChoice;
}

/** The stick's dead zone the settings allow, in percent: from a hair to a good part of it. */
export const DEADZONE_MIN = 5;
export const DEADZONE_MAX = 40;

export const DEFAULT_SETTINGS: Settings = {
  volumes: { master: 100, music: 70, effects: 100, voice: 100, ambience: 100 },
  muted: { music: false, effects: false, voice: false, ambience: false },
  keys: DEFAULT_KEYS,
  pad: DEFAULT_PAD,
  deadzone: 20,
  glyphs: 'auto',
  textSize: 'normal',
  motion: 'system',
  light: 'auto',
  patterns: false,
  subtitles: 'normal',
  music: DEFAULT_CHOICE,
};

/** Where the settings are kept in the browser's storage. */
export const SETTINGS_KEY = 'escapelab.settings';

/** How large the text stands at each size, against its normal size. */
export const TEXT_SCALE: Readonly<Record<TextSize, number>> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
};

/** How large the spoken lines' words stand at each size, against their normal size. */
export const SUBTITLE_SCALE: Readonly<Record<SubtitleSize, number>> = {
  normal: 1,
  large: 1.25,
  larger: 1.5,
};

const TEXT_SIZES: readonly TextSize[] = ['small', 'normal', 'large'];
const MOTIONS: readonly Motion[] = ['off', 'on', 'system'];
const LIGHTS: readonly LightWay[] = ['auto', 'canvas'];
const GLYPHS: readonly GlyphChoice[] = ['auto', 'xbox', 'playstation'];
const SUBTITLES: readonly SubtitleSize[] = ['normal', 'large', 'larger'];

/** The media query of a browser that asks for less motion. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Storage as the settings use it: the browser's local storage, or a stand-in in a test. */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

/** The first of `values` that is a volume (`volumeOf`); `fallback` where none is. */
function firstVolume(values: readonly unknown[], fallback: number): number {
  for (const value of values) {
    const volume = volumeOf(value);
    if (volume !== null) {
      return volume;
    }
  }
  return fallback;
}

/**
 * The volumes `raw` keeps, each missing or malformed at its default. Settings kept before the
 * buses had a volume each set the radio's voice as „radio" and the beds with the effects: they
 * come over so.
 */
function readVolumes(raw: Record<string, unknown>): Volumes {
  const kept = isRecord(raw['volumes']) ? raw['volumes'] : {};
  const fallback = DEFAULT_SETTINGS.volumes;
  return {
    master: firstVolume([kept['master']], fallback.master),
    music: firstVolume([kept['music']], fallback.music),
    effects: firstVolume([kept['effects']], fallback.effects),
    voice: firstVolume([kept['voice'], kept['radio']], fallback.voice),
    ambience: firstVolume([kept['ambience'], kept['effects']], fallback.ambience),
  };
}

/** The mutes `raw` keeps: a bus muted only where it says so in as many words. */
function readMuted(raw: Record<string, unknown>): Muted {
  const kept = isRecord(raw['muted']) ? raw['muted'] : {};
  return {
    music: kept['music'] === true,
    effects: kept['effects'] === true,
    voice: kept['voice'] === true,
    ambience: kept['ambience'] === true,
  };
}

/** The stick's dead zone `value` keeps, in percent: a number held to its range, or the default. */
function deadzoneOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(DEADZONE_MAX, Math.max(DEADZONE_MIN, value)))
    : DEFAULT_SETTINGS.deadzone;
}

/**
 * The music `value` keeps: a pack the game ships, else the default; and for each place a pack
 * the game ships — any other is let go, as a pack no longer shipped.
 */
function readMusic(value: unknown): MusicChoice {
  const kept = isRecord(value) ? value : {};
  const picked = isRecord(kept['pieces']) ? kept['pieces'] : {};
  const pieces: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) {
    const pack = shippedPack(picked[slot]);
    if (pack !== null) pieces[slot] = pack;
  }
  return { pack: shippedPack(kept['pack']) ?? DEFAULT_CHOICE.pack, pieces };
}

/** The pack `value` names, where the game ships it — every pack fills every place; else null. */
function shippedPack(value: unknown): string | null {
  return typeof value === 'string' ? (packById(value)?.id ?? null) : null;
}

/** The settings `store` keeps, each one missing or malformed at its default. */
export function readSettings(store: SettingsStore | null): Settings {
  const raw = stored(store) ?? {};
  const fallback = DEFAULT_SETTINGS;
  return {
    volumes: readVolumes(raw),
    muted: readMuted(raw),
    // Settings kept before every action had a key of its own named only the talk key.
    keys: readKeys(raw['keys'] ?? { talk: raw['talkKey'] }),
    pad: readPad(raw['pad']),
    deadzone: deadzoneOf(raw['deadzone']),
    glyphs: oneOf(raw['glyphs'], GLYPHS, fallback.glyphs),
    textSize: oneOf(raw['textSize'], TEXT_SIZES, fallback.textSize),
    motion: oneOf(raw['motion'], MOTIONS, fallback.motion),
    light: oneOf(raw['light'], LIGHTS, fallback.light),
    patterns: raw['patterns'] === true,
    subtitles: oneOf(raw['subtitles'], SUBTITLES, fallback.subtitles),
    music: readMusic(raw['music']),
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
 * The look of `settings` on the page's root: the text's scale as `--text-scale`, the spoken
 * lines' as `--subtitle-scale`, the motion as `data-motion` — „reduce" or „full" — with the
 * browser asking for less (`system`), and the crew's colour patterns as `data-patterns`.
 */
export function applyLook(settings: Settings, root: SettingsRoot, system: boolean): void {
  root.style.setProperty('--text-scale', String(TEXT_SCALE[settings.textSize]));
  root.style.setProperty('--subtitle-scale', String(SUBTITLE_SCALE[settings.subtitles]));
  root.dataset['motion'] = motionReduced(settings.motion, system) ? 'reduce' : 'full';
  root.dataset['patterns'] = settings.patterns ? 'on' : 'off';
}

/** A bus's volume as a share of full, nothing where the settings mute it. */
const shareOf = (volume: number, muted: boolean): number => (muted ? 0 : volume / 100);

/**
 * The volumes on the audio's buses, as shares of full, a bus the settings mute at nothing; the
 * whole lab's at its own, under the sound switch's mute (world/audio.ts).
 */
export function applyVolumes(volumes: Volumes, muted: Muted = DEFAULT_SETTINGS.muted): void {
  setVolumes({
    master: volumes.master / 100,
    music: shareOf(volumes.music, muted.music),
    effects: shareOf(volumes.effects, muted.effects),
    voice: shareOf(volumes.voice, muted.voice),
    ambience: shareOf(volumes.ambience, muted.ambience),
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

/** The browser's ask for less motion: its query, and what it last answered. */
interface SystemMotion {
  query: MediaQueryList;
  reduce: boolean;
}

/** The query, asked once a page; null until a window was there to ask. */
let systemMotion: SystemMotion | null = null;

/**
 * The browser's motion query, asked once a page and its answer kept as it changes — the
 * scene's loop asks after the motion each frame; null without a window to ask.
 */
function motionQuery(): SystemMotion | null {
  if (
    systemMotion === null &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    const query = window.matchMedia(REDUCED_MOTION);
    const asked: SystemMotion = { query, reduce: query.matches };
    query.addEventListener('change', (e) => {
      asked.reduce = e.matches;
    });
    systemMotion = asked;
  }
  return systemMotion;
}

/** Whether the browser asks for less motion; without a window, nothing asks. */
function systemReduced(): boolean {
  return motionQuery()?.reduce === true;
}

let current: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();
/**
 * How many of the panel's waits for the next key or controller button, to bind it, are open:
 * meanwhile no key and no button acts — nobody talks, walks or works.
 */
let waits = 0;

/** The settings as they stand now. */
export function getSettings(): Settings {
  return current;
}

/** Calls `listener` whenever the settings change; returns what stops it. */
export function watchSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Applies `settings` where they act: the audio's buses, the music's choice, and the page's root
 * where there is one.
 */
function apply(settings: Settings): void {
  applyVolumes(settings.volumes, settings.muted);
  setMusicChoice(settings.music);
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
  motionQuery()?.query.addEventListener('change', () => apply(current));
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
  return useSyncExternalStore(watchSettings, getSettings, getSettings);
}

/** Whether things move less now, by the settings and the browser. */
export function reducedMotion(): boolean {
  return motionReduced(current.motion, systemReduced());
}

/**
 * Calls `changed` whenever `reducedMotion` may have turned — the settings changed, or what the
 * browser asks — as a loop standing still under reduced motion needs to hear; returns the stop.
 */
export function watchMotion(changed: () => void): () => void {
  const unwatch = watchSettings(changed);
  const query = motionQuery()?.query;
  query?.addEventListener('change', changed);
  return () => {
    unwatch();
    query?.removeEventListener('change', changed);
  };
}

/** Whether things move less, kept up to date with the settings and the browser. */
export function useReducedMotion(): boolean {
  const { motion } = useSettings();
  return motionReduced(motion, useMedia(REDUCED_MOTION));
}

/** Whether the panel waits for a key or a controller button to bind. */
export function isRebinding(): boolean {
  return waits > 0;
}

/**
 * The panel starts waiting for a key or a controller button to bind; returns what ends this
 * wait, once — the keys' table and the controller's each end their own.
 */
export function startRebinding(): () => void {
  waits += 1;
  let open = true;
  return () => {
    if (open) {
      open = false;
      waits -= 1;
    }
  };
}
