import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { moduleFor, puzzleDefSchema, type ConsoleId, type RelayView } from '@escapelab/core';
import { NotepadContext } from '../src/noting.js';
import { PANELS } from '../src/puzzles/index.js';
import { RelayAlert, StationModal, type Sabotage } from '../src/screens/Game.js';
import { elementsOf, lengthOf, Sheets, type Screen, type Styled } from './cascade.js';
import { deviceRun, mapWith, NO_CLOCK, stationView } from './fixtures.js';

/**
 * The devices' type and targets as the stylesheets set them, read the way the bundle orders
 * them (cascade.ts): every word on a device at its role's size at least — engraved in the
 * metal 11 px, a label or an LED's words 12, what is read off its face 14, a readout 18 —
 * and a little larger in a taller window; every control on Blackout's devices and on its
 * relay console a target, 36 px under a pointer and 44 under a finger. Read for a laptop's
 * 1280×720, a desktop's 1440×820 and a phone held sideways (844×390). Words drawn in an
 * SVG grow with their drawing, which only a browser measures: the audit's m5 does, with the
 * rest (docs/foundation-audit.md, „Stand nach N-readability").
 */

const sheets = new Sheets();

/** The screens the devices are read for, and the target a control takes on each. */
const SCREENS: { name: string; screen: Screen; target: number }[] = [
  { name: 'a laptop’s 1280×720', screen: { width: 1280, height: 720, coarse: false }, target: 36 },
  { name: 'a desktop’s 1440×820', screen: { width: 1440, height: 820, coarse: false }, target: 36 },
  { name: 'a phone held sideways', screen: { width: 844, height: 390, coarse: true }, target: 44 },
];
const [LAPTOP, DESKTOP, PHONE] = SCREENS.map(({ screen }) => screen) as [Screen, Screen, Screen];

const noop = (): void => undefined;

/** Blackout's stations as its mission writes them. */
const BLACKOUT = (
  JSON.parse(
    readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
  ) as { puzzles: Record<string, unknown>[] }
).puzzles;

/** The device of `puzzle` as the station modal shows it in a run, the notepad within reach. */
function station(def: Record<string, unknown>, seat: ConsoleId): Styled[] {
  return elementsOf(
    renderToStaticMarkup(
      <NotepadContext value={{ noteDown: noop, toggle: noop }}>
        <StationModal
          puzzle={stationView(def, { seat })}
          run={deviceRun()}
          map={mapWith({})}
          edgework={null}
          mission={NO_CLOCK}
          send={noop}
          onStepBack={noop}
        />
      </NotepadContext>,
    ),
  );
}

/** Every device of Blackout's at each of its consoles: `notstrom a`, `notstrom b`, …. */
const BLACKOUT_DEVICES = BLACKOUT.flatMap((def) => {
  const two = moduleFor(puzzleDefSchema.parse(def).type).consoles === 2;
  const seats: ConsoleId[] = two ? ['a', 'b'] : ['a'];
  return seats.map((seat) => ({ name: `${String(def['id'])} ${seat}`, nodes: station(def, seat) }));
});

/** The relay emergency's console over everything, a dial, a switch and a button on it. */
function relayConsole(): Styled[] {
  const relay: RelayView & { manual: [] } = {
    kind: 'relay',
    controls: [
      { id: 'k', name: 'Kryo-Puffer', kind: 'dial', value: 2 },
      { id: 'f', name: 'Faradaykäfig', kind: 'switch', value: false },
      { id: 'z', name: 'Zirkulator', kind: 'button', value: null },
    ],
    instruction: { playerName: 'Ben', control: 'Zirkulator', value: 'press', expiresAt: 12_000 },
    windowSec: 15,
    completed: 1,
    required: 6,
    endsAt: 40_000,
    manual: [],
  };
  const sabotage: Sabotage = {
    label: 'KÜHLKREISLAUF — RELAIS VON HAND',
    hint: 'Notfallverfahren: Jede Anweisung sofort laut durchgeben.',
    endsAt: 40_000,
    panels: [],
    relay,
  };
  return elementsOf(
    renderToStaticMarkup(
      <RelayAlert sabotage={sabotage} relay={relay} pausedAt={null} send={noop} refusal={null} />,
    ),
  );
}

const DEVICES = [...BLACKOUT_DEVICES, { name: 'relay console', nodes: relayConsole() }];

/** The words of `node` and of everything in it. */
function wordsIn(node: Styled, nodes: readonly Styled[]): string {
  const within = (other: Styled): boolean => {
    for (let at: Styled | null = other; at !== null; at = at.parent) {
      if (at === node) {
        return true;
      }
    }
    return false;
  };
  return nodes
    .filter(within)
    .map((other) => other.text)
    .join('')
    .trim();
}

/** The most px `node` declares for any of `properties` on `screen`; 0 where it declares none. */
function mostOf(node: Styled, properties: string[], screen: Screen): number {
  const lengths = properties.map((property) => sheets.length(node, property, screen));
  return Math.max(0, ...lengths.filter((n) => !Number.isNaN(n)));
}

const CONTROL_TAGS = new Set(['button', 'input', 'select', 'summary']);

/** The controls among `nodes` that `screen` shows. */
function controlsShown(nodes: readonly Styled[], screen: Screen): Styled[] {
  return nodes.filter((node) => CONTROL_TAGS.has(node.tag) && !sheets.hidden(node, screen));
}

/**
 * The controls `screen` shows that fall short of `target`: in height, or — one without a
 * word on it, only a sign or a digit, and not as wide as its row — in width.
 */
function shortOf(nodes: readonly Styled[], screen: Screen, target: number): string[] {
  return controlsShown(nodes, screen).flatMap((node) => {
    const high = mostOf(node, ['min-height', 'height', 'line-height'], screen);
    const wide = mostOf(node, ['min-width', 'width'], screen);
    const worded = wordsIn(node, nodes).length >= 4;
    const fullRow = sheets.declared(node, 'width', screen)?.value === '100%';
    const short = high < target || (!worded && !fullRow && wide < target);
    const size = `${Math.round(high)}×${Math.round(wide)}`;
    return short ? [`${node.tag}.${node.classes.join('.')} ${size}`] : [];
  });
}

/** Whether `node` lies in an SVG drawing, where its words grow with the drawing. */
function drawn(node: Styled): boolean {
  for (let at: Styled | null = node; at !== null; at = at.parent) {
    if (at.tag === 'svg') {
      return true;
    }
  }
  return false;
}

/** The elements with words of their own that `screen` shows, outside drawings. */
function wordsShown(nodes: readonly Styled[], screen: Screen): Styled[] {
  return nodes.filter((n) => n.text.trim() !== '' && !drawn(n) && !sheets.hidden(n, screen));
}

/** The roles words take on a device: the classes that carry each, on the words or round them. */
const ROLES = [
  {
    role: 'engraved in the metal',
    floor: 11,
    classes: [
      'device-engraving',
      'signal-legend',
      'servers-marks',
      'circuit-log-head',
      'rack-diagram-caption',
      'device-step-back',
    ],
  },
  {
    role: 'a label or an LED’s words',
    floor: 12,
    classes: [
      'device-plate-title',
      'device-plate-tag',
      'device-led-label',
      'device-led-detail',
      'lever-plate',
      'servers-key',
      'servers-plate',
      'note-down-word',
      'device-tab',
      'relay-name',
    ],
  },
  {
    role: 'read off its face',
    floor: 14,
    classes: [
      'station-coach',
      'circuit-number',
      'circuit-reading',
      'servers-line',
      'servers-needs',
      'servers-power',
      'relay-progress',
    ],
  },
  {
    role: 'read out',
    floor: 18,
    classes: ['circuit-unit', 'circuit-probe', 'morse-freq', 'relay-order-text', 'relay-count'],
  },
];

/** The elements among `nodes` whose words carry `name`, on themselves or on their parent. */
function carrying(nodes: readonly Styled[], name: string, screen: Screen): Styled[] {
  return wordsShown(nodes, screen).filter(
    (node) => node.classes.includes(name) || node.parent?.classes.includes(name) === true,
  );
}

describe('the type and the target on the root', () => {
  const root = elementsOf('<div></div>')[0]?.parent?.parent ?? null;
  const token = (name: string, screen: Screen): number =>
    lengthOf(root === null ? '' : (sheets.custom(root, name, screen) ?? ''), {
      screen,
      em: 16,
      custom: (n) => (root === null ? undefined : sheets.custom(root, n, screen)),
    });

  it('sets each role at its least in a laptop’s window, a little larger in a taller one', () => {
    const floors = [
      ['--type-engraving', 11],
      ['--type-label', 12],
      ['--type-body', 14],
      ['--type-readout', 18],
    ] as const;
    for (const [name, floor] of floors) {
      expect(token(name, LAPTOP), name).toBeGreaterThanOrEqual(floor);
      expect(token(name, PHONE), name).toBeGreaterThanOrEqual(floor);
      expect(token(name, DESKTOP), name).toBeGreaterThan(token(name, LAPTOP));
      const tall = { width: 2560, height: 1440, coarse: false };
      expect(token(name, tall), name).toBeLessThan(floor * 1.25);
    }
  });

  it('makes a target 36 px under a pointer and 44 under a finger', () => {
    expect(token('--target', LAPTOP)).toBe(36);
    expect(token('--target', DESKTOP)).toBe(36);
    expect(token('--target', PHONE)).toBe(44);
  });
});

describe.each(DEVICES)('$name', ({ nodes }) => {
  it.each(SCREENS)('makes every control a target on $name', ({ screen, target }) => {
    expect(controlsShown(nodes, screen).length).toBeGreaterThan(0);
    expect(shortOf(nodes, screen, target)).toEqual([]);
  });

  it.each(SCREENS)('sets every word 11 px at least on $name', ({ screen }) => {
    const small = wordsShown(nodes, screen)
      .filter((node) => !(sheets.fontSize(node, screen) >= 11))
      .map((node) => `${node.classes.join('.')} ${sheets.fontSize(node, screen)}`);
    expect(small).toEqual([]);
  });
});

describe('the roles words take on Blackout’s devices', () => {
  const all = DEVICES.flatMap(({ nodes }) => nodes);

  it.each(ROLES)('sets the words $role at $floor px at least, on every screen', (role) => {
    const { floor, classes } = role;
    for (const name of classes) {
      const shown = SCREENS.map(({ screen }) => ({ screen, words: carrying(all, name, screen) }));
      expect(shown.flatMap(({ words }) => words).length, name).toBeGreaterThan(0);
      for (const { screen, words } of shown) {
        for (const node of words) {
          expect(sheets.fontSize(node, screen), name).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });
});

describe('every other device', () => {
  const others = Object.keys(PANELS).filter((type) => type !== 'relay');

  it.each(others)('%s sets every word 11 px at least, under a pointer and a finger', (type) => {
    const nodes = station({ type, id: type, title: 'Station' }, 'a');
    for (const { screen } of SCREENS) {
      const small = wordsShown(nodes, screen).filter(
        (node) => !(sheets.fontSize(node, screen) >= 11),
      );
      expect(small.map((node) => node.classes.join('.'))).toEqual([]);
    }
  });
});
