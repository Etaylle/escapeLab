import { useId } from 'react';

/**
 * The lab's seal on a book's cover: a double ring, „LABOR" round the top,
 * the mission's title round the bottom, a flask in the middle. Strokes and
 * lettering take the colour around them, like the device drawings.
 */

/** The seal's size in its own units; everything is placed round its middle. */
const SIZE = 120;
const MID = SIZE / 2;

/** „LABOR" stands on this circle, its letters pointing out. */
const TOP_RADIUS = 44.5;
/** The title hangs from this circle, its letters pointing in. */
const BOTTOM_RADIUS = 51.5;
/** The title fills at most this much of the bottom, in degrees round six o'clock. */
const TITLE_ARC = 136;
/** A capital of the serif with its letter-spacing, in em, a little over the widest face. */
const CAPS_ADVANCE = 0.78;
const TITLE_SIZE = 8.5;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The point at `deg` degrees clockwise from twelve o'clock on the circle of radius `r`. */
function onCircle(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [round(MID + r * Math.sin(rad)), round(MID - r * Math.cos(rad))];
}

/** An arc of radius `r` from `from` to `to` degrees: clockwise when `to` is the larger. */
function arc(r: number, from: number, to: number): string {
  const [x1, y1] = onCircle(r, from);
  const [x2, y2] = onCircle(r, to);
  return `M${x1} ${y1}A${r} ${r} 0 0 ${to > from ? 1 : 0} ${x2} ${y2}`;
}

/** A five-pointed star of radius `r` at `deg` degrees on the circle of radius `ring`. */
function star(ring: number, deg: number, r: number): string {
  const [cx, cy] = onCircle(ring, deg);
  const points = Array.from({ length: 10 }, (_, i) => {
    const length = i % 2 === 0 ? r : r * 0.42;
    const rad = (i * Math.PI) / 5;
    return `${round(cx + length * Math.sin(rad))} ${round(cy - length * Math.cos(rad))}`;
  });
  return `M${points.join('L')}Z`;
}

/** The title's size: as large as the bottom arc holds it. */
export function titleSize(title: string): number {
  const room = (BOTTOM_RADIUS * TITLE_ARC * Math.PI) / 180;
  return round(Math.min(TITLE_SIZE, room / (Math.max(1, title.length) * CAPS_ADVANCE)));
}

/** The flask's glass: the rim, then down one side, round the foot and up the other. */
const GLASS =
  'M53.5 38H66.5M56.5 38V52L43.5 75.5Q41.8 80 46.5 80H73.5Q78.2 80 76.5 75.5L63.5 52V38';

/** An Erlenmeyer flask, a third full and bubbling. */
function Flask() {
  return (
    <>
      <path
        d="M47.7 68H72.3L76.5 75.5Q78.2 80 73.5 80H46.5Q41.8 80 43.5 75.5Z"
        fill="currentColor"
        fillOpacity={0.2}
        stroke="none"
      />
      <path d={GLASS} />
      <path d="M47.7 68H72.3M56.5 44H59.5M56.5 48H58.5" strokeWidth={0.9} />
      <circle cx={55} cy={74} r={1.4} />
      <circle cx={62.5} cy={72.5} r={1.9} />
      <circle cx={59.5} cy={63.5} r={1.1} />
      <circle cx={61.5} cy={57.5} r={0.8} />
    </>
  );
}

/** The seal round the mission's title. */
export function Seal({ mission }: { mission: string }) {
  const id = useId();
  const title = mission.toUpperCase();
  return (
    <svg
      className="seal"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Laborsiegel: ${mission}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        {/* Longer than the lettering needs: a long title is centred, never cut at an end. */}
        <path id={`${id}-top`} d={arc(TOP_RADIUS, -80, 80)} />
        <path id={`${id}-bottom`} d={arc(BOTTOM_RADIUS, 260, 100)} />
      </defs>
      <circle cx={MID} cy={MID} r={57} strokeWidth={2.4} />
      <circle cx={MID} cy={MID} r={54.4} strokeWidth={0.6} />
      <circle cx={MID} cy={MID} r={40.5} strokeWidth={0.9} />
      <path d={`${star(48, 90, 2.8)}${star(48, 270, 2.8)}`} fill="currentColor" stroke="none" />
      <text fill="currentColor" stroke="none" fontSize={11.5} letterSpacing={3} textAnchor="middle">
        <textPath href={`#${id}-top`} startOffset="50%">
          LABOR
        </textPath>
      </text>
      <text
        fill="currentColor"
        stroke="none"
        fontSize={titleSize(title)}
        letterSpacing={0.6}
        textAnchor="middle"
      >
        <textPath href={`#${id}-bottom`} startOffset="50%">
          {title}
        </textPath>
      </text>
      <Flask />
    </svg>
  );
}
