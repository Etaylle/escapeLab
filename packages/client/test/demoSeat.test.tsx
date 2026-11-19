import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, DemoDoing } from '@escapelab/core';
import { GameScreen, openedBy, type Watch } from '../src/screens/Game.js';
import { storage } from './page.js';
import { playingView } from './playerView.js';

/**
 * A seat's own screen as the demo's audience has it (Game.tsx `watch`): read-only — inert, with
 * nothing to send by — and showing what its seat has open.
 */

const stage = vi.hoisted(() => ({
  /** the props each world shown was given, in order */
  worlds: [] as Record<string, unknown>[],
}));

vi.mock('../src/world/GameWorld.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GameWorld: (props: Record<string, unknown>) => {
    stage.worlds.push(props);
    return null;
  },
}));

const noop = (): void => undefined;
const what = (name: DemoDoing['what'], sourceId: string | null = null): DemoDoing => ({
  what: name,
  sourceId,
});
const ANNA = playingView();

afterEach(() => {
  vi.unstubAllGlobals();
  stage.worlds = [];
});

describe('a seat’s screen watched', () => {
  /** The game screen on Anna's view, watched or played; what its world was handed. */
  function game(watch: Watch | undefined) {
    const sent: ClientMessage[] = [];
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('sessionStorage', storage(new Map()));
    vi.stubGlobal('localStorage', storage(new Map()));
    const html = renderToStaticMarkup(
      <GameScreen
        view={ANNA}
        roomCode={null}
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        send={(msg) => void sent.push(msg)}
        listen={() => noop}
        refusal={null}
        finale={null}
        line={{ status: 'open', retry: null, wake: noop, giveUp: noop }}
        {...(watch === undefined ? {} : { watch })}
      />,
    );
    type World = { send: (msg: ClientMessage) => void } & Record<string, unknown>;
    const world = stage.worlds.at(-1) as World;
    return { html, sent, world };
  }

  it('is inert, and sends nothing: what its world would send goes nowhere', () => {
    const watched = game({ doing: what('walk'), covered: false });
    expect(watched.html).toMatch(/^<div class="game[^"]*" inert="">/);
    expect(watched.world).toMatchObject({ watched: true, covered: false });
    watched.world.send({ kind: 'drop-item' });
    expect(watched.sent).toEqual([]);
    // Played, the same screen takes a finger and sends what its world says.
    const played = game(undefined);
    expect(played.html).toMatch(/^<div class="game[^"]*">/);
    expect(played.world).toMatchObject({ watched: false, covered: false });
    played.world.send({ kind: 'drop-item' });
    expect(played.sent).toEqual([{ kind: 'drop-item' }]);
  });

  it('draws nothing under the whole lab', () => {
    expect(game({ doing: what('walk'), covered: true }).world).toMatchObject({ covered: true });
  });

  it('has open what its seat is doing: the console’s panel, the source’s pages', () => {
    const mine = { operating: true, readingId: 'x', noteIndex: 2, notes: true, info: true };
    const shut = { operating: false, readingId: null };
    const nothing = { ...shut, noteIndex: null, notes: false, info: false };
    expect(openedBy(mine, undefined)).toBe(mine);
    const at = (doing: DemoDoing) => openedBy(mine, { doing, covered: false });
    expect(at(what('operate'))).toEqual({ ...nothing, operating: true });
    expect(at(what('read', 'buch'))).toEqual({ ...nothing, readingId: 'buch' });
    expect(at(what('walk'))).toEqual(nothing);
  });
});
