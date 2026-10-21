import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  scaleMission,
  viewFor,
  type Action,
  type GameState,
  type PlayerView,
  type RunEvent,
} from '@escapelab/core';
import { StageTop, type ColdOpen } from '../src/screens/Game.js';
import { alarmCause, alarmLine, alarmNotice, worldHornDue } from '../src/world/alarm.js';
import { iconsAsWords } from './fixtures.js';

const T0 = 1_700_000_000_000;

/** Blackout at the normal difficulty, as the server starts it: five alarms end the run. */
const blackout = scaleMission(
  parseMission(
    JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
  ),
  'normal',
);

/** Blackout under way for Anna and Ben: the lights out, the clock running. */
function running(): GameState {
  const actions: Action[] = [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed: 5 },
    { type: 'lights-out', at: T0 + 5000 },
  ];
  return actions.reduce(applyAction, initialState(blackout));
}

/** The run's last line of its report, as Anna's view has it. */
function lastLine(state: GameState): RunEvent | undefined {
  return viewFor(state, 'p1').events.at(-1);
}

const dark: ColdOpen = {
  darkSince: T0,
  dark: true,
  intro: true,
  flashUntil: null,
  gates: { sign: T0, line: T0 },
};

function bar(view: PlayerView, deviceOpen = false): string {
  if (view.map === null) {
    throw new Error('the run has no map');
  }
  return iconsAsWords(
    renderToStaticMarkup(
      <StageTop
        view={view}
        map={view.map}
        coldOpen={dark}
        notice={null}
        alarmVisible
        deviceOpen={deviceOpen}
      />,
    ),
  );
}

describe('what set an alarm off', () => {
  it('is read off the run report as the core writes it: a drone, an emergency run out', () => {
    const spotted = applyAction(running(), {
      type: 'drone-spotted',
      at: T0 + 6000,
      penaltySec: 20,
      playerId: 'p2',
    });
    expect(alarmCause(lastLine(spotted)?.label ?? '')).toBe('Drohne');
    const started = applyAction(spotted, { type: 'sabotage-start', at: T0 + 7000 });
    const missed = applyAction(started, { type: 'sabotage-expired', at: T0 + 40_000 });
    expect(lastLine(missed)?.kind).toBe('penalty');
    expect(alarmCause(lastLine(missed)?.label ?? '')).toBe('Notfall');
  });

  it('is a wrong move for every other alarm: a station’s, an emergency console’s', () => {
    for (const reason of ['Falsche Taste am Tastenfeld', 'Gegen eine Wand gelaufen', '']) {
      expect(alarmCause(reason)).toBe('Fehlversuch');
    }
  });
});

describe('an alarm’s notice', () => {
  const penalty = (label: string, seconds: number): RunEvent => ({
    at: T0,
    kind: 'penalty',
    label,
    seconds,
  });

  it('says what it cost, and with the run’s first how many more the limit takes', () => {
    const first = alarmNotice([penalty('Von einer Drohne erfasst', 20)], { count: 1, limit: 5 });
    expect(first).toEqual({
      seq: 1,
      cause: 'Drohne',
      seconds: 20,
      warning: 'Noch 4 bis zur Abschaltung',
    });
    expect(alarmLine(first ?? { seq: 0, cause: '', seconds: null, warning: null })).toBe(
      'ALARM — Drohne! −20 Sekunden',
    );
    const hard = alarmNotice([penalty('x', 15)], { count: 1, limit: 3 });
    expect(hard?.warning).toBe('Noch 2 bis zur Abschaltung');
  });

  it('warns once only, and never without a limit; none before the first alarm', () => {
    const events = [penalty('x', 20), penalty('Notfall nicht rechtzeitig behoben', 30)];
    const second = alarmNotice(events, { count: 2, limit: 5 });
    expect(second).toMatchObject({ seq: 2, cause: 'Notfall', seconds: 30, warning: null });
    expect(alarmNotice([penalty('x', 20)], { count: 1, limit: null })?.warning).toBeNull();
    expect(alarmNotice([], { count: 0, limit: 5 })).toBeNull();
  });
});

describe('the alarm on the objective bar', () => {
  it('names its cause and cost, and with the first alarm how many are left', () => {
    const spotted = applyAction(running(), {
      type: 'drone-spotted',
      at: T0 + 6000,
      penaltySec: 20,
      playerId: 'p2',
    });
    const view = viewFor(spotted, 'p1');
    expect(view.alarms).toEqual({ count: 1, limit: 5 });
    expect(bar(view)).toContain(
      '<div class="alarm" role="alert">[siren] ALARM — Drohne! −20 Sekunden' +
        '<span class="alarm-warning">Noch 4 bis zur Abschaltung</span></div>',
    );
  });

  it('stays off the bar while a device is open: its head says it, the bar would lie under it', () => {
    const spotted = applyAction(running(), {
      type: 'drone-spotted',
      at: T0 + 6000,
      penaltySec: 20,
      playerId: 'p2',
    });
    expect(bar(viewFor(spotted, 'p1'), true)).not.toContain('class="alarm"');
  });
});

describe('one alarm, one sound', () => {
  it('sounds the world’s horn while the run goes on and no device is open', () => {
    expect(worldHornDue('playing', false)).toBe(true);
    // An open device sounds its own (Device.tsx); the alarm that ends the run, the ending's.
    expect(worldHornDue('playing', true)).toBe(false);
    expect(worldHornDue('lost', false)).toBe(false);
  });
});
