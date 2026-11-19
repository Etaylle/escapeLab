import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_CODE,
  DEMO_PINS,
  moduleFor,
  type DemoDoing,
  type DemoShot,
  type ServerMessage,
} from '@escapelab/core';
import {
  direct,
  MOVE_HOLDS_MS,
  OVERVIEW_SHOT_MS,
  SEAT_SHOT_MS,
  SOLVED_SHOT_MS,
  type Cut,
  type Scene,
} from '../src/demo/director.js';
import { captionFrom, WORKSHOP } from '../src/demo/caption.js';
import { SAID_MS } from '../src/demo/crew.js';
import { DemoHost } from '../src/demo/host.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import { DEMO_PIN_ONLY, serveSockets } from '../src/sockets.js';
import { blackoutMission } from './demo.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/**
 * The demo's director and its feed: which picture is on air by what the crew does (a table of
 * scenes), how a whole run is cut, what a viewer is sent — the view of the seat on air or of
 * the seat it pinned — and that no other room's audience is ever sent a seat's view.
 */

const mission = blackoutMission();
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));
const T0 = Date.UTC(2026, 10, 19, 22, 0, 0);

beforeEach(() => {
  const toFake = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
  vi.useFakeTimers({ toFake: [...toFake] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type What = DemoDoing['what'];

/** A scene of a run on, long after its last cut: seats `a` and `b` doing `one` and `other`. */
function scene(one: What, other: What, more: Partial<Scene> = {}): Scene {
  const seat = (id: string, what: What) => ({
    id,
    doing: { what, sourceId: what === 'read' ? 'buch' : null },
    actedAt: 0,
    drones: false,
  });
  const seats: Scene['seats'] = [seat('a', one), seat('b', other)];
  return { now: T0, phase: 'playing', opening: false, solvedAt: null, seats, ...more };
}

/** `scene` with drones about, or with the moves its seats last made (ms before now). */
const underDrones = (given: Scene): Scene => ({
  ...given,
  seats: given.seats.map((seat) => ({ ...seat, drones: true })) as unknown as Scene['seats'],
});
const moved = (given: Scene, a: number | null, b: number | null): Scene => {
  const [one, other] = given.seats;
  const at = (ago: number | null): number => (ago === null ? 0 : given.now - ago);
  return { ...given, seats: [{ ...one, actedAt: at(a) }, { ...other, actedAt: at(b) }] };
};

/** What comes on air for `given` where `was` has been on air for `ms`. */
const cutTo = (given: Scene, was: string | null, ms = 60_000): string | null =>
  direct(given, { onAir: was, since: given.now - ms }).onAir;

describe('the director’s table: the scene, and what it puts on air', () => {
  it.each<[string, Scene, string | null]>([
    ['the lobby is the whole lab’s', scene('idle', 'idle', { phase: 'lobby' }), null],
    ['the opening is the first seat’s', scene('intro', 'intro', { opening: true }), 'a'],
    ['the Auswertung of a win is the first seat’s', scene('idle', 'idle', { phase: 'won' }), 'a'],
    ['and of a loss', scene('idle', 'idle', { phase: 'lost' }), 'a'],
    ['who reads at a source is on air', scene('walk', 'read'), 'b'],
    ['who works a console is on air', scene('operate', 'idle'), 'a'],
    ['before a move, the reader beside a console', scene('operate', 'read'), 'b'],
    ['after a move, the console', moved(scene('operate', 'read'), 1000, null), 'a'],
    ['two consoles: the first seat before any move', scene('operate', 'operate'), 'a'],
    ['two consoles: who moved last', moved(scene('operate', 'operate'), 9000, 2000), 'b'],
    ['a walk with no drone about is the first seat’s', scene('walk', 'carry'), 'a'],
    ['a walk under the drones is the whole lab’s', underDrones(scene('idle', 'carry')), null],
    ['drones about change nothing at a console', underDrones(scene('operate', 'walk')), 'a'],
    ['the way out is the whole lab’s', scene('escape', 'escape'), null],
    ['a station just solved is the whole lab’s', scene('operate', 'read', { solvedAt: T0 }), null],
  ])('%s', (_name, given, onAir) => {
    expect(cutTo(given, onAir === 'a' ? 'b' : 'a')).toBe(onAir);
    // The first look of all cuts to it too.
    expect(direct(given, null)).toEqual({ onAir, since: T0 });
  });

  it('lets a move hold the console for a while, then goes back to the pages', () => {
    const work = scene('operate', 'read');
    expect(cutTo(moved(work, MOVE_HOLDS_MS - 1, null), 'b')).toBe('a');
    expect(cutTo(moved(work, MOVE_HOLDS_MS, null), 'a')).toBe('b');
  });

  it('shows a solve for a moment after it, and no longer', () => {
    const after = (ms: number): Scene => scene('walk', 'walk', { solvedAt: T0 - ms });
    expect(cutTo(after(SOLVED_SHOT_MS - 1), 'a')).toBeNull();
    expect(cutTo(after(SOLVED_SHOT_MS), null)).toBe('a');
  });

  it('cuts no faster than a viewer can follow: a seat stays its time, the lab its own', () => {
    const wantsB = scene('walk', 'read');
    const young: Cut = { onAir: 'a', since: T0 - (SEAT_SHOT_MS - 1) };
    expect(direct(wantsB, young)).toBe(young);
    expect(cutTo(wantsB, 'a', SEAT_SHOT_MS)).toBe('b');
    expect(cutTo(wantsB, null, OVERVIEW_SHOT_MS - 1)).toBeNull();
    expect(cutTo(wantsB, null, OVERVIEW_SHOT_MS)).toBe('b');
    // What is on air and wanted stays, its start kept.
    const old: Cut = { onAir: 'b', since: T0 - 30_000 };
    expect(direct(wantsB, old)).toBe(old);
  });

  it('cuts at once where the run’s phase turns, however young the picture', () => {
    expect(cutTo(scene('idle', 'idle', { phase: 'lobby' }), 'a', 10)).toBeNull();
    expect(cutTo(scene('intro', 'intro', { opening: true }), null, 10)).toBe('a');
    expect(cutTo(scene('idle', 'idle', { phase: 'won' }), null, 10)).toBe('a');
    // Within a run nothing is that urgent: not the way out, not a solve.
    expect(cutTo(scene('escape', 'escape'), 'a', 10)).toBe('a');
    expect(cutTo(scene('walk', 'walk', { solvedAt: T0 }), 'a', 10)).toBe('a');
  });
});

describe('what a reader passes on', () => {
  const p = (text: string) => ({ kind: 'p' as const, text });
  const rules = (...items: string[]) => ({ kind: 'rules' as const, items });

  it('is the workshop’s first note, before any rule; a rule where the workshop left none', () => {
    const betrieb = { heading: 'Betrieb', blocks: [p('Zwei Pulte.'), rules('Wenn A, dann B.')] };
    const workshop = { heading: WORKSHOP, blocks: [p('Erst messen.'), p('Dann schneiden.')] };
    expect(captionFrom([betrieb, workshop])).toBe('Erst messen.');
    expect(captionFrom([betrieb])).toBe('Wenn A, dann B.');
    expect(captionFrom([{ heading: 'Aufbau', blocks: [p('Ein Pult.')] }])).toBeNull();
    expect(captionFrom([])).toBeNull();
  });

  it('is a sentence every one of Blackout’s manuals prints, whatever the seed', () => {
    for (const def of mission.puzzles) {
      const manual = moduleFor(def.type).manual(def);
      const said = captionFrom(manual);
      expect(said, def.id).not.toBeNull();
      expect(JSON.stringify(manual)).toContain(JSON.stringify(said));
    }
  });
});

/** What a viewer of a whole run saw of it: each cut, and what was on air at each station. */
interface Watched {
  phase: string;
  /** each picture on air in turn: the seat's index or null, from when and how long, s */
  shots: { onAir: 0 | 1 | null; at: number; long: number; phase: string }[];
  /**
   * seconds on air by station up and by what the seat on air did: `2 read`, `3 overview`; and
   * the seconds one of the crew read to the other at the console: `2 read to`
   */
  shown: Record<string, number>;
  /** what one of the crew told the other, by station up: the words, and how long they stood, s */
  said: Record<number, { text: string; by: 0 | 1; long: number }>;
  /**
   * shots whose `ear` is not the seat on air — or, under the whole lab, the seat last on air —
   * and views sent under the whole lab that are not that seat's
   */
  deaf: number;
  /** the bytes sent this viewer, by kind of message, and the run's length, s */
  bytes: Record<string, number>;
  seconds: number;
}

/** What a viewer has of the run so far: its phase, the station up, the seats, what is on air. */
interface Seen {
  phase: string;
  index: number;
  ids: string[];
  shot: DemoShot | null;
}

/**
 * Whether the seat's view `msg` is none the lab is heard by while the whole lab is on air:
 * neither the view of the seat last on air nor the one that comes just before the word of a cut
 * to its seat (`next`).
 */
function strayView(msg: ServerMessage, shot: DemoShot | null, next?: ServerMessage): boolean {
  if (msg.kind !== 'demo-view' || shot === null || shot.onAir !== null) {
    return false;
  }
  const cutTo = next?.kind === 'demo-shot' ? next.shot.onAir : null;
  return msg.seat !== shot.ear && msg.seat !== cutTo;
}

/** Adds `by` to what `tally` has under `key`. */
function add(tally: Record<string, number>, key: string, by: number): void {
  tally[key] = (tally[key] ?? 0) + by;
}

/** The place in the crew `ids` of the seat `id`; null for the whole lab. */
const placeOf = (ids: readonly string[], id: string | null): 0 | 1 | null =>
  id === null ? null : ids[0] === id ? 0 : 1;

/** A word of what is on air, as a viewer takes it: a cut noted, the seat it is heard by checked. */
function takeShot(shot: DemoShot, seen: Seen, watched: Watched): void {
  const before = seen.shot;
  const last = before === null ? seen.ids[0] : (before.onAir ?? before.ear);
  watched.deaf += shot.ear === (shot.onAir ?? last) ? 0 : 1;
  if (before === null || shot.onAir !== before.onAir) {
    const at = (Date.now() - T0) / 1000;
    watched.shots.push({ onAir: placeOf(seen.ids, shot.onAir), at, long: 0, phase: seen.phase });
  }
  seen.shot = shot;
}

/** `msg` as a viewer takes it: the run's state off the audience's view, each cut noted. */
function take(msg: ServerMessage, seen: Seen, watched: Watched, next?: ServerMessage): void {
  watched.deaf += strayView(msg, seen.shot, next) ? 1 : 0;
  add(watched.bytes, msg.kind, JSON.stringify(msg).length);
  if (msg.kind === 'spectator-view') {
    seen.phase = msg.view.phase;
    seen.index = msg.view.currentPuzzleIndex;
    seen.ids = msg.view.players.map((player) => player.id);
  } else if (msg.kind === 'demo-shot') {
    takeShot(msg.shot, seen, watched);
  }
}

/** A tick of the run counted for what is said under the picture during it. */
function countSaid({ shot, index, ids }: Seen, said: Watched['said']): void {
  const caption = shot?.caption ?? null;
  if (caption !== null) {
    const by = ids[0] === caption.by ? 0 : 1;
    said[index] = { text: caption.text, by, long: (said[index]?.long ?? 0) + 0.08 };
  }
}

/** What the seat on air in `shot` is doing; `overview` for the whole lab. */
const onAirDoing = (shot: DemoShot): string =>
  shot.onAir === null ? 'overview' : (shot.doing[shot.onAir]?.what ?? 'idle');

/** A tick of the run counted for what is on air during it: `2 read`, `4 overview`. */
function count({ shot, phase, index }: Seen, shown: Watched['shown']): void {
  if (shot === null || phase !== 'playing') {
    return;
  }
  add(shown, `${index} ${onAirDoing(shot)}`, 0.08);
  // One reads to the other who works: counted apart, whoever is on air.
  const crew = Object.values(shot.doing).map((doing) => doing.what);
  if (crew.sort().join('+') === 'operate+read') {
    add(shown, `${index} read to`, 0.08);
  }
}

/** A whole run of the demo on `seed`, watched by one of the audience from its lobby on. */
function watchRun(seed: number): Watched {
  const host = new DemoHost(mission, [seed]);
  const heard: ServerMessage[] = [];
  host.watch((msg) => heard.push(msg)).pin('regie');
  const seen: Seen = { phase: 'lobby', index: 0, ids: [], shot: null };
  const counted = { shown: {}, said: {}, deaf: 0, bytes: {}, seconds: 0 };
  const watched: Watched = { phase: 'lobby', shots: [], ...counted };
  const over = (): boolean => seen.phase === 'won' || seen.phase === 'lost';
  // To the run's end and five seconds of its Auswertung.
  for (let tick = 0, after = 0; tick < 15_000 && after < 60; tick++) {
    heard.splice(0).forEach((msg, i, all) => take(msg, seen, watched, all[i + 1]));
    count(seen, watched.shown);
    countSaid(seen, watched.said);
    after += over() ? 1 : 0;
    vi.advanceTimersByTime(80);
  }
  host.stop();
  watched.phase = seen.phase;
  watched.seconds = (Date.now() - T0) / 1000;
  watched.shots.forEach((shot, i) => {
    shot.long = (watched.shots[i + 1]?.at ?? watched.seconds) - shot.at;
  });
  return watched;
}

/** What a reader passes on of the station `id`: off its module's manual, as printed. */
function captionOf(id: string): string | null {
  const def = mission.puzzles.find((puzzle) => puzzle.id === id);
  return def === undefined ? null : captionFrom(moduleFor(def.type).manual(def));
}

/** The stations of Blackout whose rules lie at a source, by their place in the run. */
const WITH_A_SOURCE = [1, 2, 3, 4];

describe('a whole run as the director cuts it', () => {
  it.each([
    ['Signalkette', 12],
    ['Funkpult', 56],
    ['Notstromkasten', 93],
  ])('the run with the %s: no hasty cut, every station read and worked on air', (_draw, seed) => {
    const run = watchRun(seed);
    expect(run.phase).toBe('won');
    const said = run.shots.map(
      (s) => `${s.at.toFixed(1)} ${s.onAir ?? 'lab'} ${s.long.toFixed(1)}`,
    );
    // The lobby from above, then the opening on the first seat; the Auswertung on it at the end.
    expect(run.shots.slice(0, 2).map((shot) => shot.onAir)).toEqual([null, 0]);
    expect(run.shots.at(-1)).toMatchObject({ onAir: 0, phase: 'won' });
    // No picture of the run is cut away from before its time; the lobby's ends with the start.
    const inRun = run.shots.slice(1, -1);
    for (const shot of inRun) {
      const least = shot.onAir === null ? OVERVIEW_SHOT_MS : SEAT_SHOT_MS;
      expect(shot.long, said.join(' | ')).toBeGreaterThanOrEqual(least / 1000 - 0.1);
    }
    expect(inRun.length).toBeGreaterThanOrEqual(20);
    expect(inRun.length).toBeLessThanOrEqual(45);
    // The lab is always heard from the seat on air, and under the whole lab from the last one.
    expect(run.deaf).toBe(0);
    // Both seats are seen, and the whole lab for a tenth to a third of the run.
    const seconds = (onAir: 0 | 1 | null): number =>
      inRun.filter((shot) => shot.onAir === onAir).reduce((sum, shot) => sum + shot.long, 0);
    const whole = seconds(null) + seconds(0) + seconds(1);
    expect(seconds(null) / whole).toBeGreaterThan(0.1);
    expect(seconds(null) / whole).toBeLessThan(0.3);
    expect(seconds(1) / whole).toBeGreaterThan(0.15);
    // Every station with a source is seen read for ten seconds and worked for twenty.
    for (const index of WITH_A_SOURCE) {
      expect(run.shown[`${index} read`], `station ${index} read`).toBeGreaterThan(10);
      expect(run.shown[`${index} operate`], `station ${index} worked`).toBeGreaterThan(20);
    }
    // A station's solve is seen from above — the first three before any drone flies.
    for (const index of [1, 2, 3]) {
      expect(run.shown[`${index} overview`], `solve before ${index}`).toBeGreaterThan(4);
    }
    // At the Funkpult one reads to the other who works it; the other draws have two consoles.
    const readTo = run.shown['4 read to'] ?? 0;
    expect(readTo > 15).toBe(seed === 56);
    expect(readTo === 0).toBe(seed !== 56);
    // Whoever read a station's rules passes a sentence of them on, word for word, for nine
    // seconds: of that station's manual, and of no other.
    const drawn = { 12: 'signalkette', 56: 'frequenz', 93: 'notstrom' }[seed] ?? '';
    const read = ['anlauf', 'paketfilter', 'subsysteme', drawn];
    expect(Object.keys(run.said).map(Number)).toEqual(WITH_A_SOURCE);
    WITH_A_SOURCE.forEach((index, i) => {
      const said = run.said[index];
      expect(said?.text, read[i]).toBe(captionOf(read[i] ?? ''));
      expect(said?.long).toBeGreaterThan(SAID_MS / 1000 - 0.5);
      expect(said?.long).toBeLessThan(SAID_MS / 1000 + 0.5);
    });
    expect(run.said[1]?.text).toBe(
      'Das Terminal zählt nicht mit: Am Skriptpult verrät nur das Licht im Bodenkanal, ' +
        'wie weit der Impuls ist.',
    );
    // The seat's view costs a viewer about as much again as the audience's own.
    const perSecond = (kind: string): number => (run.bytes[kind] ?? 0) / run.seconds / 1000;
    expect(perSecond('demo-view')).toBeLessThan(perSecond('spectator-view') * 1.2);
    expect(perSecond('demo-view')).toBeLessThan(8);
    expect(perSecond('demo-shot')).toBeLessThan(0.1);
  });
});

const kinds = (heard: readonly ServerMessage[]): Set<string> => new Set(heard.map((m) => m.kind));

/** The seat views `heard` carries, by seat. */
const viewsIn = (heard: readonly ServerMessage[]): string[] =>
  heard.flatMap((msg) => (msg.kind === 'demo-view' ? [msg.seat] : []));

/** The demo run on for `seconds`. */
const run = (seconds: number): void => {
  for (let tick = 0; tick * 80 < seconds * 1000; tick++) {
    vi.advanceTimersByTime(80);
  }
};

describe('the demo’s feed', () => {
  it('tells a viewer at once what is on air, and sends it the seat’s view as it is cut to', () => {
    const host = new DemoHost(mission, [12]);
    const heard: ServerMessage[] = [];
    const watch = host.watch((msg) => heard.push(msg));
    const first = heard.find((msg) => msg.kind === 'demo-shot');
    expect(first).toMatchObject({ kind: 'demo-shot', shot: { onAir: null, caption: null } });
    // Whoever comes is shown the first seat, whatever is on air: its view comes at once.
    const ear = first?.kind === 'demo-shot' ? first.shot.ear : '';
    expect(viewsIn(heard)).toEqual([ear]);
    watch.pin('regie');
    run(4);
    // The run started: the opening on the first seat, its own view with it.
    const shot = heard.filter((msg) => msg.kind === 'demo-shot').at(-1);
    const view = heard.filter((msg) => msg.kind === 'demo-view').at(-1);
    const seat = shot?.kind === 'demo-shot' ? shot.shot.onAir : null;
    expect(seat).not.toBeNull();
    expect(view).toMatchObject({ kind: 'demo-view', seat, view: { you: { id: seat } } });
    // The view comes with the cut, just before the word of it: no picture waits for the
    // seat's next view, and none shows an old one.
    const cut = heard.findIndex((msg) => msg.kind === 'demo-shot' && msg.shot.onAir === seat);
    expect(heard[cut - 1]).toMatchObject({ kind: 'demo-view', seat });
    expect(view?.kind === 'demo-view' && view.view.you.name).toBe('HCW Bachelor');
    host.stop();
  });

  it('gives whoever comes mid-run the picture as it stands: a line lost, a restart', () => {
    const host = new DemoHost(mission, [12]);
    const first = host.watch(() => undefined);
    run(40);
    first.detach();
    const heard: ServerMessage[] = [];
    host.watch((msg) => heard.push(msg));
    const told = ['audience', 'demo-shot', 'demo-view', 'positions', 'spectator-view'];
    expect([...kinds(heard)].sort()).toEqual(told);
    host.stop();
    // Another server, as after a restart: its demo starts anew, and says what is on air at once.
    const again = new DemoHost(mission, [12]);
    const fresh: ServerMessage[] = [];
    again.watch((msg) => fresh.push(msg));
    expect(kinds(fresh).has('demo-shot')).toBe(true);
    again.stop();
  });

  it('sends a viewer the seat it pinned, whatever is on air; for the lab, the seat on air', () => {
    const host = new DemoHost(mission, [12]);
    const heard: ServerMessage[] = [];
    const watch = host.watch((msg) => heard.push(msg));
    run(30);
    const ids = heard.flatMap((msg) =>
      msg.kind === 'demo-shot' ? Object.keys(msg.shot.doing) : [],
    );
    const [one, two] = ids as [string, string];
    heard.length = 0;
    watch.pin('two');
    expect(viewsIn(heard)).toEqual([two]);
    run(60);
    expect(new Set(viewsIn(heard))).toEqual(new Set([two]));
    heard.length = 0;
    // The whole lab pinned: the picture needs no seat, the sound does — the director's seats.
    watch.pin('overview');
    run(120);
    expect(new Set(viewsIn(heard))).toEqual(new Set([one, two]));
    expect(kinds(heard).has('demo-shot')).toBe(true);
    heard.length = 0;
    watch.pin('one');
    run(30);
    expect(new Set(viewsIn(heard))).toEqual(new Set([one]));
    heard.length = 0;
    watch.pin('regie');
    run(120);
    expect(new Set(viewsIn(heard))).toEqual(new Set([one, two]));
    host.stop();
  });

  it('shows whoever chose nothing the first seat, whoever is on air', () => {
    const host = new DemoHost(mission, [12]);
    const heard: ServerMessage[] = [];
    host.watch((msg) => heard.push(msg));
    run(150);
    const shots = heard.flatMap((msg) => (msg.kind === 'demo-shot' ? [msg.shot] : []));
    const [first, second] = Object.keys(shots.at(-1)?.doing ?? {});
    // The director had the second seat on air meanwhile; this viewer was sent the first alone.
    expect(shots.some((shot) => shot.onAir === second)).toBe(true);
    expect(new Set(viewsIn(heard))).toEqual(new Set([first]));
    host.stop();
  });

  it('sends nobody anything once they left', () => {
    const host = new DemoHost(mission, [12]);
    const stays: ServerMessage[] = [];
    const left: ServerMessage[] = [];
    host.watch((msg) => stays.push(msg));
    const watch = host.watch((msg) => left.push(msg));
    run(10);
    watch.detach();
    left.length = 0;
    stays.length = 0;
    run(30);
    expect(left).toEqual([]);
    expect(kinds(stays).has('demo-view')).toBe(true);
    host.stop();
  });
});

describe('a seat’s own view and every other room', () => {
  /** A server with a demo and Anna and Ben in a run of their own, Zoe watching it. */
  function served() {
    const host = new DemoHost(mission, [12]);
    const line = new FakeServer();
    const manager = new RoomManager(undefined, true);
    serveSockets(line, { catalog: shipped, manager, demo: host });
    type Three = [FakeSocket, FakeSocket, FakeSocket];
    const [anna, ben, zoe] = [0, 1, 2].map(() => line.connect()) as Three;
    const pass = passFor('Anna');
    anna.say({ kind: 'create-room', name: 'Anna', pass, missionId: 'blackout', seed: 12 });
    const { code } = joinedOf(anna);
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'set-ready', ready: true });
    anna.say({ kind: 'start-mission' });
    zoe.say({ kind: 'spectate', code });
    return { host, line, manager, anna, ben, zoe, code };
  }

  it('is sent to no audience of a crew’s room, whatever it pins, nor to the crew', () => {
    const { host, manager, anna, ben, zoe, code } = served();
    for (const pin of DEMO_PINS) {
      zoe.say({ kind: 'demo-pin', pin });
      anna.say({ kind: 'demo-pin', pin });
    }
    anna.say({ kind: 'intro-done' });
    ben.say({ kind: 'intro-done' });
    run(20);
    const refusals = (socket: FakeSocket): string[] =>
      socket.heard.flatMap((msg) => (msg.kind === 'error' ? [msg.message] : []));
    expect(refusals(zoe)).toEqual(DEMO_PINS.map(() => DEMO_PIN_ONLY));
    expect(refusals(anna)).toEqual(DEMO_PINS.map(() => DEMO_PIN_ONLY));
    for (const socket of [anna, ben, zoe]) {
      expect(kinds(socket.heard).has('demo-view')).toBe(false);
      expect(kinds(socket.heard).has('demo-shot')).toBe(false);
    }
    // What only a seat at its place is shown reaches the audience by no message at all: Zoe's
    // line carries the audience's view and nothing made by `viewFor`.
    const told = JSON.stringify(zoe.heard);
    expect(told).not.toContain('"manualsHere"');
    expect(told).not.toContain('"sourcesHere"');
    expect(told).not.toContain('"you"');
    expect(JSON.stringify(anna.heard)).toContain('"manualsHere"');
    manager.get(code).dispose();
    host.stop();
  });

  it('is sent to the demo’s audience on a socket, pinned over the line', () => {
    const { host, line, manager, code } = served();
    const viewer = line.connect();
    viewer.say({ kind: 'spectate', code: DEMO_CODE });
    run(5);
    viewer.heard.length = 0;
    viewer.say({ kind: 'demo-pin', pin: 'two' });
    const [sent] = viewer.heard;
    expect(sent).toMatchObject({ kind: 'demo-view', view: { you: { name: 'HCW Master' } } });
    // Off to a crew's room, the same socket is sent no seat's view any more.
    viewer.say({ kind: 'spectate', code });
    viewer.heard.length = 0;
    run(20);
    expect(kinds(viewer.heard).has('demo-view')).toBe(false);
    expect(kinds(viewer.heard).has('demo-shot')).toBe(false);
    manager.get(code).dispose();
    host.stop();
  });
});
