import { DeviceLamp, type LampTone } from './Device.js';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { stageChime } from './sounds.js';
import './memory.css';

const STAGES = 5;

type MemoryPuzzle = PanelProps<'memory'>['puzzle'];
type MemoryChange = Change<MemoryPuzzle>;

/** Whether a change moved the bank on a stage. */
export function advancedWith(change: MemoryChange | null): boolean {
  return change !== null && change.after.stage > change.before.stage;
}

/**
 * Whether a change threw the bank back to stage 1. Once the bank runs, only a
 * wrong press lands there — at stage 1 itself as a fresh layout — so every
 * change of the bank that arrives at stage 1 is a fall.
 */
export function fellWith(change: MemoryChange | null): boolean {
  if (change === null || change.after.stage !== 1) {
    return false;
  }
  const { before, after } = change;
  return (
    before.stage !== 1 ||
    before.display !== after.display ||
    before.labels?.join() !== after.labels?.join()
  );
}

/** What a change sounds like: a chime as the stage LEDs move on. */
export function memorySounds(change: MemoryChange): void {
  if (advancedWith(change)) {
    stageChime();
  }
}

/** A stage's LED: green once done, amber while under way, dark ahead. */
function stageTone(lamp: number, stage: number): LampTone {
  if (lamp < stage) {
    return 'green';
  }
  return lamp === stage ? 'amber' : 'off';
}

/** The stage LEDs, one per stage, „STUFE" engraved beside them; the one just done pops on. */
function StageLeds({ stage, advanced }: { stage: number; advanced: boolean }) {
  return (
    <div className="memory-stage" role="img" aria-label={`Stufe ${stage} von ${STAGES}`}>
      <span className="memory-stage-lamps">
        {Array.from({ length: STAGES }, (_, i) => (
          <DeviceLamp key={i} tone={stageTone(i + 1, stage)} fresh={advanced && i + 2 === stage} />
        ))}
      </span>
      <span className="device-engraving">STUFE</span>
    </div>
  );
}

/** The display digit over the four buttons, as the operator reads them out. */
function Bank({
  display,
  labels,
  send,
}: {
  display: number;
  labels: number[];
  send: PanelProps<'memory'>['send'];
}) {
  return (
    <>
      <div className="memory-display" role="img" aria-label={`Display zeigt ${display}`}>
        {display}
      </div>
      <div className="memory-keys">
        {labels.map((label, position) => (
          <button
            key={position}
            className="memory-key"
            aria-label={`Taste ${position + 1} von links, Beschriftung ${label}`}
            onClick={() => send({ position })}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export function MemoryPanel({ puzzle, change, send }: PanelProps<'memory'>) {
  return (
    <div className="memory">
      <StageLeds stage={puzzle.stage} advanced={advancedWith(change)} />
      {puzzle.display !== null && puzzle.labels !== null && (
        <Bank display={puzzle.display} labels={puzzle.labels} send={send} />
      )}
      {change !== null && fellWith(change) && (
        <p key={change.seq} className="memory-reset" role="status">
          Zurück auf Stufe 1
        </p>
      )}
    </div>
  );
}
