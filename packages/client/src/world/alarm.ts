import { useEffect, useRef, useState } from 'react';

/**
 * The world answering an alarm — any penalty: the picture strobes red twice,
 * the camera shakes, a klaxon sounds and every drone wears a „!" for a
 * second. All of it on this screen only: the server's drones are unchanged.
 * A screen marks the alarms it sees come in, never one that was there when
 * it came. Under reduced motion there is neither strobe nor shake. Pure but
 * for the two hooks at the end; the strobe and the shake are finale.css's.
 */

/** One flash of the strobe, and the dark between the two flashes, ms. */
export const FLASH_MS = 120;
/** The whole strobe: a flash, the dark, a flash. */
export const STROBE_MS = 3 * FLASH_MS;
/** How long the camera shakes, ms, and how far, CSS px (finale.css's keyframes). */
export const SHAKE_MS = 300;
export const SHAKE_PX = 3;
/** How long the drones wear their „!", ms. */
export const DRONE_MARK_MS = 1000;

/** An alarm this screen saw come in: the penalty count it raised, and when (epoch ms). */
export interface Alarm {
  seq: number;
  at: number;
}

/**
 * The last alarm, once the view's penalty count has gone from `seen` to
 * `seq` at `now`: a new one where it rose, `last` where it did not.
 */
export function nextAlarm(last: Alarm | null, seen: number, seq: number, now: number): Alarm | null {
  return seq > seen ? { seq, at: now } : last;
}

/** What an alarm `ms` ago still shows; nothing for none (null). */
export interface AlarmFx {
  strobe: boolean;
  shake: boolean;
  droneMarks: boolean;
}

export function alarmFx(ms: number | null, reduced: boolean): AlarmFx {
  if (ms === null || ms < 0) {
    return { strobe: false, shake: false, droneMarks: false };
  }
  return {
    strobe: !reduced && ms < STROBE_MS,
    shake: !reduced && ms < SHAKE_MS,
    droneMarks: ms < DRONE_MARK_MS,
  };
}

/** The world's classes while an alarm shows: the strobe over the picture, the camera shaking. */
export function alarmClasses(fx: AlarmFx): string {
  return [fx.strobe ? 'alarm-strobe' : null, fx.shake ? 'alarm-shake' : null]
    .filter((name) => name !== null)
    .join(' ');
}

/**
 * The last alarm this screen saw come in, kept from the view's penalty
 * count: `onAlarm` hears of each as it comes. The count the screen first
 * saw raises none.
 */
export function useAlarm(penaltySeq: number, onAlarm: () => void): Alarm | null {
  const seen = useRef(penaltySeq);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const heard = useRef(onAlarm);
  heard.current = onAlarm;
  useEffect(() => {
    const next = nextAlarm(null, seen.current, penaltySeq, Date.now());
    seen.current = penaltySeq;
    if (next !== null) {
      setAlarm(next);
      heard.current();
    }
  }, [penaltySeq]);
  return alarm;
}

/** The world's classes for `alarm`, re-rendering once its strobe and its shake are over. */
export function useAlarmClasses(alarm: Alarm | null, reduced: boolean): string {
  const [, setTick] = useState(0);
  const at = alarm?.at ?? null;
  useEffect(() => {
    const wait = at === null ? 0 : at + Math.max(STROBE_MS, SHAKE_MS) - Date.now();
    if (wait <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), wait);
    return () => clearTimeout(timer);
  }, [at]);
  return alarmClasses(alarmFx(at === null ? null : Date.now() - at, reduced));
}
