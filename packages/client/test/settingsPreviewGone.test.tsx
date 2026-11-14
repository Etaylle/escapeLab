import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/screens/Settings.js';
import { previewing, stopPreview, togglePreview } from '../src/world/musicPreview.js';
import { fakeGraph } from './fakeGraph.js';
import { fakeMedia } from './fakeMedia.js';
import { serveSamples } from './fakeSamples.js';

/**
 * The settings panel gone while a piece plays for the ear (screens/Settings.tsx): it stops,
 * however the panel went — not only by its own way out. The tests run without a page, where React
 * runs no effect; so the panel's effects are kept as it renders, run, and taken back as a page
 * taking the panel away would.
 */

type Effect = () => void | (() => void);

const effects: Effect[] = [];

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return { ...react, useEffect: (effect: Effect) => void effects.push(effect) };
});

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
  effects.length = 0;
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
