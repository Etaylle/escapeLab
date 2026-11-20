import { createContext, lazy, Suspense, useContext, useEffect, useRef } from 'react';
import { duck, unduck } from '../world/mix.js';
import { liveEngine } from '../world/audio.js';
import type { MissionTime } from '../clock.js';
import {
  clearLine,
  closeArcade,
  closingLine,
  openArcade,
  useDoor,
  waitOf,
  type Wait,
  type WaitFacts,
} from './door.js';

/**
 * The break-room machine as the page carries it before it is opened (door.ts): the control that
 * opens it where the player waits, the machine itself fetched as a chunk of its own the first time
 * it opens (Machine.tsx), its closing line, and the lab's music and beds pulled down while it
 * stands open (world/mix.ts, the source `arcade`) and let back up as it goes — no stem restarted.
 */

const Machine = lazy(() => import('./Machine.js'));

/** How long the plant's closing line stands, ms: the length of its toast's fade (reconnect.css). */
export const LINE_MS = 3500;

/** What the player waits for now, as the screens under the machine reach it. */
export const WaitContext = createContext<Wait>(null);

/**
 * The machine's door over the room the facts describe: it closes, with the plant's line, the
 * moment the wait is over (`closingLine`); the lab's music and beds go down while it stands open.
 * Returns what the player waits for now.
 */
export function useArcadeDoor(facts: WaitFacts): Wait {
  const wait = waitOf(facts);
  const before = useRef(wait);
  const { open } = useDoor();
  const phase = facts.phase;
  useEffect(() => {
    const from = before.current;
    before.current = wait;
    const line = closingLine(from, wait, phase);
    if (open && line !== undefined) closeArcade(line);
  }, [wait, phase, open]);
  useEffect(() => {
    const engine = liveEngine();
    if (!open || engine === null) return undefined;
    duck(engine, 'arcade', engine.ctx.currentTime, Infinity, engine.ctx.currentTime);
    return () => unduck(engine, 'arcade', engine.ctx.currentTime, engine.ctx.currentTime);
  }, [open]);
  return wait;
}

/** What the player waits for now, where the machine may open; null where it may not. */
export function useWait(): Wait {
  return useContext(WaitContext);
}

/** „Arcade": opens the break-room machine where the player waits; nothing elsewhere. */
export function ArcadeButton({ className = '' }: { className?: string }) {
  const wait = useWait();
  if (wait === null) return null;
  return (
    <button className={`arcade-open ${className}`.trim()} onClick={() => openArcade(wait)}>
      Arcade
    </button>
  );
}

/**
 * The machine over everything while it stands open; the plant's line as it closed by itself.
 * `run`: the run going on around the player while the machine stands open, its clock said on the
 * machine's frame; null where none runs.
 */
export function ArcadeHost({ run }: { run: MissionTime | null }) {
  const { open, line } = useDoor();
  useEffect(() => {
    if (line === null) return undefined;
    const timer = setTimeout(clearLine, LINE_MS);
    return () => clearTimeout(timer);
  }, [line]);
  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <Machine onLeave={() => closeArcade()} run={run} />
        </Suspense>
      )}
      {line !== null && (
        <div className="crew-back arcade-line" role="status">
          {line}
        </div>
      )}
    </>
  );
}
