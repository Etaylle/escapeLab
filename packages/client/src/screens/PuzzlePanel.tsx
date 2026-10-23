import type { ClientMessage, PuzzleView } from '@escapelab/core';
import {
  Device,
  deviceOf,
  useDeviceFeel,
  useFreshAlarm,
  type ChangeSounds,
  type DeviceRun,
} from '../puzzles/Device.js';
import { PANELS, READERS, SOUNDS, type Panel, type Reader } from '../puzzles/index.js';

interface PuzzlePanelProps {
  puzzle: PuzzleView;
  /** the run around the device: its alarms, the stations solved, the crew — as the view has it */
  run: DeviceRun;
  send: (msg: ClientMessage) => void;
  deadlineAt: number | null;
  /** steps back from the device, as its chassis offers; none for the audience */
  onStepBack?: (() => void) | null;
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

function StationDevice({ puzzle, run, send, deadlineAt, onStepBack = null }: PuzzlePanelProps) {
  // PANELS and SOUNDS are keyed by kind, so the entries for this kind take exactly this puzzle.
  const ModulePanel = PANELS[puzzle.kind] as Panel<PuzzleView['kind']>;
  const sounds = (SOUNDS[puzzle.kind] ?? null) as ChangeSounds | null;
  const feel = useDeviceFeel(puzzle, run, sounds);
  const notice = useFreshAlarm(run.alarm, feel.alarms);
  return (
    <Device
      {...deviceOf(puzzle)}
      alarms={feel.alarms}
      solved={feel.solved}
      press={feel.press}
      notice={notice}
      onStepBack={onStepBack}
    >
      <ModulePanel
        puzzle={puzzle}
        change={feel.change}
        send={(input) => send({ kind: 'puzzle-input', input })}
        deadlineAt={deadlineAt}
        crew={run.crew}
      />
    </Device>
  );
}

/** What the open puzzle shows a reader beyond its printed rules; nothing for most modules. */
export function ReaderPanel({ puzzle }: { puzzle: PuzzleView }) {
  const ModuleReader = READERS[puzzle.kind] as Reader<PuzzleView['kind']> | undefined;
  return ModuleReader === undefined ? null : <ModuleReader puzzle={puzzle} />;
}
