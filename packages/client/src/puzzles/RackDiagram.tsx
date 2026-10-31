import {
  DEPENDS_ON,
  SERVICES,
  serviceDiagram,
  serviceName,
  type Diagram,
  type RackUnit,
  type ServerLed,
  type Service,
} from '@escapelab/core';
import './rack.css';

/**
 * The Serverraum's Netzplan as a cabling diagram — derived from the plan's dependencies
 * (core servers.ts `serviceDiagram`): NETZ → DNS, DB → AUTH → WEB, MAIL, a box for every
 * service with its power LED, an arrow from every dependency to the service that needs it.
 * Rules, never answers: the rack (console B) lights the boxes' LEDs as its units light theirs,
 * nothing more; the printed page draws the same diagram, its LEDs dark (screens/Figure.tsx).
 */

/** A service's box, in the diagram's units. */
export const BOX = { w: 44, h: 22 } as const;

/** A box where it is drawn, and an arrow from the right edge of one to the left of another. */
export interface Laid<T extends string> {
  boxes: { node: T; x: number; y: number }[];
  arrows: { from: T; to: T; x1: number; y1: number; x2: number; y2: number }[];
  width: number;
  height: number;
}

/**
 * `diagram` laid out `height` high: its columns `step` apart from x 0, each column's boxes
 * spread evenly over the height in the diagram's order.
 */
export function laidOut<T extends string>(
  diagram: Diagram<T>,
  step = 68,
  height = 140,
): Laid<T> {
  const at = new Map<T, { x: number; y: number }>();
  diagram.columns.forEach((column, c) => {
    column.forEach((node, r) => {
      at.set(node, { x: c * step, y: ((r + 0.5) * height) / column.length - BOX.h / 2 });
    });
  });
  const boxes = [...at].map(([node, { x, y }]) => ({ node, x, y }));
  const arrows = diagram.arrows.flatMap(([from, to]) => {
    const a = at.get(from);
    const b = at.get(to);
    if (a === undefined || b === undefined) {
      return [];
    }
    return [{ from, to, x1: a.x + BOX.w, y1: a.y + BOX.h / 2, x2: b.x, y2: b.y + BOX.h / 2 }];
  });
  return { boxes, arrows, width: (diagram.columns.length - 1) * step + BOX.w, height };
}

/** A straight arrow from (x1, y1) to (x2, y2), its head an open V at the end, as one path. */
export function arrowPath(x1: number, y1: number, x2: number, y2: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const round = (n: number): number => Math.round(n * 10) / 10;
  const point = (x: number, y: number): string => `${round(x)} ${round(y)}`;
  const barb = (turn: number): string => {
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    return point(x2 - 6 * (ux * c - uy * s), y2 - 6 * (uy * c + ux * s));
  };
  const tip = point(x2, y2);
  return `M${point(x1, y1)}L${tip}M${barb(0.45)}L${tip}L${barb(-0.45)}`;
}

/** The diagram laid out for the Serverraum, its LEDs where the rack's light them. */
const SERVICES_LAID = laidOut(serviceDiagram());

/**
 * The services' boxes and the arrows between them, as SVG in the diagram's units: each box
 * named, its LED left of the name — lit as `leds` says, dark where it says nothing.
 */
export function ServicesGraph({ leds }: { leds: Readonly<Partial<Record<Service, ServerLed>>> }) {
  const { boxes, arrows } = SERVICES_LAID;
  const cables = arrows.map((a) => arrowPath(a.x1, a.y1, a.x2, a.y2)).join('');
  return (
    <g className="services-graph">
      <path className="services-arrows" d={cables} />
      {boxes.map(({ node, x, y }) => {
        const led = leds[node] ?? null;
        return (
          <g key={node} className="services-box" data-service={node}>
            <rect x={x} y={y} width={BOX.w} height={BOX.h} rx={3} strokeWidth={1.4} />
            <circle
              className={led === null ? 'services-led' : `services-led services-led--${led}`}
              cx={x + 7}
              cy={y + BOX.h / 2}
              r={2.6}
            />
            <text
              x={x + 26}
              y={y + 14.5}
              fontSize={8.5}
              textAnchor="middle"
              stroke="none"
              fill="currentColor"
            >
              {serviceName(node)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** The diagram in words, for a screen reader: what each service needs. */
const SAID = SERVICES.map((service) => {
  const deps = DEPENDS_ON[service].map(serviceName);
  const needs = deps.length === 0 ? 'nichts' : deps.join(', ');
  return `${serviceName(service)} braucht ${needs}`;
}).join('; ');

/**
 * The rack's cabling diagram (console B): the Netzplan with every service's LED as the rack's
 * unit shows it — the rules beside the switches, the codes still at the terminal alone.
 */
export function RackDiagram({ rack }: { rack: readonly RackUnit[] }) {
  const leds = Object.fromEntries(rack.map((unit) => [unit.service, unit.led]));
  const { width, height } = SERVICES_LAID;
  return (
    <figure className="rack-diagram">
      <figcaption className="rack-diagram-caption">Netzplan · Verkabelung</figcaption>
      <svg
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
        role="img"
        aria-label={`Netzplan: ${SAID}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ServicesGraph leds={leds} />
      </svg>
    </figure>
  );
}
