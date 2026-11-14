import { describe, expect, it } from 'vitest';
import {
  applyAction,
  crewOf,
  initialState,
  LATER_WAIT_MS,
  parseMission,
  RELAY_GRACE_MS,
  TAKEOVER_WAIT_MS,
  runReport,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import type { RelayState } from '../src/puzzles/relay.js';
import type { Spot } from '../src/reach.js';
import { consoleLab, lineBack, lineDrops, serverDown, standing, started, T0 } from './lab.js';

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
    const atStation = standing(three, {
      stations: { eins: ['p1', 'p3'] },
      plates: { platte: ['p2', 'p3'] },
      signSeen: ['p3'],
    });
    const left = run([abandon('p3', T0 + 1000, { x: 2.5, y: 1.5 })], atStation);
    expect(left.phase).toBe('playing');
    expect(left.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(left.presence.stations).toEqual({ eins: ['p1'] });
    expect(left.presence.plates).toEqual({ platte: ['p2'] });
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

describe('giving the seat up with somebody away', () => {
  it('goes on at once where the server’s maintenance stood it still for them alone', () => {
    const down = run([{ type: 'maintenance', at: T0 + 2000, waitFrom: T0 + 2000 }], three);
    const waiting = run([lineBack('p1', T0 + 5000), lineBack('p2', T0 + 5000)], down);
    expect(waiting.paused).not.toBeNull();
    const left = run([abandon('p3', T0 + 32_000)], waiting);
    expect(left.paused).toBeNull();
    expect(left.away).toEqual({});
    expect(left.deadlineAt).toBe((three.deadlineAt ?? 0) + 30_000);
  });

  it('counts again whoever it went on without, once too few are on the line', () => {
    const gone = run(
      [
        lineDrops('p3', T0 + 1000),
        { type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 61_000 },
      ],
      three,
    );
    const left = run([abandon('p2', T0 + 70_000)], gone);
    expect(left.phase).toBe('playing');
    expect(left.paused).toBeNull();
    expect(left.away).toEqual({
      p3: { since: T0 + 70_000, waivableAt: T0 + 70_000 + LATER_WAIT_MS, waived: false },
    });
    expect(crewOf(left).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(viewFor(left, 'p1').away.map((away) => away.name)).toEqual(['Cem']);
    // Anna, alone on the line, calls it off once the new wait is over.
    const early = { type: 'call-off', playerId: 'p1', at: T0 + 75_000 } as const;
    expect(() => run([early], left)).toThrow(/Wartezeit/);
    const over = run([{ ...early, at: T0 + 70_000 + LATER_WAIT_MS }], left);
    expect(over.calledOff).toBe('Abgebrochen ohne Cem.');
  });

  it('keeps a new device’s ask for a seat it waits for again', () => {
    const asked = run(
      [
        lineDrops('p3', T0 + 1000),
        { type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 61_000 },
        { type: 'takeover-claimed', playerId: 'p3', at: T0 + 65_000 },
      ],
      three,
    );
    const left = run([abandon('p2', T0 + 70_000)], asked);
    expect(left.away['p3']).toMatchObject({
      waived: false,
      claimUntil: T0 + 65_000 + TAKEOVER_WAIT_MS,
    });
    expect(viewFor(left, 'p1').takeovers?.map((ask) => ask.name)).toEqual(['Cem']);
  });

  it('holds on while nobody of the crew is back on the line: the run runs for nobody', () => {
    const allGone = run(
      [lineDrops('p1', T0 + 1000), lineDrops('p2', T0 + 2000), lineDrops('p3', T0 + 3000)],
      three,
    );
    expect(allGone.paused).toEqual({ since: T0 + 3000, kind: 'wartung' });
    const left = run([abandon('p3', T0 + 9000)], allGone);
    expect(left.phase).toBe('playing');
    expect(left.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(left.paused).toEqual(allGone.paused);
    expect(run([lineBack('p2', T0 + 12_000)], left).paused).toBeNull();
  });
});

/** The emergency's tick, once a second while it runs, as the room dispatches it. */
const tick = (at: number): Action => ({ type: 'sabotage-tick', at });

/** The moment Cem's line, down from T0 + 6 s, has been down long enough to lose his console. */
const GRACE_OVER = T0 + 6000 + RELAY_GRACE_MS;

/**
 * The corridor's crew of three: Ben's line down a moment at T0 + 1 s, the run's first drop; an
 * emergency from T0 + 5 s; Cem's line down at T0 + 6 s, a later drop of 20 s, and the
 * emergency's tick once his line has been down RELAY_GRACE_MS; the crew on without him once his
 * wait is over.
 */
const inEmergency = run(
  [
    lineDrops('p2', T0 + 1000),
    lineBack('p2', T0 + 2000),
    { type: 'sabotage-start', at: T0 + 5000 },
  ],
  three,
);
const cemDown = run([lineDrops('p3', T0 + 6000)], inEmergency);
const cemAway = run([tick(GRACE_OVER)], cemDown);
const without = run(
  [{ type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 26_000 }],
  cemAway,
);

/** The emergency at the relay under way in `state`; throws where none runs. */
function emergencyOf(state: GameState): RelayState {
  const emergency = state.sabotage?.emergency;
  if (emergency === undefined) {
    throw new Error('no emergency at the relay under way');
  }
  return emergency;
}

/** Whose consoles the emergency of `state` has. */
const consoles = (state: GameState): Set<string> =>
  new Set(emergencyOf(state).controls.map((c) => c.ownerId));

/** Who holds an instruction of the emergency of `state`, in the crew's order. */
const holders = (state: GameState): string[] =>
  emergencyOf(state).instructions.map((i) => i.holderId);

/** `playerId`'s relay console as their view of `state` shows it; null for none. */
const relayOf = (state: GameState, playerId: string) =>
  viewFor(state, playerId).map?.sabotage?.relay ?? null;

describe('the relay as a line drops and comes back', () => {
  it('rolls nothing for a page loaded anew: a line down a moment keeps its console', () => {
    expect(emergencyOf(cemDown)).toEqual(emergencyOf(inEmergency));
    const reloaded = run(
      [tick(T0 + 7000), tick(GRACE_OVER - 1), lineBack('p3', GRACE_OVER - 500)],
      cemDown,
    );
    expect(emergencyOf(reloaded)).toEqual(emergencyOf(inEmergency));
    expect(relayOf(cemDown, 'p1')?.instruction).toEqual(relayOf(inEmergency, 'p1')?.instruction);
  });

  it('rolls it anew at the tick once the line is down RELAY_GRACE_MS: no console for it', () => {
    expect(consoles(inEmergency)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(consoles(cemAway)).toEqual(new Set(['p1', 'p2']));
    expect(holders(cemAway)).toEqual(['p1', 'p2']);
    expect(relayOf(cemAway, 'p3')).toMatchObject({ controls: [], instruction: null });
    for (const id of ['p1', 'p2']) {
      const relay = relayOf(cemAway, id);
      expect(relay?.instruction?.playerName).toMatch(/^(Anna|Ben)$/);
      // Three instructions a console of the crew on the line clear it, as the core counts them.
      expect(relay?.required).toBe(6);
    }
    // Once: what comes after finds the consoles it was rolled with.
    const ticked = run([tick(GRACE_OVER + 1000)], cemAway);
    expect(emergencyOf(ticked).controls).toEqual(emergencyOf(cemAway).controls);
  });

  it('starts the fresh instructions’ clocks at the tick that rolled it, its deadline kept', () => {
    for (const instruction of emergencyOf(cemAway).instructions) {
      expect(instruction.expiresAt).toBe(GRACE_OVER + 12_000);
    }
    expect(emergencyOf(cemAway).endsAt).toBe(emergencyOf(inEmergency).endsAt);
  });

  it('leaves it be as the crew goes on without the one away: no console was his already', () => {
    expect(without.away['p3']?.waived).toBe(true);
    expect(emergencyOf(without)).toEqual(emergencyOf(cemAway));
  });

  it('rolls it anew with a console for Cem once he is back, waived or not', () => {
    for (const before of [cemAway, without]) {
      const back = run([lineBack('p3', T0 + 30_000)], before);
      expect(back.paused).toBeNull();
      expect(consoles(back)).toEqual(new Set(['p1', 'p2', 'p3']));
      expect(relayOf(back, 'p3')?.controls).toHaveLength(4);
      expect(emergencyOf(back).completed).toBe(emergencyOf(before).completed);
    }
  });

  it('opens a later emergency with no console for whoever is away, waived or not', () => {
    const dropped = run([lineDrops('p3', T0 + 1000)], three);
    const calm = run([{ type: 'sabotage-start', at: T0 + 1000 + RELAY_GRACE_MS }], dropped);
    const waived = run(
      [
        { type: 'continue-without', playerId: 'p1', absentId: 'p3', at: T0 + 61_000 },
        { type: 'sabotage-start', at: T0 + 62_000 },
      ],
      dropped,
    );
    for (const state of [calm, waived]) {
      expect(consoles(state)).toEqual(new Set(['p1', 'p2']));
      expect(holders(state)).toEqual(['p1', 'p2']);
    }
    // Opened while his page could be loading anew, it has his console until its tick after that.
    const early = run([{ type: 'sabotage-start', at: T0 + 2000 }], dropped);
    expect(consoles(early)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(consoles(run([tick(T0 + 1000 + RELAY_GRACE_MS)], early))).toEqual(
      new Set(['p1', 'p2']),
    );
  });
});

describe('the relay with few on the line, a give-up, the maintenance and the end', () => {
  /** Anna alone on the line: Ben's line down since T0 + 12 s, his grace over, Cem away. */
  const lone = run([lineDrops('p2', T0 + 12_000), tick(T0 + 12_000 + RELAY_GRACE_MS)], cemAway);

  it('keeps a console for each of the crew it counts while fewer than two are on the line', () => {
    expect(consoles(lone)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(consoles(run([lineBack('p2', T0 + 18_000)], lone))).toEqual(new Set(['p1', 'p2']));
  });

  it('holds it with the run while nobody is on the line: the first back finds it as it was', () => {
    const nobody = run([lineDrops('p1', T0 + 18_000), tick(T0 + 18_000 + RELAY_GRACE_MS)], lone);
    expect(nobody.paused).toEqual({ since: T0 + 18_000, kind: 'wartung' });
    expect(emergencyOf(nobody)).toEqual(emergencyOf(lone));
    const one = run([lineBack('p2', T0 + 24_000)], nobody);
    expect(one.paused).toBeNull();
    expect(emergencyOf(one).controls).toEqual(emergencyOf(lone).controls);
    // Its clocks moved on by the hold, 6 s.
    expect(emergencyOf(one).instructions.map((i) => i.expiresAt)).toEqual(
      emergencyOf(lone).instructions.map((i) => i.expiresAt + 6000),
    );
  });

  it('rolls it for the crew the run counts again once a give-up leaves one on the line', () => {
    const left = run([abandon('p2', T0 + 30_000)], without);
    expect(left.paused).toBeNull();
    expect(consoles(left)).toEqual(new Set(['p1', 'p3']));
  });

  it('keeps it through the server’s maintenance: the crew back finds it as it stood', () => {
    const down = run([serverDown(T0 + 12_000)], cemAway);
    expect(emergencyOf(down)).toEqual(emergencyOf(cemAway));
    const annaBack = run([lineBack('p1', T0 + 40_000)], down);
    expect(emergencyOf(annaBack)).toEqual(emergencyOf(cemAway));
    const back = run([lineBack('p2', T0 + 41_000)], annaBack);
    expect(back.paused).toBeNull();
    expect(emergencyOf(back).controls).toEqual(emergencyOf(cemAway).controls);
    // Its clocks moved on by the pause, 29 s.
    expect(emergencyOf(back).instructions.map((i) => i.expiresAt)).toEqual(
      emergencyOf(cemAway).instructions.map((i) => i.expiresAt + 29_000),
    );
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
});
