import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import {
  moduleFor,
  parseMission,
  type CrewPass,
  type Mission,
  type Move,
  type PlayerView,
  type PuzzleDef,
  type PuzzleInput,
  type PuzzleView,
  type ServerMessage,
} from '@escapelab/core';
import { Room, type LineEnd, type RunListener } from '../src/room.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * Blackout for two in a real room, played as a crew plays it — walking, pressing E, every
 * station worked by its module's solver on the views at its consoles — on the seeds the harness
 * and the smoke pin it to, one for each station its Wechselplatz can have: Anna, the host,
 * starts in the Archiv beside the Laborkennung, Ben at the Flur's west end, on every one of
 * them. The tests run it on fake timers, a second a round at a station.
 */

/** A seed for each station of Blackout's Wechselplatz (core test/blackoutPlan.ts). */
export const DRAW_SEEDS = { signalkette: 12, frequenz: 56, notstrom: 93 } as const;

/** The seed the harness and the smoke pin Blackout to: the Signalkette's. */
export const BLACKOUT_SEED = DRAW_SEEDS.signalkette;

export function blackoutMission(): Mission {
  const file = new URL('../../../missions/blackout.json', import.meta.url);
  return parseMission(JSON.parse(readFileSync(file, 'utf8')));
}

/** A member of the crew: who they are, everything their connection heard, how it lets go. */
export interface Member extends Walker {
  name: string;
  pass: CrewPass;
  detach: (end?: LineEnd) => void;
}

/** The latest view `member` was sent. */
export function lastView(member: Walker): PlayerView {
  const last = member.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view');
  }
  return last.view;
}

/** `name`'s seat of `room` on a new connection of its own, heard from now on. */
function connect(room: Room, playerId: string, name: string): Member {
  const messages: ServerMessage[] = [];
  const detach = room.attach(playerId, (m) => messages.push(m));
  return { playerId, name, pass: passFor(name), messages, detach };
}

/** `member` back in `room` on a new connection, as their page resumes on their pass. */
export function rejoin(room: Room, member: Pick<Member, 'name'>): Member {
  return connect(room, room.resume(passFor(member.name)), member.name);
}

/** A crew of Blackout in its room: the room with its two seats. */
export interface BlackoutCrew {
  room: Room;
  anna: Member;
  ben: Member;
}

/** A crew of Anna and Ben in Blackout on `seed`, the opening skipped: the lights out. */
export function blackoutRun(
  onRunFinished?: RunListener,
  seed: number = BLACKOUT_SEED,
): BlackoutCrew {
  const room = new Room('SNAP', blackoutMission(), onRunFinished, seed);
  const [anna, ben] = ['Anna', 'Ben'].map((name) =>
    connect(room, room.join(name, passFor(name)).playerId, name),
  ) as [Member, Member];
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  room.act(anna.playerId, { kind: 'intro-done' });
  room.act(ben.playerId, { kind: 'intro-done' });
  if (!lastView(anna).lights.out) {
    throw new Error('the lights stayed on after both skipped the opening');
  }
  return { room, anna, ben };
}

/** `member` walks to the middle of tile (x, y). */
const walk = (room: Room, member: Member, x: number, y: number): void =>
  walkTo(room, member, x + 0.5, y + 0.5);

/** The open puzzle as `member` sees it at their console; throws where they see none. */
function puzzleOf(member: Member): PuzzleView {
  const puzzle = lastView(member).puzzle;
  if (puzzle === null) {
    throw new Error(`${member.name} sees no open puzzle`);
  }
  return puzzle;
}

/** Every one of `moves` as the puzzle-inputs it takes: the operator's, the partner's, or both. */
function play(room: Room, moves: Move<PuzzleInput>[], operator: Member, partner: Member): void {
  const by = { operator: [operator], partner: [partner], everyone: [operator, partner] };
  for (const move of moves) {
    for (const member of by[move.by]) {
      room.act(member.playerId, { kind: 'puzzle-input', input: move.input });
    }
  }
}

/**
 * The station `room`'s run has in the `index`-th place of its own order — of the mission the
 * room plays, which for a room taken up again from an older snapshot is the one it began with.
 */
function stationOf(room: Room, index: number): PuzzleDef {
  const def = room.snapshot().state.mission.puzzles[index];
  if (def === undefined) {
    throw new Error(`the run has no station ${index + 1}`);
  }
  return def;
}

/** How many rounds of a second a station may take: the Paketfilter's waves run on the clock. */
const ROUNDS = 240;

/** Whether an emergency has the lab: every station stands locked till it is over. */
const inEmergency = (member: Member): boolean => lastView(member).map?.sabotage != null;

/**
 * The open station worked by its module's solver on the views at its consoles until it is
 * solved: `operator` at console a, or at the station where it has one, `partner` at console b
 * or beside the operator, or reading its rules; a round a second, the moment handed to the
 * solver as the crew's clock shows it. An emergency that drops the station is sat out — it
 * costs its minute — and `operator` switches the station on again.
 */
function work(room: Room, operator: Member, partner: Member): void {
  const index = lastView(operator).currentPuzzleIndex;
  const def = stationOf(room, index);
  const station = moduleFor(def.type);
  const two = station.consoles === 2;
  const open = (): boolean => lastView(operator).currentPuzzleIndex === index;
  for (let round = 0; round < ROUNDS && open(); round++) {
    if (dropped(operator)) {
      sitOut(room, operator);
      continue;
    }
    const views = { operator: puzzleOf(operator), partner: puzzleOf(partner) };
    const edgework = lastView(operator).edgework ?? lastView(partner).edgework;
    const perspectives = {
      operator: views.operator,
      ...(two ? { partner: views.partner } : {}),
      reader: views.partner,
    };
    const aid = { transcript: [], remainingSec: null, at: Date.now() };
    play(room, station.solve(def, perspectives, edgework, aid), operator, partner);
    vi.advanceTimersByTime(1000);
  }
  if (open()) {
    throw new Error(`${def.title} is not solved after ${ROUNDS} rounds`);
  }
}

/** Whether an emergency has dropped the station `operator` works: none is open on its view. */
const dropped = (operator: Member): boolean =>
  inEmergency(operator) || lastView(operator).puzzle === null;

/** An emergency sat out to its end, then the station it dropped switched on again by `operator`. */
function sitOut(room: Room, operator: Member): void {
  for (let second = 0; second < 120 && inEmergency(operator); second++) {
    vi.advanceTimersByTime(1000);
  }
  if (lastView(operator).phase === 'playing' && lastView(operator).puzzle === null) {
    pressE(room, operator);
  }
}

/** `operator` switches the station beside them on, any emergency that has the lab sat out first. */
function switchOn(room: Room, operator: Member): void {
  for (let second = 0; second < 120 && inEmergency(operator); second++) {
    vi.advanceTimersByTime(1000);
  }
  pressE(room, operator);
}

/** How long Ben reads the policy before the Paketfilter's first wave, ms (`blackoutMidway`). */
const POLICY_READ_MS = 20_000;

/**
 * Blackout's first three stations solved and the spare fuse in Anna's hands: the Notlicht's
 * main switch thrown together in the Flur; Ben on the plate that holds the Maschinenraum door
 * for Anna, then at console B of the Anlaufsteuerung in the Flur while she works console A
 * inside; Anna at the Sperrpult and Ben at the Analysepult of the Paketfilter, once he has read
 * its policy; then Ben walks to the Flur's east end and Anna fetches the fuse from the Archiv.
 * The run's emergencies are due from then on: the first moment for one, 100 s in, lies behind
 * the run by then (the read policy sees to it), so the next comes with the schedule's second,
 * a good two minutes on. The drones sleep until the Serverraum is solved.
 */
export function blackoutMidway(
  onRunFinished?: RunListener,
  seed: number = BLACKOUT_SEED,
): BlackoutCrew {
  const { room, anna, ben } = blackoutRun(onRunFinished, seed);
  // Anna steps past the Laborkennung, which the Notstromkasten's rules read from.
  walk(room, anna, 3, 4);
  walk(room, anna, 15, 9);
  walk(room, ben, 14, 9);
  pressE(room, anna);
  work(room, anna, ben);
  walk(room, ben, 7, 12);
  walk(room, anna, 2, 15);
  walk(room, ben, 3, 9);
  pressE(room, anna);
  work(room, anna, ben);
  walk(room, anna, 26, 10);
  walk(room, ben, 17, 11);
  vi.advanceTimersByTime(POLICY_READ_MS);
  walk(room, ben, 21, 10);
  pressE(room, anna);
  work(room, anna, ben);
  walk(room, ben, 29, 9);
  walk(room, anna, 9, 7);
  pressE(room, anna);
  return { room, anna, ben };
}

/** The Serverraum from `blackoutMidway` on: Anna at the terminal, Ben at the rack. */
export function serverraum({ room, anna, ben }: BlackoutCrew): void {
  walk(room, anna, 12, 4);
  walk(room, ben, 20, 4);
  switchOn(room, anna);
  work(room, anna, ben);
}

/**
 * The station the run has at its Wechselplatz, the Labortür open: the Signalkette with Ben at
 * console A at the Flur's east end and Anna at console B in the Maschinenraum; the Funkpult
 * with Anna at it and Ben at the cabinet he unlocked with the key from the Serverraum; the
 * Notstromkasten with Anna at the box in the Maschinenraum and Ben at the Prüfpult in the Labor.
 */
export function wechselplatz({ room, anna, ben }: BlackoutCrew): void {
  const drawn = stationOf(room, 4);
  if (drawn.id === 'signalkette') {
    walk(room, anna, 9, 19);
    walk(room, ben, 29, 9);
    switchOn(room, ben);
    work(room, ben, anna);
    return;
  }
  if (drawn.id === 'frequenz') {
    // Where this run laid the cabinet: nobody has come across it in the dark yet.
    const cabinet = room.snapshot().state.places['aktenschrank'] ?? { x: 0, y: 0 };
    walk(room, ben, 21, 1);
    pressE(room, ben);
    walk(room, ben, cabinet.x, cabinet.y);
    pressE(room, ben);
    walk(room, anna, 12, 20);
    switchOn(room, anna);
    work(room, anna, ben);
    return;
  }
  walk(room, anna, 6, 15);
  walk(room, ben, 15, 19);
  switchOn(room, anna);
  work(room, anna, ben);
}

/**
 * Blackout with its Serverraum solved too, four stations in: both drones are out from then on,
 * the Flurwache on its beat along the Flur, and the Labortür stands open.
 */
export function blackoutPatrolled(
  onRunFinished?: RunListener,
  seed: number = BLACKOUT_SEED,
): BlackoutCrew {
  const crew = blackoutMidway(onRunFinished, seed);
  serverraum(crew);
  return crew;
}

/** The reactor: the fuse Anna carries set into it, then its two levers thrown together. */
export function reaktor({ room, anna, ben }: BlackoutCrew): void {
  walk(room, anna, 34, 14);
  pressE(room, anna);
  walk(room, anna, 33, 16);
  walk(room, ben, 34, 17);
  switchOn(room, anna);
  work(room, anna, ben);
}

/**
 * Blackout from `blackoutMidway` to its end: the Serverraum, the station of the Wechselplatz,
 * the fuse Anna has carried since set into the reactor, the reactor pressed together, and
 * both out through the hatch in the Archiv.
 */
export function playToTheHatch(crew: BlackoutCrew): void {
  const { room, anna, ben } = crew;
  serverraum(crew);
  wechselplatz(crew);
  reaktor(crew);
  walk(room, anna, 1, 1);
  walk(room, ben, 1, 1);
}
