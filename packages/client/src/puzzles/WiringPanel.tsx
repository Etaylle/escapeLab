import { cutBetween, Pliers, Spark } from './cutter.js';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { pliersSnip, sparkCrackle } from './sounds.js';
import './wiring.css';

type WiringPuzzle = PanelProps<'wiring'>['puzzle'];
type Wire = NonNullable<WiringPuzzle['wires']>[number];

/** Stroke colour per wire; the name is printed beside it as well, for colour-blind players. */
const TONE: Record<Wire['color'], string> = {
  rot: 'wiring-red',
  blau: 'wiring-blue',
  gelb: 'wiring-yellow',
  weiß: 'wiring-white',
  schwarz: 'wiring-black',
};

/** The wire a change cut, by its place from the top; none where none was. */
export function snappedWith(change: Change<WiringPuzzle> | null): number | null {
  return change === null ? null : cutBetween(change.before.wires, change.after.wires);
}

/** What a change sounds like: a cut throws sparks — the pliers snipped as it was pressed. */
export function wiringSounds(change: Change<WiringPuzzle>): void {
  if (snappedWith(change) !== null) {
    sparkCrackle();
  }
}

export function WiringPanel({ puzzle, change, send }: PanelProps<'wiring'>) {
  const status = (
    <p className="progress-line">
      Kabel: {puzzle.wireCount} · getrennt: {puzzle.cutsDone}
    </p>
  );
  if (puzzle.wires === null) {
    return status;
  }
  const snapped = snappedWith(change);
  return (
    <div>
      <ol className="wiring-box" aria-label="Kabel, von oben gezählt">
        {puzzle.wires.map((wire, i) => (
          <li key={wire.id}>
            <WireButton
              wire={wire}
              position={i + 1}
              snapped={i === snapped}
              onCut={() => {
                pliersSnip();
                send({ wireId: wire.id });
              }}
            />
          </li>
        ))}
      </ol>
      {status}
    </div>
  );
}

interface WireButtonProps {
  wire: Wire;
  /** counted from the top, as the manual counts */
  position: number;
  /** cut with the latest change: its halves fall and sway, sparks fly from the cut */
  snapped: boolean;
  onCut: () => void;
}

/** A wire between its posts: the pliers over it while it is whole, the cut's sparks just after. */
function WireButton({ wire, position, snapped, onCut }: WireButtonProps) {
  const state = `${snapped ? ' wiring-snapped' : ''}${wire.cut ? ' wiring-cut' : ''}`;
  return (
    <button
      className={`wiring-wire ${TONE[wire.color]}${state}`}
      disabled={wire.cut}
      data-feel="none"
      onClick={onCut}
      aria-label={`Kabel ${position}, ${wire.color}${wire.cut ? ', getrennt' : ''}`}
    >
      <span className="wiring-pos">{position}</span>
      <span className="wiring-line" aria-hidden="true">
        <span className="wiring-half wiring-half--left" />
        <span className="wiring-half wiring-half--right" />
        {!wire.cut && (
          <span className="wiring-cutter">
            <Pliers />
          </span>
        )}
        {snapped && <Spark />}
      </span>
      <span className="wiring-name">{wire.color}</span>
    </button>
  );
}
