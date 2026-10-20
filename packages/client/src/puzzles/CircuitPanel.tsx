import { useEffect, useState, type ReactNode } from 'react';
import { consoleName } from '../world/consoles.js';
import { cutBetween, Pliers, Spark } from './cutter.js';
import { DeviceLamp } from './Device.js';
import { motionMs, type Change } from './feel.js';
import type { PanelProps } from './index.js';
import { pliersSnip, shortArc, sparkCrackle, voltageHum } from './sounds.js';

type CircuitPuzzle = PanelProps<'circuit'>['puzzle'];
type CircuitChange = Change<CircuitPuzzle>;
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

/** A wire's row on the board, in its cable's colour; falling and hanging loose once cut. */
function wireClass(wire: Wire, snapped: boolean): string {
  const fall = snapped ? ' circuit-wire--snapped' : '';
  return `circuit-wire ${TONE[wire.colour]}${fall}${wire.cut ? ' circuit-wire--cut' : ''}`;
}

/** The box shorted with this change: rewired, every cable whole again. */
export function shortedWith(change: CircuitChange | null): boolean {
  return change !== null && (change.after.shorts ?? 0) > (change.before.shorts ?? 0);
}

/** The wire this change cut at the box, by its place; none for a short, which cuts nothing. */
export function cutWith(change: CircuitChange | null): number | null {
  if (change === null || change.after.shorts !== change.before.shorts) {
    return null;
  }
  return cutBetween(change.before.wires, change.after.wires);
}

/** What a view's meter read on `wire` this round; none for no wire, or none read. */
function readingOf(view: CircuitPuzzle, wire: number | null): number | null {
  return wire === null ? null : (view.readings?.[wire] ?? null);
}

/** The wire this change measured at the meter and what it read; none where nothing new came. */
export function probedWith(change: CircuitChange | null): { wire: number; volts: number } | null {
  if (change === null) {
    return null;
  }
  const { before, after } = change;
  const wire = after.probed;
  const reading = readingOf(after, wire);
  if (wire === null || reading === null) {
    return null;
  }
  const was = before.probed === wire ? readingOf(before, wire) : null;
  return was === reading ? null : { wire, volts: reading };
}

/**
 * What a change sounds like at either console: a short arcs — the alarm after it — a cut
 * throws sparks, and a measurement hums at a pitch that follows its voltage, none at 0 V.
 */
export function circuitSounds(change: CircuitChange): void {
  if (shortedWith(change)) {
    shortArc();
  } else if (cutWith(change) !== null) {
    sparkCrackle();
  }
  const probe = probedWith(change);
  if (probe !== null) {
    voltageHum(probe.volts);
  }
}

/*
 * A cable's run in its row's 100 × 44 units, stretched to the row's width
 * while every stroke keeps its own: whole, it sags between the terminals;
 * cut, each half hangs from its terminal, the copper bare at the cut — and
 * as it is cut, falls about its terminal and sways (CSS).
 */
const WHOLE = 'M0 12Q50 36 100 12';
const HALVES = [
  { side: 'left', run: 'M0 12Q22 26 40 38', bare: 'M35 34.6 40 38' },
  { side: 'right', run: 'M100 12Q78 26 60 38', bare: 'M65 34.6 60 38' },
] as const;
const stroke = { vectorEffect: 'non-scaling-stroke' } as const;

/**
 * A length of cable: its shadow on the board, the insulation with a sheen
 * along it and, on a black one, a grey tracer stripe so that it shows on
 * anything dark.
 */
function Run({ d, black }: { d: string; black: boolean }) {
  return (
    <>
      <path className="cable-shadow" d={d} transform="translate(0 3)" {...stroke} />
      <path className="cable-edge" d={d} {...stroke} />
      <path className="cable-core" d={d} {...stroke} />
      {black && <path className="cable-tracer" d={d} {...stroke} />}
      <path className="cable-sheen" d={d} transform="translate(0 -1.5)" {...stroke} />
    </>
  );
}

/** The cable between its terminals: whole, or in two halves hanging from them. */
function Cable({ wire }: { wire: Wire }) {
  const black = wire.colour === 'schwarz';
  return (
    <svg className="cable" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      {wire.cut ? (
        HALVES.map(({ side, run, bare }) => (
          <g key={side} className={`cable-half cable-half--${side}`}>
            <Run d={run} black={black} />
            <path className="cable-bare" d={bare} {...stroke} />
          </g>
        ))
      ) : (
        <Run d={WHOLE} black={black} />
      )}
    </svg>
  );
}

/**
 * A wire's row: its number printed on the board, a terminal either side and
 * the cable between them; with `cutter`, the pliers that show over the cable
 * where a tap or a click goes in; `snapped`, the sparks off the cut it just got.
 */
function WireRun(props: { wire: Wire; number: number; cutter: boolean; snapped: boolean }) {
  return (
    <>
      <span className="circuit-number">{props.number}</span>
      <span className="circuit-terminal" />
      <span className="circuit-run">
        <Cable wire={props.wire} />
        {props.cutter && (
          <span className="circuit-cutter">
            <Pliers />
          </span>
        )}
        {props.snapped && <Spark />}
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

/** How long a new reading's digits run wild before they settle, in ms. */
export const SETTLE_MS = 150;
/** How often they change meanwhile, in ms. */
const SETTLE_STEP_MS = 30;

/**
 * The digits a display shows `frame` steps into settling on `text`: every digit another,
 * changing from frame to frame; whatever is not a digit as it is.
 */
export function scrambled(text: string, frame: number): string {
  const wild = (digit: string, i: number): string =>
    String((Number(digit) + 3 + frame * 7 + i * 5) % 10);
  return [...text].map((char, i) => (/\d/.test(char) ? wild(char, i) : char)).join('');
}

/** `text` on seven segments once SETTLE_MS of wild digits have run, from the first frame on. */
function Settling({ text, width }: { text: string; width: number }) {
  const [frame, setFrame] = useState(0);
  const frames = Math.round(motionMs(SETTLE_MS) / SETTLE_STEP_MS);
  useEffect(() => {
    if (frame >= frames) {
      return undefined;
    }
    const timer = setTimeout(() => setFrame((n) => n + 1), SETTLE_STEP_MS);
    return () => clearTimeout(timer);
  }, [frame, frames]);
  return <Segments text={frame >= frames ? text : scrambled(text, frame)} width={width} />;
}

/**
 * The box at console a: the board behind the glass door, a button per wire
 * numbered from the top. Its colour is the cable's; a screen reader hears it.
 * The pliers snip as a wire is pressed; the cut itself is the server's to say.
 */
function Box(props: { wires: Wire[]; snapped: number | null; rewired: boolean; send: Send }) {
  const { wires, snapped, rewired, send } = props;
  return (
    <ol
      className={rewired ? 'circuit-board circuit-board--rewired' : 'circuit-board'}
      aria-label="Kabel, von oben gezählt"
    >
      {wires.map((wire, i) => (
        <li key={i}>
          <button
            className={wireClass(wire, i === snapped)}
            data-index={i}
            disabled={wire.cut}
            data-feel="none"
            aria-label={`Kabel ${i + 1}, ${wire.colour}${wire.cut ? ', getrennt' : ''}`}
            onClick={() => {
              pliersSnip();
              send({ cut: i });
            }}
          >
            <WireRun wire={wire} number={i + 1} cutter={!wire.cut} snapped={i === snapped} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The box for the audience: each wire with its voltage now, the dead one marked; nothing to cut. */
function WatchedBox(props: {
  wires: Wire[];
  voltages: number[];
  dead: boolean[];
  snapped: number | null;
}) {
  const { wires, voltages, dead, snapped } = props;
  return (
    <ol className="circuit-board" aria-label="Kabel, von oben gezählt">
      {wires.map((wire, i) => {
        const now = dead[i] === true ? 'tot' : volts(voltages[i]);
        return (
          <li key={i}>
            <span
              className={`${wireClass(wire, i === snapped)} circuit-wire--watched`}
              data-index={i}
              role="img"
              aria-label={`Kabel ${i + 1}, ${wire.colour}${wire.cut ? ', getrennt' : ''}: ${now}`}
            >
              <WireRun wire={wire} number={i + 1} cutter={false} snapped={i === snapped} />
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
 * of the scale marked red. The needle swings to the reading on the display
 * with a needle's inertia, past it once and back (CSS), and rests at 0 before one.
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

/**
 * The meter's display: the wire measured last in this round and its voltage; dashes before.
 * A reading just come in runs through wild digits first (`settling`, the change's number).
 */
function Readout(props: {
  probed: number | null;
  readings: (number | null)[];
  settling: number | null;
}) {
  const { probed, readings, settling } = props;
  const reading = probed === null ? null : (readings[probed] ?? null);
  const text = reading === null ? '---' : String(reading);
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
        {settling === null ? (
          <Segments text={text} width={3} />
        ) : (
          <Settling key={settling} text={text} width={3} />
        )}
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
            data-feel="probe"
            aria-label={`Kabel ${i + 1} messen`}
            onClick={() => send({ probe: i })}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * This round's readings on the meter's paper strip, wire by wire; a dash where none was
 * taken. The line of a reading just come in (`fresh`) slides in.
 */
function Log({ readings, fresh }: { readings: (number | null)[]; fresh: number | null }) {
  return (
    <figure className="circuit-log">
      <figcaption className="circuit-log-head">MESSPROTOKOLL</figcaption>
      <ol className="circuit-readings" aria-label="Messungen dieser Runde">
        {readings.map((reading, i) => (
          <li key={i} className={i === fresh ? 'circuit-log-new' : undefined}>
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
 * Console a: the wires behind the box's glass door, the pliers over them;
 * beside the door the KURZSCHLUSS lamp, lit after a wrong cut until the
 * next right one, and the counter of live wires. A short rewires the board,
 * which redraws with a flicker — a board of its own for every short.
 */
function FuseBox(props: {
  puzzle: CircuitPuzzle;
  wires: Wire[];
  change: CircuitChange | null;
  send: Send;
}) {
  const { puzzle, wires, change, send } = props;
  return (
    <div className="circuit-cabinet">
      <div className="circuit-door">
        <Box
          key={puzzle.shorts ?? 0}
          wires={wires}
          snapped={cutWith(change)}
          rewired={shortedWith(change)}
          send={send}
        />
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
function Meter(props: {
  puzzle: CircuitPuzzle;
  count: number;
  readings: (number | null)[];
  change: CircuitChange | null;
  send: Send;
}) {
  const { puzzle, count, readings, change, send } = props;
  const { probed } = puzzle;
  const fresh = probedWith(change);
  return (
    <div className="circuit-meter">
      <div className="circuit-dial">
        <Gauge reading={probed === null ? null : (readings[probed] ?? null)} />
        <Readout
          probed={probed}
          readings={readings}
          settling={fresh === null || change === null ? null : change.seq}
        />
      </div>
      <div className="circuit-paper">
        <LiveCounter left={puzzle.liveLeft ?? 0} />
        <Log readings={readings} fresh={fresh?.wire ?? null} />
      </div>
      <Keys count={count} probed={probed} send={send} />
    </div>
  );
}

/** A short's white flash over the console, one for every short. */
function ShortFlash({ change }: { change: CircuitChange | null }) {
  return change !== null && shortedWith(change) ? (
    <span key={change.seq} className="circuit-flash" aria-hidden="true" />
  ) : null;
}

/** A console's face: a short's flash over it, its instrument, what the last wrong cut did. */
function Console(props: {
  puzzle: CircuitPuzzle;
  change: CircuitChange | null;
  children: ReactNode;
}) {
  return (
    <div className="circuit">
      <ShortFlash change={props.change} />
      {props.children}
      <Alarm puzzle={props.puzzle} />
    </div>
  );
}

/**
 * Both consoles as the audience sees them: every wire with its voltage now
 * and the dead one marked, the meter's display and strip; nothing to press.
 * A console nobody stands at says it is not connected.
 */
function Watched({ puzzle, change }: { puzzle: CircuitPuzzle; change: CircuitChange | null }) {
  const { wires, readings, voltages, dead, probed } = puzzle;
  if (wires === null || readings === null || voltages === null || dead === null) {
    return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
  }
  return (
    <div className="circuit">
      <ShortFlash change={change} />
      <LiveCounter left={puzzle.liveLeft ?? 0} />
      <Alarm puzzle={puzzle} />
      <section className="circuit-console" aria-label={consoleName('a')}>
        <h4 className="circuit-console-name">{consoleName('a')}</h4>
        <WatchedBox wires={wires} voltages={voltages} dead={dead} snapped={cutWith(change)} />
      </section>
      <section className="circuit-console" aria-label={consoleName('b')}>
        <h4 className="circuit-console-name">{consoleName('b')}</h4>
        <Readout probed={probed} readings={readings} settling={null} />
        <Log readings={readings} fresh={probedWith(change)?.wire ?? null} />
      </section>
    </div>
  );
}

/**
 * Sicherungskasten + Prüfpult at one console. Console a has the wires and
 * cuts them, console b measures them by number; after every cut the
 * voltages change, so b measures again. A short flashes the console white
 * and arcs before the device's alarm. The audience sees both consoles, with
 * every voltage.
 */
export function CircuitPanel({ puzzle, change, send }: PanelProps<'circuit'>) {
  const { wires, count, readings } = puzzle;
  if (puzzle.role === 'box' && wires !== null) {
    return (
      <Console puzzle={puzzle} change={change}>
        <FuseBox puzzle={puzzle} wires={wires} change={change} send={send} />
      </Console>
    );
  }
  if (puzzle.role === 'meter' && count !== null && readings !== null) {
    return (
      <Console puzzle={puzzle} change={change}>
        <Meter puzzle={puzzle} count={count} readings={readings} change={change} send={send} />
      </Console>
    );
  }
  return <Watched puzzle={puzzle} change={change} />;
}
