import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleId, PuzzleView } from '@escapelab/core';
import { NO_CLOCK, stationView } from './fixtures.js';

/**
 * The Anlaufsteuerung's controls pressed one by one, without a DOM: React's state hooks are
 * stood in for — each `useState` hands out its first value, or the line set below for the
 * prompt's, and a setter that notes what it is given —, the panel's own components are called
 * as functions and every element with a handler is found in what they return. So each handler
 * is proved wired to the input it sends and to the state it sets.
 */

/** Every setter handed out, with the value its state started at. */
const setters: { init: unknown; set: ReturnType<typeof vi.fn> }[] = [];
/** The prompt's line as the next render starts it (its state starts at ''). */
let line = '';

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    useState: (init: unknown) => {
      const start = typeof init === 'function' ? (init as () => unknown)() : init;
      const set = vi.fn();
      setters.push({ init: start, set });
      return [start === '' ? line : start, set];
    },
    useRef: (init: unknown = null) => ({ current: init }),
    useCallback: (fn: unknown) => fn,
    useEffect: () => undefined,
  };
});

vi.mock('../src/puzzles/sounds.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn() : value,
    ]),
  );
});

const { NPM_REPLY, StartupPanel } = await import('../src/puzzles/StartupPanel.js');

type Startup = Extract<PuzzleView, { kind: 'startup' }>;

/** The panel's own components, called as functions; any other stays an element. */
const OWN = new Set([
  'Terminal',
  'Glass',
  'Script',
  'ScriptLine',
  'Log',
  'Keys',
  'Prompt',
  'Reply',
  'Board',
  'Breaker',
  'Lamp',
  'Ladder',
  'Status',
  'BoardConsole',
  'IdleTerminal',
  'IdleBoard',
]);

interface Node {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value && 'props' in value;

/** Every element of the tree under `value`, the panel's own components called. */
function elements(value: unknown): Node[] {
  if (Array.isArray(value)) {
    return value.flatMap(elements);
  }
  if (!isNode(value)) {
    return [];
  }
  const { type, props } = value;
  if (typeof type === 'function' && OWN.has(type.name)) {
    return elements((type as (p: unknown) => unknown)(props));
  }
  return [value, ...elements(props.children)];
}

const seen = (seat: ConsoleId): Startup =>
  stationView({ type: 'startup', id: 'as', title: 'AS' }, { seat }) as Startup;

/** The panel at `seat`, rendered as its handlers see it, and what it sends. */
function panel(seat: ConsoleId) {
  const send = vi.fn();
  const props = { puzzle: seen(seat), change: null, send, mission: NO_CLOCK };
  const tree = elements(StartupPanel(props));
  return { tree, send };
}

/** The setter of the prompt's line: the state that started at ''. */
const lineSetter = () => setters.find((entry) => entry.init === '')?.set ?? vi.fn();
/** The setter of the prompt's reply: the state that started at null, first of them. */
const replySetter = () => setters.find((entry) => entry.init === null)?.set ?? vi.fn();

/** The line a setter was last given, worked out from `from` where it was given a function. */
function lineSet(set: ReturnType<typeof vi.fn>, from: string): unknown {
  const given: unknown = set.mock.calls.at(-1)?.[0];
  return typeof given === 'function' ? (given as (now: string) => string)(from) : given;
}

const submit = (tree: Node[]) => {
  const form = tree.find((node) => node.type === 'form');
  (form?.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
};

beforeEach(() => {
  setters.length = 0;
  line = '';
});

describe('the Schaltfeld’s breakers', () => {
  it('send each its own feeder', () => {
    const { tree, send } = panel('b');
    const breakers = tree.filter((node) => node.props['data-breaker'] !== undefined);
    expect(breakers).toHaveLength(4);
    for (const breaker of breakers) {
      (breaker.props.onClick as () => void)();
    }
    const sent = send.mock.calls.map(([input]) => input);
    expect(sent).toEqual([1, 2, 3, 4].map((breaker) => ({ breaker })));
  });
});

describe('the terminal’s prompt and keys', () => {
  it('sends a line it reads and clears it', () => {
    line = 'setze abgang 2';
    const { tree, send } = panel('a');
    submit(tree);
    expect(send).toHaveBeenCalledWith({ cmd: 'setze', gap: 'abgang', value: 2 });
    expect(lineSet(lineSetter(), line)).toBe('');
  });

  it('sends nothing for an empty line', () => {
    line = '   ';
    const { tree, send } = panel('a');
    submit(tree);
    expect(send).not.toHaveBeenCalled();
    // Nothing to answer either: no „Befehl unbekannt" for a line with nothing in it.
    expect(replySetter()).not.toHaveBeenCalled();
  });

  it('answers npm itself, sending nothing to the server', () => {
    line = 'npm start';
    const { tree, send } = panel('a');
    submit(tree);
    expect(send).not.toHaveBeenCalled();
    expect(replySetter()).toHaveBeenCalledWith(NPM_REPLY);
  });

  it('completes a command with Tab', () => {
    const { tree } = panel('a');
    const input = tree.find((node) => node.type === 'input');
    const keyDown = input?.props.onKeyDown as (e: unknown) => void;
    const plain = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    keyDown({ key: 'Tab', ...plain, preventDefault: vi.fn() });
    expect(lineSet(lineSetter(), 'se')).toBe('setze ');
  });

  it('puts each key’s word into the line', () => {
    const { tree } = panel('a');
    const keys = tree.filter(
      (node) => node.type === 'button' && node.props['data-feel'] === 'blip',
    );
    const word = (node: Node): string => {
      (node.props.onClick as (() => void) | undefined)?.();
      return String(lineSet(lineSetter(), 'setze abgang '));
    };
    const by = (attr: string, value: string) => keys.find((node) => node.props[attr] === value);
    expect(word(by('data-cmd', 'start') ?? fail())).toBe('start');
    expect(word(by('data-cmd', 'setze') ?? fail())).toBe('setze abgang ');
    expect(word(by('data-feeder', '3') ?? fail())).toBe('setze abgang 3');
    expect(word(by('data-gap', 'abgang') ?? fail())).toBe('setze abgang ');
    expect(word(keys.find((node) => node.props['data-erase'] !== undefined) ?? fail())).toBe(
      'setze abgang',
    );
  });
});

function fail(): never {
  throw new Error('no such control');
}
