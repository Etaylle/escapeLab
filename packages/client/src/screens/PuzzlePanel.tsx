import type { ClientMessage, PuzzleView } from '@escapelab/core';
import {
  Device,
  deviceOf,
  useDeviceFeel,
  type ChangeSounds,
  type DeviceRun,
} from '../puzzles/Device.js';
import { PANELS, READERS, SOUNDS, type Panel, type Reader } from '../puzzles/index.js';

interface PuzzlePanelProps {
  puzzle: PuzzleView;
  /** the run around the device: its alarms and the stations solved, as the view counts them */
  run: DeviceRun;
  send: (msg: ClientMessage) => void;
  deadlineAt: number | null;
}

/**
 * The open puzzle's panel in its device frame, so that every station shares
 * one physical look and feel; every input it makes goes out as a
 * `puzzle-input`. Another station is another device: what one saw and did
 * goes with it.
 */
export function PuzzlePanel(props: PuzzlePanelProps) {
  return <StationDevice key={props.puzzle.index} {...props} />;
}

function StationDevice({ puzzle, run, send, deadlineAt }: PuzzlePanelProps) {
  // PANELS and SOUNDS are keyed by kind, so the entries for this kind take exactly this puzzle.
  const ModulePanel = PANELS[puzzle.kind] as Panel<PuzzleView['kind']>;
  const sounds = (SOUNDS[puzzle.kind] ?? null) as ChangeSounds | null;
  const feel = useDeviceFeel(puzzle, run, sounds);
  return (
    <Device {...deviceOf(puzzle)} alarms={feel.alarms} solved={feel.solved} press={feel.press}>
      <ModulePanel
        puzzle={puzzle}
        change={feel.change}
        send={(input) => send({ kind: 'puzzle-input', input })}
        deadlineAt={deadlineAt}
      />
    </Device>
  );
}

/** What the open puzzle shows a reader beyond its printed rules; nothing for most modules. */
export function ReaderPanel({ puzzle }: { puzzle: PuzzleView }) {
  const ModuleReader = READERS[puzzle.kind] as Reader<PuzzleView['kind']> | undefined;
  return ModuleReader === undefined ? null : <ModuleReader puzzle={puzzle} />;
}
