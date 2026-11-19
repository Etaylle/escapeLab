import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayedPosition } from '@escapelab/core';
import { GameWorld } from '../src/world/GameWorld.js';
import { newSim, walk, watchSelf, type Sim } from '../src/world/sim.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';
import { playingView } from './playerView.js';

/**
 * A seat watched, not played — the demo's audience on the own view of one of its crew: the
 * figure goes where the room has that seat, the world offers no control, and the game's keys do
 * nothing while such a screen stands.
 */

const MAP = mapWith({ width: 10, height: 6, tiles: TILES, yourSpawn: { x: 1, y: 3 } });
const RUN = 1_700_000_000_000;

/** Where the room has a seat: at (x, y), walking or not, said at `t`. */
const at = (x: number, y: number, moving: boolean, t: number): RelayedPosition => ({
  x,
  y,
  facing: 0,
  moving,
  t,
  rt: t,
});

/** A frame of a seat watched: `players` as the room has them now, drawn as of `now`. */
function frame(sim: Sim, players: Record<string, RelayedPosition>, youId: string, now: number) {
  return watchSelf(sim, { run: RUN, players }, MAP, { youId, run: RUN }, now);
}

describe('a seat watched in the simulation', () => {
  it('stands where the room has it, the camera on it at once, and walks as its samples do', () => {
    const sim = newSim(0);
    expect(frame(sim, { a: at(4.5, 3.5, false, 1000) }, 'a', 1000)).toBeNull();
    expect(sim.self).toMatchObject({ x: 4.5, y: 3.5, moving: false });
    expect(sim.cam).toEqual({ x: 4.5, y: 3.5 });
    expect([sim.watching, sim.run]).toEqual(['a', RUN]);
    // It walks east: the figure follows its samples, and its feet are heard.
    const sounds = [];
    for (let i = 1; i <= 20; i++) {
      const t = 1000 + i * 80;
      sounds.push(frame(sim, { a: at(4.5 + i * 0.3, 3.5, true, t) }, 'a', t));
    }
    expect(sim.self.x).toBeGreaterThan(8);
    expect(sim.self.moving).toBe(true);
    expect(sounds.filter((sound) => sound === 'walk').length).toBeGreaterThan(3);
    expect(sounds).not.toContain('bump');
  });

  it('takes no key: a key held walks it nowhere', () => {
    const sim = newSim(0);
    sim.keys.add('right');
    for (let i = 0; i < 30; i++) {
      frame(sim, { a: at(4.5, 3.5, false, 1000) }, 'a', 1000 + i * 16);
    }
    expect(sim.self.x).toBe(4.5);
    // The same key walks a figure that is played.
    walk(sim, MAP, 0.5, false);
    expect(sim.self.x).toBeGreaterThan(4.5);
  });

  it('cuts to the other seat: the camera jumps, and nobody is drawn twice', () => {
    const sim = newSim(0);
    const both = { a: at(2.5, 3.5, false, 1000), b: at(7.5, 2.5, false, 1000) };
    frame(sim, both, 'a', 1000);
    sim.others.set('b', { x: 7.5, y: 2.5, facing: 0, moving: false, rx: 7.5, ry: 2.5, phase: 0 });
    sim.lead = { x: 1, y: 0 };
    expect(frame(sim, both, 'b', 1016)).toBeNull();
    expect(sim.self).toMatchObject({ x: 7.5, y: 2.5 });
    expect(sim.cam).toEqual({ x: 7.5, y: 2.5 });
    expect(sim.lead).toEqual({ x: 0, y: 0 });
    expect(sim.watching).toBe('b');
    expect(sim.others.has('b')).toBe(false);
  });

  it('starts a seat the room has said nothing of yet on its spawn, and stays there', () => {
    const sim = newSim(0);
    frame(sim, {}, 'a', 1000);
    expect(sim.self).toMatchObject({ x: 1.5, y: 3.5, moving: false });
    Object.assign(sim.self, { x: 3, y: 3 });
    frame(sim, {}, 'a', 1016);
    expect(sim.self).toMatchObject({ x: 3, y: 3 });
  });
});

/** The world's markup as it first renders, played, watched or the audience's. */
function world(kind: 'played' | 'watched' | 'audience'): string {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  return renderToStaticMarkup(
    <GameWorld
      view={playingView({ startedAt: RUN, map: MAP })}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      inputLocked={false}
      darkSince={0}
      spectator={kind === 'audience'}
      watched={kind === 'watched'}
      holdTips={false}
      onToggleInfo={() => undefined}
      onRead={() => undefined}
      onReadNote={() => undefined}
      onOperate={() => undefined}
      send={() => undefined}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the world of a seat watched', () => {
  const CONTROLS = ['world-pad', 'world-interact', 'world-chat-toggle', 'world-sprint'];

  it('offers no control: no pad, no E, no chat — as the audience’s', () => {
    const played = world('played');
    for (const control of CONTROLS) {
      expect(played, control).toContain(`class="${control}"`);
    }
    for (const kind of ['watched', 'audience'] as const) {
      const html = world(kind);
      expect(html).toContain('<canvas');
      expect(html, kind).not.toMatch(/<button|<input|<textarea/);
    }
  });

  it('is the seat’s own picture, not the audience’s wide one', () => {
    expect(world('watched')).toContain('class="world-canvas "');
    expect(world('audience')).toContain('world-canvas--wide');
  });
});

describe('the game’s keys while a screen only shows a game', () => {
  const caught = { onDown: null as ((e: unknown) => void) | null };
  const down = (key: string) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    preventDefault: () => undefined,
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('react', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      useRef: <T,>(value: T) => ({ current: value }),
      useEffect: (effect: () => void) => void effect(),
    }));
    vi.doMock('../src/menuLayer.js', () => ({ usePause: () => ({ open: false }) }));
    vi.stubGlobal('document', { activeElement: null });
    vi.stubGlobal('window', {
      addEventListener: (_type: string, onDown: (e: unknown) => void) => {
        caught.onDown = onDown;
      },
      removeEventListener: () => undefined,
    });
  });

  afterEach(() => {
    vi.doUnmock('react');
    vi.doUnmock('../src/menuLayer.js');
  });

  it('do nothing: the notepad’s key is heard by a screen played, and by none watched', async () => {
    const { useKeys } = await import('../src/hooks.js');
    const { keysDeaf, useDeafKeys } = await import('../src/input/deaf.js');
    const heard: string[] = [];
    useKeys(['n'], (key) => heard.push(key));
    useDeafKeys(false);
    caught.onDown?.(down('n'));
    expect([keysDeaf(), heard]).toEqual([false, ['n']]);
    useDeafKeys(true);
    caught.onDown?.(down('n'));
    expect([keysDeaf(), heard]).toEqual([true, ['n']]);
  });

  it('are the game’s again once the screen is gone', async () => {
    vi.doMock('react', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          cleanup();
        }
      },
    }));
    const { keysDeaf, useDeafKeys } = await import('../src/input/deaf.js');
    useDeafKeys(true);
    expect(keysDeaf()).toBe(false);
  });
});
