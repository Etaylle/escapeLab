import { Icon } from '../screens/Icon.js';
import { DeviceLamp } from './Device.js';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { LeverPanel } from './LeverPanel.js';
import { lampPop, mushroomStomp, rejectBuzz } from './sounds.js';
import { ownPressAt, syncPress, useNowUntil } from './syncPress.js';

type SyncPuzzle = PanelProps<'button-sync'>['puzzle'];
type SyncChange = Change<SyncPuzzle>;

/** Whether a change told this player that their press ran out: dropped, to be made again. */
export function expiredWith(change: SyncChange | null): boolean {
  return (
    change !== null &&
    change.after.lastResult === 'expired' &&
    change.before.lastResult !== 'expired'
  );
}

/** How many partners' presses a change brought in — this player's own is not among them. */
export function partnersPressedWith(change: SyncChange): number {
  const own = change.after.youPressed && !change.before.youPressed ? 1 : 0;
  return Math.max(0, change.after.pressedCount - change.before.pressedCount - own);
}

/**
 * What a change sounds like at the mushroom button: a partner's press stamped down, a lamp
 * popping on for every press that counts, a dull buzz for an own press that ran out — a
 * refusal, no alarm. The main switch stays as built: it has its own sounds (LeverPanel).
 */
export function syncSounds(change: SyncChange): void {
  if (change.after.style === 'lever') {
    return;
  }
  if (partnersPressedWith(change) > 0) {
    mushroomStomp();
  }
  if (change.after.pressedCount > change.before.pressedCount) {
    lampPop();
  }
  if (expiredWith(change)) {
    rejectBuzz();
  }
}

/**
 * The Synchronschaltung, as the printed figure draws it: one mushroom
 * button in a steel collar for the whole crew, under a lamp for each crew
 * member that pops on as their press comes in and goes dark again where it
 * expired. Every press stomps; pressed, the button stays down until the
 * press runs out of its window — then it is up again, and an own press that
 * ran out shakes the collar. A station whose mission draws it as a lever is
 * the main switch instead (LeverPanel). `.big-button` is what the
 * screenshot harness presses.
 */
export function ButtonSyncPanel(props: PanelProps<'button-sync'>) {
  const { puzzle, change, send } = props;
  const sync = syncPress(puzzle);
  const now = useNowUntil(sync.press?.expiresAt ?? null);
  if (puzzle.style === 'lever') {
    return <LeverPanel {...props} />;
  }
  const { pressedCount, requiredCount } = puzzle;
  const own = ownPressAt(puzzle, sync, now);
  const before = change === null ? pressedCount : change.before.pressedCount;
  return (
    <div className="sync">
      <div
        className="sync-lamps"
        role="img"
        aria-label={`${pressedCount} von ${requiredCount} gedrückt`}
      >
        {Array.from({ length: requiredCount }, (_, i) => (
          <DeviceLamp
            key={i}
            tone={i < pressedCount ? 'green' : 'off'}
            fresh={i < pressedCount && i >= before}
          />
        ))}
      </div>
      <div className={expiredWith(change) ? 'sync-collar sync-collar--missed' : 'sync-collar'}>
        <button
          className="big-button sync-button"
          disabled={own.down}
          data-feel="stomp"
          aria-label={own.down ? 'Gedrückt' : 'Drücken'}
          onClick={() => send({ press: true })}
        />
      </div>
      {own.expired && (
        <p className="warn" role="status">
          <Icon name="warning" /> Druck verfallen — nochmal alle zusammen
        </p>
      )}
    </div>
  );
}
