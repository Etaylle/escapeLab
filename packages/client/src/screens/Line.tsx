import type { PlayerView } from '@escapelab/core';
import { useNow } from '../hooks.js';
import type { LineStatus, Retry } from '../line.js';
import { GiveUpButton } from './GiveUp.js';
import { Icon } from './Icon.js';

/**
 * The own line down while a run is on (line.ts): the player's card over the world says so — or
 * that the server goes down for a restart, a deploy — and when the next try goes out, with the
 * ways on — try now, load the page anew, give the seat up (at a second press, GiveUp.tsx). While
 * a new server waits for the newest snapshot of the room before it takes it up again
 * (`Retry.restoring`), the card says that instead, and only the page loaded anew is a way on:
 * the line is up, and the seat back in a moment. While it stands the world takes nothing: what
 * is pressed meanwhile goes nowhere, and nothing throws (`Line.send`).
 */

/** The line as the game screen hears of it, and what the card does with it. */
export interface GameLine {
  status: LineStatus;
  retry: Retry | null;
  /** tries again now (`Line.wake`) */
  wake: () => void;
  /** gives the seat up, sent once the line is back (ws.ts `Connection.giveUp`) */
  giveUp: () => void;
}

/** The line up, as a screen that hears of none takes it. */
export const ON_THE_LINE: GameLine = {
  status: 'open',
  retry: null,
  wake: () => undefined,
  giveUp: () => undefined,
};

/**
 * Whether the own line is down, or its comeback waits for the room (`Retry.restoring`), while
 * the run of `view` is on: its card stands over the world.
 */
export function lineLost(
  line: Pick<GameLine, 'status' | 'retry'>,
  view: Pick<PlayerView, 'phase'> | null,
): boolean {
  const down = line.status !== 'open' || line.retry?.restoring === true;
  return down && view?.phase === 'playing';
}

/** What a card says over a room on its way back: here, and on the join screen's (Join.tsx). */
export const RESTORING_TITLE = 'EINSATZ WIRD WIEDERHERGESTELLT';

/** What a card says of a room on its way back, the newest snapshot of it awaited. */
export const RESTORING_LINE = 'Der letzte Stand trifft gleich ein';

/** What the card's title says of the line: its room on the way back, a restart, or a drop. */
export function lineTitle(retry: Retry | null): string {
  if (retry?.restoring === true) {
    return RESTORING_TITLE;
  }
  return retry?.restart === true ? 'WARTUNG · Der Server startet neu' : 'VERBINDUNG VERLOREN';
}

/**
 * What the card says of the next try at `now`: „Verbinde neu · Versuch 2 · in 4 s", or without
 * the wait while the try is under way.
 */
export function retryLine(retry: Retry | null, now: number): string {
  if (retry === null) {
    return 'Verbinde neu';
  }
  const wait = retry.at === null ? 0 : Math.ceil((retry.at - now) / 1000);
  return wait > 0
    ? `Verbinde neu · Versuch ${retry.attempt} · in ${wait} s`
    : `Verbinde neu · Versuch ${retry.attempt}`;
}

/** The card over the world of a player whose own line is down in a run. */
export function LineLostCard({ line }: { line: GameLine }) {
  const now = useNow(250);
  const restoring = line.retry?.restoring === true;
  return (
    <div className="overlay pause line-lost" role="alert">
      <h1>
        <Icon name="warning" /> {lineTitle(line.retry)}
      </h1>
      <p className="line-retry">
        {restoring ? RESTORING_LINE : retryLine(line.retry, now)}
      </p>
      <div className="pause-ways">
        {!restoring && (
          <button className="primary line-try" onClick={line.wake}>
            Jetzt versuchen
          </button>
        )}
        <button className="line-reload" onClick={() => location.reload()}>
          Seite neu laden
        </button>
        {!restoring && <GiveUpButton onGiveUp={line.giveUp} />}
      </div>
    </div>
  );
}
