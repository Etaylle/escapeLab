import { useEffect, useRef, useState } from 'react';
import { Icon } from '../screens/Icon.js';
import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './button.css';

/** On the button longer than this and the touch is a hold, not a press. */
const HOLD_AFTER_MS = 250;

type ButtonPuzzle = PanelProps<'button'>['puzzle'];
type Colour = NonNullable<ButtonPuzzle['colour'] | ButtonPuzzle['strip']>;

/** The colour as the operator says it, and the CSS modifier that paints it. */
const COLOURS: Record<Colour, { word: string; css: string }> = {
  rot: { word: 'ROT', css: 'red' },
  blau: { word: 'BLAU', css: 'blue' },
  gelb: { word: 'GELB', css: 'yellow' },
  weiß: { word: 'WEISS', css: 'white' },
};

const MISTAKES: Record<NonNullable<ButtonPuzzle['lastResult']>, string> = {
  early: 'Kurz gedrückt — falsch!',
  held: 'Gehalten — falsch!',
  'wrong-time': 'Zur falschen Zeit losgelassen!',
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The mission clock again, worked out like the HUD's, so the operator need not look away. */
function MissionClock({ deadlineAt }: { deadlineAt: number | null }) {
  const now = useNow(200);
  const left = deadlineAt === null ? null : Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const text =
    left === null
      ? '--:--'
      : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="button-clock">
      <span className="button-clock-label">MISSIONSUHR</span>
      <span className="button-clock-time">{text}</span>
    </div>
  );
}

/**
 * Touch and keys on the big button: let go within HOLD_AFTER_MS and it was a
 * press; stay longer and it becomes a hold, and letting go then is the
 * release. A button the server still holds — the touch was cancelled, the
 * page reloaded — is let go by the next touch.
 */
function useHoldButton(holding: boolean, send: PanelProps<'button'>['send']) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const down = useRef(false);
  const releaseOnEnd = useRef(false);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const start = () => {
    if (down.current) {
      return;
    }
    down.current = true;
    releaseOnEnd.current = holding;
    play('click');
    if (!holding) {
      timer.current = setTimeout(() => {
        timer.current = null;
        releaseOnEnd.current = true;
        send({ kind: 'hold' });
      }, HOLD_AFTER_MS);
    }
  };
  /** Ends the touch; true when it ended before it became a hold. */
  const stop = (): boolean => {
    down.current = false;
    if (timer.current === null) {
      return false;
    }
    clearTimeout(timer.current);
    timer.current = null;
    return true;
  };
  const end = () => {
    if (!down.current) {
      return;
    }
    if (stop()) {
      send({ kind: 'press' });
    } else if (releaseOnEnd.current) {
      send({ kind: 'release' });
    }
  };
  /** The browser took the touch away: drop a pending press, keep a hold for the next touch. */
  const cancel = () => {
    if (down.current) {
      stop();
    }
  };
  return { start, end, cancel };
}

function Console({
  puzzle,
  colour,
  label,
  send,
  deadlineAt,
}: PanelProps<'button'> & { colour: Colour; label: NonNullable<ButtonPuzzle['label']> }) {
  const touch = useHoldButton(puzzle.holding, send);
  const isKey = (key: string) => key === ' ' || key === 'Enter';
  const strip = puzzle.strip === null ? null : COLOURS[puzzle.strip];
  return (
    <div className="button-console">
      <MissionClock deadlineAt={deadlineAt} />
      <div className="button-rig">
        <div className="button-mount">
          <button
            type="button"
            className={`button-face button-face--${COLOURS[colour].css}`}
            aria-pressed={puzzle.holding}
            aria-label={`Knopf ${COLOURS[colour].word}, Aufschrift ${label}`}
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.currentTarget.setPointerCapture(event.pointerId);
                touch.start();
              }
            }}
            onPointerUp={touch.end}
            onPointerCancel={touch.cancel}
            onLostPointerCapture={touch.cancel}
            onBlur={touch.cancel}
            onKeyDown={(event) => {
              if (isKey(event.key)) {
                event.preventDefault();
                if (!event.repeat) {
                  touch.start();
                }
              }
            }}
            onKeyUp={(event) => {
              if (isKey(event.key)) {
                event.preventDefault();
                touch.end();
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {label}
          </button>
          <span className="button-caption">{COLOURS[colour].word}</span>
        </div>
        <div className={`button-strip ${strip === null ? '' : `button-strip--${strip.css}`}`}>
          <span className="button-strip-bar" />
          <span className="button-caption">{strip === null ? 'AUS' : strip.word}</span>
        </div>
      </div>
      <p className="button-status warn" role="status">
        {puzzle.lastResult !== null && (
          <>
            <Icon name="warning" /> {MISTAKES[puzzle.lastResult]}
          </>
        )}
      </p>
    </div>
  );
}

export function ButtonPanel(props: PanelProps<'button'>) {
  const { colour, label } = props.puzzle;
  return colour === null || label === null ? null : (
    <Console {...props} colour={colour} label={label} />
  );
}
