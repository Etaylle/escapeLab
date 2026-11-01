import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, DEFAULT_PAD } from '../src/input/bindings.js';
import { inputDevice, noteDevice } from '../src/input/device.js';
import { nextInDirection } from '../src/input/focus.js';
import { glyph, glyphOf, type GlyphSource } from '../src/input/glyphs.js';
import {
  DEADZONE,
  directionOf,
  padFamily,
  padStateOf,
  pressedSince,
  radial,
  releasedSince,
  STANDARD_BUTTONS,
  steerOf,
  type GamepadLike,
  type PadButton,
} from '../src/input/pad.js';
import { carryLine, promptText, type ContextAction } from '../src/world/interact.js';
import { newSim, walk } from '../src/world/sim.js';
import { changeSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

/** A controller of the standard mapping with `held` pressed and the left stick at (x, y). */
function pad(held: PadButton[] = [], [x, y] = [0, 0]): GamepadLike {
  return {
    id: 'Xbox Wireless Controller',
    connected: true,
    buttons: STANDARD_BUTTONS.map((button) =>
      held.includes(button) ? { pressed: true, value: 1 } : { pressed: false, value: 0 },
    ),
    axes: [x, y, 0, 0],
  };
}

const length = ({ x, y }: { x: number; y: number }): number => Math.hypot(x, y);

afterEach(() => {
  noteDevice('keys', 'xbox');
  changeSettings(DEFAULT_SETTINGS);
});

describe('the stick’s dead zone, radial', () => {
  it('reads nothing within 0.2 of the middle, whichever way it leans', () => {
    expect(DEADZONE).toBe(0.2);
    expect(radial(0.19, 0)).toEqual({ x: 0, y: 0 });
    expect(radial(0.14, 0.14)).toEqual({ x: 0, y: 0 });
    expect(radial(0, -0.2)).toEqual({ x: 0, y: 0 });
  });

  it('scales from the zone’s edge to the rim, keeping the way it leans', () => {
    expect(length(radial(0.6, 0))).toBeCloseTo(0.5, 9);
    expect(length(radial(1, 0))).toBeCloseTo(1, 9);
    const lean = radial(0.3, -0.4);
    expect(length(lean)).toBeCloseTo((0.5 - 0.2) / 0.8, 9);
    expect(Math.atan2(lean.y, lean.x)).toBeCloseTo(Math.atan2(-0.4, 0.3), 9);
  });

  it('walks a full diagonal as fast as a straight lean: never past 1', () => {
    expect(length(radial(Math.SQRT1_2, Math.SQRT1_2))).toBeCloseTo(1, 9);
    expect(length(radial(1, 1))).toBeCloseTo(1, 9);
  });
});

describe('a poll of the controller', () => {
  it('holds the buttons pressed and the triggers past half their travel', () => {
    const trigger = { ...pad(['a', 'dleft']) };
    const buttons = trigger.buttons.map((it, i) => (i === 7 ? { pressed: false, value: 0.6 } : it));
    const state = padStateOf({ ...trigger, buttons });
    expect([...state.held].sort()).toEqual(['a', 'dleft', 'r2']);
    expect(padStateOf(pad([], [0.1, 0.1])).stick).toEqual({ x: 0, y: 0 });
  });

  it('tells a PlayStation controller by its vendor or its name, everything else as Xbox', () => {
    expect(padFamily('054c-0ce6-Wireless Controller')).toBe('playstation');
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)')).toBe(
      'playstation',
    );
    expect(padFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padFamily('8BitDo Pro 2')).toBe('xbox');
    // Microsoft's own say „Xbox Wireless Controller" on macOS, Linux, Firefox and Safari.
    const series = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
    expect(padFamily(series)).toBe('xbox');
    expect(padFamily('Xbox Wireless Controller')).toBe('xbox');
    expect(padFamily('045e-0b13-Xbox Wireless Controller')).toBe('xbox');
    // A DualShock 4 calls itself a bare „Wireless Controller".
    const ds4 = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
    expect(padFamily(ds4)).toBe('playstation');
    expect(padFamily('Wireless Controller')).toBe('playstation');
  });

  it('tells what was pressed and let go since the poll before', () => {
    const before = padStateOf(pad(['a', 'l1']));
    const now = padStateOf(pad(['l1', 'b']));
    expect(pressedSince(before, now)).toEqual(['b']);
    expect(releasedSince(before, now)).toEqual(['a']);
  });

  it('steers by the stick alone: the D-pad walks nobody, in the world it pings and chats', () => {
    expect(steerOf(padStateOf(pad(['dright'], [-1, 0])))).toEqual({ x: -1, y: 0 });
    expect(steerOf(padStateOf(pad(['dup', 'dleft'])))).toEqual({ x: 0, y: 0 });
    expect(length(steerOf(padStateOf(pad([], [0.6, 0]))))).toBeCloseTo(0.5, 9);
  });

  it('points between a panel’s controls by the D-pad or a flick of the stick', () => {
    expect(directionOf(padStateOf(pad(['ddown'])))).toBe('down');
    expect(directionOf(padStateOf(pad([], [0.9, 0.3])))).toBe('right');
    expect(directionOf(padStateOf(pad([], [-0.2, -0.8])))).toBe('up');
    // A lean too slight to be a flick moves nothing.
    expect(directionOf(padStateOf(pad([], [0.4, 0])))).toBeNull();
  });
});

describe('the prompts follow the device used last', () => {
  const at: ContextAction = {
    kind: 'read',
    manualId: 'buch',
    label: 'Lesen',
    x: 1,
    y: 1,
    subject: { of: 'manual', id: 'buch' },
  };

  it('names the keys as bound until a controller is used, then its buttons, then keys', () => {
    expect(promptText(at, true)).toBe('[E] Lesen');
    expect(carryLine('Sicherung')).toBe('📦 Sicherung — [Q] ablegen');
    noteDevice('pad', 'xbox');
    expect(inputDevice().device).toBe('pad');
    expect(promptText(at, true)).toBe('[A] Lesen');
    expect(carryLine('Sicherung')).toBe('📦 Sicherung — [B] ablegen');
    noteDevice('pad', 'playstation');
    expect(promptText(at, true)).toBe('[✕] Lesen');
    noteDevice('keys');
    expect(promptText(at, true)).toBe('[E] Lesen');
  });

  it('names a touch screen’s verb alone — unless a controller steers it', () => {
    expect(promptText(at, false)).toBe('Lesen');
    noteDevice('pad', 'xbox');
    expect(promptText(at, false)).toBe('[A] Lesen');
  });

  it('reads every key from the bindings: a rebound key is the one named', () => {
    changeSettings({ keys: { ...DEFAULT_KEYS, interact: 'f', drop: 'g' } });
    expect(promptText(at, true)).toBe('[F] Lesen');
    expect(carryLine('Sicherung')).toBe('📦 Sicherung — [G] ablegen');
    changeSettings({ pad: { ...DEFAULT_PAD, interact: 'y', minimap: 'a' } });
    noteDevice('pad', 'xbox');
    expect(promptText(at, true)).toBe('[Y] Lesen');
  });

  it('names the shared steps by their keys, and on a controller by its buttons', () => {
    const keys: GlyphSource = {
      keys: DEFAULT_KEYS,
      pad: DEFAULT_PAD,
      device: 'keys',
      family: 'xbox',
    };
    const shared = ['close', 'putDown', 'skip', 'pageOn', 'talk', 'sprint', 'info'] as const;
    expect(shared.map((p) => glyphOf(p, keys))).toEqual([
      ...['Esc', 'E', 'Leertaste', '→'],
      ...['V', 'Shift', 'I'],
    ]);
    const ps: GlyphSource = { ...keys, device: 'pad', family: 'playstation' };
    expect(shared.map((p) => glyphOf(p, ps))).toEqual(['○', '○', '✕', '▶', 'L1', 'R1', 'Create']);
    // The quick chat opens on the D-pad's ▶; the ways to walk are the stick's, no button's.
    expect(glyphOf('chat', ps)).toBe('▶');
    expect(glyphOf('chat', keys)).toBe('C');
    expect(glyph('notes')).toBe('N');
  });
});

describe('the avatar steered by a controller', () => {
  const OPEN = mapWith({ width: 10, height: 6, tiles: TILES });

  /** A second east from (1.5, 2.5), the controller steering `x` with R1 as `sprint`. */
  function steered(x: number, sprint = false, locked = false): number {
    const sim = newSim(0);
    Object.assign(sim.self, { x: 1.5, y: 2.5 });
    sim.pad = { x, y: 0, sprint };
    for (let i = 0; i < 60; i++) {
      walk(sim, OPEN, 1 / 60, locked);
    }
    return sim.self.x - 1.5;
  }

  it('walks as far as the stick leans, sprints with R1, and stands while input is locked', () => {
    expect(steered(1)).toBeCloseTo(4.2, 6);
    expect(steered(0.5)).toBeCloseTo(2.1, 6);
    expect(steered(1, true)).toBeCloseTo(4.2 * 1.3, 6);
    expect(steered(1, false, true)).toBe(0);
  });

  it('walks by the keys over the stick where both are held', () => {
    const sim = newSim(0);
    Object.assign(sim.self, { x: 1.5, y: 2.5 });
    sim.pad = { x: -1, y: 0, sprint: false };
    sim.keys.add('right');
    for (let i = 0; i < 60; i++) {
      walk(sim, OPEN, 1 / 60, false);
    }
    expect(sim.self.x - 1.5).toBeCloseTo(4.2, 6);
  });
});

describe('moving between a panel’s controls', () => {
  /** A button of a grid: 40 × 30 px, 10 px apart. */
  const box = (col: number, row: number) => ({
    left: col * 50,
    top: row * 40,
    right: col * 50 + 40,
    bottom: row * 40 + 30,
  });
  const grid = [box(0, 0), box(1, 0), box(2, 0), box(0, 1), box(1, 1), box(2, 1)];

  it('goes to the nearest control that way', () => {
    expect(nextInDirection(box(0, 0), grid, 'right')).toBe(1);
    expect(nextInDirection(box(1, 0), grid, 'down')).toBe(4);
    expect(nextInDirection(box(2, 1), grid, 'left')).toBe(4);
    expect(nextInDirection(box(0, 1), grid, 'up')).toBe(0);
  });

  it('goes nowhere past the panel’s edge', () => {
    expect(nextInDirection(box(2, 0), grid, 'right')).toBeNull();
    expect(nextInDirection(box(0, 0), grid, 'up')).toBeNull();
  });

  it('keeps to the line of travel over a nearer control off to the side', () => {
    const inLine = { left: 200, top: 0, right: 240, bottom: 30 };
    const aside = { left: 60, top: 90, right: 100, bottom: 120 };
    expect(nextInDirection(box(0, 0), [aside, inLine], 'right')).toBe(1);
  });
});
