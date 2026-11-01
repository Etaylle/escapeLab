import { describe, expect, it } from 'vitest';
import { HeldKeys } from '../src/input/heldKeys.js';

describe('the keys held for a step or the sprint', () => {
  it('lets a key go where it went down, whatever Shift made of its name meanwhile', () => {
    const held = new HeldKeys();
    held.press({ code: 'Comma', key: ',' }, 'up');
    // Shift went down while „," was held: it comes up as „;".
    expect(held.release({ code: 'Comma', key: ';' })).toBe('up');
    expect(held.release({ code: 'Comma', key: ',' })).toBeNull();
  });

  it('holds what two keys hold until both are up: W and ↑', () => {
    const held = new HeldKeys();
    held.press({ code: 'KeyW', key: 'w' }, 'up');
    held.press({ code: 'ArrowUp', key: 'ArrowUp' }, 'up');
    expect(held.release({ code: 'KeyW', key: 'w' })).toBeNull();
    expect(held.release({ code: 'ArrowUp', key: 'ArrowUp' })).toBe('up');
  });

  it('lets nothing go for a key that held nothing, nor after the window was lost', () => {
    const held = new HeldKeys();
    expect(held.release({ code: 'KeyQ', key: 'q' })).toBeNull();
    held.press({ code: 'ShiftLeft', key: 'Shift' }, 'sprint');
    held.clear();
    expect(held.release({ code: 'ShiftLeft', key: 'Shift' })).toBeNull();
  });

  it('goes by the name of a key a controller sends, which sits nowhere', () => {
    const held = new HeldKeys();
    held.press({ code: '', key: 'D' }, 'right');
    expect(held.release({ code: '', key: 'd' })).toBe('right');
  });
});
