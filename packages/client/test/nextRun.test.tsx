import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClientMessage, MissionInfo, PlayerView } from '@escapelab/core';
import { EndScreen, NextRun } from '../src/screens/End.js';
import { iconsAsWords } from './fixtures.js';

const noop = (): void => undefined;

const ANNA = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
const BEN = { id: 'p2', name: 'Ben', color: '#f472b6', ready: false, isHost: false };

/** The tutorial won, as Anna (the host) sees it unless told otherwise: it leads on to Blackout. */
function wonTutorial(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'won',
    missionId: 'systemcheck',
    missionTitle: 'Tutorial: Systemcheck',
    nextMissionId: 'blackout',
    difficulty: 'normal',
    storyText: 'Alle Systeme online.',
    crewSize: { min: 2, max: 2 },
    you: ANNA,
    players: [ANNA, BEN].map((p) => ({ ...p, connected: true })),
    palette: [],
    deadlineAt: 421_000,
    startedAt: 1_000,
    lights: { out: true, outAt: 1_000 },
    finishedAt: 301_000,
    timeLimitSec: 420,
    currentPuzzleIndex: 4,
    puzzleCount: 4,
    pausedFor: null,
    events: [],
    grade: { rank: 'A', label: 'Stark' },
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: true },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: null,
    ...parts,
  };
}

const CATALOG: MissionInfo[] = [
  {
    id: 'blackout',
    title: 'Blackout im Labor',
    subtitle: '',
    players: { min: 2, max: 3 },
    timeLimitSec: 660,
    puzzleCount: 6,
    tiles: [],
  },
];

/** Every element `node` renders to, function components called through (none uses a hook). */
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => elementsOf(child));
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  if (typeof node.type === 'function') {
    return elementsOf((node.type as (props: unknown) => ReactNode)(node.props));
  }
  return [node, ...elementsOf(node.props['children'] as ReactNode)];
}

/** The buttons for the next run, left to right: what each reads and sends, and if it leads. */
function buttons(view: PlayerView, missions = CATALOG) {
  const sent: ClientMessage[] = [];
  const tree = <NextRun view={view} missions={missions} send={(msg) => sent.push(msg)} />;
  const labels = [...renderToStaticMarkup(tree).matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(
    (match) => iconsAsWords(match[1] ?? ''),
  );
  return elementsOf(tree)
    .filter((element) => element.type === 'button')
    .map((element, i) => {
      (element.props['onClick'] as () => void)();
      return {
        label: labels[i],
        primary: element.props['className'] === 'primary',
        sends: sent.at(-1),
      };
    });
}

describe('the end screen after a won tutorial', () => {
  it('leads on to Blackout: the host\'s yes names it, „Nochmal" stays beside it', () => {
    expect(buttons(wonTutorial())).toEqual([
      {
        label: '[play] Weiter: Blackout im Labor',
        primary: true,
        sends: { kind: 'set-ready', ready: true, missionId: 'blackout' },
      },
      { label: '[replay] Nochmal', primary: false, sends: { kind: 'set-ready', ready: true } },
    ]);
  });

  it('gives everybody the same buttons, though only the host\'s yes says which run comes', () => {
    const ben = buttons(wonTutorial({ you: BEN }));
    expect(ben.map((button) => button.label)).toEqual([
      '[play] Weiter: Blackout im Labor',
      '[replay] Nochmal',
    ]);
    expect(ben.map((button) => button.sends)).toEqual([
      { kind: 'set-ready', ready: true },
      { kind: 'set-ready', ready: true },
    ]);
  });

  it('lets a yes given be taken back', () => {
    expect(buttons(wonTutorial({ you: { ...ANNA, ready: true } }))).toEqual([
      { label: '[check] Bereit', primary: false, sends: { kind: 'set-ready', ready: false } },
    ]);
  });

  it('names no mission where the catalog has none to name, and still goes on', () => {
    const [onward] = buttons(wonTutorial(), []);
    expect(onward?.label).toBe('[play] Weiter: nächster Einsatz');
    expect(onward?.sends).toEqual({ kind: 'set-ready', ready: true, missionId: 'blackout' });
  });

  it('offers only „Nochmal" after a lost run, and where no mission follows', () => {
    const leadsNowhere = wonTutorial();
    delete leadsNowhere.nextMissionId;
    for (const view of [wonTutorial({ phase: 'lost', grade: null }), leadsNowhere]) {
      expect(buttons(view)).toEqual([
        {
          label: '[replay] Nochmal — ich bin dabei',
          primary: true,
          sends: { kind: 'set-ready', ready: true },
        },
      ]);
    }
  });

  it('says who chooses what starts once all have agreed', () => {
    const line = (view: PlayerView): string =>
      renderToStaticMarkup(
        <EndScreen view={view} fresh={false} send={noop} leaveRoom={noop} missions={CATALOG} />,
      );
    expect(line(wonTutorial())).toContain('startet der Einsatz, den du wählst.');
    expect(line(wonTutorial({ you: BEN }))).toContain('startet der Einsatz, den der Host wählt.');
    expect(line(wonTutorial({ phase: 'lost', grade: null }))).toContain(
      'startet derselbe Einsatz von selbst.',
    );
  });
});
