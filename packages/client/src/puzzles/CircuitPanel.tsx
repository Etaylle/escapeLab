import { play } from '../sounds.js';
import { consoleName } from '../world/consoles.js';
import type { PanelProps } from './index.js';
import './wiring.css';

type CircuitPuzzle = PanelProps<'circuit'>['puzzle'];
type Wire = NonNullable<CircuitPuzzle['wires']>[number];
type Send = PanelProps<'circuit'>['send'];

/** Stroke colour per wire, as the wiring box draws it; the name stands beside it as well. */
const TONE: Record<Wire['colour'], string> = {
  rot: 'wiring-red',
  blau: 'wiring-blue',
  gelb: 'wiring-yellow',
  weiß: 'wiring-white',
  schwarz: 'wiring-black',
};

/** A measurement as the meter shows it; a dash where none was taken. */
function volts(reading: number | null | undefined): string {
  return reading === null || reading === undefined ? '—' : `${reading} V`;
}

/** A wire's row in the box: the wiring box's look, drooping once cut. */
const wireClass = (wire: Wire): string =>
  `circuit-wire wiring-wire ${TONE[wire.colour]}${wire.cut ? ' wiring-cut' : ''}`;

/** The wire between its two posts. */
function Line() {
  return (
    <span className="wiring-line" aria-hidden="true">
      <span className="wiring-half" />
      <span className="wiring-half" />
    </span>
  );
}

/** The box at console a: a button per wire, numbered from the top; a tap cuts at once. */
function Box({ wires, send }: { wires: Wire[]; send: Send }) {
  return (
    <ol className="wiring-box" aria-label="Kabel, von oben gezählt">
      {wires.map((wire, i) => (
        <li key={i}>
          <button
            className={wireClass(wire)}
            data-index={i}
            disabled={wire.cut}
            aria-label={`Kabel ${i + 1}, ${wire.colour}${wire.cut ? ', getrennt' : ''}`}
            onClick={() => {
              play('click');
              send({ cut: i });
            }}
          >
            <span className="wiring-pos">{i + 1}</span>
            <Line />
            <span className="wiring-name">{wire.colour}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The box for the audience: each wire with its voltage now, the dead one marked; nothing to cut. */
function WatchedBox({
  wires,
  voltages,
  dead,
}: {
  wires: Wire[];
  voltages: number[];
  dead: boolean[];
}) {
  return (
    <ol className="wiring-box" aria-label="Kabel, von oben gezählt">
      {wires.map((wire, i) => (
        <li key={i}>
          <span className={`${wireClass(wire)} circuit-wire--watched`} data-index={i}>
            <span className="wiring-pos">{i + 1}</span>
            <Line />
            <span className="wiring-name">{wire.colour}</span>
            <span className="circuit-volts">{dead[i] === true ? 'tot' : volts(voltages[i])}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** This round's measurements, wire by wire; a dash where none was taken. */
function Readings({ readings }: { readings: (number | null)[] }) {
  return (
    <ol className="circuit-readings" aria-label="Messungen dieser Runde">
      {readings.map((reading, i) => (
        <li key={i}>
          <span>{`Kabel ${i + 1}`}</span>
          <span className="circuit-reading">{volts(reading)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The meter's display: the wire measured last in this round and its voltage; a dash before. */
function Readout({ probed, readings }: { probed: number | null; readings: (number | null)[] }) {
  return (
    <output className="circuit-readout" aria-live="polite">
      {probed === null ? '—' : `Kabel ${probed + 1}: ${volts(readings[probed])}`}
    </output>
  );
}

/** The meter's keys at console b, one for every wire by its number; a press measures it. */
function Keys({ count, send }: { count: number; send: Send }) {
  return (
    <div className="circuit-keys">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          className="circuit-probe"
          data-index={i}
          aria-label={`Kabel ${i + 1} messen`}
          onClick={() => {
            play('click');
            send({ probe: i });
          }}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

/** What both consoles show: the live wires left, and what the last wrong cut did. */
function Status({ puzzle }: { puzzle: CircuitPuzzle }) {
  return (
    <>
      <p className="circuit-left">{`Noch unter Spannung: ${puzzle.liveLeft ?? 0}`}</p>
      {puzzle.lastResult === 'short' && (
        <p className="warn" role="status">
          Kurzschluss — neu verdrahtet.
        </p>
      )}
      {puzzle.lastResult === 'burnout' && (
        <p className="warn" role="status">
          {`Kasten durchgebrannt — −${puzzle.burnoutSec} s.`}
        </p>
      )}
    </>
  );
}

/**
 * Sicherungskasten + Prüfpult at one console. Console a has the wires and
 * cuts them, console b measures them by number; after every cut the
 * voltages change, so b measures again. A short shakes the console — keyed
 * by the shorts so far, so that every new one shakes it again. The audience
 * sees both consoles, with every voltage.
 */
export function CircuitPanel({ puzzle, send }: PanelProps<'circuit'>) {
  const shaken = puzzle.lastResult === null ? 'circuit' : 'circuit circuit--short';
  if (puzzle.role === 'box' && puzzle.wires !== null) {
    return (
      <div key={puzzle.shorts} className={shaken}>
        <Box wires={puzzle.wires} send={send} />
        <Status puzzle={puzzle} />
        <p className="muted">Erst bei Ansage trennen — Antippen trennt sofort.</p>
      </div>
    );
  }
  const { count, readings, probed } = puzzle;
  if (puzzle.role === 'meter' && count !== null && readings !== null) {
    return (
      <div key={puzzle.shorts} className={shaken}>
        <Readout probed={probed} readings={readings} />
        <Keys count={count} send={send} />
        <Readings readings={readings} />
        <Status puzzle={puzzle} />
      </div>
    );
  }
  const { wires, voltages, dead } = puzzle;
  if (wires !== null && readings !== null && voltages !== null && dead !== null) {
    return (
      <div className="circuit">
        <Status puzzle={puzzle} />
        <section className="circuit-console" aria-label={consoleName('a')}>
          <h4 className="circuit-console-name">{consoleName('a')}</h4>
          <WatchedBox wires={wires} voltages={voltages} dead={dead} />
        </section>
        <section className="circuit-console" aria-label={consoleName('b')}>
          <h4 className="circuit-console-name">{consoleName('b')}</h4>
          <Readout probed={probed} readings={readings} />
          <Readings readings={readings} />
        </section>
      </div>
    );
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
