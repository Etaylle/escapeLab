import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * useKeys as a page runs it, without a DOM: its effect run at once, the window's listener caught,
 * a key pressed through it.
 */

const caught = vi.hoisted(() => ({ onDown: null as ((e: unknown) => void) | null }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void) => effect(),
}));

vi.mock('../src/menuLayer.js', () => ({ usePause: () => ({ open: false }) }));

const { useKeys } = await import('../src/hooks.js');

beforeEach(() => {
  caught.onDown = null;
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('window', {
    addEventListener: (_type: string, onDown: (e: unknown) => void) => {
      caught.onDown = onDown;
    },
    removeEventListener: () => undefined,
  });
});

/** A key going down, as the window hands it on. */
const down = (key: string) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  preventDefault: () => undefined,
});

describe('useKeys', () => {
  it('hears the space bar beside enter and the arrows', () => {
    const heard: string[] = [];
    useKeys([' ', 'enter', 'arrowleft'], (key) => heard.push(key));
    for (const key of [' ', 'Enter', 'ArrowLeft', 'x']) {
      caught.onDown?.(down(key));
    }
    expect(heard).toEqual([' ', 'enter', 'arrowleft']);
  });
});
