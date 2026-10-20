import { cssVars } from './feel.js';

/**
 * The cutting kit the fuse box and the wiring share: the pliers over a cable, the sparks
 * off a cut, and which cable a change cut. The pliers cursor and the cables' fall are in
 * styles/devices.css (`.cuttable`, `.spark`).
 */

/** The cable a change cut, by its place: whole before, cut after; none where none was. */
export function cutBetween(
  before: readonly { cut: boolean }[] | null,
  after: readonly { cut: boolean }[] | null,
): number | null {
  if (before === null || after === null || before.length !== after.length) {
    return null;
  }
  const cut = after.findIndex((wire, i) => wire.cut && before[i]?.cut === false);
  return cut === -1 ? null : cut;
}

/**
 * Side cutters over a cable, jaws down and open; they snap shut while the cable is pressed
 * (CSS turns each arm about the pivot). Each arm is one piece: a grip, and the jaw across.
 */
export function Pliers() {
  return (
    <svg className="pliers" viewBox="0 0 24 24" aria-hidden="true">
      <g className="pliers-arm pliers-arm--a">
        <path className="pliers-neck" d="M12 11 11.2 13.6" />
        <path className="pliers-grip" d="M11.2 13.6Q9.6 17.5 7.6 22.2" />
        <path className="pliers-jaw" d="M12 11 13.9 7.5Q13.6 4.5 12 2.4Z" />
      </g>
      <g className="pliers-arm pliers-arm--b">
        <path className="pliers-neck" d="M12 11 12.8 13.6" />
        <path className="pliers-grip" d="M12.8 13.6Q14.4 17.5 16.4 22.2" />
        <path className="pliers-jaw" d="M12 11 10.1 7.5Q10.4 4.5 12 2.4Z" />
      </g>
      <circle className="pliers-pivot" cx={12} cy={11} r={1.4} />
    </svg>
  );
}

/** Where each spark flies from the cut, in px: up and out first, the heavier ones low. */
const SPARKS = [
  [-22, -9],
  [-15, -19],
  [-4, -24],
  [8, -18],
  [19, -10],
  [15, 10],
  [-11, 12],
] as const;

/** The way a spark flies off, in degrees from rightwards: its streak lies along it. */
const heading = (x: number, y: number): string =>
  `${Math.round((Math.atan2(y, x) * 180) / Math.PI)}deg`;

/** Sparks off a cut, at the middle of whatever holds them: a flash and seven sparks, 300 ms. */
export function Spark() {
  return (
    <span className="spark" aria-hidden="true">
      <span className="spark-flash" />
      {SPARKS.map(([x, y]) => (
        <span
          key={`${x} ${y}`}
          className="spark-bit"
          style={cssVars({ '--x': `${x}px`, '--y': `${y}px`, '--a': heading(x, y) })}
        />
      ))}
    </span>
  );
}
