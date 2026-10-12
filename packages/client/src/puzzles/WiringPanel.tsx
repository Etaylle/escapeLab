import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './wiring.css';

type Wire = NonNullable<PanelProps<'wiring'>['puzzle']['wires']>[number];

/** Stroke colour per wire; the name is printed beside it as well, for colour-blind players. */
const TONE: Record<Wire['color'], string> = {
  rot: 'wiring-red',
  blau: 'wiring-blue',
  gelb: 'wiring-yellow',
  weiß: 'wiring-white',
  schwarz: 'wiring-black',
};

export function WiringPanel({ puzzle, send }: PanelProps<'wiring'>) {
  const status = (
    <p className="progress-line">
      Kabel: {puzzle.wireCount} · getrennt: {puzzle.cutsDone}
    </p>
  );
  if (puzzle.wires === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Die Kabel siehst du nicht. Lass dir alle Farben von oben nach unten ansagen und prüf
          die Liste zur Kabelzahl der Reihe nach.
        </p>
        {status}
      </div>
    );
  }
  return (
    <div>
      <ol className="wiring-box" aria-label="Kabel, von oben gezählt">
        {puzzle.wires.map((wire, i) => (
          <li key={wire.id}>
            <WireButton
              wire={wire}
              position={i + 1}
              onCut={() => {
                play('click');
                send({ wireId: wire.id });
              }}
            />
          </li>
        ))}
      </ol>
      {status}
      <p className="muted">Antippen trennt sofort — erst alle Farben ansagen.</p>
    </div>
  );
}

interface WireButtonProps {
  wire: Wire;
  /** counted from the top, as the manual counts */
  position: number;
  onCut: () => void;
}

function WireButton({ wire, position, onCut }: WireButtonProps) {
  return (
    <button
      className={`wiring-wire ${TONE[wire.color]} ${wire.cut ? 'wiring-cut' : ''}`}
      disabled={wire.cut}
      onClick={onCut}
      aria-label={`Kabel ${position}, ${wire.color}${wire.cut ? ', getrennt' : ''}`}
    >
      <span className="wiring-pos">{position}</span>
      <span className="wiring-line" aria-hidden="true">
        <span className="wiring-half" />
        <span className="wiring-half" />
      </span>
      <span className="wiring-name">{wire.color}</span>
    </button>
  );
}
