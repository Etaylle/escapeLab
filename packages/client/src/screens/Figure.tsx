import type { ReactNode } from 'react';
import {
  LEVER_FIGURE,
  PATTERN_FIGURE,
  SIGNAL_PATTERNS,
  type PuzzleDef,
  type SignalPattern,
} from '@escapelab/core';

/**
 * Line drawings of the devices for the printed rules, one per module type,
 * and the Signalkette's key of colours and patterns (PATTERN_FIGURE).
 * Thin strokes in the colour of the text around them; a surface is only ever
 * hatched or lightly tinted, so a drawing reads the same on paper, on the
 * terminal's glass and from a printer. Drawn 376 units across and 140 down:
 * on a book's page it is set 18.8 em wide (pages.ts FIGURE_WIDTH), centred
 * in the text column, so 7 em tall, as pages.ts counts it.
 */

/** The drawing's size in its own units. */
export const FIGURE_VIEW = { width: 376, height: 140 } as const;

/** A lit or raised surface: the ink, thinned out. */
const TINT = { fill: 'currentColor', fillOpacity: 0.2 } as const;
/** A lit LED, too small to read as lit when only tinted. */
const GLOW = { fill: 'currentColor', fillOpacity: 0.7 } as const;

/** To a tenth of a unit, which keeps computed paths short. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Diagonal hatching across a rectangle, `step` units apart, as one path. */
function hatch(x: number, y: number, w: number, h: number, step = 4): string {
  let d = '';
  for (let k = step; k < w + h; k += step) {
    const top = Math.min(k, w);
    const side = Math.min(k, h);
    d += `M${x + top} ${y + k - top}L${x + k - side} ${y + side}`;
  }
  return d;
}

/** Lettering printed on the device itself, set in mono; `y` is its baseline. */
function Mark({
  x,
  y,
  size = 10,
  anchor = 'middle',
  children,
}: {
  x: number;
  y: number;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  children: ReactNode;
}) {
  return (
    <text x={x} y={y} fontSize={size} textAnchor={anchor} fill="currentColor" stroke="none">
      {children}
    </text>
  );
}

/** Lettering that differs from one device to the next, drawn as blocks of strokes. */
function Lettering({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <path
      d={`M${x} ${y}h${width}`}
      strokeWidth={2.4}
      strokeDasharray="6 2.5"
      strokeLinecap="butt"
    />
  );
}

/** A round lamp; a lit one is tinted and throws eight short rays. */
function Lamp({ x, y, r, lit = false }: { x: number; y: number; r: number; lit?: boolean }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const cos = Math.cos((i * Math.PI) / 4);
    const sin = Math.sin((i * Math.PI) / 4);
    const out = (d: number): string => `${round(x + cos * d)} ${round(y + sin * d)}`;
    return `M${out(r + 2.5)}L${out(r + 6)}`;
  });
  return (
    <>
      <circle cx={x} cy={y} r={r} {...(lit ? TINT : {})} />
      {lit && <path d={rays.join('')} strokeWidth={1} />}
    </>
  );
}

/** The front plate every device sits on. */
function Housing({ x, width }: { x: number; width: number }) {
  return <rect x={x} y={6} width={width} height={128} rx={6} strokeWidth={1.6} />;
}

/** Four wires numbered from the top as the rules count them; the third one is cut. */
function Wiring() {
  return (
    <>
      <Housing x={104} width={168} />
      <Lamp x={188} y={17} r={4} lit />
      <rect x={118} y={28} width={12} height={92} rx={2} />
      <rect x={246} y={28} width={12} height={92} rx={2} />
      {[38, 62, 86, 110].map((y, i) => (
        <g key={y}>
          <Mark x={98} y={y + 3.5} anchor="end">
            {i + 1}
          </Mark>
          <circle cx={124} cy={y} r={3} />
          <circle cx={252} cy={y} r={3} />
          <path
            d={
              i === 2
                ? `M127 ${y}Q158 ${y + 3} 179 ${y + 8}M197 ${y + 8}Q218 ${y + 3} 249 ${y}`
                : `M127 ${y}Q188 ${y + 8} 249 ${y}`
            }
            strokeWidth={2.2}
          />
        </g>
      ))}
      {/* the cutter, open over the cut */}
      <circle cx={183} cy={73} r={3.2} />
      <circle cx={193} cy={73} r={3.2} />
      <path d="M185 76L193 89M191 76L183 89" />
    </>
  );
}

/** Marks that stand for a symbol: no letter, and none the keypad really shows. */
const GLYPHS = [
  'M0 -10L9 0L0 10L-9 0ZM2 0A2 2 0 1 1 -2 0A2 2 0 1 1 2 0',
  'M-6 -9L5 -2L-5 3L6 9',
  'M-8 -7H4M-4 0H8M-8 7H4',
  'M-7 -7L7 7M7 -7L-7 7M-9 0H9',
];

/** Four keys with a symbol each and a lamp over it; the second key is lit. */
function Keypad() {
  return (
    <>
      <Housing x={122} width={132} />
      {GLYPHS.map((glyph, i) => {
        const x = 137 + (i % 2) * 56;
        const y = 19 + Math.floor(i / 2) * 56;
        const lit = i === 1;
        return (
          <g key={glyph}>
            <rect x={x} y={y} width={46} height={46} rx={3} {...(lit ? TINT : {})} />
            <circle cx={x + 23} cy={y + 7} r={2.5} {...(lit ? GLOW : {})} />
            <path d={glyph} transform={`translate(${x + 23} ${y + 28})`} />
          </g>
        );
      })}
    </>
  );
}

/** A five-pointed star around (x, y). */
function star(x: number, y: number, outer: number, inner: number): string {
  const points = Array.from({ length: 10 }, (_, k) => {
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? outer : inner;
    return `${round(x + r * Math.cos(angle))} ${round(y + r * Math.sin(angle))}`;
  });
  return `M${points.join('L')}Z`;
}

/** The bank's six levers: whether the lamp is on, a marking band is there, the lever is up. */
const BANK = [
  { lit: true, band: false, up: true },
  { lit: false, band: true, up: false },
  { lit: true, band: true, up: false },
  { lit: true, band: false, up: true },
  { lit: false, band: false, up: true },
  { lit: false, band: true, up: false },
];

/** Six levers in a row, each under its number, lamp and marking; the fourth has the star. */
function Switches() {
  return (
    <>
      <Housing x={60} width={256} />
      {BANK.map(({ lit, band, up }, i) => {
        const x = 88 + i * 40;
        return (
          <g key={x}>
            <Mark x={x} y={20} size={9}>
              {i + 1}
            </Mark>
            <circle cx={x} cy={30} r={3.5} {...(lit ? GLOW : {})} />
            {band ? (
              <path d={`M${x - 9} 39h18v7h-18z${hatch(x - 9, 39, 18, 7, 3)}`} strokeWidth={0.8} />
            ) : (
              <rect
                x={x - 9}
                y={39}
                width={18}
                height={7}
                strokeDasharray="2 2"
                strokeWidth={0.8}
              />
            )}
            <rect x={x - 4.5} y={64} width={9} height={56} rx={4.5} />
            <rect x={x - 8} y={up ? 66 : 106} width={16} height={12} rx={2} {...TINT} />
          </g>
        );
      })}
      <path d={star(208, 54, 5.5, 2.3)} {...TINT} />
    </>
  );
}

/** Four pads in a square, the second lit, and the alarm counter beside them. */
function Simon() {
  return (
    <>
      <Housing x={96} width={184} />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={114 + (i % 2) * 52}
          y={22 + Math.floor(i / 2) * 52}
          width={44}
          height={44}
          rx={6}
          {...(i === 1 ? TINT : {})}
        />
      ))}
      <Mark x={248} y={58} size={9}>
        ALARME
      </Mark>
      <rect x={232} y={64} width={32} height={22} rx={2} />
      <Mark x={248} y={80} size={14}>
        0
      </Mark>
    </>
  );
}

/** The big button with its label across it, the colour strip beside it. */
function Button() {
  return (
    <>
      <Housing x={100} width={176} />
      <circle cx={166} cy={70} r={52} />
      <circle cx={166} cy={70} r={44} />
      <rect x={126} y={61} width={80} height={18} rx={2} />
      <Lettering x={134} y={70} width={64} />
      <path d={`M238 22h18v96h-18z${hatch(238, 22, 18, 96)}`} strokeWidth={0.8} />
    </>
  );
}

/** The display's digit over four labelled buttons; the stage lamps at the side. */
function Memory() {
  return (
    <>
      <Housing x={100} width={176} />
      <rect x={120} y={16} width={112} height={50} rx={3} />
      <Mark x={176} y={54} size={34}>
        3
      </Mark>
      {['2', '4', '1', '3'].map((label, j) => (
        <g key={j}>
          <rect x={120 + j * 30} y={76} width={22} height={44} rx={2} />
          <Mark x={131 + j * 30} y={103} size={13}>
            {label}
          </Mark>
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((k) => (
        <rect
          key={k}
          x={248}
          y={18 + k * 21}
          width={14}
          height={14}
          rx={2}
          {...(k > 2 ? TINT : {})}
        />
      ))}
    </>
  );
}

/** The 16 steps of the frequency dial, every fifth one longer. */
const MORSE_SCALE = Array.from(
  { length: 16 },
  (_, i) => `M${150 + i * 10} ${i % 5 === 0 ? 36 : 40}V48`,
).join('');

/** The signal lamp over the send key; the frequency dial with its scale and read-out. */
function Morse() {
  return (
    <>
      <Housing x={40} width={296} />
      <Lamp x={88} y={46} r={14} lit />
      <rect x={56} y={92} width={64} height={28} rx={4} />
      <Mark x={88} y={110} size={11}>
        SENDEN
      </Mark>
      <path d={`M146 48H304${MORSE_SCALE}`} />
      <path d="M210 52l-5 8h10z" {...TINT} />
      <Mark x={304} y={32} size={9} anchor="end">
        MHz
      </Mark>
      <rect x={150} y={80} width={26} height={22} rx={3} />
      <path d="M167 85l-8 6 8 6z" />
      <rect x={184} y={80} width={82} height={22} rx={3} />
      <Lettering x={196} y={91} width={58} />
      <rect x={274} y={80} width={26} height={22} rx={3} />
      <path d="M283 85l8 6-8 6z" />
    </>
  );
}

/** The field's top left corner, the side of a cell and the cells a side. */
const MAZE = { x: 137, y: 24, cell: 17, size: 6 };

/**
 * The navigation console: the 6 × 6 field with its letters and numbers, the
 * marker and the goal — and no walls, which only the Schaltplan shows.
 */
function Maze() {
  const { x, y, cell, size } = MAZE;
  const span = size * cell;
  const lines = Array.from({ length: size - 1 }, (_, i) => {
    const at = (i + 1) * cell;
    return `M${x + at} ${y}V${y + span}M${x} ${y + at}H${x + span}`;
  });
  return (
    <>
      {Array.from({ length: size }, (_, i) => (
        <g key={i}>
          <Mark x={x + i * cell + cell / 2} y={y - 6} size={9}>
            {'ABCDEF'[i]}
          </Mark>
          <Mark x={x - 6} y={y + i * cell + 12} size={9} anchor="end">
            {i + 1}
          </Mark>
        </g>
      ))}
      <path d={lines.join('')} strokeWidth={0.6} strokeOpacity={0.4} />
      <rect x={x} y={y} width={span} height={span} strokeWidth={1.6} />
      <circle cx={x + cell / 2} cy={y + 5.5 * cell} r={5} {...TINT} />
      <path d={`M${x + 5.5 * cell} ${y + 2}l6.5 11h-13z`} {...TINT} />
    </>
  );
}

/** One big button under two lamps, one for each press. */
function ButtonSync() {
  return (
    <>
      <Housing x={124} width={128} />
      <Lamp x={168} y={24} r={4.5} lit />
      <Lamp x={208} y={24} r={4.5} />
      <circle cx={188} cy={84} r={40} />
      <circle cx={188} cy={84} r={32} />
    </>
  );
}

/** Where the main switch's two levers stand, across. */
const LEVERS = [158, 218] as const;

/**
 * The main switch a sync station is drawn as where its style says lever: a
 * plate over two levers side by side, each in its slot between AUS at the
 * top and EIN at the foot, a lamp over each — the first lit, its partner
 * there. Both stand at AUS.
 */
function LeverSwitch() {
  return (
    <>
      <Housing x={108} width={160} />
      <rect x={124} y={14} width={128} height={18} rx={2} {...TINT} />
      <Lettering x={138} y={23} width={100} />
      {LEVERS.map((x, i) => (
        <g key={x}>
          <Lamp x={x} y={45} r={4} lit={i === 0} />
          <rect x={x - 6} y={58} width={12} height={66} rx={6} />
          <Mark x={x + 21} y={68} size={7} anchor="start">
            AUS
          </Mark>
          <Mark x={x + 21} y={122} size={7} anchor="start">
            EIN
          </Mark>
          <path d={`M${x} 66V78`} strokeWidth={3} />
          <rect x={x - 17} y={60} width={34} height={10} rx={3} {...TINT} />
        </g>
      ))}
    </>
  );
}

/** A Schalter on its plate around (x, 72): the lever up for AN, down for AUS. */
function ToggleSwitch({ x, on }: { x: number; on: boolean }) {
  return (
    <>
      <rect x={x - 9} y={48} width={18} height={48} rx={3} />
      <path d={`M${x} 72V${on ? 58 : 86}`} strokeWidth={2.2} />
      <circle cx={x} cy={72} r={3} />
      <circle cx={x} cy={on ? 56 : 88} r={4.5} {...TINT} />
    </>
  );
}

/** A Drehregler around (x, 72): the knob, a tick for each of its 5 levels, the pointer on one. */
function Dial({ x, level }: { x: number; level: number }) {
  // The levels run from the lower left over the top to the lower right, 60° apart.
  const towards = (step: number, r: number): string => {
    const angle = ((150 + step * 60) * Math.PI) / 180;
    return `${round(x + r * Math.cos(angle))} ${round(72 + r * Math.sin(angle))}`;
  };
  const ticks = [0, 1, 2, 3, 4].map((step) => `M${towards(step, 16)}L${towards(step, 20)}`);
  return (
    <>
      <path d={ticks.join('')} strokeWidth={1} />
      <circle cx={x} cy={72} r={12} {...TINT} />
      <path d={`M${x} 72L${towards(level - 1, 9)}`} strokeWidth={2} />
    </>
  );
}

/** A Taster around (x, 72): a round cap in its square bezel. */
function PushButton({ x }: { x: number }) {
  return (
    <>
      <rect x={x - 13} y={59} width={26} height={26} rx={4} />
      <circle cx={x} cy={72} r={8} {...TINT} />
    </>
  );
}

/**
 * A relay console: a Schalter at AN, a Drehregler, a Taster and a Schalter
 * at AUS, each over its name plate, under a strip of lamps.
 */
function Relay() {
  return (
    <>
      <Housing x={70} width={236} />
      <rect x={94} y={14} width={188} height={16} rx={8} />
      {Array.from({ length: 8 }, (_, k) => (
        <circle key={k} cx={106 + k * 24} cy={22} r={4} {...(k < 3 ? GLOW : {})} />
      ))}
      <ToggleSwitch x={119} on />
      <Dial x={165} level={4} />
      <PushButton x={211} />
      <ToggleSwitch x={257} on={false} />
      {[119, 165, 211, 257].map((x) => (
        <g key={x}>
          <rect x={x - 17} y={112} width={34} height={14} rx={2} />
          <Lettering x={x - 10} y={119} width={20} />
        </g>
      ))}
    </>
  );
}

type Shape = 'circle' | 'triangle' | 'square';
const SHAPES: readonly Shape[] = ['circle', 'triangle', 'square'];
/** Four colours told apart in one ink: from bare to nearly solid. */
const TONES = [0, 0.25, 0.5, 0.8];

/** One coloured token of the Signalkette, its colour drawn as a tone of the ink. */
function Token({ shape, x, y, tone }: { shape: Shape; x: number; y: number; tone: number }) {
  const fill = { fill: 'currentColor', fillOpacity: TONES[tone] ?? 0 };
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={8} {...fill} />;
    case 'triangle':
      return <path d={`M${x} ${y - 8.5}L${x + 8.5} ${y + 6.5}H${x - 8.5}Z`} {...fill} />;
    case 'square':
      return <rect x={x - 7} y={y - 7} width={14} height={14} {...fill} />;
  }
}

/** The sending console's row of four tokens, an arrow, the receiving console's 3 × 4 keys. */
function Signal() {
  const sent: [Shape, number][] = [
    ['circle', 1],
    ['triangle', 3],
    ['square', 0],
    ['triangle', 2],
  ];
  return (
    <>
      <rect x={10} y={30} width={150} height={80} rx={6} strokeWidth={1.6} />
      <Mark x={85} y={45} size={9}>
        PULT A
      </Mark>
      <rect x={22} y={52} width={126} height={44} rx={3} />
      {sent.map(([shape, tone], i) => (
        <Token key={i} shape={shape} x={40 + i * 30} y={75} tone={tone} />
      ))}
      <path d="M170 70H204M197 64l7 6-7 6" />
      <rect x={214} y={6} width={152} height={128} rx={6} strokeWidth={1.6} />
      <Mark x={290} y={20} size={9}>
        PULT B
      </Mark>
      {Array.from({ length: 12 }, (_, k) => {
        const [col, row] = [k % 4, Math.floor(k / 4)];
        const [x, y] = [225 + col * 34, 28 + row * 34];
        return (
          <g key={k}>
            <rect x={x} y={y} width={28} height={28} rx={3} />
            <Token shape={SHAPES[(row + col) % 3] ?? 'circle'} x={x + 14} y={y + 14} tone={col} />
          </g>
        );
      })}
    </>
  );
}

/** The Signalkette's colours as the legend names them, left to right, each with its pattern. */
const PATTERN_KEY = [
  { colour: 'rot', name: 'ROT', pattern: 'glatt' },
  { colour: 'blau', name: 'BLAU', pattern: 'Punkte' },
  { colour: 'gruen', name: 'GRÜN', pattern: 'Streifen' },
  { colour: 'gelb', name: 'GELB', pattern: 'Ring' },
] as const;

/** Where the key's discs stand: the first one's centre, the step between them, their radius. */
const DISC = { x: 59, y: 52, step: 86, r: 21 };
/** How far in from a disc's edge its pattern stays. */
const PATTERN_MARGIN = 4;

/** A staggered grid of dot centres, 6 units apart, that keeps clear of the disc's edge. */
function dotsOn(cx: number, cy: number): [number, number][] {
  const dots: [number, number][] = [];
  for (let row = -3; row <= 3; row++) {
    for (let col = -3; col <= 3; col++) {
      const x = cx + col * 6 + (row % 2 === 0 ? 0 : 3);
      const y = cy + row * 5.2;
      if (Math.hypot(x - cx, y - cy) <= DISC.r - PATTERN_MARGIN - 1.5) {
        dots.push([round(x), round(y)]);
      }
    }
  }
  return dots;
}

/** Stripes rising to the right, 7 units apart, cut off short of the disc's edge, as one path. */
function stripesOn(cx: number, cy: number): string {
  const inner = DISC.r - PATTERN_MARGIN;
  const half = Math.SQRT1_2;
  return [-2, -1, 0, 1, 2]
    .map((k) => {
      const offset = k * 7;
      const reach = Math.sqrt(inner * inner - offset * offset);
      const [mx, my] = [cx + offset * half, cy + offset * half];
      return (
        `M${round(mx - reach * half)} ${round(my + reach * half)}` +
        `L${round(mx + reach * half)} ${round(my - reach * half)}`
      );
    })
    .join('');
}

/** The pattern a colour carries, over its disc around (cx, cy); a plain one has none. */
function PatternMarks({ pattern, cx, cy }: { pattern: SignalPattern; cx: number; cy: number }) {
  switch (pattern) {
    case 'plain':
      return null;
    case 'dots':
      return (
        <g fill="currentColor" stroke="none">
          {dotsOn(cx, cy).map(([x, y]) => (
            <circle key={`${x} ${y}`} cx={x} cy={y} r={1.5} />
          ))}
        </g>
      );
    case 'stripes':
      return <path d={stripesOn(cx, cy)} strokeWidth={1.8} />;
    case 'ring':
      return <circle cx={cx} cy={cy} r={8} strokeWidth={2.6} />;
  }
}

/**
 * The Signalkette's four colours as round signs side by side, each in the
 * pattern it carries at the consoles, with the colour and the pattern
 * lettered under it: the legend's key for whoever cannot tell the colours.
 */
function SignalPatterns() {
  return (
    <>
      {PATTERN_KEY.map(({ colour, name, pattern }, i) => {
        const cx = DISC.x + i * DISC.step;
        return (
          <g key={colour}>
            <circle cx={cx} cy={DISC.y} r={DISC.r} strokeWidth={1.6} {...TINT} />
            <PatternMarks pattern={SIGNAL_PATTERNS[colour]} cx={cx} cy={DISC.y} />
            <Mark x={cx} y={96} size={11}>
              {name}
            </Mark>
            <Mark x={cx} y={112} size={10}>
              {pattern}
            </Mark>
          </g>
        );
      })}
    </>
  );
}

/** The meter's pivot and the radius of its scale. */
const DIAL = { x: 281, y: 76, r: 44 };

/** The point at `angle` degrees (clockwise from east) and `r` units out from the meter's pivot. */
function onDial(angle: number, r: number): string {
  const rad = (angle * Math.PI) / 180;
  return `${round(DIAL.x + r * Math.cos(rad))} ${round(DIAL.y + r * Math.sin(rad))}`;
}

/**
 * Two consoles side by side: at A the box with five wires numbered from the
 * top, the third cut; at B the meter — a needle over a scale, under it a key
 * for each wire's number.
 */
function Circuit() {
  const ticks = Array.from({ length: 7 }, (_, k) => {
    const angle = 205 + (k * 130) / 6;
    return `M${onDial(angle, k % 2 === 0 ? 35 : 38)}L${onDial(angle, DIAL.r)}`;
  });
  const arc = `M${onDial(205, DIAL.r)}A${DIAL.r} ${DIAL.r} 0 0 1 ${onDial(335, DIAL.r)}`;
  return (
    <>
      <rect x={28} y={6} width={150} height={128} rx={6} strokeWidth={1.6} />
      <Mark x={103} y={18} size={9}>
        PULT A
      </Mark>
      <rect x={40} y={22} width={10} height={102} rx={2} />
      <rect x={156} y={22} width={10} height={102} rx={2} />
      {[32, 52, 72, 92, 112].map((y, i) => (
        <g key={y}>
          <Mark x={22} y={y + 3.5} anchor="end">
            {i + 1}
          </Mark>
          <circle cx={45} cy={y} r={2.6} />
          <circle cx={161} cy={y} r={2.6} />
          <path
            d={
              i === 2
                ? `M48 ${y}Q72 ${y + 3} 93 ${y + 8}M113 ${y + 8}Q134 ${y + 3} 158 ${y}`
                : `M48 ${y}Q103 ${y + 7} 158 ${y}`
            }
            strokeWidth={2.2}
          />
        </g>
      ))}
      <rect x={206} y={6} width={150} height={128} rx={6} strokeWidth={1.6} />
      <Mark x={281} y={18} size={9}>
        PULT B
      </Mark>
      <rect x={220} y={24} width={122} height={60} rx={3} />
      <path d={`${arc}${ticks.join('')}`} />
      <Mark x={262} y={74} size={9}>
        V
      </Mark>
      <path d={`M${DIAL.x} ${DIAL.y}L${onDial(300, 38)}`} strokeWidth={1.6} />
      <circle cx={DIAL.x} cy={DIAL.y} r={3} {...TINT} />
      {[1, 2, 3, 4, 5].map((key, k) => (
        <g key={key}>
          <rect x={224 + k * 24} y={96} width={18} height={22} rx={2} />
          <Mark x={233 + k * 24} y={111} size={10}>
            {key}
          </Mark>
        </g>
      ))}
    </>
  );
}

/** The Serverraum's services as boxes of its graph, by their top-left corner: 40 × 22 each. */
const SERVICE_BOXES = [
  { name: 'NETZ', x: 4, y: 59 },
  { name: 'DNS', x: 72, y: 13 },
  { name: 'DB', x: 72, y: 105 },
  { name: 'AUTH', x: 140, y: 59 },
  { name: 'MAIL', x: 208, y: 13 },
  { name: 'WEB', x: 208, y: 105 },
] as const;

/**
 * The graph's arrows, each from a dependency to the service that needs it:
 * [x1, y1, x2, y2] from an edge of the one box to an edge of the other.
 */
const NEEDS = [
  [34, 59, 72, 24],
  [34, 81, 72, 116],
  [44, 70, 140, 70],
  [112, 24, 150, 59],
  [112, 24, 208, 24],
  [112, 116, 208, 116],
  [180, 70, 218, 35],
  [180, 70, 218, 105],
] as const;

/** A straight arrow from (x1, y1) to (x2, y2), its head an open V at the end, as one path. */
function arrowPath(x1: number, y1: number, x2: number, y2: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const barb = (turn: number): string => {
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    return `${round(x2 - 6 * (ux * c - uy * s))} ${round(y2 - 6 * (uy * c + ux * s))}`;
  };
  return `M${x1} ${y1}L${x2} ${y2}M${barb(0.45)}L${x2} ${y2}L${barb(-0.45)}`;
}

/** The rack's six units, top to bottom: its name, whether its LED burns and its switch is up. */
const RACK_UNITS = [
  { name: 'NETZ', lit: true, on: true },
  { name: 'DNS', lit: true, on: true },
  { name: 'DB', lit: true, on: true },
  { name: 'AUTH', lit: false, on: false },
  { name: 'WEB', lit: false, on: false },
  { name: 'MAIL', lit: true, on: true },
] as const;

/**
 * The Serverraum: on the left its six services as boxes, an arrow from every
 * dependency to the service that needs it, NETZ first; on the right a small
 * rack of six units, each with its name, an LED and a power switch.
 */
function Servers() {
  return (
    <>
      {SERVICE_BOXES.map(({ name, x, y }) => (
        <g key={name}>
          <rect x={x} y={y} width={40} height={22} rx={3} strokeWidth={1.4} />
          <Mark x={x + 20} y={y + 14.5} size={9}>
            {name}
          </Mark>
        </g>
      ))}
      <path d={NEEDS.map(([x1, y1, x2, y2]) => arrowPath(x1, y1, x2, y2)).join('')} />
      <rect x={268} y={6} width={102} height={128} rx={5} strokeWidth={1.6} />
      <rect x={274} y={12} width={6} height={116} rx={1} />
      <rect x={358} y={12} width={6} height={116} rx={1} />
      {RACK_UNITS.map(({ name, lit, on }, k) => {
        const y = 15 + k * 19;
        return (
          <g key={name}>
            <rect x={284} y={y} width={70} height={16} rx={1.5} />
            <Mark x={288} y={y + 11} size={7} anchor="start">
              {name}
            </Mark>
            <circle cx={326} cy={y + 8} r={2.4} {...(lit ? GLOW : {})} />
            <rect x={335} y={y + 3} width={13} height={10} rx={2} />
            <path d={`M341.5 ${y + 8}V${on ? y + 2 : y + 14}`} strokeWidth={2} />
          </g>
        );
      })}
    </>
  );
}

/** A device without a drawing: an empty frame naming its type, so its pages still print. */
function Frame({ of }: { of: string }) {
  return (
    <>
      <rect x={6} y={6} width={364} height={128} rx={4} strokeDasharray="5 4" />
      <Mark x={188} y={75} size={14}>
        {of}
      </Mark>
    </>
  );
}

interface Drawing {
  /** what the drawing shows, in words */
  label: string;
  draw: () => ReactNode;
}

/**
 * Every module the core knows has its drawing, and so have the Signalkette's
 * key of patterns and the main switch a sync station may be built as.
 */
const DRAWINGS: Record<
  PuzzleDef['type'] | typeof PATTERN_FIGURE | typeof LEVER_FIGURE,
  Drawing
> = {
  wiring: {
    label: 'Sicherungskasten: 4 Kabel übereinander, oben eine Kontrolllampe, ein Kabel durchtrennt',
    draw: Wiring,
  },
  keypad: {
    label: 'Tastenfeld: 4 quadratische Tasten mit je einem Zeichen, eine Taste leuchtet',
    draw: Keypad,
  },
  switches: {
    label:
      'Schalterbank: 6 Hebel nebeneinander, über jedem eine LED und eine Markierung, ' +
      'ein Schalter mit Stern',
    draw: Switches,
  },
  simon: {
    label: 'Farbtasten: 4 Tasten im Quadrat, eine leuchtet, daneben der Alarmzähler',
    draw: Simon,
  },
  button: {
    label: 'Großer runder Knopf mit Aufschrift, daneben ein senkrechter Farbstreifen',
    draw: Button,
  },
  memory: {
    label:
      'Speicherfeld: Display mit einer Ziffer über 4 beschrifteten Tasten, ' +
      'daneben 5 Stufenlampen',
    draw: Memory,
  },
  morse: {
    label: 'Funkgerät: Signallampe, Taste SENDEN und Frequenzregler mit Skala',
    draw: Morse,
  },
  maze: {
    label:
      'Navigationspult: Raster aus 6 × 6 Feldern ohne Wände, ' +
      'Kreis als Markierung, Dreieck als Ziel',
    draw: Maze,
  },
  'button-sync': {
    label: 'Großer Knopf unter 2 Lampen, eine je Druck',
    draw: ButtonSync,
  },
  [LEVER_FIGURE]: {
    label: 'Hauptschalter: ein Schild über 2 Hebeln nebeneinander, über jedem Hebel eine Lampe',
    draw: LeverSwitch,
  },
  relay: {
    label:
      'Schaltpult: 2 Schalter, ein Drehregler und ein Taster, beschriftet, ' +
      'unter einer Lampenleiste',
    draw: Relay,
  },
  signal: {
    label:
      'Zwei Pulte nebeneinander: links eine Reihe aus 4 Formen, rechts ein Raster aus 3 × 4 ' +
      'Formen, dazwischen ein Pfeil',
    draw: Signal,
  },
  [PATTERN_FIGURE]: {
    label:
      'Vier runde Zeichen nebeneinander, jedes im Muster seiner Farbe: rot glatt, ' +
      'blau mit Punkten, grün mit Streifen, gelb mit Ring',
    draw: SignalPatterns,
  },
  circuit: {
    label:
      'Sicherungskasten und Prüfpult: links 5 Kabel übereinander, eines durchtrennt, ' +
      'rechts ein Zeigerinstrument über 5 Zifferntasten',
    draw: Circuit,
  },
  servers: {
    label:
      'Dienste und Rack: 6 Kästen NETZ, DNS, DB, AUTH, MAIL und WEB, ein Pfeil von jeder ' +
      'Abhängigkeit zum Dienst, der sie braucht; rechts ein Rack mit 6 Einschüben, je ' +
      'Name, LED und Schalter',
    draw: Servers,
  },
};

function isDrawn(of: string): of is keyof typeof DRAWINGS {
  return Object.hasOwn(DRAWINGS, of);
}

/** The drawing of the device of type `of`; one the book has no drawing for gets a frame. */
export function Figure({ of }: { of: string }) {
  const drawing = isDrawn(of) ? DRAWINGS[of] : null;
  return (
    <svg
      className="figure"
      viewBox={`0 0 ${FIGURE_VIEW.width} ${FIGURE_VIEW.height}`}
      role="img"
      aria-label={drawing?.label ?? `Gerät „${of}“, ohne Zeichnung`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawing === null ? <Frame of={of} /> : drawing.draw()}
    </svg>
  );
}
