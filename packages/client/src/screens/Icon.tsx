import type { ReactNode } from 'react';

/** The icons, by what they show. */
export type IconName =
  | 'book'
  | 'box'
  | 'camera'
  | 'check'
  | 'clock'
  | 'copy'
  | 'crew'
  | 'cross'
  | 'exit'
  | 'eye'
  | 'flag'
  | 'hex'
  | 'info'
  | 'mic'
  | 'note'
  | 'pause'
  | 'pencil'
  | 'plate'
  | 'play'
  | 'podium'
  | 'power'
  | 'printer'
  | 'radio'
  | 'replay'
  | 'search'
  | 'sign'
  | 'siren'
  | 'speaker'
  | 'speaker-off'
  | 'star'
  | 'station'
  | 'warning';

/** A small solid part of a glyph: filled, no outline. */
const SOLID = { fill: 'currentColor', stroke: 'none' } as const;

/** A speaker's cone, under its sound or struck through. */
const CONE = <path d="M2 6.25h2.5L8 3.25v9.5l-3.5-3H2Z" />;

/** Every glyph on a 16-unit square, in outline unless a part is solid. */
const GLYPHS: Record<IconName, ReactNode> = {
  // An open book: two pages curving up from the spine.
  book: (
    <>
      <path d="M8 4.5C6.5 3.2 4.3 2.8 1.75 3v9.5c2.55-.2 4.75.2 6.25 1.5Z" />
      <path d="M8 4.5c1.5-1.3 3.7-1.7 6.25-1.5v9.5c-2.55-.2-4.75.2-6.25 1.5Z" />
    </>
  ),
  // A parcel seen from above one corner: its lid's edges meet at the near one.
  box: (
    <>
      <path d="M8 1.75 14 4.75v6.5l-6 3-6-3v-6.5Z" />
      <path d="M2 4.75 8 7.75l6-3M8 7.75v6.5" />
    </>
  ),
  camera: (
    <>
      <path d="M1.75 5.25h3l1.5-2h3.5l1.5 2h3v8H1.75Z" />
      <circle cx="8" cy="9" r="2.5" />
    </>
  ),
  check: <path d="M2.5 8.5 6 12l7.5-8" />,
  clock: (
    <>
      <circle cx="8" cy="9.5" r="5" />
      <path d="M6.25 1.75h3.5M8 1.75V4.5M8 9.5l2-2M12.1 5.4l1.15-1.15" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  // One of the crew as the game draws them: the body, the visor, the pack.
  crew: (
    <>
      <path d="M4.5 13.5V7a3.5 3.5 0 0 1 7 0v6.5H9V12H7v1.5Z" />
      <path d="M8.5 5.5h3a1.25 1.25 0 0 1 0 2.5h-3a1.25 1.25 0 0 1 0-2.5Z" />
      <path d="M4.5 7.5H3.25v4H4.5" />
    </>
  ),
  cross: <path d="m3.5 3.5 9 9m0-9-9 9" />,
  exit: <path d="M9.5 2.5h-6v11h6M7 8h7.25m-2.5-2.5L14.25 8l-2.5 2.5" />,
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  // The chequered flag that ends a race: on its pole, three of its squares filled.
  flag: (
    <>
      <path d="M3.25 14.5V1.75M3.25 2.5h10V9h-10" />
      <path d="M3.25 2.5h3.3v3.25h-3.3Zm6.7 0h3.3v3.25h-3.3ZM6.55 5.75h3.4V9h-3.4Z" {...SOLID} />
    </>
  ),
  hex:<path d="M8 1.5 13.6 4.75v6.5L8 14.5l-5.6-3.25v-6.5Z" {...SOLID} />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4.25" />
      <circle cx="8" cy="4.75" r="1" {...SOLID} />
    </>
  ),
  // A microphone: its capsule in the cradle, on a short stand.
  mic: (
    <>
      <rect x="5.75" y="1.75" width="4.5" height="7.5" rx="2.25" />
      <path d="M3.5 7a4.5 4.5 0 0 0 9 0M8 11.5v2.75M5.5 14.25h5" />
    </>
  ),
  note: <path d="M3.5 1.75h6l3 3v9.5h-9Zm6 0v3h3M5.75 8h4.5m-4.5 2.75h4.5" />,
  pause: (
    <>
      <rect x="3.75" y="3" width="2.75" height="10" rx=".75" {...SOLID} />
      <rect x="9.5" y="3" width="2.75" height="10" rx=".75" {...SOLID} />
    </>
  ),
  pencil: <path d="M10.75 2.25l3 3-8.5 8.5H2.25v-3Zm-1.5 1.5 3 3" />,
  plate: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.75" {...SOLID} />
    </>
  ),
  play: <path d="M5 3.5v9l7.5-4.5Z" {...SOLID} />,
  // The winners' steps: the first in the middle, the second left, the third right.
  podium: <path d="M1.75 14V8.5h4V4.5h4.5V10h4V14ZM5.75 8.5V14m4.5-4V14" />,
  // The standby symbol printed on a power switch.
  power: <path d="M4.6 4.75a5.25 5.25 0 1 0 6.8 0M8 2v6" />,
  // A printer: the paper going in at the top, the body, the printed sheet in front.
  printer: (
    <>
      <path d="M4.5 6V2h7v4M4.5 11.5H2V6h12v5.5h-2.5" />
      <path d="M4.5 9.5h7V14h-7Z" />
    </>
  ),
  radio: (
    <>
      <path d="m4.5 5.5 7-3.5" />
      <rect x="1.75" y="5.5" width="12.5" height="8.5" rx="1.5" />
      <circle cx="5.75" cy="9.75" r="2" />
      <path d="M10 8.25h2.25M10 11.25h2.25" />
    </>
  ),
  // Once more round: a circle nearly closed, its arrow going on clockwise.
  replay: <path d="M14.6 3.2v3.6H11m2.1 3a5.4 5.4 0 1 1-1.27-5.62l2.77 2.62" />,
  // A magnifying glass: the lens, the handle down to the right.
  search: (
    <>
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.5 10.5 3.75 3.75" />
    </>
  ),
  sign: (
    <>
      <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.25" />
      <path d="M4.5 6.5h7m-7 3h4.5" />
    </>
  ),
  // A beacon on its base, its light going out three ways.
  siren: (
    <>
      <path d="M4.25 12.5V9a3.75 3.75 0 0 1 7.5 0v3.5" />
      <path d="M2.75 12.5h10.5v2H2.75Z" />
      <path d="M8 1.5v1.75M2.6 3.6l1.2 1.2m9.6-1.2-1.2 1.2" />
    </>
  ),
  speaker: (
    <>
      {CONE}
      <path d="M10.5 5.75a3.25 3.25 0 0 1 0 4.5m2-6.5a6 6 0 0 1 0 8.5" />
    </>
  ),
  'speaker-off': (
    <>
      {CONE}
      <path d="m10.5 6 4 4m0-4-4 4" />
    </>
  ),
  star: (
    <path
      d="M8 2.1 9.6 6.4l4.6.2-3.6 2.9 1.2 4.4L8 11.4l-3.8 2.5 1.2-4.4-3.6-2.9 4.6-.2Z"
      {...SOLID}
    />
  ),
  // A console: its screen over the desk with the keys.
  station: (
    <>
      <rect x="2.5" y="2" width="11" height="7.5" rx="1" />
      <path d="M5 5.75h3.5M1.5 14 3 11.5h10l1.5 2.5Z" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.25 14.5 13.5h-13ZM8 6.5v3.25" />
      <circle cx="8" cy="11.6" r=".85" {...SOLID} />
    </>
  ),
};

/** As big as the text around it, sitting on its baseline, never squeezed in a row. */
const SIZING = { flexShrink: 0, verticalAlign: '-0.125em' } as const;

/**
 * One of the game's own icons, drawn in place of the platform's emoji, which
 * look different on every system: one line weight on a 16-unit square, like
 * the symbols screen-printed on the devices, in the colour of the text around
 * it. It only decorates — the words beside it, or the label of the control it
 * sits on, say what it means.
 */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className={`icon icon-${name}`}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={SIZING}
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** Every icon there is, for whoever lists them. */
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
