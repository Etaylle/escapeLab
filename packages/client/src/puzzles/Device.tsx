import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moduleFor, type ConsoleId, type PuzzleView } from '@escapelab/core';
import { consoleName } from '../world/consoles.js';
import { cssVars, useChange, usePressFeel, type Change, type PressHandlers } from './feel.js';
import { alarmKlaxon, relayClick, solvedChord, solvedChunk, startHum } from './sounds.js';

/** How a lamp burns: dark, or lit in its colour. */
export type LampTone = 'off' | 'green' | 'red' | 'amber';

/** One LED of a device's strip: its colour, the word engraved beside it, and what it reports. */
export interface DeviceLed {
  tone: LampTone;
  /** the engraved word: „PARTNER", „KEIN PARTNER" */
  label: string;
  /** printed beside the word — the partner's name and place, where someone has to stand */
  detail: string | null;
}

/** The run around an open device, as the player's view counts it. */
export interface DeviceRun {
  /** the run's alarms so far (`penaltySeq`) */
  alarms: number;
  /** stations solved so far (`currentPuzzleIndex`): a device further up the list is done */
  solved: number;
}

export interface DeviceProps {
  /** the module behind the face; the bezel carries it as `device--<kind>` for its own look */
  kind: PuzzleView['kind'];
  /** the label plate: the station's paragraph in the printed rules, „§1" */
  paragraph: string;
  /** the label plate: the station's name */
  title: string;
  /** the plate's console tag, „PULT A", at a station with two consoles; null at one with one */
  tag: string | null;
  /** the strip beside the plate, left to right; none at all leaves the plate alone */
  leds: readonly DeviceLed[];
  /**
   * the alarms that came in while it was open, 0 for none: each new one flashes the status
   * strip red three times and jolts the chassis
   */
  alarms: number;
  /** the crew has solved it: the status strip sweeps green, the plate dims, no more presses */
  solved: boolean;
  /** what the face does with a press (`usePressFeel`); null where nobody works it */
  press: PressHandlers | null;
  /** the face: the module's controls and displays */
  children: ReactNode;
}

/** A lamp of a device: a glass dome, dark or lit in its colour — `fresh` just come on. */
export function DeviceLamp({ tone, fresh = false }: { tone: LampTone; fresh?: boolean }) {
  const lit = `device-lamp device-lamp--${tone}`;
  return <span className={fresh ? `${lit} device-lamp--fresh` : lit} aria-hidden="true" />;
}

/** How many LEDs the status strip along the bezel's foot has. */
export const STRIP_LEDS = 12;

/** The status strip along the bezel's foot: dark at work, red on an alarm, green once solved. */
function StatusStrip() {
  return (
    <span className="device-strip" aria-hidden="true">
      {Array.from({ length: STRIP_LEDS }, (_, i) => (
        <span key={i} className="device-strip-led" style={cssVars({ '--i': i })} />
      ))}
    </span>
  );
}

/**
 * The bezel's classes: its kind, the alarm that came in last — every other one named apart,
 * so that each starts its flash and jolt over — and whether it is solved.
 */
export function deviceClass(kind: PuzzleView['kind'], alarms: number, solved: boolean): string {
  const parity = alarms % 2 === 1 ? 'odd' : 'even';
  const alarm = alarms === 0 ? '' : ` device--alarm device--alarm-${parity}`;
  return `device device--${kind}${alarm}${solved ? ' device--solved' : ''}`;
}

/**
 * The physical frame every station's panel sits in, after Keep Talking's
 * modules: a metal bezel with a screw in each corner, a label plate naming
 * the station, an LED strip, the face with the controls — and not one word
 * of instruction on it — and along its foot the status strip that flashes
 * red on an alarm and sweeps green once the station is solved.
 */
export function Device(props: DeviceProps) {
  const { kind, paragraph, title, tag, leds, alarms, solved, press, children } = props;
  return (
    <div className={deviceClass(kind, alarms, solved)}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
        <span key={corner} className={`device-screw device-screw--${corner}`} aria-hidden="true" />
      ))}
      <div className="device-head">
        <div className="device-plate">
          <span className="device-plate-paragraph">{paragraph}</span>
          <span className="device-plate-title">{title}</span>
          {tag !== null && <span className="device-plate-tag">{tag}</span>}
        </div>
        {leds.length > 0 && (
          <ul className="device-leds">
            {leds.map((led) => (
              <li key={led.label} className={`device-led device-led--${led.tone}`}>
                <DeviceLamp tone={led.tone} />
                <span className="device-led-label">{led.label}</span>
                {led.detail !== null && <span className="device-led-detail">{led.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="device-face" inert={solved} {...(press ?? {})}>
        {children}
      </div>
      <StatusStrip />
    </div>
  );
}

const OTHER: Record<ConsoleId, ConsoleId> = { a: 'b', b: 'a' };

/** The station module behind an open puzzle; none for the relay, which never stands at one. */
function stationModule(puzzle: PuzzleView) {
  return puzzle.kind === 'relay' ? null : moduleFor(puzzle.kind);
}

/**
 * The LED that says whether this player's inputs count: green with who
 * backs them up and where — „Ben · Pult B", „Ben · SPIND" — or red with
 * where somebody has to stand. None where the whole crew works the station,
 * and none for the audience, who stands at no console.
 */
export function partnerLed(puzzle: PuzzleView): DeviceLed | null {
  const station = stationModule(puzzle);
  if (station === null || station.wholeCrew || puzzle.console === null) {
    return null;
  }
  const { backup } = puzzle;
  if (backup !== null) {
    return { tone: 'green', label: 'PARTNER', detail: `${backup.name} · ${backup.where}` };
  }
  const where =
    station.consoles === 2
      ? `an ${consoleName(OTHER[puzzle.console])} oder zu den Regeln`
      : 'zu den Regeln';
  return { tone: 'red', label: 'KEIN PARTNER', detail: `jemand ${where}` };
}

/**
 * Whether the device refuses every press right now: its station takes nobody alone, and
 * nobody backs this player up — the server says no to whatever goes out from here.
 */
export function refusesPresses(puzzle: PuzzleView): boolean {
  return partnerLed(puzzle)?.tone === 'red';
}

/**
 * The frame for the open puzzle: its paragraph and title on the plate, the
 * console this player works where the station has two — the view names
 * console a at a station with one as well, the module tells them apart —
 * and the partner LED.
 */
export function deviceOf(
  puzzle: PuzzleView,
): Omit<DeviceProps, 'children' | 'alarms' | 'solved' | 'press'> {
  const twoConsoles = stationModule(puzzle)?.consoles === 2;
  const partner = partnerLed(puzzle);
  return {
    kind: puzzle.kind,
    paragraph: `§${puzzle.index + 1}`,
    title: puzzle.title,
    tag:
      twoConsoles && puzzle.console !== null ? consoleName(puzzle.console).toUpperCase() : null,
    leds: partner === null ? [] : [partner],
  };
}

/** A device that drops home with a ka-chunk of its own once solved: the main switch's levers. */
function chunksItself(puzzle: PuzzleView): boolean {
  return puzzle.kind === 'button-sync' && puzzle.style === 'lever';
}

/** What a module's device sounds like at a change, beyond the kit; see `SOUNDS`. */
export type ChangeSounds = (change: Change<PuzzleView>) => void;

/** What the kit makes of an open device beyond its view: see `useDeviceFeel`. */
export interface DeviceFeel {
  /** the latest change while it was open; null before any */
  change: Change<PuzzleView> | null;
  /** alarms since it opened */
  alarms: number;
  solved: boolean;
  /** the face's press feel; null for the audience, which works no controls */
  press: PressHandlers | null;
}

/**
 * The kit at an open device. It opens with a relay click and hums until it closes; every
 * change plays once — the module's own `sounds`, and an alarm's klaxon after a buzz for the
 * control pressed just before it; solved, it drops home with a ka-chunk and a major chord.
 * The audience, at no console, sees all of it and hears none of it.
 */
export function useDeviceFeel(
  puzzle: PuzzleView,
  run: DeviceRun,
  sounds: ChangeSounds | null,
): DeviceFeel {
  const operating = puzzle.console !== null;
  const solved = run.solved > puzzle.index;
  const [alarmsAtOpen] = useState(run.alarms);
  const change = useChange(puzzle, run.alarms);
  const { handlers, blame } = usePressFeel(refusesPresses(puzzle), operating && !solved);
  useEffect(() => {
    if (!operating) {
      return undefined;
    }
    relayClick();
    const hum = startHum();
    return () => hum.stop();
  }, [operating]);
  useEffect(() => {
    if (change === null || !operating) {
      return;
    }
    sounds?.(change);
    if (change.alarm) {
      blame();
      alarmKlaxon();
    }
  }, [change, operating, sounds, blame]);
  const ownChunk = chunksItself(puzzle);
  useEffect(() => {
    if (solved && operating) {
      if (!ownChunk) {
        solvedChunk();
      }
      solvedChord();
    }
  }, [solved, operating, ownChunk]);
  return { change, alarms: run.alarms - alarmsAtOpen, solved, press: operating ? handlers : null };
}

/** How long a solved device stays in view: its strip sweeps green, then it closes itself. */
export const SOLVED_CLOSE_MS = 800;

/** Calls `close` once SOLVED_CLOSE_MS have passed; returns what calls it off. */
export function closeAfterSolved(close: () => void): () => void {
  const timer = setTimeout(close, SOLVED_CLOSE_MS);
  return () => clearTimeout(timer);
}

/**
 * The station `last` showed, solved by now (`solved` stations), as it stands done: a sync
 * station with every press in — a main switch with every lever down — a keypad with every
 * key lit, the Signalkette with every sign of its stage in; any other as last seen. Null
 * where it is not solved: only closed, or walked away from.
 */
export function heldView(last: PuzzleView, solved: number): PuzzleView | null {
  if (solved <= last.index) {
    return null;
  }
  switch (last.kind) {
    case 'button-sync':
      return { ...last, youPressed: true, pressedCount: last.requiredCount };
    case 'keypad':
      return last.keys === null
        ? last
        : {
            ...last,
            keys: last.keys.map((key) => ({ ...key, lit: true })),
            litCount: last.keys.length,
          };
    case 'signal':
      return { ...last, done: last.length };
    default:
      return last;
  }
}

/**
 * The open station's panel — and for SOLVED_CLOSE_MS after the crew solved it under this
 * player's hands, that station as it stands done (`heldView`), which then closes itself.
 * The solve takes the station off the map at once, so the device is shown from the last
 * view of it.
 */
export function useSolvedHold(station: PuzzleView | null, solved: number): PuzzleView | null {
  const kept = useRef<{ last: PuzzleView | null; held: PuzzleView | null }>({
    last: null,
    held: null,
  });
  const k = kept.current;
  if (station !== null) {
    k.last = station;
    k.held = null;
  } else if (k.last !== null) {
    k.held = heldView(k.last, solved);
    k.last = null;
  }
  const [, release] = useState(0);
  const held = k.held;
  useEffect(() => {
    if (held === null) {
      return undefined;
    }
    return closeAfterSolved(() => {
      kept.current.held = null;
      release((n) => n + 1);
    });
  }, [held]);
  return station ?? held;
}
