import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PuzzleView } from '@escapelab/core';
import { useKeys } from '../hooks.js';
import { Icon } from '../screens/Icon.js';
import { leverChunk } from '../world/audio.js';
import { DeviceLamp, type DeviceCrew, type DeviceMate } from './Device.js';
import { cssVars } from './feel.js';
import type { PanelProps } from './index.js';
import { leverSpring } from './sounds.js';
import {
  ownPressAt,
  secondsText,
  syncPress,
  useNowUntil,
  type OwnPress,
  type OwnPressState,
} from './syncPress.js';

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

/** „NUR ZU ZWEIT", „NUR ZU DRITT": how many the main switch takes, as its plate says. */
const TOGETHER = ['ZWEIT', 'DRITT', 'VIERT'] as const;

/** The word for a crew of `count` on the plate; a crew of fewer than two still reads ZWEIT. */
export function togetherWord(count: number): string {
  return TOGETHER[Math.min(Math.max(count, 2), TOGETHER.length + 1) - 2] ?? 'ZWEIT';
}

/**
 * What the main switch's plate says: what it is, that it takes the crew, and — where it has
 * one — its window: „NOTLICHT · HAUPTSCHALTER · NUR ZU ZWEIT · 2 S".
 */
export function leverPlate(puzzle: SyncView, windowMs: number | null): string {
  const together = `NUR ZU ${togetherWord(puzzle.requiredCount)}`;
  const plate = `${puzzle.title.toUpperCase()} · HAUPTSCHALTER · ${together}`;
  return windowMs === null ? plate : `${plate} · ${secondsText(windowMs)} S`;
}

/**
 * What the device says once this player's press ran out, its plate's rule again: „Zug
 * verfallen — nur zu zweit zugleich".
 */
export function expiredLine(requiredCount: number): string {
  return `Zug verfallen — nur zu ${togetherWord(requiredCount).toLowerCase()} zugleich`;
}

/** One lever of the main switch, as the panel draws it. */
export interface Handle {
  own: boolean;
  /** somebody stands at it — at the own one, this player: its lamp burns */
  here: boolean;
  /** its press is in: thrown down, the grip glowing */
  down: boolean;
  /** under it: whose badge it answers to, by name in their colour; null where nobody is named */
  label: { text: string; color: string | null } | null;
}

/**
 * The levers, one for every member of the crew: at the station, this player's first, under
 * their own name, down as its press stands (`own`), then the partners' with their names in
 * their colours, each lamp burning while somebody stands there and each partner's lever down
 * while a partner's press is in — the view counts the partners' presses, not whose — and
 * every lever home once all presses are in. For the audience (`own` null), which stands at
 * none, none is its own and none named.
 */
export function handlesOf(
  puzzle: SyncView,
  own: OwnPressState | null,
  crew: DeviceCrew | null,
): Handle[] {
  const count = Math.max(2, puzzle.requiredCount);
  const thrown = puzzle.pressedCount >= puzzle.requiredCount;
  if (own === null) {
    return Array.from({ length: count }, (_, i) => ({
      own: false,
      here: i < puzzle.here,
      down: i < puzzle.pressedCount,
      label: null,
    }));
  }
  const { partners } = syncPress(puzzle);
  const named = (mate: DeviceMate | undefined): Handle['label'] =>
    mate === undefined ? null : { text: mate.name, color: mate.color };
  const self = crew?.mates.find((mate) => mate.id === crew.you);
  const mates = (crew?.mates ?? []).filter((mate) => mate.id !== crew?.you);
  return Array.from({ length: count }, (_, i): Handle => {
    if (i === 0) {
      return { own: true, here: true, down: own.down, label: named(self) };
    }
    const label = named(mates[i - 1]);
    return { own: false, here: i < puzzle.here, down: thrown || i - 1 < partners, label };
  });
}

/**
 * The lever's own sounds at the station: back up with a clack where the panel saw its press
 * run out, home with a heavy ka-chunk once every lever is down. The audience hears neither.
 */
function useLeverSounds(lever: OwnPressState | null, thrown: boolean): void {
  const audible = lever !== null;
  const down = lever?.down ?? false;
  const expired = lever?.expired ?? false;
  const wasDown = useRef(down);
  useEffect(() => {
    if (wasDown.current && expired && audible) {
      leverSpring();
    }
    wasDown.current = down;
  }, [down, expired, audible]);
  useEffect(() => {
    if (thrown && audible) {
      leverChunk();
    }
  }, [thrown, audible]);
}

/**
 * The window of this player's press draining round the grip, from full at the press to
 * empty as its window shuts — in step with the press however late the panel came to it.
 */
function LeverRing({ press }: { press: OwnPress }) {
  const [shown] = useState(() => Date.now());
  const total = Math.max(1, press.expiresAt - press.at);
  const elapsed = Math.min(total, Math.max(0, shown - press.at));
  const timing = cssVars({ '--ring-ms': `${total}ms`, '--ring-delay': `${-elapsed}ms` });
  return (
    <svg className="lever-ring" viewBox="0 0 40 40" aria-hidden="true">
      <circle className="lever-ring-track" cx="20" cy="20" r="15" />
      <circle className="lever-ring-left" cx="20" cy="20" r="15" pathLength={100} style={timing} />
    </svg>
  );
}

/**
 * One lever: its lamp, its slot with AUS at the top and EIN at the foot, and whose it is; the
 * own one's grip is `grip`, the button this player throws.
 */
function LeverUnit({ handle, grip }: { handle: Handle; grip: ReactNode }) {
  const unit =
    'lever-unit' +
    (handle.here ? ' lever-unit--here' : '') +
    (handle.down ? ' lever-unit--down' : '');
  const color = handle.label?.color ?? null;
  return (
    <div className={unit}>
      <DeviceLamp tone={handle.here ? 'green' : 'off'} />
      <div className="lever-slot">
        <span className="device-engraving lever-mark">AUS</span>
        {handle.own ? grip : <span className="lever-grip" aria-hidden="true" />}
        <span className="device-engraving lever-mark lever-mark--on">EIN</span>
      </div>
      {handle.label !== null && (
        <span className="lever-name" style={color === null ? undefined : { color }}>
          {handle.label.text}
        </span>
      )}
    </div>
  );
}

/**
 * The Notlicht's main switch, the whole crew's press as a cabinet with a lever for each, side
 * by side under the plate that says what it is and in how many seconds: this player's lever
 * in front of them, each lever named for its badge in its colour. E or a click throws
 * the own lever, with the kit's press feel; a ring round its grip drains while the press
 * counts, and as its window shuts the lever springs back with a clack — „Zug verfallen". A
 * partner's lever is down while a partner's press is in; once all are down, they drop home
 * with a heavy ka-chunk. `.big-button` on the own lever is what the screenshot harness presses.
 */
export function LeverPanel({ puzzle, send, crew }: PanelProps<'button-sync'>) {
  const atStation = puzzle.console !== null;
  const sync = syncPress(puzzle);
  const now = useNowUntil(sync.press?.expiresAt ?? null);
  const lever = atStation ? ownPressAt(puzzle, sync, now) : null;
  const thrown = puzzle.pressedCount >= puzzle.requiredCount;
  const grip = useRef<HTMLButtonElement>(null);
  useKeys(['e'], () => grip.current?.click());
  useLeverSounds(lever, thrown);
  const pull = (): void => {
    if (lever !== null && !lever.down) {
      send({ press: true });
    }
  };
  const down = lever?.down ?? true;
  const ownGrip = (
    <button
      ref={grip}
      className="big-button lever-grip"
      data-feel="pull"
      disabled={down}
      aria-label={down ? 'Eigener Hebel: unten' : 'Hebel umlegen'}
      onClick={pull}
    >
      {lever?.ring != null && <LeverRing key={lever.ring.at} press={lever.ring} />}
    </button>
  );
  return (
    <div className={`lever${thrown ? ' lever--thrown' : ''}`}>
      <div className="lever-plate">{leverPlate(puzzle, sync.windowMs)}</div>
      <div
        className="lever-handles"
        role="group"
        aria-label={`${puzzle.pressedCount} von ${puzzle.requiredCount} Hebeln unten`}
      >
        {handlesOf(puzzle, lever, crew ?? null).map((handle, i) => (
          <LeverUnit key={i} handle={handle} grip={ownGrip} />
        ))}
      </div>
      {lever?.expired === true && (
        <p className="warn" role="status">
          <Icon name="warning" /> {expiredLine(puzzle.requiredCount)}
        </p>
      )}
    </div>
  );
}
