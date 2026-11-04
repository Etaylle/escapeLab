import type { PointerEvent, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleView } from '@escapelab/core';
import { keysClaimed } from '../src/hooks.js';
import { DEFAULT_KEYS, DEFAULT_PAD } from '../src/input/bindings.js';
import { noteDevice } from '../src/input/device.js';
import { holdKeys, printable, strayKey, type PromptKey } from '../src/puzzles/prompt.js';
import {
  completed,
  enter,
  promptKeyDown,
  Reply,
  ServersPanel,
} from '../src/puzzles/ServersPanel.js';
import { controlsOf } from '../src/screens/InfoPanel.js';
import type { VoiceMesh, VoiceState } from '../src/voice/mesh.js';
import { talkKeyBusy, talksOnDown, VoiceContext } from '../src/voice/useVoice.js';
import type { Refusal } from '../src/ws.js';
import { NO_CLOCK } from './fixtures.js';
import { elementsOf, type Rendered } from './probe.js';

const noop = (): void => undefined;

/** The Serverraum's terminal as its operator sees it: two services, one down. */
const terminalView = {
  kind: 'servers',
  role: 'terminal',
  rows: [
    { service: 'netz', running: true, code: null, power: true },
    { service: 'dns', running: false, code: 'E23', power: true },
  ],
  log: [],
  rack: null,
  index: 3,
  total: 6,
  title: 'Serverraum',
  manual: null,
  console: 'a',
  backup: null,
} as unknown as Extract<PuzzleView, { kind: 'servers' }>;

/** A thing on the fake page that can hold the focus: the body, the prompt, the notepad's text. */
interface Spot {
  tagName: string;
}

/** The page round an open terminal, as far as its prompt reaches it. */
interface FakePage {
  focus: Spot;
  /** the dialogs open over the world, the last on top */
  dialogs: object[];
  /** the window's keydown listeners that capture */
  listeners: ((e: KeyboardEvent) => void)[];
  /** the pointer is a finger */
  coarse: boolean;
  /** the terminal's device is inert: stepped back from, or solved */
  inert: boolean;
}

const body: Spot = { tagName: 'BODY' };
const notepadText: Spot = { tagName: 'TEXTAREA' };

let page: FakePage;

/** The prompt's field on the fake page: it takes the focus when asked, and counts the times. */
const field = {
  tagName: 'INPUT',
  focused: 0,
  focus(): void {
    this.focused += 1;
    page.focus = field;
  },
  closest(selector: string): object | null {
    return selector === '[inert]' && page.inert ? {} : null;
  },
};

/** A dialog over the world: the terminal's frame, holding the prompt, or another one. */
function dialog(holds: boolean, name = 'station-modal'): object {
  return {
    closest: () => null,
    getClientRects: () => [{}],
    classList: { contains: (className: string) => className === name },
    contains: (el: unknown) => holds && el === field,
  };
}

function stubPage(): void {
  page = { focus: body, dialogs: [dialog(true)], listeners: [], coarse: false, inert: false };
  field.focused = 0;
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (e: KeyboardEvent) => void, capture?: boolean) => {
      if (type === 'keydown' && capture === true) {
        page.listeners.push(listener);
      }
    },
    removeEventListener: (type: string, listener: (e: KeyboardEvent) => void) => {
      page.listeners = page.listeners.filter((each) => each !== listener);
    },
    matchMedia: () => ({ matches: page.coarse }),
  });
  vi.stubGlobal('document', {
    get activeElement() {
      return page.focus;
    },
    documentElement: { dataset: {} },
    querySelectorAll: (selector: string) =>
      selector === '[aria-modal="true"]' ? page.dialogs : [],
    querySelector: () => null,
  });
}

beforeEach(() => {
  stubPage();
  noteDevice('keys');
});

afterEach(() => {
  noteDevice('keys');
  vi.unstubAllGlobals();
});

/** A key going down on the fake page, as the window's capturing listeners hear it. */
function keyDown(key: string, parts: Partial<PromptKey> = {}) {
  const e = {
    key,
    isTrusted: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    prevented: false,
    stopped: false,
    preventDefault(): void {
      this.prevented = true;
    },
    stopImmediatePropagation(): void {
      this.stopped = true;
    },
    ...parts,
  };
  for (const listener of [...page.listeners]) {
    listener(e as unknown as KeyboardEvent);
  }
  return e;
}

/** The terminal's elements, as `ServersPanel` renders them at console a. */
function terminal(refused: Refusal | null = null, wrap?: (probe: ReactNode) => ReactNode) {
  return elementsOf(
    () => (
      <ServersPanel
        puzzle={terminalView}
        change={null}
        send={noop}
        mission={NO_CLOCK}
        refused={refused}
      />
    ),
    wrap,
  );
}

/** The prompt's field among `elements`, its ref called with the fake one: what lets go. */
function attach(elements: Rendered[]): () => void {
  const input = elements.find((element) => element.type === 'input');
  const ref = input?.props['ref'] as ((el: unknown) => (() => void) | undefined) | undefined;
  const release = ref?.(field);
  if (release === undefined) {
    throw new Error('the prompt’s field holds nothing as it comes up');
  }
  return release;
}

describe('the terminal’s prompt and the focus', () => {
  it('takes the focus as the terminal opens, where keys and a mouse steer', () => {
    const release = attach(terminal());
    expect(field.focused).toBe(1);
    expect(page.focus).toBe(field);
    release();
  });

  it('leaves the focus under a finger, which the screen’s keyboard covers, or on a pad', () => {
    page.coarse = true;
    attach(terminal())();
    expect(field.focused).toBe(0);
    page.coarse = false;
    noteDevice('pad');
    attach(terminal())();
    expect(field.focused).toBe(0);
  });

  it('keeps the focus after a command, sent by Enter or the bezel’s ⏎, and an unread line', () => {
    const sent: unknown[] = [];
    expect(enter('start dns', (input) => sent.push(input), field)).toEqual({
      kind: 'sent',
      input: { cmd: 'start', service: 'dns' },
    });
    expect(sent).toEqual([{ cmd: 'start', service: 'dns' }]);
    expect(field.focused).toBe(1);
    expect(enter('start kaffee', (input) => sent.push(input), field)).toEqual({ kind: 'unread' });
    expect(enter('   ', (input) => sent.push(input), field)).toEqual({ kind: 'empty' });
    expect(sent).toHaveLength(1);
    expect(field.focused).toBe(3);
  });

  it('takes the focus back when its form is sent, as the panel wires it', () => {
    const elements = terminal();
    const release = attach(elements);
    page.focus = body;
    const form = elements.find((element) => element.type === 'form');
    (form?.props['onSubmit'] as (e: { preventDefault: () => void }) => void)({
      preventDefault: noop,
    });
    expect(field.focused).toBe(2);
    expect(page.focus).toBe(field);
    release();
  });
});

describe('a key typed elsewhere while the terminal is up', () => {
  it('goes to the prompt, which takes the focus with it, and nowhere else', () => {
    const typed: string[] = [];
    const release = holdKeys(field as unknown as HTMLElement, (text) => typed.push(text));
    page.focus = body;
    const d = keyDown('d');
    expect(page.focus).toBe(field);
    // The prompt has the focus now: the next key types there by itself.
    expect(keyDown('n').stopped).toBe(false);
    page.focus = body;
    const blank = keyDown(' ');
    expect(typed).toEqual(['d', ' ']);
    const held = [d.prevented, d.stopped, blank.prevented, blank.stopped];
    expect(held).toEqual([true, true, true, true]);
    release();
    expect(page.listeners).toHaveLength(0);
  });

  it('is wired in by the panel’s field itself: up with it, gone with it', () => {
    const release = attach(terminal());
    expect(page.listeners).toHaveLength(1);
    page.focus = body;
    expect(keyDown('s').stopped).toBe(true);
    release();
    expect(page.listeners).toHaveLength(0);
    expect(keysClaimed()).toBe(false);
  });

  it('stays where it is typed: in the notepad, from a controller, with Strg, Esc and Tab', () => {
    const typed: string[] = [];
    const release = holdKeys(field as unknown as HTMLElement, (text) => typed.push(text));
    page.focus = notepadText;
    expect(keyDown('n').stopped).toBe(false);
    page.focus = body;
    // A controller's X sends N on — untrusted — for the notepad: it is no letter typed.
    const pad = keyDown('n', { isTrusted: false });
    const copy = keyDown('c', { ctrlKey: true });
    const esc = keyDown('Escape');
    const tab = keyDown('Tab');
    expect([pad, copy, esc, tab].map((e) => e.prevented || e.stopped)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(typed).toEqual([]);
    release();
  });

  it('stays away while a dialog lies over the terminal, or once it is stepped back from', () => {
    const typed: string[] = [];
    const release = holdKeys(field as unknown as HTMLElement, (text) => typed.push(text));
    page.focus = body;
    page.dialogs = [dialog(true), dialog(false, 'settings')];
    expect(keyDown('a').stopped).toBe(false);
    page.dialogs = [dialog(true)];
    page.inert = true;
    expect(keyDown('a').stopped).toBe(false);
    expect(typed).toEqual([]);
    release();
  });

  it('reads only single characters from the keyboard as typed', () => {
    const key = (k: string, parts: Partial<PromptKey> = {}): PromptKey => ({
      key: k,
      isTrusted: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      ...parts,
    });
    expect(printable(key('ä'))).toBe(true);
    expect(printable(key('Backspace'))).toBe(false);
    expect(printable(key('a', { metaKey: true }))).toBe(false);
    expect(printable(key('a', { isComposing: true }))).toBe(false);
    expect(strayKey(key('a'), false, false)).toBe(true);
    expect(strayKey(key('a'), true, false)).toBe(false);
    expect(strayKey(key('a'), false, true)).toBe(false);
  });
});

describe('the talk key at the terminal', () => {
  const v = { key: 'v', altKey: false, ctrlKey: false, metaKey: false, repeat: false };

  it('types like any letter: the prompt holds the keys, and V talks from none of them', () => {
    expect(talksOnDown(v, 'v', talkKeyBusy())).toBe(true);
    const typed: string[] = [];
    const release = holdKeys(field as unknown as HTMLElement, (text) => typed.push(text));
    page.focus = body;
    expect(talkKeyBusy()).toBe(true);
    expect(talksOnDown(v, 'v', talkKeyBusy())).toBe(false);
    keyDown('v');
    expect(typed).toEqual(['v']);
    release();
    page.focus = body;
    expect(talksOnDown(v, 'v', talkKeyBusy())).toBe(true);
  });

  it('leaves talking to the bezel’s FUNK key, held by mouse or finger while the mic is on', () => {
    const held: boolean[] = [];
    const state: VoiceState = {
      mic: 'on',
      open: false,
      held: false,
      listening: false,
      speaking: new Set(),
      intercom: new Set(),
    };
    const mesh = {
      subscribe: () => noop,
      getState: () => state,
      setHeld: (down: boolean) => held.push(down),
    } as unknown as VoiceMesh;
    const within = (probe: ReactNode) => <VoiceContext value={mesh}>{probe}</VoiceContext>;
    const funk = terminal(null, within).find(
      (element) => element.type === 'button' && element.props['className'] === 'servers-talk',
    );
    expect(funk?.props['children']).toBe('FUNK');
    const press = funk?.props['onPointerDown'] as (e: Partial<PointerEvent>) => void;
    press({
      preventDefault: noop,
      pointerId: 1,
      currentTarget: { setPointerCapture: noop } as unknown as PointerEvent['currentTarget'],
    });
    (funk?.props['onPointerUp'] as () => void)();
    expect(held).toEqual([true, false]);
    const off = { ...state, mic: 'off' as const };
    const quiet = { ...mesh, getState: () => off } as unknown as VoiceMesh;
    const html = renderToStaticMarkup(
      <VoiceContext value={quiet}>
        <ServersPanel puzzle={terminalView} change={null} send={noop} mission={NO_CLOCK} />
      </VoiceContext>,
    );
    expect(html).not.toContain('servers-talk');
  });

  it('is said so in the Einsatzinfo’s controls: at the terminal the mouse or the pad talks', () => {
    const keyboard = {
      keys: DEFAULT_KEYS,
      pad: DEFAULT_PAD,
      device: 'keys',
      family: 'xbox',
    } as const;
    const rows = new Map(controlsOf(keyboard));
    expect(rows.get('V halten')).toContain('Am Terminal: Funk per Maus/Pad');
    const pad = new Map(controlsOf({ ...keyboard, device: 'pad', family: 'playstation' }));
    expect(pad.get('L1 halten')).toContain('Am Terminal: Funk per Maus/Pad');
  });
});

describe('Tab at the prompt', () => {
  it('completes a command, then a service, as far as the words agree', () => {
    expect(completed('')).toBe('');
    expect(completed('s')).toBe('sta');
    expect(completed('sta')).toBe('sta');
    expect(completed('star')).toBe('start ');
    expect(completed('STAT')).toBe('status');
    expect(completed('r')).toBe('restart ');
    expect(completed('start ')).toBe('start ');
    expect(completed('start d')).toBe('start d');
    expect(completed('start dn')).toBe('start dns');
    expect(completed('restart  a')).toBe('restart  auth');
    expect(completed('start m')).toBe('start mail');
  });

  it('leaves a line it cannot complete as it was', () => {
    expect(completed('x')).toBe('x');
    expect(completed('status n')).toBe('status n');
    expect(completed('start dns ')).toBe('start dns ');
    expect(completed('start kaffee')).toBe('start kaffee');
  });

  it('keeps the focus at the prompt and completes the line; Shift+Tab goes back as ever', () => {
    const updates: ((line: string) => string)[] = [];
    let prevented = 0;
    const key = (k: string, shiftKey = false) => ({
      key: k,
      shiftKey,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {
        prevented += 1;
      },
    });
    promptKeyDown(key('Tab'), (update) => updates.push(update));
    expect(prevented).toBe(1);
    expect(updates.map((update) => update('star'))).toEqual(['start ']);
    promptKeyDown(key('Tab', true), (update) => updates.push(update));
    expect(prevented).toBe(1);
    expect(updates).toHaveLength(1);
  });
});

describe('Esc at the prompt', () => {
  it('is nobody’s here: it reaches the window, where it steps back from the device', () => {
    let prevented = false;
    promptKeyDown(
      {
        key: 'Escape',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {
          prevented = true;
        },
      },
      () => {
        throw new Error('Esc changed the line');
      },
    );
    expect(prevented).toBe(false);
    const release = holdKeys(field as unknown as HTMLElement, noop);
    page.focus = field;
    const esc = keyDown('Escape');
    expect([esc.prevented, esc.stopped]).toEqual([false, false]);
    release();
  });
});

describe('the terminal’s answers at the prompt', () => {
  it('says a line it cannot read under it', () => {
    expect(renderToStaticMarkup(<Reply unread refused={null} />)).toBe(
      '<p class="servers-reply" role="status">? Befehl unbekannt</p>',
    );
  });

  it('says a command the server refused there too, not only in the device’s head', () => {
    const refused = { seq: 4, message: 'Am Rack steht niemand.', of: 'puzzle-input' } as const;
    const html = renderToStaticMarkup(
      <ServersPanel
        puzzle={terminalView}
        change={null}
        send={noop}
        mission={NO_CLOCK}
        refused={refused}
      />,
    );
    const reply =
      '<p class="servers-reply servers-reply--refused" aria-hidden="true">' +
      '! Am Rack steht niemand.</p>';
    expect(html).toContain(reply);
    expect(html.indexOf(reply)).toBeGreaterThan(html.indexOf('class="servers-prompt"'));
    expect(html.indexOf(reply)).toBeLessThan(html.indexOf('class="servers-bezel"'));
  });
});
