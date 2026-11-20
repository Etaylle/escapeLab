import { useServerNow } from '../hooks.js';
import { clockText, type MissionTime } from '../clock.js';

/**
 * Over the machine while the run goes on around the player — a crew mate away, the own line
 * down —: the plant says that the run's clock keeps running, and shows it as the run's HUD does.
 */

/** What the frame says of the run's clock at server time `now`. */
export function runLineOf(run: MissionTime, now: number): string {
  const shown = clockText(run, now);
  return shown === null
    ? 'Die Uhr des Einsatzes läuft weiter.'
    : `Die Uhr des Einsatzes läuft weiter · ${shown}`;
}

export function RunLine({ run }: { run: MissionTime }) {
  const now = useServerNow(250);
  return (
    <p className="arcade-run" role="status">
      {runLineOf(run, now)}
    </p>
  );
}
