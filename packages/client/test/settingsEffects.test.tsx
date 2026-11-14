import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicSettings } from '../src/screens/MusicSettings.js';
import { SettingsPanel } from '../src/screens/Settings.js';
import { previewing, stopPreview, togglePreview } from '../src/world/musicPreview.js';
import { fakeGraph } from './fakeGraph.js';
import { fakeMedia } from './fakeMedia.js';
import { serveSamples } from './fakeSamples.js';

/**
 * What the settings do once they stand on a page and as they leave it (screens/Settings.tsx,
 * MusicSettings.tsx). The tests run without a page, where React runs no effect and draws nothing
 * anew; so the effects are kept as a component renders, run, and taken back as a page would, and
 * every state set is noted.
 */

type Effect = () => void | (() => void);

const effects: Effect[] = [];
/** Every value a component's state was set to, in order. */
const sets: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return {
    ...react,
    useEffect: (effect: Effect) => void effects.push(effect),
    useState: <S,>(initial: S | (() => S)) => {
      const [state, set] = react.useState(initial);
      const noted = (next: React.SetStateAction<S>): void => {
        sets.push(next);
        set(next);
      };
      return [state, noted] as const;
    },
  };
});

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
  effects.length = 0;
  sets.length = 0;
});

afterEach(() => {
  stopPreview();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs every effect kept, as a page mounting the panel would; returns what takes each back. */
function mount(): (() => void)[] {
  return effects.flatMap((effect) => {
    try {
      const back = effect();
      return typeof back === 'function' ? [back] : [];
    } catch {
      // An effect that needs a page (a listener on the window) has none to run on here.
      return [];
    }
  });
}

describe('the settings panel taken away', () => {
  it('stops the piece played for the ear, which its coming left playing', async () => {
    serveSamples();
    togglePreview('yalciner', 'calm');
    await vi.advanceTimersByTimeAsync(20);
    renderToStaticMarkup(<SettingsPanel onClose={() => undefined} tab="ton" />);
    const takeBack = mount();
    expect(previewing()).toBe('yalciner/calm');
    for (const back of takeBack) back();
    expect(previewing()).toBeNull();
  });
});

describe('the music block before the music’s list is here', () => {
  it('asks for it as it comes, and is drawn anew once it is here', async () => {
    serveSamples();
    renderToStaticMarkup(<MusicSettings />);
    mount();
    expect(sets).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sets).toEqual([true]);
  });

  it('is drawn anew by nothing once it has gone', async () => {
    serveSamples();
    renderToStaticMarkup(<MusicSettings />);
    for (const back of mount()) back();
    await vi.advanceTimersByTimeAsync(0);
    expect(sets).toEqual([]);
  });
});
