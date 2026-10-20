import { useEffect } from 'react';
import type { PuzzleView } from '@escapelab/core';
import { useKeys } from '../hooks.js';
import { Icon } from '../screens/Icon.js';
import { leverChunk } from '../world/audio.js';
import { DeviceLamp } from './Device.js';
import type { PanelProps } from './index.js';

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

/** „NUR ZU ZWEIT", „NUR ZU DRITT": how many the main switch takes, as its plate says. */
const TOGETHER = ['ZWEIT', 'DRITT', 'VIERT'] as const;

/** The word for a crew of `count` on the plate; a crew of fewer than two still reads ZWEIT. */
export function togetherWord(count: number): string {
  return TOGETHER[Math.min(Math.max(count, 2), TOGETHER.length + 1) - 2] ?? 'ZWEIT';
}

/** One lever of the main switch: whether it is this player's, lit, and thrown down. */
export interface Handle {
  own: boolean;
  /** somebody stands at it — at the own one, this player */
  lit: boolean;
  down: boolean;
}

/**
 * The levers as the panel draws them, one for every member of the crew:
 * at the station, this player's first, then the partners', each lit while
 * somebody stands there and down once thrown — the partners' in the order
 * their throws count. For the audience, which stands at none, none is its own.
 */
export function handlesOf(puzzle: SyncView): Handle[] {
  const atStation = puzzle.console !== null;
  const count = Math.max(2, puzzle.requiredCount);
  const othersDown = puzzle.pressedCount - (atStation && puzzle.youPressed ? 1 : 0);
  return Array.from({ length: count }, (_, i) => {
    const own = atStation && i === 0;
    const partner = atStation ? i - 1 : i;
    return { own, lit: i < puzzle.here, down: own ? puzzle.youPressed : partner < othersDown };
  });
}

/**
 * The Notlicht's main switch, the whole crew's press as a cabinet with a
 * lever for each, side by side under the plate that says what it is: this
 * player's lever in front of them, the others' lit while their partner
 * stands at the station — the same word on it the partner LED has on every
 * other device. E or a click throws the own one; once all are down, they
 * drop home with a heavy ka-chunk. `.big-button` on the own lever is what
 * the screenshot harness presses.
 */
export function LeverPanel({ puzzle, send }: PanelProps<'button-sync'>) {
  const atStation = puzzle.console !== null;
  const thrown = puzzle.pressedCount >= puzzle.requiredCount;
  const pull = (): void => {
    if (atStation && !puzzle.youPressed) {
      send({ press: true });
    }
  };
  useKeys(['e'], pull);
  useEffect(() => {
    if (thrown) {
      leverChunk();
    }
  }, [thrown]);
  return (
    <div className={`lever${thrown ? ' lever--thrown' : ''}`}>
      <div className="lever-plate">
        {puzzle.title.toUpperCase()} · HAUPTSCHALTER · NUR ZU {togetherWord(puzzle.requiredCount)}
      </div>
      <div
        className="lever-handles"
        role="group"
        aria-label={`${puzzle.pressedCount} von ${puzzle.requiredCount} Hebeln unten`}
      >
        {handlesOf(puzzle).map((handle, i) => (
          <div
            key={i}
            className={
              'lever-unit' +
              (handle.lit ? ' lever-unit--lit' : '') +
              (handle.down ? ' lever-unit--down' : '')
            }
          >
            <DeviceLamp tone={handle.lit ? 'green' : 'off'} />
            <div className="lever-slot">
              <span className="device-engraving lever-mark">AUS</span>
              {handle.own ? (
                <button
                  className="big-button lever-grip"
                  disabled={puzzle.youPressed}
                  aria-label={puzzle.youPressed ? 'Dein Hebel: unten' : 'Hebel umlegen'}
                  onClick={pull}
                />
              ) : (
                <span className="lever-grip" aria-hidden="true" />
              )}
              <span className="device-engraving lever-mark lever-mark--on">EIN</span>
            </div>
          </div>
        ))}
      </div>
      {puzzle.lastResult === 'missed-window' && (
        <p className="warn" role="status">
          <Icon name="warning" /> Zeitfenster verpasst — Versuch {puzzle.attempts}
        </p>
      )}
    </div>
  );
}
