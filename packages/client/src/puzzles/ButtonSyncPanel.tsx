import { Icon } from '../screens/Icon.js';
import { DeviceLamp } from './Device.js';
import type { PanelProps } from './index.js';
import { LeverPanel } from './LeverPanel.js';

/**
 * The Synchronschaltung, as the printed figure draws it: one mushroom
 * button in a steel collar for the whole crew, under a lamp for each crew
 * member that lights as their press comes in and goes dark again where it
 * expired. Pressed, the button stays down. A station whose mission draws it
 * as a lever is the main switch instead (LeverPanel). `.big-button` is what
 * the screenshot harness presses.
 */
export function ButtonSyncPanel({ puzzle, send, deadlineAt }: PanelProps<'button-sync'>) {
  if (puzzle.style === 'lever') {
    return <LeverPanel puzzle={puzzle} send={send} deadlineAt={deadlineAt} />;
  }
  const { pressedCount, requiredCount, youPressed } = puzzle;
  return (
    <div className="sync">
      <div
        className="sync-lamps"
        role="img"
        aria-label={`${pressedCount} von ${requiredCount} gedrückt`}
      >
        {Array.from({ length: requiredCount }, (_, i) => (
          <DeviceLamp key={i} tone={i < pressedCount ? 'green' : 'off'} />
        ))}
      </div>
      <div className="sync-collar">
        <button
          className="big-button sync-button"
          disabled={youPressed}
          aria-label={youPressed ? 'Gedrückt' : 'Drücken'}
          onClick={() => send({ press: true })}
        />
      </div>
      {puzzle.lastResult === 'missed-window' && (
        <p className="warn" role="status">
          <Icon name="warning" /> Zeitfenster verpasst — Versuch {puzzle.attempts}
        </p>
      )}
    </div>
  );
}
