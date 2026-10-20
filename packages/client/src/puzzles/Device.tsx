import type { ReactNode } from 'react';
import { moduleFor, type ConsoleId, type PuzzleView } from '@escapelab/core';
import { consoleName } from '../world/consoles.js';

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
  /** the face: the module's controls and displays */
  children: ReactNode;
}

/** A lamp of a device: a glass dome, dark or lit in its colour. */
export function DeviceLamp({ tone }: { tone: LampTone }) {
  return <span className={`device-lamp device-lamp--${tone}`} aria-hidden="true" />;
}

/**
 * The physical frame every station's panel sits in, after Keep Talking's
 * modules: a metal bezel with a screw in each corner, a label plate naming
 * the station, an LED strip, and the face with the controls — and not one
 * word of instruction on it.
 */
export function Device({ kind, paragraph, title, tag, leds, children }: DeviceProps) {
  return (
    <div className={`device device--${kind}`}>
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
      <div className="device-face">{children}</div>
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
 * The frame for the open puzzle: its paragraph and title on the plate, the
 * console this player works where the station has two — the view names
 * console a at a station with one as well, the module tells them apart —
 * and the partner LED.
 */
export function deviceOf(puzzle: PuzzleView): Omit<DeviceProps, 'children'> {
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
