import { createElement, type MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleView } from '@escapelab/core';

vi.mock('../src/puzzles/sounds.js', () => ({
  buttonThunk: vi.fn(),
  dialDetent: vi.fn(),
  keyClick: vi.fn(),
  leverPull: vi.fn(),
  mushroomStomp: vi.fn(),
  probeClick: vi.fn(),
  rejectBuzz: vi.fn(),
  simonTone: vi.fn(),
  toggleClack: vi.fn(),
  typeBlip: vi.fn(),
}));

const sounds = await import('../src/puzzles/sounds.js');
const {
  BLAME_MS,
  blamed,
  CALM_MS,
  deviceState,
  flash,
  motionMs,
  opened,
  pressed,
  pressSound,
  PRESS_MS,
  refusedSince,
  reject,
  REJECT_MS,
  seeing,
  usePressFeel,
} = await import('../src/puzzles/feel.js');
const { reducedMotion } = await import('../src/settings.js');

/** A control as the kit sees it, its classes kept in a set. */
function control(dataset: Record<string, string> = {}) {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
    },
    dataset,
    getBoundingClientRect: () => ({}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a control going down', () => {
  it('sounds as its data-feel says, and clicks where it says nothing', () => {
    pressSound(control());
    expect(sounds.keyClick).toHaveBeenCalledTimes(1);
    const feels = [
      ['clack', sounds.toggleClack],
      ['thunk', sounds.buttonThunk],
      ['stomp', sounds.mushroomStomp],
      ['pull', sounds.leverPull],
      ['probe', sounds.probeClick],
      ['detent', sounds.dialDetent],
      ['blip', sounds.typeBlip],
    ] as const;
    for (const [feel, sound] of feels) {
      pressSound(control({ feel }));
      expect(sound).toHaveBeenCalledTimes(1);
    }
    expect(sounds.keyClick).toHaveBeenCalledTimes(1);
  });

  it('sounds a colour key’s own tone, and nothing for one that makes its own sound', () => {
    pressSound(control({ feel: 'tone', tone: 'gelb' }));
    expect(sounds.simonTone).toHaveBeenCalledWith('gelb', 0.25);
    pressSound(control({ feel: 'tone', tone: 'lila' }));
    pressSound(control({ feel: 'none' }));
    expect(sounds.simonTone).toHaveBeenCalledTimes(1);
    expect(sounds.keyClick).not.toHaveBeenCalled();
  });
});

describe('a flash on a control', () => {
  it('shows its class for as long as asked, then takes it off', () => {
    vi.useFakeTimers();
    const key = control();
    flash(key, 'feel-pressed', 80);
    expect(key.classes.has('feel-pressed')).toBe(true);
    vi.advanceTimersByTime(79);
    expect(key.classes.has('feel-pressed')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(key.classes.has('feel-pressed')).toBe(false);
  });

  it('starts over where it still shows, for its whole time again', () => {
    vi.useFakeTimers();
    const key = control();
    flash(key, 'feel-reject', 160);
    vi.advanceTimersByTime(100);
    flash(key, 'feel-reject', 160);
    vi.advanceTimersByTime(100);
    expect(key.classes.has('feel-reject')).toBe(true);
    vi.advanceTimersByTime(60);
    expect(key.classes.has('feel-reject')).toBe(false);
  });
});

describe('a press', () => {
  const way = { keyboard: false, audible: true };

  it('from a key shows the control down for 80 ms and sounds it; a pointer’s does not', () => {
    vi.useFakeTimers();
    const key = control({ feel: 'clack' });
    pressed(key, way, 0);
    expect(key.classes.size).toBe(0);
    expect(sounds.toggleClack).not.toHaveBeenCalled();
    pressed(key, { ...way, keyboard: true }, 0);
    expect(key.classes.has('feel-pressed')).toBe(true);
    expect(sounds.toggleClack).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESS_MS);
    expect(key.classes.has('feel-pressed')).toBe(false);
  });

  it('shows nothing it has not heard from the server: no shake of its own', () => {
    const key = control();
    pressed(key, way, 0);
    expect(key.classes.has('feel-reject')).toBe(false);
    expect(sounds.rejectBuzz).not.toHaveBeenCalled();
  });

  it('is kept with its time, for a refusal or an alarm right after it', () => {
    const key = control();
    expect(pressed(key, way, 1234)).toEqual({ control: key, at: 1234 });
  });

  it('makes no sound where the device is not heard', () => {
    const key = control();
    pressed(key, { keyboard: true, audible: false }, 0);
    expect(key.classes).toEqual(new Set(['feel-pressed']));
    expect(sounds.keyClick).not.toHaveBeenCalled();
  });
});

describe('a reject', () => {
  it('shakes the control for 160 ms, with a buzz where the device is heard', () => {
    vi.useFakeTimers();
    const key = control();
    reject(key, true);
    expect(key.classes.has('feel-reject')).toBe(true);
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REJECT_MS);
    expect(key.classes.has('feel-reject')).toBe(false);
    reject(control(), false);
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
  });
});

describe('the control pressed before an alarm or a refusal', () => {
  /** An element the kit takes a click on: inside a working button, the control it finds. */
  class FakeElement {
    constructor(private readonly button: unknown) {}
    closest(): unknown {
      return this.button;
    }
  }

  /** The kit a device's face takes its presses with, `audible` or not. */
  function kit(audible: boolean): ReturnType<typeof usePressFeel> {
    let made: ReturnType<typeof usePressFeel> | null = null;
    function Face(): null {
      made = usePressFeel(audible);
      return null;
    }
    renderToStaticMarkup(createElement(Face));
    if (made === null) {
      throw new Error('the face rendered without its kit');
    }
    return made;
  }

  /** Clicks a working button through the kit, as a pointer does; returns that button. */
  function click(on: ReturnType<typeof usePressFeel>) {
    const button = { ...control(), disabled: false };
    vi.stubGlobal('Element', FakeElement);
    const event = { target: new FakeElement(button), detail: 1 };
    on.handlers.onClick(event as unknown as MouseEvent<HTMLElement>);
    return button;
  }

  it('shakes without a buzz for an alarm — the alarm has its own sound — and with one for a refusal', () => {
    vi.useFakeTimers();
    const face = kit(true);
    const alarmed = click(face);
    face.blame(false);
    expect(alarmed.classes.has('feel-reject')).toBe(true);
    expect(sounds.rejectBuzz).not.toHaveBeenCalled();
    const refused = click(face);
    face.blame();
    expect(refused.classes.has('feel-reject')).toBe(true);
    expect(sounds.rejectBuzz).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal from the server', () => {
  it('is due where the server’s count of them has gone up since the device looked', () => {
    expect(refusedSince(0, 1)).toBe(true);
    expect(refusedSince(3, 5)).toBe(true);
    // The count as the device opened, or a reconnect's fresh count, refuses nothing.
    expect(refusedSince(2, 2)).toBe(false);
    expect(refusedSince(4, 0)).toBe(false);
  });

  it('blames the press just before it, as an alarm does, and none older', () => {
    const key = control();
    const press = pressed(key, { keyboard: false, audible: true }, 5000);
    expect(blamed(press, 5040)).toBe(key);
    expect(blamed(press, 5000 + BLAME_MS + 1)).toBeNull();
  });
});

describe('an alarm after a press', () => {
  it('is the fault of a press up to 1.5 s before it, and of none after that', () => {
    const key = control();
    const press = { control: key, at: 1000 };
    expect(blamed(press, 1000 + BLAME_MS)).toBe(key);
    expect(blamed(press, 1001 + BLAME_MS)).toBeNull();
    expect(blamed(null, 1000)).toBeNull();
  });
});

describe('a change at a device', () => {
  type Sync = Extract<PuzzleView, { kind: 'button-sync' }>;
  const sync = (fields: Partial<Sync> = {}): Sync => ({
    kind: 'button-sync',
    style: 'button',
    windowMs: null,
    press: null,
    youPressed: false,
    partnerPressed: false,
    pressedCount: 0,
    requiredCount: 2,
    here: 1,
    lastResult: null,
    index: 0,
    total: 3,
    title: 'Synchronschaltung',
    manual: null,
    console: 'a',
    backup: null,
    ...fields,
  });

  it('is told by what the device shows, not by who stands where', () => {
    expect(deviceState(sync({ here: 2, backup: { name: 'Ben', where: 'SPIND' } }))).toBe(
      deviceState(sync()),
    );
    expect(deviceState(sync({ pressedCount: 1 }))).not.toBe(deviceState(sync()));
  });

  it('is none for a new copy of the same view, nor for a partner walking up', () => {
    const seen = opened(sync(), 0);
    expect(seen.change).toBeNull();
    expect(seeing(seen, sync(), 0)).toBe(seen);
    expect(seeing(seen, sync({ here: 2 }), 0)).toBe(seen);
  });

  it('keeps the view before and after it, whether an alarm came with it, and counts', () => {
    const first = opened(sync(), 3);
    const pressedOnce = seeing(first, sync({ pressedCount: 1 }), 3);
    expect(pressedOnce.change).toMatchObject({ alarm: false, seq: 1 });
    expect(pressedOnce.change?.before.pressedCount).toBe(0);
    expect(pressedOnce.change?.after.pressedCount).toBe(1);
    // An alarm alone is a change too — at a device whose view it leaves as it was.
    const alarmed = seeing(pressedOnce, sync({ pressedCount: 1 }), 4);
    expect(alarmed.change).toMatchObject({ alarm: true, seq: 2 });
    expect(alarmed.change?.before.pressedCount).toBe(1);
  });
});

describe('reduced motion', () => {
  it('cuts whatever moves to 120 ms at most, and leaves it be otherwise', () => {
    expect(motionMs(600, true)).toBe(CALM_MS);
    expect(motionMs(80, true)).toBe(80);
    expect(motionMs(600, false)).toBe(600);
  });

  it('is asked of the window under the settings’ „System", and of nothing without one', () => {
    expect(reducedMotion()).toBe(false);
    const asks = (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' });
    vi.stubGlobal('window', { matchMedia: asks });
    expect(reducedMotion()).toBe(true);
    expect(motionMs(600)).toBe(CALM_MS);
  });
});
