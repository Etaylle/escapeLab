import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRerenderAt } from '../src/world/finale.js';

const T0 = 1_000_000;
/** When the end screen is due: a won run's finale, 1.8 s after T0. */
const AT = T0 + 1800;

/** React's act environment: act flushes a render and its effects before it returns. */
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * A node React DOM mounts a root in that draws nothing: an element by its type and tag, React
 * listening for events on it and its document; nothing else of a DOM is asked for.
 */
function bareNode(): Element {
  const listens = { addEventListener: () => undefined, removeEventListener: () => undefined };
  return { nodeType: 1, tagName: 'DIV', ...listens, ownerDocument: listens } as unknown as Element;
}

/**
 * Mounts a component waiting for `at` with useRerenderAt, its commit landing `lateMs` after its
 * render, as after a long frame; `renders` are the times, on the page's clock, it rendered at.
 */
function mount(at: number, lateMs = 0): { renders: number[]; root: Root } {
  const renders: number[] = [];
  function Waiting(): null {
    renders.push(Date.now());
    useRerenderAt(at);
    // Layout effects run before passive ones: the clock moves on between the render and them.
    useLayoutEffect(() => {
      vi.setSystemTime(Date.now() + lateMs);
    }, []);
    return null;
  }
  const root = createRoot(bareNode());
  act(() => root.render(createElement(Waiting)));
  return { renders, root };
}

/** Lets `ms` go by a millisecond at a time, every render and effect that brings flushed. */
function elapse(ms: number): void {
  for (let i = 0; i < ms; i++) {
    act(() => vi.advanceTimersByTime(1));
  }
}

describe('a screen waiting for the end of its finale (useRerenderAt)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    // What React DOM asks of the window here: its event for an update's priority (none), and the
    // iframe class it follows the focus through on a commit (no iframe).
    vi.stubGlobal('window', { HTMLIFrameElement: class {} });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders again once the end has come', () => {
    const { renders, root } = mount(AT);
    elapse(1810);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toBeGreaterThanOrEqual(AT);
    act(() => root.unmount());
  });

  it('renders again where its effect ran only after the end, a long frame after the render', () => {
    const { renders, root } = mount(AT, 2000);
    elapse(10);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toBeGreaterThanOrEqual(AT);
    act(() => root.unmount());
  });

  it('looks again where its timer fired a moment early, and renders once the end has come', () => {
    const { renders, root } = mount(AT);
    // From here the page's clock runs 2 ms behind the timers: a timer fires 2 ms early by it.
    vi.setSystemTime(T0 - 2);
    elapse(1810);
    expect(renders).toEqual([T0, AT - 1, AT + 1]);
    act(() => root.unmount());
  });

  it('renders no more once the end has passed', () => {
    const { renders, root } = mount(T0 - 100);
    elapse(200);
    expect(renders).toEqual([T0]);
    act(() => root.unmount());
  });
});
