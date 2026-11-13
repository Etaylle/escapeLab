import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAD } from '../src/input/bindings.js';
import { inputDevice, noteDevice } from '../src/input/device.js';
import { DIALOGS } from '../src/input/focus.js';
import { STANDARD_BUTTONS } from '../src/input/pad.js';
import {
  capturePadButton,
  onPadPing,
  onPadTalk,
  padSteer,
  startPad,
  type PadProbe,
} from '../src/input/padRuntime.js';
import { changeSettings, DEFAULT_SETTINGS, startRebinding } from '../src/settings.js';

/** A key event as the page sends it on: the fake keeps what it was. */
class FakeKeyboardEvent {
  readonly isTrusted = false;
  readonly key: string;
  constructor(
    readonly type: string,
    init: { key: string },
  ) {
    this.key = init.key;
  }
}

/** The page as far as the controller's layer reaches it: what it sends, its dialogs, its world. */
interface FakePage {
  sent: string[];
  dialogs: object[];
  world: boolean;
  frames: ((now: number) => void)[];
  now: number;
  /** what has the focus: nothing, a text field, a control */
  focus: object | null;
  /** the quick chat's wheel, while it is open over the world */
  wheel: object | null;
}

let page: FakePage;

/** Where a key sent on the page lands: noted, down (↓) or up (↑), the key after. */
function noted(e: FakeKeyboardEvent): boolean {
  page.sent.push(`${e.type === 'keydown' ? '↓' : '↑'}${e.key}`);
  return true;
}

function stubPage(): void {
  page = { sent: [], dialogs: [], world: true, frames: [], now: 0, focus: null, wheel: null };
  const body = { dispatchEvent: noted };
  vi.stubGlobal('document', {
    get activeElement() {
      return page.focus;
    },
    body,
    documentElement: { dataset: {}, style: { setProperty: () => undefined } },
    querySelectorAll: (selector: string) => (selector === DIALOGS ? page.dialogs : []),
    querySelector: (selector: string) => {
      if (selector === '.chat-wheel') {
        return page.wheel;
      }
      return selector === '.world-wrap' && page.world ? {} : null;
    },
  });
  const listen = { addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal('window', listen);
  vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  vi.stubGlobal('requestAnimationFrame', (frame: (now: number) => void) => page.frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

/** One animation frame: the controller polled once. */
function frame(): void {
  page.now += 16;
  page.frames.shift()?.(page.now);
}

/** The walkthrough's controller, as `?fakepad=1` puts it on the page. */
function probe(): PadProbe {
  const pad = (window as unknown as { __escapelab?: { pad?: PadProbe } }).__escapelab?.pad;
  if (pad === undefined) {
    throw new Error('no fake controller on the page — was ?fakepad=1 given?');
  }
  return pad;
}

/** `button` pressed and let go, a frame each: what the page was sent meanwhile. */
function click(button: Parameters<PadProbe['press']>[0]): string[] {
  page.sent = [];
  probe().press(button);
  frame();
  probe().release(button);
  frame();
  return page.sent;
}

let stop: () => void = () => undefined;
/** a wait of the keys' table, as a test opened it */
let endWait: () => void = () => undefined;
const onSettings = vi.fn();

beforeEach(() => {
  stubPage();
  onSettings.mockClear();
  stop = startPad({ onSettings }, '?fakepad=1');
});

afterEach(() => {
  stop();
  noteDevice('keys', 'xbox');
  endWait();
  changeSettings(DEFAULT_SETTINGS);
  vi.unstubAllGlobals();
});

describe('a controller in the world', () => {
  it('works with A — by Space, which skips the opening too — and puts down with B', () => {
    expect(click('a')).toEqual(['↓ ', '↑ ']);
    expect(click('b')).toEqual(['↓q', '↑q']);
    expect(click('x')).toEqual(['↓n', '↑n']);
    expect(click('y')).toEqual(['↓m', '↑m']);
    expect(click('select')).toEqual(['↓i', '↑i']);
  });

  it('turns the prompts to its buttons as it is used', () => {
    expect(inputDevice().device).toBe('keys');
    click('l3');
    expect(inputDevice()).toEqual({ device: 'pad', family: 'xbox' });
  });

  it('talks while L1 is held — straight to the voice, no key a prompt would type —, opens the settings with Start', () => {
    const talking: boolean[] = [];
    const off = onPadTalk((held) => talking.push(held));
    page.sent = [];
    probe().press('l1');
    frame();
    expect(talking).toEqual([true]);
    probe().release('l1');
    frame();
    expect(talking).toEqual([true, false]);
    // A prompt holding the keys would type the talk key: none is sent, and no text field loses it.
    expect(page.sent).toEqual([]);
    page.focus = {
      tagName: 'INPUT',
      blur: () => {
        page.focus = null;
      },
    };
    click('l1');
    expect(page.focus).not.toBeNull();
    expect(talking).toEqual([true, false, true, false]);
    off();
    click('start');
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('pings with the D-pad’s ◀ and opens the quick chat with its ▶, by the chat key', () => {
    const ping = vi.fn();
    const off = onPadPing(ping);
    expect(click('dleft')).toEqual([]);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(click('dright')).toEqual(['↓c', '↑c']);
    changeSettings({ keys: { ...DEFAULT_SETTINGS.keys, chat: 'k' } });
    expect(click('dright')).toEqual(['↓k', '↑k']);
    // ▲ and ▼ do nothing in the world; without a world that pings, ◀ neither.
    expect(click('dup')).toEqual([]);
    off();
    click('dleft');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('sends the keys the settings bind, and its main actions where the settings put them', () => {
    changeSettings({
      keys: { ...DEFAULT_SETTINGS.keys, drop: 'g', talk: 'b' },
      pad: { ...DEFAULT_PAD, notes: 'a', interact: 'x' },
    });
    expect(click('b')).toEqual(['↓g', '↑g']);
    expect(click('a')).toEqual(['↓n', '↑n']);
    expect(click('x')).toEqual(['↓ ', '↑ ']);
  });

  it('lets a text field in the focus go before a key: X closes the notepad it opened', () => {
    page.focus = {
      tagName: 'TEXTAREA',
      blur: () => {
        page.focus = null;
      },
    };
    expect(click('x')).toEqual(['↓n', '↑n']);
    expect(page.focus).toBeNull();
  });

  it('steers with the stick past its dead zone, R1 sprinting; the D-pad walks nobody', () => {
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
    probe().lean(0.6, 0);
    frame();
    expect(padSteer().x).toBeCloseTo(0.5, 9);
    probe().press('dleft');
    probe().press('r1');
    frame();
    expect(padSteer().x).toBeCloseTo(0.5, 9);
    expect(padSteer().sprint).toBe(true);
  });
});

describe('a controller over a dialog', () => {
  const dialog = {
    closest: () => null,
    getClientRects: () => [{}],
    classList: { contains: () => false },
  };

  it('steps back with B — Esc for every dialog — and keeps the notepad on X', () => {
    page.dialogs = [dialog];
    expect(click('b')).toEqual(['↓Escape', '↑Escape']);
    expect(click('x')).toEqual(['↓n', '↑n']);
    // The minimap is the world's.
    expect(click('y')).toEqual([]);
  });

  it('walks nobody while a dialog lies over the world: the stick is the dialog’s', () => {
    page.dialogs = [dialog];
    // Leant, but not enough for a flick between the dialog's controls.
    probe().lean(0.45, 0);
    frame();
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
    page.dialogs = [];
    expect(padSteer().x).toBeCloseTo(0.3125, 9);
  });

  it('holds a control made to be held for as long as A is: the button module’s face', () => {
    const face = { tagName: 'BUTTON', dataset: { pad: 'hold' }, dispatchEvent: noted };
    page.dialogs = [{ ...dialog, contains: (el: unknown) => el === face }];
    page.focus = face;
    page.sent = [];
    probe().press('a');
    frame();
    frame();
    expect(page.sent).toEqual(['↓ ']);
    probe().release('a');
    frame();
    expect(page.sent).toEqual(['↓ ', '↑ ']);
  });

  /** A book's dialog: the D-pad turns its pages. */
  const book = { ...dialog, classList: { contains: (name: string) => name === 'reading-modal' } };

  it('presses any other control with A, sending no Space the world behind would hear', () => {
    class FakeElement {}
    vi.stubGlobal('HTMLElement', FakeElement);
    const pressed: string[] = [];
    const control = Object.assign(new FakeElement(), {
      dataset: {},
      click: () => pressed.push('click'),
      dispatchEvent: noted,
    });
    const contains = (el: unknown): boolean => el === control;
    page.dialogs = [{ ...dialog, ownerDocument: document, contains }];
    page.focus = control;
    expect(click('a')).toEqual([]);
    expect(pressed).toEqual(['click']);
  });

  it('steps nowhere with a direction still held from walking as a dialog comes up', () => {
    probe().press('dright');
    frame();
    // A book opens under the D-pad held to walk: no page turns until it is let go.
    page.dialogs = [book];
    page.sent = [];
    frame();
    frame();
    expect(page.sent).toEqual([]);
    probe().release('dright');
    frame();
    probe().press('dright');
    frame();
    expect(page.sent).toEqual(['↓ArrowRight', '↑ArrowRight']);
  });

  it('neither pings nor opens the quick chat over a dialog: the D-pad is the dialog’s', () => {
    const ping = vi.fn();
    const off = onPadPing(ping);
    page.dialogs = [book];
    expect(click('dleft')).toEqual(['↓ArrowLeft', '↑ArrowLeft']);
    expect(click('dright')).toEqual(['↓ArrowRight', '↑ArrowRight']);
    expect(ping).not.toHaveBeenCalled();
    off();
  });

  it('takes the quick chat’s wheel for a menu: B shuts it, the stick walks nobody', () => {
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('HTMLInputElement', class {});
    page.wheel = {
      closest: () => null,
      classList: { contains: () => false },
      ownerDocument: document,
      contains: () => false,
      querySelectorAll: () => [],
    };
    expect(click('b')).toEqual(['↓Escape', '↑Escape']);
    // ▶ moves in the wheel instead of opening it again.
    expect(click('dright')).toEqual([]);
    probe().lean(0.45, 0);
    frame();
    expect(padSteer().x).toBe(0);
    page.wheel = null;
    expect(padSteer().x).toBeCloseTo(0.3125, 9);
  });

  it('turns a book’s pages left and right with the D-pad', () => {
    page.dialogs = [book];
    expect(click('dright')).toEqual(['↓ArrowRight', '↑ArrowRight']);
    expect(click('dleft')).toEqual(['↓ArrowLeft', '↑ArrowLeft']);
  });
});

describe('the controllers connected', () => {
  it('reads only one of the standard mapping: a wheel’s pedals walk nobody', () => {
    stop();
    const at = (pressed: string | null) =>
      STANDARD_BUTTONS.map((button) => ({ pressed: button === pressed, value: 0 }));
    const wheel = { id: 'Wheel', connected: true, mapping: '', buttons: at(null), axes: [-1, 1] };
    const standard = { id: 'Xbox Wireless Controller', connected: true, mapping: 'standard' };
    const pads = [wheel, { ...standard, buttons: at('a'), axes: [0, 0, 0, 0] }];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    stop = startPad({ onSettings }, '');
    page.sent = [];
    frame();
    expect(page.sent).toEqual(['↓ ', '↑ ']);
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
  });
});

describe('remapping in the settings', () => {
  it('hands the next button to the settings instead of acting on it', () => {
    const got: (string | null)[] = [];
    capturePadButton((slot) => got.push(slot));
    expect(click('r2')).toEqual([]);
    expect(got).toEqual(['r2']);
    // Waiting no more, the button acts again.
    expect(click('b')).toEqual(['↓q', '↑q']);
  });

  it('calls the remap off for a button no main action can sit on', () => {
    const got: (string | null)[] = [];
    capturePadButton((slot) => got.push(slot));
    expect(click('start')).toEqual([]);
    expect(got).toEqual([null]);
    expect(onSettings).not.toHaveBeenCalled();
  });

  it('calls the keys’ wait off with any button — by Esc — and does nothing else meanwhile', () => {
    endWait = startRebinding();
    expect(click('a')).toEqual(['↓Escape', '↑Escape']);
    expect(click('start')).toEqual(['↓Escape', '↑Escape']);
    expect(onSettings).not.toHaveBeenCalled();
    probe().lean(1, 0);
    frame();
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
  });

  it('lets go of what is held as it stops: nobody keeps talking, no key stays down', () => {
    const talking: boolean[] = [];
    const off = onPadTalk((held) => talking.push(held));
    const face = { tagName: 'BUTTON', dataset: { pad: 'hold' }, dispatchEvent: noted };
    page.dialogs = [
      {
        closest: () => null,
        getClientRects: () => [{}],
        classList: { contains: () => false },
        contains: (el: unknown) => el === face,
      },
    ];
    page.focus = face;
    page.sent = [];
    probe().press('l1');
    probe().press('a');
    frame();
    stop();
    expect(talking).toEqual([true, false]);
    expect(page.sent).toEqual(['↓ ', '↑ ']);
    off();
    stop = () => undefined;
  });
});
