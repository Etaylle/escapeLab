import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkMission,
  DIFFICULTIES,
  missionSchema,
  nudgeDueAt,
  parseMission,
  runReport,
  runSeconds,
  scaleMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState, Mission } from '../src/index.js';
import { everyConsole, labMission, openLab, standing, started, T0 } from './lab.js';

/**
 * A corridor lab of three stations the whole crew presses — Eins (3,1), Zwei (7,1), Drei
 * (11,1) — taken in any order, the hatch at its east end.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..1...2...3...#   spawns (1,1) and (1,2)
 * 2 #.............E#   the hatch (14,2)
 * 3 ################
 */
function freeLabData(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'frei',
    title: 'Freie Reihenfolge',
    order: 'free',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'zwei', title: 'Zwei' },
      { type: 'button-sync', id: 'drei', title: 'Drei' },
    ],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations: [
        { puzzleId: 'eins', x: 3, y: 1 },
        { puzzleId: 'zwei', x: 7, y: 1 },
        { puzzleId: 'drei', x: 11, y: 1 },
      ],
      exit: { x: 14, y: 2 },
    },
    ...changes,
  };
}

/** The lab as the game takes it, `changes` made to its file. */
const freeLab = (changes: Record<string, unknown> = {}): Mission =>
  parseMission(freeLabData(changes));

/** Both of the crew at station `id`, E pressed there at `at`. */
function switchOn(state: GameState, id: string, at: number): GameState {
  const here = standing(state, { stations: { [id]: ['p1', 'p2'] } });
  return applyAction(here, { type: 'interact', playerId: 'p1', at });
}

/** Both press the open station at `at`, which solves a station the whole crew presses. */
function pressTogether(state: GameState, at: number): GameState {
  return ['p1', 'p2'].reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    state,
  );
}

/** The station `id` switched on and solved at `at`. */
function take(state: GameState, id: string, at: number): GameState {
  return pressTogether(switchOn(state, id, at), at);
}

/** The status of every station on p1's map, by puzzle id. */
function statuses(state: GameState): Record<string, string> {
  const stations = viewFor(state, 'p1').map?.stations ?? [];
  return Object.fromEntries(
    stations.map((s) => [s.puzzleId, 'status' in s ? s.status : 'glimpsed']),
  );
}

/** The ids of the run's puzzles in the run's order. */
const order = (state: GameState): string[] => state.mission.puzzles.map((p) => p.id);

describe('free order: the mission file', () => {
  it('takes the stations in a chain unless it says otherwise', () => {
    expect(missionSchema.parse({ ...freeLab(), order: undefined }).order).toBe('chain');
    expect(freeLab().order).toBe('free');
  });

  it('knows two orders and no third', () => {
    const checked = checkMission(freeLabData({ order: 'zufall' }));
    expect(checked.ok).toBe(false);
    expect(checked.ok ? [] : checked.issues.join('\n')).toMatch(/^order: /m);
  });

  it('takes 0 s on the clock for a mission without one, and no less', () => {
    expect(freeLab({ timeLimitSec: 0 }).timeLimitSec).toBe(0);
    for (const timeLimitSec of [-1, 1.5]) {
      expect(checkMission(freeLabData({ timeLimitSec })).ok, `${timeLimitSec}`).toBe(false);
    }
  });
});

/**
 * Two rooms joined by a door that solving Eins opens: Eins (2,1) where both start, the
 * wiring box Zwei (8,1) behind the door, its book (3,2) and the sign (2,2) in the first room.
 *
 *   01234567890
 * 0 ###########
 * 1 #.1..D..2.#   spawns (1,1) and (1,2); the door (5,1)
 * 2 #.SB.#....#
 * 3 ###########
 */
function twoRooms(
  order: 'chain' | 'free',
  changes: { manuals?: object[]; stations?: object[] } = {},
) {
  return {
    id: 'zwei-raeume',
    title: 'Zwei Räume',
    order,
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'wiring', id: 'zwei', title: 'Zwei' },
    ],
    map: {
      tiles: ['###########', '#.........#', '#....#....#', '###########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      doors: [{ id: 'tuer', x: 5, y: 1, opensBy: { kind: 'puzzle', puzzleId: 'eins' } }],
      stations: changes.stations ?? [
        { puzzleId: 'eins', x: 2, y: 1 },
        { puzzleId: 'zwei', x: 8, y: 1 },
      ],
      manuals: changes.manuals ?? [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['zwei'],
          spots: [{ x: 3, y: 2 }],
        },
      ],
      edgeworkSign: { x: 2, y: 2 },
    },
  };
}

/** What validation says of a mission file: its issues, one a line; none for a sound one. */
function issuesOf(data: unknown): string {
  const checked = checkMission(data);
  return checked.ok ? '' : checked.issues.join('\n');
}

describe('free order: validation', () => {
  it('lets a chain keep a station behind the door an earlier solve opens', () => {
    expect(issuesOf(twoRooms('chain'))).toBe('');
  });

  it('needs every station in reach from the start, as any may come first', () => {
    expect(issuesOf(twoRooms('free'))).toContain(
      'map: nobody can reach station "zwei" with nothing solved yet, as any station may come first',
    );
  });

  it('needs every source in reach from the start, not once an earlier solve opens its door', () => {
    const manuals = [
      { id: 'buch', kind: 'book', label: 'HANDBUCH', puzzleIds: ['zwei'], spots: [{ x: 8, y: 2 }] },
    ];
    const stations = [
      { puzzleId: 'eins', x: 2, y: 1 },
      { puzzleId: 'zwei', x: 3, y: 1 },
    ];
    expect(issuesOf(twoRooms('chain', { manuals, stations }))).toBe('');
    expect(issuesOf(twoRooms('free', { manuals, stations }))).toContain(
      'map: nobody can reach manual object "buch" at 8,2 while puzzle "zwei" is open',
    );
  });

  it('needs two players who can man both consoles of a station from the start', () => {
    const mission = {
      ...twoRooms('free'),
      puzzles: [
        { type: 'button-sync', id: 'eins', title: 'Eins' },
        { type: 'signal', id: 'zwei', title: 'Zwei' },
      ],
    };
    const consoles = [
      { puzzleId: 'eins', x: 2, y: 1 },
      { puzzleId: 'zwei', x: 3, y: 1, console: 'a' },
      { puzzleId: 'zwei', x: 8, y: 1, console: 'b' },
    ];
    const free = { ...mission, map: { ...mission.map, stations: consoles } };
    expect(issuesOf(free)).toContain(
      'map: nobody can reach console b of station "zwei" with nothing solved yet',
    );
    expect(issuesOf({ ...free, order: 'chain' })).toBe('');
  });

  it('takes a lab whose every station and source the crew reaches from the start', () => {
    expect(issuesOf(freeLab())).toBe('');
  });
});

describe('free order: the run', () => {
  const fresh = started(freeLab());
  // The crew has come across every console, so that every view lists every station.
  const running = standing(fresh, { found: { p1: everyConsole(fresh) } });

  it('arms every station from the start, and tells every view the order is free', () => {
    expect(statuses(running)).toEqual({ eins: 'armed', zwei: 'armed', drei: 'armed' });
    expect(viewFor(running, 'p1').freeOrder).toBe(true);
    expect(viewFor(started(freeLab({ order: 'chain' })), 'p1').freeOrder).toBeUndefined();
  });

  it('switches on the station the crew stands at, which comes up first', () => {
    const drei = switchOn(running, 'drei', T0 + 1000);
    expect(order(drei)).toEqual(['drei', 'zwei', 'eins']);
    expect(drei.currentPuzzleIndex).toBe(0);
    expect(drei.picked).toBe(true);
    expect(viewFor(drei, 'p1').puzzle?.title).toBe('Drei');
    expect(statuses(drei)).toEqual({ eins: 'locked', zwei: 'locked', drei: 'armed' });
  });

  it('keeps the station switched on as the crew’s until it is solved', () => {
    const drei = switchOn(running, 'drei', T0 + 1000);
    expect(() => switchOn(drei, 'eins', T0 + 2000)).toThrow('Die Station läuft schon.');
  });

  it('arms every station still to solve again once one is solved', () => {
    const solved = take(running, 'drei', T0 + 1000);
    expect(solved.currentPuzzleIndex).toBe(1);
    expect(solved.picked).toBe(false);
    expect(statuses(solved)).toEqual({ eins: 'armed', zwei: 'armed', drei: 'done' });
  });

  it('switches nothing on at a station already solved', () => {
    const solved = take(running, 'drei', T0 + 1000);
    expect(() => switchOn(solved, 'drei', T0 + 2000)).toThrow('Hier gibt es nichts zu aktivieren.');
  });

  it('is solved in any order and opens the hatch with the last, the escape winning it', () => {
    const steps = [
      ['drei', T0 + 1000],
      ['eins', T0 + 2000],
      ['zwei', T0 + 3000],
    ] as const;
    const last = steps.reduce((state, [id, at]) => take(state, id, at), running);
    expect(order(last)).toEqual(['drei', 'eins', 'zwei']);
    expect(last.phase).toBe('playing');
    expect(viewFor(last, 'p1').map?.exit?.open).toBe(true);
    const out = applyAction(standing(last, { exit: ['p1', 'p2'] }), {
      type: 'escaped',
      at: T0 + 4000,
    });
    expect(out.phase).toBe('won');
    const stations = runReport(out, 'ABCD').stations.map((s) => s.puzzleId);
    expect(stations).toEqual(['drei', 'eins', 'zwei']);
  });

  it('is won with the last solve where the mission has no hatch, every station counted', () => {
    const noHatch = started(freeLab({ map: { ...freeLab().map, exit: undefined } }));
    const won = ['zwei', 'drei', 'eins'].reduce(
      (state, id, i) => take(state, id, T0 + 1000 * (i + 1)),
      noHatch,
    );
    expect(won.phase).toBe('won');
    expect(won.events.at(-1)?.label).toBe('Alle Systeme online');
    // Every screen counts the stations solved by the index: the last one too.
    expect(won.currentPuzzleIndex).toBe(3);
    expect(viewFor(won, 'p1').currentPuzzleIndex).toBe(3);
    expect(viewForSpectator(won).currentPuzzleIndex).toBe(3);
  });

  it('deals a station the same whichever order the crew takes it in', () => {
    const lab = parseMission({
      ...twoRooms('free'),
      map: { ...twoRooms('free').map, doors: [] },
    });
    const kabel = (state: GameState) => {
      const here = standing(state, { stations: { zwei: ['p1'] }, manuals: { buch: ['p2'] } });
      return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 5000 }).puzzleState;
    };
    const fresh = started(lab, 11);
    const first = kabel(fresh);
    const second = kabel(take(fresh, 'eins', T0 + 1000));
    expect(first?.type).toBe('wiring');
    expect(second).toEqual(first);
  });

  it('keeps mission control quiet until the crew has switched a station on', () => {
    const quiet = started(
      freeLab({
        puzzles: freeLab().puzzles.map((p) => ({ ...p, nudges: ['Zum Pult im Flur.'] })),
      }),
    );
    expect(quiet.quietSince).toBeNull();
    expect(switchOn(quiet, 'zwei', T0 + 1000).quietSince).toBe(T0 + 1000);
  });
});

describe('a mission without a clock', () => {
  const clockless = freeLab({ timeLimitSec: 0, order: 'chain' });
  const running = started(clockless);

  it('sets no deadline and counts up from the lights going out, which every view tells', () => {
    expect(running.deadlineAt).toBeNull();
    expect(running.clockFrom).toBe(T0);
    expect(viewFor(running, 'p1').clockFrom).toBe(T0);
    expect(viewFor(started(freeLab()), 'p1').clockFrom).toBeUndefined();
  });

  it('counts an alarm without taking time, and goes on', () => {
    const caught = applyAction(running, {
      type: 'drone-spotted',
      at: T0 + 5000,
      penaltySec: 15,
      playerId: 'p1',
    });
    expect(caught.phase).toBe('playing');
    expect(caught.penaltySeq).toBe(1);
    expect(caught.deadlineAt).toBeNull();
    expect(caught.lastPenaltySec).toBeNull();
    expect(caught.events.at(-1)).toMatchObject({ kind: 'penalty', seconds: null });
  });

  it('moves the clock’s start on by a pause, so that it stands still meanwhile', () => {
    const away = applyAction(running, {
      type: 'player-disconnected',
      playerId: 'p2',
      at: T0 + 10_000,
    });
    const back = applyAction(away, { type: 'player-connected', playerId: 'p2', at: T0 + 40_000 });
    expect(back.clockFrom).toBe(T0 + 30_000);
  });

  it('records the time run in the report, and grades it by alarms and notes alone', () => {
    const late = T0 + 3 * 3600_000;
    const solved = ['eins', 'zwei', 'drei'].reduce((state, id) => take(state, id, late), running);
    const out = applyAction(standing(solved, { exit: ['p1', 'p2'] }), {
      type: 'escaped',
      at: late,
    });
    const report = runReport(out, 'ABCD');
    expect(out.phase).toBe('won');
    expect(report.timeLimitSec).toBe(0);
    expect(runSeconds(report)).toBe(3 * 3600);
    // Time to spare would be a word too many: nothing ran out.
    expect(viewFor(out, 'p1').grade).toEqual({
      rank: 'S',
      label: 'Makellos — kein einziger Alarm, keine Notiz gebraucht',
    });
  });

  it('grades a run without a hatch in words it can bear: nobody had to get out', () => {
    const noHatch = started(freeLab({ map: { ...freeLab().map, exit: undefined } }));
    const won = ['eins', 'zwei', 'drei'].reduce((state, id) => take(state, id, T0 + 1000), noHatch);
    // Two alarms, as a drone or a wrong move would have cost: the third rank.
    const shaky = { ...won, penaltySeq: 2 };
    expect(viewFor(shaky, 'p1').grade).toEqual({
      rank: 'B',
      label: 'Solide — es hat gewackelt, aber jede Station ist abgenommen',
    });
    const throughTheHatch = viewFor({ ...shaky, mission: freeLab() }, 'p1').grade;
    expect(throughTheHatch?.label).toBe('Solide — es hat gewackelt, aber alle sind draußen');
  });

  it('gives the notes of the last shift for no time, and mission control names no place', () => {
    const lab = (timeLimitSec: number) =>
      parseMission({
        ...labMission([
          {
            type: 'wiring',
            id: 'kabel',
            title: 'Kabel',
            hints: ['Erst zählen.'],
            nudges: ['Los.'],
          },
        ]),
        timeLimitSec,
      });
    const timed = openLab(started(lab(600)));
    expect(nudgeDueAt(timed)).not.toBeNull();
    const open = openLab(started(lab(0)));
    expect(nudgeDueAt(open)).toBeNull();
    const ready = (open.hintReadyAt ?? 0) + 1;
    const asked = applyAction(open, { type: 'request-hint', playerId: 'p2', at: ready });
    expect(asked.hintsUsed).toBe(1);
    expect(asked.deadlineAt).toBeNull();
    const note = { kind: 'hint', label: 'Erst zählen.', seconds: null };
    expect(asked.events.at(-1)).toMatchObject(note);
    expect(viewFor(open, 'p2').manualsHere[0]?.sections[0]?.costSec).toBe(0);
    expect(viewFor(timed, 'p2').manualsHere[0]?.sections[0]?.costSec).toBe(20);
  });

  it('keeps no clock at every difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      expect(scaleMission(clockless, difficulty).timeLimitSec, difficulty).toBe(0);
      expect(scaleMission(freeLab(), difficulty).timeLimitSec, difficulty).toBeGreaterThan(0);
    }
  });
});
