import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { GameWorld } from '../src/world/GameWorld.js';
import { mapWith, type Item } from './fixtures.js';

const YOU = 'p1';

/** The fuse, lying on the floor unless `parts` say otherwise. */
function fuse(parts: Partial<Item> = {}): Item {
  return {
    found: true,
    known: true,
    id: 'fuse',
    kind: 'fuse',
    label: 'SICHERUNG',
    x: 3.5,
    y: 4.5,
    carriedBy: null,
    delivered: false,
    deliverTo: { x: 9, y: 2 },
    requiredFor: null,
    ...parts,
  };
}

/** A running mission as this player sees it, the lab holding `items`. */
function viewWith(items: Item[]): PlayerView {
  const you = { id: YOU, name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    chat: [],
    you,
    players: [{ ...you, connected: true }],
    palette: [],
    deadlineAt: null,
    startedAt: 1,
    lights: { out: true, outAt: 1 },
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
    pausedAt: null,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({ items }),
  };
}

/** The world's markup as it first renders: the canvas and the controls over it. */
function world(items: Item[], spectator = false): string {
  return renderToStaticMarkup(
    <GameWorld
      view={viewWith(items)}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      inputLocked={false}
      darkSince={0}
      spectator={spectator}
      holdTips={false}
      onToggleInfo={() => undefined}
      onRead={() => undefined}
      onReadNote={() => undefined}
      onOperate={() => undefined}
      send={() => undefined}
    />,
  );
}

const DROP = 'class="world-drop"';

describe('the button that puts down what you carry', () => {
  it('is not there while your hands are empty', () => {
    const html = world([fuse()]);
    expect(html).not.toContain(DROP);
    for (const control of ['world-pad', 'world-interact', 'world-chat-toggle']) {
      expect(html).toContain(`class="${control}"`);
    }
  });

  it('shows while you carry something: a round 📦 named „Ablegen", at the row’s far end', () => {
    const drop = '<button class="world-drop" aria-label="Ablegen">📦</button>';
    expect(world([fuse({ carriedBy: YOU })])).toContain(
      `<div class="world-thumb">${drop}<button class="world-chat-toggle"`,
    );
  });

  it('puts the pad under the left thumb, the buttons under the right one, the action last', () => {
    const html = world([fuse({ carriedBy: YOU })]);
    const controls = ['world-pad', 'world-thumb', 'world-drop', 'world-chat-toggle'];
    const order = [...controls, 'world-sprint', 'world-interact'].map((control) =>
      html.indexOf(`class="${control}"`),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The action stands in the right corner: nothing comes after it in the row.
    const row = html.slice(html.indexOf('class="world-thumb"'));
    expect(row.slice(row.indexOf('class="world-interact"')).match(/<button/g)).toBeNull();
  });

  it('draws the pad as eight ways round a still middle, three cells by three', () => {
    const html = world([fuse()]);
    const opens = '<div class="world-pad" role="group" aria-label="Steuerkreuz">';
    const pad = html.slice(html.indexOf(opens), html.indexOf('</div>', html.indexOf(opens)));
    const cell = /<span class="world-pad-cell" aria-hidden="true">(.)<\/span>/gu;
    const cells = [...pad.matchAll(cell)];
    expect(cells.map((cell) => cell[1])).toEqual(['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘']);
  });

  it('is not there for what somebody else carries, or for what is already in place', () => {
    expect(world([fuse({ carriedBy: 'p2' })])).not.toContain(DROP);
    expect(world([fuse({ carriedBy: YOU, delivered: true })])).not.toContain(DROP);
  });

  it('is not there for the audience, which has no controls at all', () => {
    const html = world([fuse({ carriedBy: YOU })], true);
    expect(html).not.toContain('world-controls');
    expect(html).not.toContain(DROP);
  });

  it('puts „Sprint" beside the action under the right thumb, held to run', () => {
    const html = world([fuse()]);
    expect(html).toContain(
      '<button class="world-sprint" aria-label="Sprinten">Sprint</button>' +
        '<button class="world-interact" aria-label="Benutzen">',
    );
  });

  it('shows on a touch screen only: a keyboard has Q for it', () => {
    const css = readFileSync(new URL('../src/styles/world.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\n\.world-drop \{[^}]*display: none;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.world-drop \{[^}]*display: grid;/);
  });
});
