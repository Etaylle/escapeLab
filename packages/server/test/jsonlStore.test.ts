import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialState,
  parseMission,
  runReport,
  type Mission,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';
import { RoomManager } from '../src/roomManager.js';
import type { Room } from '../src/room.js';
import { appendLine, JsonlStore, parseRuns, readRuns } from '../src/store/jsonl.js';
import { recordRuns, type FinishedRun, type LoggedRun } from '../src/store/store.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';
import { DAY, finished, reportOf, seatPassOf, storeContract } from './storeContract.js';

/**
 * Two presses for the whole crew along a corridor and the hatch between
 * them, below.
 *
 *   0123456
 * 0 #######
 * 1 #.1.2.#   stations (2,1) and (4,1); spawns (1,1) and (5,1)
 * 2 #..H..#   hatch (3,2)
 * 3 #######
 */
const mission: Mission = parseMission({
  id: 'protokollraum',
  title: 'Protokoll-Raum',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: ['erste', 'zweite'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['#######', '#.....#', '#.....#', '#######'],
    spawns: [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
    ],
    stations: [
      { puzzleId: 'erste', x: 2, y: 1 },
      { puzzleId: 'zweite', x: 4, y: 1 },
    ],
    exit: { x: 3, y: 2 },
  },
});

/** A report as a finished run leaves one: this lab, lost on time before anybody joined in. */
function someReport(): RunReport {
  const lost = { ...initialState(mission), phase: 'lost' as const, startedAt: 1, finishedAt: 2 };
  return runReport(lost, 'QXT4');
}

/** `report` as version 1 wrote it, before names and the room went in. */
function asVersion1(report: RunReport): string {
  const old: Record<string, unknown> = { ...report, version: 1 };
  delete old['crew'];
  delete old['roomCode'];
  return JSON.stringify(old);
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'escapelab-runs-'));
});

const linesOf = (file: string): string[] => readFileSync(file, 'utf8').trimEnd().split('\n');

storeContract('the run log with the accounts in memory', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'escapelab-store-')), 'runs.jsonl');
  return { store: JsonlStore.open(file), reopen: async () => JsonlStore.open(file) };
});

describe('appendLine', () => {
  it('puts every run on a line of its own, in a directory made on demand', () => {
    const file = join(dir, 'neu', 'tief', 'runs.jsonl');
    appendLine(file, someReport());
    appendLine(file, someReport());
    expect(linesOf(file).map((line) => JSON.parse(line))).toEqual([someReport(), someReport()]);
  });

  it('throws for a write that fails, naming the file and what to do', () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const file = join(blocker, 'runs.jsonl');
    expect(() => appendLine(file, someReport())).toThrow(file);
    expect(() => appendLine(file, someReport())).toThrow(/point RUNS_LOG at a writable file$/);
  });
});

describe('parseRuns', () => {
  it('reads the runs back in order, past blank lines', () => {
    const report = someReport();
    const text = `${JSON.stringify(report)}\n\n${JSON.stringify({ ...report, startedAt: 5 })}\n`;
    expect(parseRuns(text, 'runs.jsonl').map((run) => run.startedAt)).toEqual([1, 5]);
    expect(parseRuns('', 'runs.jsonl')).toEqual([]);
  });

  it('reads the reports of version 1, without names, and of version 2 side by side', () => {
    const report = someReport();
    const text = `${asVersion1(report)}\n${JSON.stringify({ ...report, crew: ['Anna', 'Ben'] })}\n`;
    const [old, named] = parseRuns(text, 'runs.jsonl');
    expect(old).toMatchObject({ version: 1, missionId: 'protokollraum' });
    expect(old).not.toHaveProperty('crew');
    expect(named).toMatchObject({ version: 2, roomCode: 'QXT4', crew: ['Anna', 'Ben'] });
  });

  it('names the line that is no run report', () => {
    const good = JSON.stringify(someReport());
    expect(() => parseRuns(`${good}\n{"version":2,`, 'runs.jsonl')).toThrow(
      /^runs\.jsonl:2: not JSON/,
    );
    const broken = [
      good.replace('"version":2', '"version":3'),
      // version 2 without its names, or with a name that is none
      asVersion1(someReport()).replace('"version":1', '"version":2'),
      good.replace('"crew":[]', '"crew":[7]'),
      good.replace('"difficulty":"normal"', '"difficulty":"extrem"'),
      good.replace('"outcome":"lost:time"', '"outcome":"vielleicht"'),
      // a moment past every day: JSON's 1e999 is Infinity
      good.replace(/"startedAt":\d+/, '"startedAt":1e999'),
      good.replace(/"finishedAt":\d+/, '"finishedAt":-1e999'),
      '[1,2]',
    ];
    for (const line of broken) {
      expect(() => parseRuns(`${good}\n${line}`, 'r'), line).toThrow(
        /^r:2: not a run report of version 1 or 2 — fix or delete that line$/,
      );
    }
  });

  it('reads on past a line that holds no run, for whoever must not stop at it', () => {
    const good = JSON.stringify(someReport());
    const { runs, problems } = readRuns(`${good}\nkaputt\n\n${good}\n{}`, 'runs.jsonl');
    expect(runs).toHaveLength(2);
    expect(problems).toEqual([
      expect.stringMatching(/^runs\.jsonl:2: not JSON/),
      'runs.jsonl:5: not a run report of version 1 or 2 — fix or delete that line',
    ]);
  });
});

describe('the run log opened as the store', () => {
  /** The stats of Blackout at normal. */
  const normal = (store: JsonlStore) =>
    store.stats().mission('blackout')?.difficulties.find((d) => d.difficulty === 'normal');

  it('starts empty where there is no log yet', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(JsonlStore.open(join(dir, 'runs.jsonl')).stats().runs).toBe(0);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('counts a log of both versions, as the server shipped it', () => {
    const fixture = fileURLToPath(new URL('./fixtures/runs.jsonl', import.meta.url));
    const stats = JsonlStore.open(fixture).stats();
    expect(stats.runs).toBe(7);
    const systemcheck = stats
      .mission('systemcheck')
      ?.difficulties.find((level) => level.difficulty === 'normal');
    expect(systemcheck).toMatchObject({
      runs: 4,
      wins: 2,
      bestSeconds: 300,
      medianSeconds: 330,
      top: [
        { crew: [], seconds: 300, alarms: 1 },
        { crew: ['Anna', 'Ben'], seconds: 360, alarms: 3 },
      ],
    });
    const hart = stats.mission('blackout')?.difficulties.find((d) => d.difficulty === 'hart');
    expect(hart?.top).toMatchObject([{ crew: ['Cleo', 'Dan'] }]);
  });

  it('leaves out each line that holds no run, and says which', () => {
    const file = join(dir, 'runs.jsonl');
    const good = JSON.stringify(reportOf());
    // A run of the Tagesschicht starting at no moment has no day to be ranked on.
    const dayless = JSON.stringify({ ...reportOf(), daily: true, startedAt: 7 });
    const never = dayless.replace('"startedAt":7', '"startedAt":1e999');
    writeFileSync(file, `${good}\n{"version":2,\n${good}\n{"version":9}\n${never}\n`);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(JsonlStore.open(file).stats().runs).toBe(2);
      expect(logged.mock.calls.map(([line]) => String(line))).toEqual([
        expect.stringMatching(/runs\.jsonl:2: not JSON .*\(the Bestenliste leaves it out\)$/),
        expect.stringMatching(/runs\.jsonl:4: not a run report .*\(the Bestenliste leaves it ou/),
        expect.stringMatching(/runs\.jsonl:5: not a run report .*\(the Bestenliste leaves it ou/),
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it('starts empty, saying why, where the log cannot be read', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // A directory where the log should be.
      expect(JsonlStore.open(dir).stats().runs).toBe(0);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(`run log ${dir} not read`));
    } finally {
      logged.mockRestore();
    }
  });

  it('counts each run as it is kept, and never reads the log again for the stats', async () => {
    const file = join(dir, 'runs.jsonl');
    writeFileSync(file, `${JSON.stringify(reportOf({ seconds: 300 }))}\n`);
    const store = JsonlStore.open(file);
    // Whatever else lands in the log afterwards is not counted ...
    appendFileSync(file, `${JSON.stringify(reportOf({ seconds: 100, at: DAY + 1 }))}\n`);
    expect(store.stats().runs).toBe(1);
    // ... only what the store keeps itself, which it writes first.
    await store.appendRun(finished({ seconds: 200, at: DAY + 2, crew: ['Cleo'] }, [null]));
    expect(store.stats().runs).toBe(2);
    expect(linesOf(file)).toHaveLength(3);
    expect(normal(store)?.top.map((entry) => entry.crew)).toEqual([['Cleo'], ['Anna', 'Ben']]);
  });

  it('counts no run it could not write, and says why', async () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const store = JsonlStore.open(join(blocker, 'runs.jsonl'));
    await expect(store.appendRun(finished({}, [null, null]))).rejects.toThrow('RUNS_LOG');
    expect(store.stats().runs).toBe(0);
  });
});

/** `name` joins, and everything the room pushes to them is kept. */
function seat(room: Room, name: string): Walker {
  const messages: ServerMessage[] = [];
  const { playerId } = room.join(name, passFor(name));
  room.attach(playerId, (m) => messages.push(m));
  return { playerId, messages };
}

function phaseOf(walker: Walker): string | undefined {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  return last?.kind === 'view' ? last.view.phase : undefined;
}

describe('a room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const moveTo = (room: Room, walker: Walker, x: number, y: number): void =>
    walkTo(room, walker, x + 0.5, y + 0.5);

  /** Both at the station, switched on, both press. */
  function solveAt(room: Room, x: number, anna: Walker, ben: Walker): void {
    moveTo(room, ben, x, 1);
    moveTo(room, anna, x, 2);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
  }

  /** A room of the manager whose runs go to the store over `file`, with Anna and Ben under way. */
  function startedRoom(file: string) {
    const recorder = recordRuns(JsonlStore.open(file));
    const room = new RoomManager(recorder.record).create(mission);
    const anna = seat(room, 'Anna');
    const ben = seat(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben, recorder };
  }

  it('keeps a line for every run that ends, a rematch on its own line', async () => {
    const file = join(dir, 'runs.jsonl');
    const { room, anna, ben, recorder } = startedRoom(file);
    expect(existsSync(file)).toBe(false);

    // The first run runs out of time.
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
    expect(phaseOf(anna)).toBe('lost');
    await recorder.settled();
    expect(linesOf(file)).toHaveLength(1);

    // Both confirm, the rematch starts by itself, and this time the crew gets out.
    room.setReady(ben.playerId, true);
    room.setReady(anna.playerId, true);
    vi.advanceTimersByTime(10_000);
    solveAt(room, 2, anna, ben);
    vi.advanceTimersByTime(20_000);
    solveAt(room, 4, anna, ben);
    moveTo(room, ben, 3, 2);
    moveTo(room, anna, 3, 2);
    expect(phaseOf(anna)).toBe('won');
    await recorder.settled();

    const text = readFileSync(file, 'utf8');
    const [lost, won, ...more]: LoggedRun[] = parseRuns(text, file);
    expect(more).toEqual([]);
    expect(lost).toMatchObject({ missionId: 'protokollraum', outcome: 'lost:time', crewSize: 2 });
    const rematchAt = (lost?.finishedAt ?? 0) + 1;
    expect(won).toMatchObject({
      outcome: 'won',
      startedAt: rematchAt,
      finishedAt: rematchAt + 30_000,
      stations: [
        { puzzleId: 'erste', openedAt: rematchAt, seconds: 10, alarms: 0 },
        { puzzleId: 'zweite', openedAt: rematchAt + 10_000, seconds: 20, alarms: 0 },
      ],
    });
    // The crew goes by the names it played under, in the order it joined, and the room by its
    // code; nobody by id, nor by pass.
    for (const run of [lost, won]) {
      expect(run).toMatchObject({ version: 2, roomCode: room.code, crew: ['Anna', 'Ben'] });
    }
    for (const id of [anna.playerId, ben.playerId, passFor('Anna').id, passFor('Ben').id]) {
      expect(text).not.toContain(id);
    }
    room.dispose();
  });

  it('hands the store the pass that held each seat, in the order of the crew', () => {
    const runs: FinishedRun[] = [];
    const room = new RoomManager((run) => runs.push(run)).create(mission);
    const anna = seat(room, 'Anna');
    const ben = seat(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
    // Each by its id and the hash of the secret its seat was bound with: an id alone is no pass.
    expect(runs.map((run) => run.passes)).toEqual([[seatPassOf('Anna'), seatPassOf('Ben')]]);
    room.dispose();
  });

  it('plays on when the line cannot be written, the log saying why', async () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { room, anna, recorder } = startedRoom(join(blocker, 'runs.jsonl'));
      vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
      expect(phaseOf(anna)).toBe('lost');
      await recorder.settled();
      expect(logged).toHaveBeenCalledOnce();
      expect(String(logged.mock.calls[0]?.[0])).toMatch(
        /^\[escapelab\] run of protokollraum not kept: run report not written to .*RUNS_LOG/,
      );
      room.dispose();
    } finally {
      logged.mockRestore();
    }
  });
});
