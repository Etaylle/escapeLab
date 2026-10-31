import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAD } from '../src/input/bindings.js';
import { inputDevice, noteDevice } from '../src/input/device.js';
import { capturePadButton, padSteer, startPad, type PadProbe } from '../src/input/padRuntime.js';
import { changeSettings, DEFAULT_SETTINGS, setRebinding } from '../src/settings.js';

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
}

let page: FakePage;

function stubPage(): void {
  page = { sent: [], dialogs: [], world: true, frames: [], now: 0 };
  const body = {
    dispatchEvent: (e: FakeKeyboardEvent): boolean => {
      page.sent.push(`${e.type === 'keydown' ? '↓' : '↑'}${e.key}`);
      return true;
    },
  };
  vi.stubGlobal('document', {
    activeElement: null,
    body,
    documentElement: { dataset: {}, style: { setProperty: () => undefined } },
    querySelectorAll: (selector: string) =>
      selector === '[aria-modal="true"]' ? page.dialogs : [],
    querySelector: (selector: string) => (selector === '.world-wrap' && page.world ? {} : null),
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
const onSettings = vi.fn();

beforeEach(() => {
  stubPage();
  onSettings.mockClear();
  stop = startPad({ onSettings }, '?fakepad=1');
});

afterEach(() => {
  stop();
  noteDevice('keys', 'xbox');
  setRebinding(false);
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

  it('talks while L1 is held, opens the settings with Start', () => {
    page.sent = [];
    probe().press('l1');
    frame();
    expect(page.sent).toEqual(['↓v']);
    probe().release('l1');
    frame();
    expect(page.sent).toEqual(['↓v', '↑v']);
    click('start');
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('sends the keys the settings bind, and its main actions where the settings put them', () => {
    changeSettings({
      keys: { ...DEFAULT_SETTINGS.keys, drop: 'g', talk: 'b' },
      pad: { ...DEFAULT_PAD, notes: 'a', interact: 'x' },
    });
    expect(click('b')).toEqual(['↓g', '↑g']);
    expect(click('a')).toEqual(['↓n', '↑n']);
    expect(click('x')).toEqual(['↓ ', '↑ ']);
    expect(click('l1')).toEqual(['↓b', '↑b']);
  });

  it('steers with the stick past its dead zone, the D-pad over it, R1 sprinting', () => {
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
    probe().lean(0.6, 0);
    frame();
    expect(padSteer().x).toBeCloseTo(0.5, 9);
    probe().press('dleft');
    probe().press('r1');
    frame();
    expect(padSteer()).toEqual({ x: -1, y: 0, sprint: true });
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

  it('turns a book’s pages left and right with the D-pad', () => {
    const book = { contains: (name: string) => name === 'reading-modal' };
    page.dialogs = [{ ...dialog, classList: book }];
    expect(click('dright')).toEqual(['↓ArrowRight', '↑ArrowRight']);
    expect(click('dleft')).toEqual(['↓ArrowLeft', '↑ArrowLeft']);
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

  it('lets nothing act while the settings wait for a key', () => {
    setRebinding(true);
    expect(click('a')).toEqual([]);
    expect(padSteer()).toEqual({ x: 0, y: 0, sprint: false });
  });

  it('lets go of a key held as it stops: nobody keeps talking', () => {
    page.sent = [];
    probe().press('l1');
    frame();
    stop();
    expect(page.sent).toEqual(['↓v', '↑v']);
    stop = () => undefined;
  });
});
