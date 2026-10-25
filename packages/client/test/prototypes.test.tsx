import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, MissionInfo, PlayerView } from '@escapelab/core';
import { draftFromJson, draftToJson, newDraft, type Draft } from '../src/editor/draft.js';
import { MissionForm } from '../src/editor/MissionForm.js';
import { validateDraft } from '../src/editor/validate.js';
import { crewSizeText } from '../src/screens/Crew.js';
import { JoinScreen, Prototypes, PROTOTYPES_ROW } from '../src/screens/Join.js';
import { LobbyScreen, PROTOTYPE_LINE } from '../src/screens/Lobby.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
};
const tutorial: MissionInfo = {
  ...blackout,
  id: 'systemcheck',
  title: 'Tutorial: Systemcheck',
  timeLimitSec: 420,
  puzzleCount: 4,
};
const ketten: MissionInfo = {
  ...blackout,
  id: 'kettenreaktion',
  title: 'Kettenreaktion',
  subtitle: 'Für drei.',
  players: { min: 3, max: 3 },
  timeLimitSec: 600,
  puzzleCount: 5,
  stage: 'prototype',
};
const doppel: MissionInfo = {
  ...ketten,
  id: 'doppelschicht',
  title: 'Doppelschicht',
  subtitle: 'Für vier.',
  players: { min: 4, max: 4 },
  timeLimitSec: 720,
};

/** The page's window as far as the join screen and the lobby read it: no address, a name kept. */
function stubWindow(): void {
  const kept = new Map([['escapelab-name', 'Anna']]);
  vi.stubGlobal('window', {
    location: { search: '' },
    localStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: noop,
      removeItem: noop,
    },
  });
}

function joinScreen(missions: MissionInfo[], send: (msg: ClientMessage) => void = noop) {
  return (
    <JoinScreen
      send={send}
      connected
      missions={missions}
      rooms={[]}
      stats={[]}
      openHandbook={noop}
      openHistory={noop}
    />
  );
}

/** The text of an element's markup, its tags left out. */
const textOf = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('the join screen and its prototypes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the current missions as cards, the prototypes behind a collapsed row last', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen([blackout, ketten, tutorial, doppel]));
    const cards = [...html.matchAll(/<span class="mission-title">([^<]*)<\/span>/g)];
    expect(cards.map((card) => card[1])).toEqual(['Blackout im Labor', 'Tutorial: Systemcheck']);
    const row = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    expect(row).toMatch(/^<details class="mission-prototypes"><summary>/);
    expect(PROTOTYPES_ROW).toBe('Prototypen (ältere Karten)');
    expect(row).toContain(`<summary>${PROTOTYPES_ROW}</summary>`);
    expect(html.indexOf('<details')).toBeGreaterThan(html.indexOf('Tutorial: Systemcheck'));
    const lines = [...row.matchAll(/<button class="mission-proto"[^>]*>(.*?)<\/button>/g)];
    expect(lines.map((line) => textOf(line[1] ?? ''))).toEqual([
      `Kettenreaktion · ${crewSizeText(ketten.players)} · 10 min · 5 Stationen`,
      `Doppelschicht · ${crewSizeText(doppel.players)} · 12 min · 5 Stationen`,
    ]);
  });

  it('shows no such row where no mission is a prototype', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen([blackout, tutorial]));
    expect(html).not.toContain('mission-prototypes');
    expect(html).not.toContain(PROTOTYPES_ROW);
  });

  it('opens a room for the first card, not for a prototype listed before it', () => {
    stubWindow();
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen([ketten, blackout], (msg) => sent.push(msg)));
    const primary = buttonsOf(elements, 'primary');
    press(primary.find((button) => button.props['children'] === 'Runde eröffnen'));
    expect(sent).toEqual([expect.objectContaining({ kind: 'create-room', missionId: 'blackout' })]);
  });

  it('marks the prototype picked, and hands on the one pressed', () => {
    const html = renderToStaticMarkup(
      <Prototypes missions={[ketten, doppel]} selected="doppelschicht" onSelect={noop} />,
    );
    expect(html).toContain('<button class="mission-proto" aria-pressed="false"');
    expect(html).toContain(
      '<button class="mission-proto mission-proto-selected" aria-pressed="true" title="Für vier.">',
    );
    const picked: string[] = [];
    const pick = (id: string): void => {
      picked.push(id);
    };
    const row = <Prototypes missions={[ketten, doppel]} selected="blackout" onSelect={pick} />;
    const lines = buttonsOf(elementsOf(() => row), 'mission-proto');
    press(lines[1]);
    expect(picked).toEqual(['doppelschicht']);
  });
});

/** Anna's lobby, as host, of a room on `mission`, the catalog holding `missions`. */
function lobby(mission: MissionInfo, missions: MissionInfo[]): string {
  stubWindow();
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
  const view = {
    phase: 'lobby',
    missionId: mission.id,
    missionTitle: mission.title,
    difficulty: 'normal',
    storyText: 'Stromausfall.',
    crewSize: mission.players,
    you: anna,
    players: [{ ...anna, connected: true }],
    palette: [],
    timeLimitSec: mission.timeLimitSec,
    alarms: { count: 0, limit: null },
  } as unknown as PlayerView;
  return renderToStaticMarkup(
    <LobbyScreen view={view} send={noop} leaveRoom={noop} missions={missions} stats={[]} />,
  );
}

describe('a prototype’s lobby', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says under the facts what the older map lacks; a current mission says nothing of it', () => {
    expect(PROTOTYPE_LINE).toBe('Prototyp: ältere Karte ohne Kaltstart und Einrichtung.');
    const facts = '</p><p class="muted lobby-prototype">';
    expect(lobby(ketten, [blackout, ketten])).toContain(`${facts}${PROTOTYPE_LINE}</p></header>`);
    expect(lobby(blackout, [blackout, ketten])).not.toContain('lobby-prototype');
    expect(lobby(blackout, [blackout, ketten])).not.toContain(PROTOTYPE_LINE);
  });
});

const KETTENREAKTION = JSON.parse(
  readFileSync(new URL('../../../missions/kettenreaktion.json', import.meta.url), 'utf8'),
) as unknown;

function loaded(data: unknown): Draft {
  const result = draftFromJson(data);
  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }
  return result.draft;
}

describe('the editor’s prototype field', () => {
  it('reads a prototype from its file and writes it back; a new mission is none', () => {
    const draft = loaded(KETTENREAKTION);
    expect(draft.stage).toBe('prototype');
    expect(draft.extra).not.toHaveProperty('stage');
    expect(draftToJson(draft)).toMatchObject({ stage: 'prototype' });
    expect(newDraft().stage).toBeNull();
    expect(draftToJson(newDraft())).not.toHaveProperty('stage');
  });

  it('ticks a box for it, and unticking makes the mission a current one again', () => {
    const changes: Draft[] = [];
    const boxOf = (draft: Draft) =>
      elementsOf(() => (
        <MissionForm
          draft={draft}
          validation={validateDraft(draft, () => 0)}
          idTaken={false}
          onChange={(next) => changes.push(next)}
        />
      )).find((element) => element.type === 'input' && element.props['type'] === 'checkbox');
    const fresh = boxOf(newDraft());
    expect(fresh?.props['checked']).toBe(false);
    (fresh?.props['onChange'] as (e: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    expect(changes.at(-1)?.stage).toBe('prototype');
    const prototype = boxOf(loaded(KETTENREAKTION));
    expect(prototype?.props['checked']).toBe(true);
    (prototype?.props['onChange'] as (e: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });
    expect(changes.at(-1)?.stage).toBeNull();
  });
});
