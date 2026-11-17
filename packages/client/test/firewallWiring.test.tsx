import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import {
  generateEdgework,
  moduleFor,
  puzzleDefSchema,
  type PuzzleInputOf,
  type PuzzleState,
  type PuzzleView,
} from '@escapelab/core';
import { lcg } from './fixtures.js';

/**
 * The Paketfilter's controls wired to what they send, without a DOM: the panel's components are
 * called as functions with React's hooks stood in for by a store kept from one render to the
 * next (`render`), and the buttons and keys of the tree they return pressed by hand.
 */

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  at: 0,
  keys: [] as { keys: readonly string[]; onKey: (key: string) => void }[],
}));

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const slot = <T,>(make: () => T): [T, number] => {
    const i = hooks.at++;
    if (!(i in hooks.slots)) {
      hooks.slots[i] = make();
    }
    return [hooks.slots[i] as T, i];
  };
  return {
    ...real,
    useState: <T,>(init: T | (() => T)) => {
      const [value, i] = slot(() => (typeof init === 'function' ? (init as () => T)() : init));
      const set = (next: T | ((was: T) => T)): void => {
        const was = hooks.slots[i] as T;
        hooks.slots[i] = typeof next === 'function' ? (next as (was: T) => T)(was) : next;
      };
      return [value, set];
    },
    useRef: <T,>(value: T) => slot(() => ({ current: value }))[0],
    useEffect: () => undefined,
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
    useContext: (context: { _currentValue: unknown }) => context._currentValue,
  };
});

vi.mock('../src/hooks.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useKeys: (keys: readonly string[], onKey: (key: string) => void) => {
    hooks.keys.push({ keys, onKey });
  },
}));

vi.mock('../src/puzzles/sounds.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn() : value,
    ]),
  );
});

const { FirewallPanel } = await import('../src/puzzles/FirewallPanel.js');
const sounds = await import('../src/puzzles/sounds.js');

type Firewall = Extract<PuzzleView, { kind: 'firewall' }>;
type Input = PuzzleInputOf<'firewall'>;

const T0 = 1_700_000_000_000;
const MID = 12_000;
const DEF = puzzleDefSchema.parse({ type: 'firewall', id: 'pf', title: 'Paketfilter' });

/** The Paketfilter `MID` into its first wave as console `seat` shows it, the Freigabe pressed. */
function seen(seat: 'a' | 'b', waiting = false): Firewall {
  const station = moduleFor(DEF.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const ctx = (at: number) => ({
    edgework,
    alarms: 0,
    remainingSec: 600,
    at,
    crew: ['p1', 'p2'],
    console: 'a' as const,
    atConsoles: { a: ['p1'], b: ['p2'] },
    readers: [],
  });
  const fresh: PuzzleState = station.init(DEF, rng, { ...ctx(T0), atConsoles: { a: [], b: [] } });
  const manned = station.elapse?.(DEF, fresh, ctx(T0)).state ?? fresh;
  const go = (): PuzzleState => station.apply(DEF, manned, { start: true }, 'p1', ctx(T0)).state;
  const started = waiting ? manned : go();
  const state = station.elapse?.(DEF, started, ctx(T0 + MID)).state ?? started;
  const viewer = { playerId: 'p1', operating: true, reading: false, console: seat };
  const shown = station.view(DEF, state, viewer, { edgework, alarms: 0, crew: [], operators: [] });
  const common = { index: 0, total: 1, title: 'Paketfilter', manual: null, console: seat };
  return { ...shown, ...common, plate: null, atOtherConsole: null } as Firewall;
}

/** The panel's components this test calls through; the rest of the tree stays as elements. */
const EXPANDED = new Set([
  'Sperrpult',
  'Analysepult',
  'Scope',
  'GateLine',
  'GateKeys',
  'CardLine',
  'LineContents',
  'Falling',
  'Card',
]);

/** `node` with every component of EXPANDED called through, down to the elements it returns. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) {
    return node.map(expand);
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    return node;
  }
  const element = node as ReactElement<Record<string, unknown>>;
  const { type } = element;
  if (typeof type === 'function' && EXPANDED.has(type.name)) {
    return expand((type as (props: unknown) => ReactNode)(element.props));
  }
  const children = expand(element.props['children'] as ReactNode);
  const lane = element.props['lane'];
  const lanes = typeof lane === 'function' ? [0, 1, 2, 3, 4].map((l) => expand(lane(l))) : [];
  return { ...element, props: { ...element.props, children, lanes } };
}

/** Every element in `tree` that `match` takes. */
function findAll(tree: ReactNode, match: (props: Record<string, unknown>) => boolean) {
  const found: Record<string, unknown>[] = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object' || !('props' in node)) {
      return;
    }
    const props = (node as ReactElement<Record<string, unknown>>).props;
    if (match(props)) {
      found.push(props);
    }
    walk(props['children'] as ReactNode);
    walk(props['lanes'] as ReactNode);
  };
  walk(tree);
  return found;
}

/** A button of `tree` by its class, pressed. */
function press(tree: ReactNode, className: string): void {
  const classed = (p: Record<string, unknown>) =>
    String(p['className'] ?? '').split(' ').includes(className);
  const [button] = findAll(tree, classed);
  (button?.['onClick'] as (() => void) | undefined)?.();
  if (button === undefined) {
    throw new Error(`no .${className} in the tree`);
  }
}

/** The panel rendered — again, after a press, from the hooks' store — with `send` noting inputs. */
function render(puzzle: Firewall, sent: Input[]): ReactNode {
  hooks.at = 0;
  hooks.keys = [];
  const send = (input: Input): void => {
    sent.push(input);
  };
  return expand(FirewallPanel({ puzzle, send } as never));
}

/** The panel's keys, pressed: `key` as useKeys hands it on. */
function key(name: string): void {
  const listener = hooks.keys.find(({ keys }) => keys.includes(name));
  if (listener === undefined) {
    throw new Error(`nothing listens for „${name}"`);
  }
  listener.onKey(name);
}

beforeEach(() => {
  hooks.slots = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0 + MID);
});

describe('the Sperrpult’s controls', () => {
  it('trips the line the gate stands on, stepped by the keys and by a tap on a line', () => {
    const sent: Input[] = [];
    let tree = render(seen('a'), sent);
    press(tree, 'firewall-trip');
    expect(sent).toEqual([{ trip: 2 }]);
    key('arrowright');
    expect(sounds.dialDetent).toHaveBeenCalledTimes(1);
    tree = render(seen('a'), sent);
    press(tree, 'firewall-trip');
    key('arrowleft');
    key('arrowleft');
    key('arrowleft');
    tree = render(seen('a'), sent);
    press(tree, 'firewall-trip');
    const [line4] = findAll(tree, (p) => p['data-line'] === 4);
    (line4?.['onClick'] as () => void)();
    tree = render(seen('a'), sent);
    press(tree, 'firewall-trip');
    expect(sent).toEqual([{ trip: 2 }, { trip: 3 }, { trip: 0 }, { trip: 4 }]);
  });

  it('trips on space and enter while the wave runs, gives the Freigabe while it waits', () => {
    const sent: Input[] = [];
    render(seen('a'), sent);
    key(' ');
    key('enter');
    render(seen('a', true), sent);
    key(' ');
    expect(sent).toEqual([{ trip: 2 }, { trip: 2 }, { start: true }]);
    const tree = render(seen('a', true), sent);
    press(tree, 'firewall-arm');
    expect(sent.at(-1)).toEqual({ start: true });
  });

  it('gives no Freigabe on space in the second after a fault, nor with the Analysepult empty', () => {
    const sent: Input[] = [];
    const fault = { n: 3, kind: 'fault' as const, at: T0 + MID - 500, line: null };
    render({ ...seen('a', true), event: fault }, sent);
    key(' ');
    render({ ...seen('a', true), vacant: ['b'] }, sent);
    key('enter');
    expect(sent).toEqual([]);
    render({ ...seen('a', true), event: { ...fault, at: T0 + MID - 1500 } }, sent);
    key(' ');
    expect(sent).toEqual([{ start: true }]);
  });
});

describe('the Analysepult’s controls', () => {
  it('marks the packet whose card is tapped', () => {
    const sent: Input[] = [];
    const tree = render(seen('b'), sent);
    const cards = findAll(tree, (p) => typeof p['data-packet'] === 'string' && 'onClick' in p);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      (card['onClick'] as () => void)();
    }
    expect(sent).toEqual(cards.map((card) => ({ mark: card['data-packet'] })));
  });

  it('steps a cursor over the cards, and marks the one under it on space or enter', () => {
    const sent: Input[] = [];
    render(seen('b'), sent);
    key(' ');
    expect(sent).toEqual([]);
    key('arrowright');
    const tree = render(seen('b'), sent);
    const cursor = (p: Record<string, unknown>) =>
      String(p['className'] ?? '').includes('firewall-card--cursor');
    const [under] = findAll(tree, cursor);
    expect(under).toBeDefined();
    key('enter');
    key(' ');
    expect(sent).toEqual([{ mark: under?.['data-packet'] }, { mark: under?.['data-packet'] }]);
  });
});
