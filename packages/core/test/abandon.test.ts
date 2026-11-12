import { describe, expect, it } from 'vitest';
import {
  applyAction,
  crewOf,
  initialState,
  LATER_WAIT_MS,
  parseMission,
  runReport,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import type { Spot } from '../src/reach.js';
import { consoleLab, lineBack, lineDrops, standing, started, T0 } from './lab.js';

/** A lab for three: Anna hosts, Ben and Cem joined after her. */
const mission = consoleLab(3);

const join = (playerId: string): Action => ({ type: 'player-join', playerId, name: playerId });
const ready = (playerId: string): Action => ({ type: 'set-ready', playerId, ready: true });
const abandon = (playerId: string, at = T0, where: Spot | null = null): Action => ({
  type: 'abandon',
  playerId,
  at,
  where,
});

function run(actions: Action[], from: GameState = initialState(mission)): GameState {
  return actions.reduce(applyAction, from);
}

const lobby = run([join('anna'), join('ben'), join('cem'), ready('ben'), ready('cem')]);

describe('leaving a room before a run', () => {
  it('takes the player out, and everyone confirms anew', () => {
    const left = run([abandon('cem')], lobby);
    expect(left.players.map((p) => p.id)).toEqual(['anna', 'ben']);
    expect(left.players.every((p) => !p.ready)).toBe(true);
  });

  it('passes the host’s part on to whoever joined next', () => {
    const left = run([abandon('anna')], lobby);
    expect(left.players.map((p) => [p.id, p.isHost])).toEqual([
      ['ben', true],
      ['cem', false],
    ]);
  });

  it('knows nobody it has never seen', () => {
    expect(() => run([abandon('zoe')], lobby)).toThrow(/Unbekannter Spieler/);
  });
});

describe('leaving a room after a run', () => {
  it('is as free: the end screen’s crew goes on without them', () => {
    const lost = applyAction(started(mission), { type: 'time-expired', at: T0 + 700_000 });
    expect(lost.phase).toBe('lost');
    const left = run([abandon('p2')], lost);
    expect(left.players.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(left.phase).toBe('lost');
  });
});

/**
 * A corridor lab for two or three: two stations where the whole crew presses, a fuse lying at
 * (1,1) for the second, emergencies at the relay, the hatch at the east end.
 *
 *   0123456789
 * 0 ##########
 * 1 #F.1.2...#   spawns (1,1), (1,2), (2,2); the fuse (1,1); its slot (8,1)
 * 2 #.......E#   the hatch (8,2)
 * 3 ##########
 */
const corridor: Mission = parseMission({
  id: 'korridor',
  title: 'Korridor',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 3 },
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins' },
    { type: 'button-sync', id: 'zwei', title: 'Zwei' },
  ],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'zwei', x: 5, y: 1 },
    ],
    items: [
      {
        id: 'sicherung',
        label: 'SICHERUNG',
        x: 1,
        y: 1,
        deliverTo: { x: 8, y: 1 },
        requiredFor: 'zwei',
      },
    ],
    exit: { x: 8, y: 2 },
    sabotage: {
      mode: 'relay',
      label: 'STEUERUNG SPINNT',
      hint: 'Anweisungen laut vorlesen!',
      durationSec: 45,
      penaltySec: 60,
    },
  },
});

/** A run of the corridor for `names`, p1 … pn, the first the host. */
function crew(names: string[]): GameState {
  const ids = names.map((_, i) => `p${i + 1}`);
  return run(
    [
      ...names.map((name, i): Action => ({ type: 'player-join', playerId: ids[i] ?? '', name })),
      ...ids.slice(1).map((playerId) => ready(playerId)),
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(corridor),
  );
}

const three = crew(['Anna', 'Ben', 'Cem']);
const pick = (playerId: string): Action => ({
  type: 'pick-item',
  playerId,
  itemId: 'sicherung',
  at: T0 + 500,
});

describe('giving the seat up in a run', () => {
  it('leaves its crew, which goes on above the mission’s smallest', () => {
    const atStation = standing(three, { stations: { eins: ['p1', 'p3'] }, signSeen: ['p3'] });
    const left = run([abandon('p3', T0 + 1000, { x: 2.5, y: 1.5 })], atStation);
    expect(left.phase).toBe('playing');
    expect(left.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(left.presence.stations).toEqual({ eins: ['p1'] });
    expect(left.presence.signSeen).toEqual([]);
    expect(crewOf(left).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(viewFor(left, 'p1').players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
  });

  it('puts down what they carried where they stood, on their spawn where unknown', () => {
    const carrying = run([pick('p3')], three);
    const there = run([abandon('p3', T0 + 1000, { x: 6.2, y: 2.4 })], carrying);
    expect(there.items['sicherung']).toMatchObject({ carriedBy: null, x: 6.2, y: 2.4 });
    const spawn = carrying.players.find((p) => p.id === 'p3')?.spawn;
    const unknown = run([abandon('p3', T0 + 1000)], carrying);
    expect(unknown.items['sicherung']).toMatchObject({
      carriedBy: null,
      x: (spawn?.x ?? 0) + 0.5,
      y: (spawn?.y ?? 0) + 0.5,
    });
  });

  it('ends the run for everyone below the smallest crew, its card naming who left', () => {
    const two = crew(['Anna', 'Ben']);
    const over = run([abandon('p2', T0 + 4000)], two);
    expect(over.phase).toBe('lost');
    expect(over.calledOff).toBe('Ben hat den Einsatz verlassen.');
    expect(over.events.at(-1)).toMatchObject({
      kind: 'finish',
      label: 'Ben hat den Einsatz verlassen.',
    });
    expect(runReport(over, 'ABCD')).toMatchObject({ outcome: 'lost:abandoned', crew: ['Anna'] });
    expect(viewFor(over, 'p1').calledOff).toBe('Ben hat den Einsatz verlassen.');
  });

  it('goes on at once where the run stood still for them', () => {
    const waiting = run([lineDrops('p3', T0 + 2000)], three);
    expect(waiting.paused).not.toBeNull();
    const left = run([abandon('p3', T0 + 32_000)], waiting);
    expect(left.paused).toBeNull();
    expect(left.away).toEqual({});
    expect(left.deadlineAt).toBe((three.deadlineAt ?? 0) + 30_000);
  });

  it('passes the host’s part on, in a run too', () => {
    const left = run([abandon('p1', T0 + 1000)], three);
    expect(left.players.map((p) => [p.id, p.isHost])).toEqual([
      ['p2', true],
      ['p3', false],
    ]);
  });

  it('ends the run below the smallest crew while an emergency runs at the relay', () => {
    const alarmed = run([{ type: 'sabotage-start', at: T0 + 5000 }], crew(['Anna', 'Ben']));
    expect(alarmed.sabotage?.emergency).toBeDefined();
    const over = run([abandon('p2', T0 + 6000)], alarmed);
    expect(over.phase).toBe('lost');
    expect(over.calledOff).toBe('Ben hat den Einsatz verlassen.');
    expect(over.players.map((p) => p.id)).toEqual(['p1']);
  });

  it('waits again for whoever it went on without, once too few are on the line', () => {
    const gone = run(
      [
        lineDrops('p3', T0 + 1000),
        { type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 61_000 },
      ],
      three,
    );
    expect(gone.paused).toBeNull();
    const left = run([abandon('p2', T0 + 70_000)], gone);
    expect(left.phase).toBe('playing');
    expect(left.paused).toEqual({ since: T0 + 70_000 });
    expect(left.away).toEqual({
      p3: { since: T0 + 70_000, waivableAt: T0 + 70_000 + LATER_WAIT_MS, waived: false },
    });
    expect(viewFor(left, 'p1').pausedFor?.map((away) => away.name)).toEqual(['Cem']);
    // Anna, alone on the line, calls it off once the new wait is over.
    const early = { type: 'call-off', playerId: 'p1', at: T0 + 75_000 } as const;
    expect(() => run([early], left)).toThrow(/Wartezeit/);
    const over = run([{ ...early, at: T0 + 70_000 + LATER_WAIT_MS }], left);
    expect(over.calledOff).toBe('Abgebrochen ohne Cem.');
  });

  it('rolls an emergency at the relay anew for the crew that is left', () => {
    const alarmed = run([{ type: 'sabotage-start', at: T0 + 5000 }], three);
    const before = alarmed.sabotage?.emergency;
    const left = run([abandon('p3', T0 + 6000)], alarmed);
    const after = left.sabotage?.emergency;
    expect(after?.endsAt).toBe(before?.endsAt);
    expect(new Set(after?.controls.map((c) => c.ownerId))).toEqual(new Set(['p1', 'p2']));
    expect(after?.instructions.map((i) => i.holderId)).toEqual(['p1', 'p2']);
    for (const id of ['p1', 'p2']) {
      const relay = viewFor(left, id).map?.sabotage?.relay;
      expect(relay?.instruction?.playerName).toMatch(/^(Anna|Ben)$/);
    }
  });
});

describe('the relay works on the crew the run counts', () => {
  /** The corridor's crew of three in an emergency, Cem's line down since T0 + 6 s. */
  const cemAway = run(
    [{ type: 'sabotage-start', at: T0 + 5000 }, lineDrops('p3', T0 + 6000)],
    three,
  );
  const without = run(
    [{ type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 66_000 }],
    cemAway,
  );
  const consoles = (state: GameState): Set<string> =>
    new Set(state.sabotage?.emergency?.controls.map((c) => c.ownerId));

  it('rolls it anew without whom the run went on without: no console, no instruction', () => {
    expect(consoles(cemAway)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(consoles(without)).toEqual(new Set(['p1', 'p2']));
    expect(without.sabotage?.emergency?.instructions.map((i) => i.holderId)).toEqual(['p1', 'p2']);
    const cem = viewFor(without, 'p3').map?.sabotage?.relay;
    expect(cem).toMatchObject({ controls: [], instruction: null });
    for (const id of ['p1', 'p2']) {
      const relay = viewFor(without, id).map?.sabotage?.relay;
      expect(relay?.instruction?.playerName).toMatch(/^(Anna|Ben)$/);
      // Three instructions a console of the crew it counts clear it, as the core counts them.
      expect(relay?.required).toBe(6);
    }
  });

  it('starts the fresh instructions’ clocks as the run goes on, not while it stood still', () => {
    const window = 12_000;
    for (const instruction of without.sabotage?.emergency?.instructions ?? []) {
      expect(instruction.expiresAt).toBe(T0 + 66_000 + window);
    }
    expect(without.sabotage?.emergency?.endsAt).toBe(
      (cemAway.sabotage?.emergency?.endsAt ?? 0) + 60_000,
    );
  });

  it('rolls it anew with a console for Cem once he is back', () => {
    const back = run([lineBack('p3', T0 + 70_000)], without);
    expect(back.paused).toBeNull();
    expect(consoles(back)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(viewFor(back, 'p3').map?.sabotage?.relay?.controls).toHaveLength(4);
    expect(back.sabotage?.emergency?.completed).toBe(without.sabotage?.emergency?.completed);
  });

  it('opens a later emergency with no console for whom the run went on without', () => {
    const calm = run(
      [
        lineDrops('p3', T0 + 1000),
        { type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 61_000 },
        { type: 'sabotage-start', at: T0 + 62_000 },
      ],
      three,
    );
    expect(consoles(calm)).toEqual(new Set(['p1', 'p2']));
    expect(calm.sabotage?.emergency?.instructions.map((i) => i.holderId)).toEqual(['p1', 'p2']);
  });

  it('rolls it for the crew the run waits for again once a give-up leaves one on the line', () => {
    const left = run([abandon('p2', T0 + 70_000)], without);
    expect(left.paused).not.toBeNull();
    expect(consoles(left)).toEqual(new Set(['p1', 'p3']));
  });

  it('ends with the run, however it ends: lost on time, given up, called off', () => {
    const alarmed = run([{ type: 'sabotage-start', at: T0 + 5000 }], three);
    expect(alarmed.sabotage?.emergency).toBeDefined();
    const timedOut = run([{ type: 'time-expired', at: T0 + 700_000 }], alarmed);
    const two = run([{ type: 'sabotage-start', at: T0 + 5000 }], crew(['Anna', 'Ben']));
    const givenUp = run([abandon('p2', T0 + 6000)], two);
    const calledOff = run(
      [lineDrops('p2', T0 + 6000), { type: 'call-off', playerId: 'p1', at: T0 + 66_000 }],
      two,
    );
    for (const over of [timedOut, givenUp, calledOff]) {
      expect(over.phase).toBe('lost');
      expect(over.sabotage).toBeNull();
    }
  });

  it('shows no console once the run is over, whoever left the end screen since', () => {
    const alarmed = run([{ type: 'sabotage-start', at: T0 + 5000 }], three);
    const over = run([{ type: 'time-expired', at: T0 + 700_000 }, abandon('p3')], three);
    // The run's end as it would stand had the emergency stayed on: its crew no longer matches.
    const kept = { ...over, sabotage: alarmed.sabotage };
    expect(viewForSpectator(kept).panels.every((panel) => panel.emergency === undefined)).toBe(
      true,
    );
    expect(viewFor(kept, 'p1').map).toBeNull();
  });

  it('leaves it be for a return the run waited for: the crew it counts is the same', () => {
    const waited = run([lineBack('p3', T0 + 20_000)], cemAway);
    expect(waited.sabotage?.emergency?.controls).toEqual(cemAway.sabotage?.emergency?.controls);
  });
});
