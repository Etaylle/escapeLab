import { Icon } from '../screens/Icon.js';
import { play } from '../sounds.js';
import { consoleName } from '../world/consoles.js';
import { DeviceLamp } from './Device.js';
import type { PanelProps } from './index.js';

type CircuitPuzzle = PanelProps<'circuit'>['puzzle'];
type Wire = NonNullable<CircuitPuzzle['wires']>[number];
type Send = PanelProps<'circuit'>['send'];

/** The meter's scale runs from 0 to this many volts over a half circle. */
export const SCALE_MAX = 250;

/** A cable's colour on the board, as styles/devices.css paints it; no word names it. */
const TONE: Record<Wire['colour'], string> = {
  rot: 'cable--red',
  blau: 'cable--blue',
  gelb: 'cable--yellow',
  weiß: 'cable--white',
  schwarz: 'cable--black',
};

/** A measurement in words; a dash where none was taken. */
function volts(reading: number | null | undefined): string {
  return reading === null || reading === undefined ? '—' : `${reading} V`;
}

/** A wire's row on the board, in its cable's colour, hanging loose once cut. */
const wireClass = (wire: Wire): string =>
  `circuit-wire ${TONE[wire.colour]}${wire.cut ? ' circuit-wire--cut' : ''}`;

/*
 * A cable's run in its row's 100 × 44 units, stretched to the row's width
 * while every stroke keeps its own: whole, it sags between the terminals;
 * cut, each half hangs from its terminal, the copper bare at the cut.
 */
const WHOLE = ['M0 12Q50 36 100 12'];
const HALVES = ['M0 12Q22 26 40 38', 'M100 12Q78 26 60 38'];
const BARE = ['M35 34.6 40 38', 'M65 34.6 60 38'];
const stroke = { vectorEffect: 'non-scaling-stroke' } as const;

/**
 * The cable between its terminals: its shadow on the board, the insulation
 * with a sheen along it and, on a black one, a grey tracer stripe so that it
 * shows on anything dark.
 */
function Cable({ wire }: { wire: Wire }) {
  const runs = wire.cut ? HALVES : WHOLE;
  return (
    <svg className="cable" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      {runs.map((d) => (
        <g key={d}>
          <path className="cable-shadow" d={d} transform="translate(0 3)" {...stroke} />
          <path className="cable-edge" d={d} {...stroke} />
          <path className="cable-core" d={d} {...stroke} />
          {wire.colour === 'schwarz' && <path className="cable-tracer" d={d} {...stroke} />}
          <path className="cable-sheen" d={d} transform="translate(0 -1.5)" {...stroke} />
        </g>
      ))}
      {wire.cut && BARE.map((d) => <path key={d} className="cable-bare" d={d} {...stroke} />)}
    </svg>
  );
}

/**
 * A wire's row: its number printed on the board, a terminal either side and
 * the cable between them; with `cutter`, the cutter that shows over the
 * cable where a tap or a click goes in.
 */
function WireRun({ wire, number, cutter }: { wire: Wire; number: number; cutter: boolean }) {
  return (
    <>
      <span className="circuit-number">{number}</span>
      <span className="circuit-terminal" />
      <span className="circuit-run">
        <Cable wire={wire} />
        {cutter && (
          <span className="circuit-cutter">
            <Icon name="cut" />
          </span>
        )}
      </span>
      <span className="circuit-terminal" />
    </>
  );
}

/**
 * Which segments light for a character: a on top, b and c down the right,
 * d at the foot, e and f up the left, g across the middle.
 */
const LIT: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
};

/** The seven segments as bars on a 12 × 22 cell. */
const BARS = {
  a: [2, 0, 8, 2],
  b: [10, 2, 2, 8],
  c: [10, 12, 2, 8],
  d: [2, 20, 8, 2],
  e: [0, 12, 2, 8],
  f: [0, 2, 2, 8],
  g: [2, 10, 8, 2],
} as const;

/**
 * Characters as a panel meter shows them, in a dark window: `width` cells
 * of seven segments, the text right-aligned in them and every dark segment
 * faintly there.
 */
function Segments({ text, width }: { text: string; width: number }) {
  const cells = [...text.padStart(width, ' ').slice(-width)];
  return (
    <span className="device-display" aria-hidden="true">
      <svg className="device-digits" viewBox={`0 0 ${width * 16} 24`}>
        {cells.map((char, i) => (
          <g key={i} transform={`translate(${i * 16 + 3} 1) skewX(-6)`}>
            {Object.entries(BARS).map(([segment, [x, y, w, h]]) => (
              <rect
                key={segment}
                className={(LIT[char] ?? '').includes(segment) ? 'seg seg--on' : 'seg'}
                x={x}
                y={y}
                width={w}
                height={h}
                rx={1}
              />
            ))}
          </g>
        ))}
      </svg>
    </span>
  );
}

/**
 * The box at console a: the board behind the glass door, a button per wire
 * numbered from the top. Its colour is the cable's; a screen reader hears it.
 */
function Box({ wires, send }: { wires: Wire[]; send: Send }) {
  return (
    <ol className="circuit-board" aria-label="Kabel, von oben gezählt">
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
            <WireRun wire={wire} number={i + 1} cutter={!wire.cut} />
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
    <ol className="circuit-board" aria-label="Kabel, von oben gezählt">
      {wires.map((wire, i) => {
        const now = dead[i] === true ? 'tot' : volts(voltages[i]);
        return (
          <li key={i}>
            <span
              className={`${wireClass(wire)} circuit-wire--watched`}
              data-index={i}
              role="img"
              aria-label={`Kabel ${i + 1}, ${wire.colour}${wire.cut ? ', getrennt' : ''}: ${now}`}
            >
              <WireRun wire={wire} number={i + 1} cutter={false} />
              <span className="circuit-volts">{now}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The needle's angle for a reading, to a tenth of a degree: −90° at 0 V,
 * upright at mid-scale, +90° at its end and beyond.
 */
export function needleAngle(reading: number | null): number {
  const clamped = Math.min(SCALE_MAX, Math.max(0, reading ?? 0));
  return Math.round((-90 + (clamped / SCALE_MAX) * 180) * 10) / 10;
}

/** Where the needle turns, on the dial's 220 × 132 face. */
const PIVOT = { x: 110, y: 112 };

/** A point on the dial `r` out from the pivot, at the angle of `v` volts. */
function onDial(v: number, r: number): { x: number; y: number } {
  const turn = (needleAngle(v) * Math.PI) / 180;
  const tenth = (n: number): number => Math.round(n * 10) / 10;
  return { x: tenth(PIVOT.x + r * Math.sin(turn)), y: tenth(PIVOT.y - r * Math.cos(turn)) };
}

/** The dial's arc `r` out from the pivot, from `from` to `to` volts. */
function arc(from: number, to: number, r: number): string {
  const start = onDial(from, r);
  const end = onDial(to, r);
  return `M${start.x} ${start.y}A${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

/** A tick every 10 V, a long one with its number every 50 V. */
const TICKS = Array.from({ length: SCALE_MAX / 10 + 1 }, (_, i) => i * 10);

/**
 * The meter's dial behind its glass: 0 to 250 V over a half circle, the top
 * of the scale marked red. The needle swings to the reading on the display,
 * and rests at 0 before one.
 */
function Gauge({ reading }: { reading: number | null }) {
  return (
    <svg className="circuit-gauge" viewBox="0 0 220 132" aria-hidden="true">
      <rect className="gauge-face" x={3} y={3} width={214} height={126} rx={12} />
      <path className="gauge-scale" d={arc(0, SCALE_MAX, 88)} />
      <path className="gauge-danger" d={arc(200, SCALE_MAX, 84)} />
      {TICKS.map((v) => {
        const major = v % 50 === 0;
        const outer = onDial(v, 88);
        const inner = onDial(v, major ? 76 : 82);
        return (
          <line
            key={v}
            className={major ? 'gauge-tick gauge-tick--major' : 'gauge-tick'}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
          />
        );
      })}
      {TICKS.filter((v) => v % 50 === 0).map((v) => {
        const at = onDial(v, 64);
        return (
          <text key={v} className="gauge-number" x={at.x} y={at.y + 3} textAnchor="middle">
            {v}
          </text>
        );
      })}
      <text className="gauge-unit" x={PIVOT.x} y={PIVOT.y - 30} textAnchor="middle">
        V
      </text>
      <g className="gauge-needle" style={{ transform: `rotate(${needleAngle(reading)}deg)` }}>
        <line x1={PIVOT.x} y1={PIVOT.y + 12} x2={PIVOT.x} y2={PIVOT.y - 90} />
      </g>
      <circle className="gauge-pivot" cx={PIVOT.x} cy={PIVOT.y} r={7} />
      <path className="gauge-glass" d="M15 3H205Q217 3 217 15V38C150 60 70 60 3 34V15Q3 3 15 3Z" />
    </svg>
  );
}

/** The meter's display: the wire measured last in this round and its voltage; dashes before. */
function Readout({ probed, readings }: { probed: number | null; readings: (number | null)[] }) {
  const reading = probed === null ? null : (readings[probed] ?? null);
  return (
    <output className="circuit-readout" aria-live="polite">
      <span className="device-sr">
        {probed === null ? '—' : `Kabel ${probed + 1}: ${volts(reading)}`}
      </span>
      <span className="circuit-readout-field" aria-hidden="true">
        <span className="device-engraving">KABEL</span>
        <Segments text={probed === null ? '-' : String(probed + 1)} width={1} />
      </span>
      <span className="circuit-readout-field" aria-hidden="true">
        <span className="device-engraving">SPANNUNG</span>
        <Segments text={reading === null ? '---' : String(reading)} width={3} />
        <span className="circuit-unit">V</span>
      </span>
    </output>
  );
}

/** The meter's pushbuttons, one for every wire by its number: a press measures it. */
function Keys({ count, probed, send }: { count: number; probed: number | null; send: Send }) {
  return (
    <div className="circuit-keys-plate">
      <span className="device-engraving">MESSEN</span>
      <div className="circuit-keys">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            className={i === probed ? 'circuit-probe circuit-probe--last' : 'circuit-probe'}
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
    </div>
  );
}

/** This round's readings on the meter's paper strip, wire by wire; a dash where none was taken. */
function Log({ readings }: { readings: (number | null)[] }) {
  return (
    <figure className="circuit-log">
      <figcaption className="circuit-log-head">MESSPROTOKOLL</figcaption>
      <ol className="circuit-readings" aria-label="Messungen dieser Runde">
        {readings.map((reading, i) => (
          <li key={i}>
            <span>{`Kabel ${i + 1}`}</span>
            <span className="circuit-reading">{volts(reading)}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** The live wires left, on the counter both consoles carry. */
function LiveCounter({ left }: { left: number }) {
  return (
    <div className="circuit-live">
      <span className="device-sr">{`Noch unter Spannung: ${left}`}</span>
      <Segments text={String(left)} width={1} />
      <span className="device-engraving" aria-hidden="true">
        UNTER SPANNUNG
      </span>
    </div>
  );
}

/** What the last wrong cut did, at both consoles and for the audience. */
function Alarm({ puzzle }: { puzzle: CircuitPuzzle }) {
  if (puzzle.lastResult === null) {
    return null;
  }
  return (
    <p className="warn" role="status">
      {puzzle.lastResult === 'short'
        ? 'Kurzschluss — neu verdrahtet.'
        : `Kasten durchgebrannt — −${puzzle.burnoutSec} s.`}
    </p>
  );
}

/**
 * Console a: the wires behind the box's glass door, the cutter over them;
 * beside the door the KURZSCHLUSS lamp, lit after a wrong cut until the
 * next right one, and the counter of live wires.
 */
function FuseBox({ puzzle, wires, send }: { puzzle: CircuitPuzzle; wires: Wire[]; send: Send }) {
  return (
    <div className="circuit-cabinet">
      <div className="circuit-door">
        <Box wires={wires} send={send} />
      </div>
      <div className="circuit-side">
        <div className="circuit-short">
          <DeviceLamp tone={puzzle.lastResult === null ? 'off' : 'red'} />
          <span className="device-engraving">KURZSCHLUSS</span>
        </div>
        <LiveCounter left={puzzle.liveLeft ?? 0} />
      </div>
    </div>
  );
}

/**
 * Console b: the dial and the display of the last measurement, the paper
 * strip of this round's readings and the counter of live wires beside them,
 * and under them a key per wire.
 */
function Meter({
  puzzle,
  count,
  readings,
  send,
}: {
  puzzle: CircuitPuzzle;
  count: number;
  readings: (number | null)[];
  send: Send;
}) {
  const { probed } = puzzle;
  return (
    <div className="circuit-meter">
      <div className="circuit-dial">
        <Gauge reading={probed === null ? null : (readings[probed] ?? null)} />
        <Readout probed={probed} readings={readings} />
      </div>
      <div className="circuit-paper">
        <LiveCounter left={puzzle.liveLeft ?? 0} />
        <Log readings={readings} />
      </div>
      <Keys count={count} probed={probed} send={send} />
    </div>
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
        <FuseBox puzzle={puzzle} wires={puzzle.wires} send={send} />
        <Alarm puzzle={puzzle} />
      </div>
    );
  }
  const { count, readings, probed } = puzzle;
  if (puzzle.role === 'meter' && count !== null && readings !== null) {
    return (
      <div key={puzzle.shorts} className={shaken}>
        <Meter puzzle={puzzle} count={count} readings={readings} send={send} />
        <Alarm puzzle={puzzle} />
      </div>
    );
  }
  const { wires, voltages, dead } = puzzle;
  if (wires !== null && readings !== null && voltages !== null && dead !== null) {
    return (
      <div className="circuit">
        <LiveCounter left={puzzle.liveLeft ?? 0} />
        <Alarm puzzle={puzzle} />
        <section className="circuit-console" aria-label={consoleName('a')}>
          <h4 className="circuit-console-name">{consoleName('a')}</h4>
          <WatchedBox wires={wires} voltages={voltages} dead={dead} />
        </section>
        <section className="circuit-console" aria-label={consoleName('b')}>
          <h4 className="circuit-console-name">{consoleName('b')}</h4>
          <Readout probed={probed} readings={readings} />
          <Log readings={readings} />
        </section>
      </div>
    );
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
