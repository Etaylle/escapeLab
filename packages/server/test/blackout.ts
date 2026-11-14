import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import {
  moduleFor,
  parseMission,
  type CrewPass,
  type Mission,
  type Move,
  type PlayerView,
  type PuzzleInput,
  type PuzzleView,
  type ServerMessage,
} from '@escapelab/core';
import { Room, type LineEnd, type RunListener } from '../src/room.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * Blackout for two in a real room, played as a crew plays it — walking, pressing E, every
 * station worked by its module's solver on the views at its consoles — on the seed the harness
 * and the smoke pin it to: Anna, the host, starts in the Archiv beside the Laborkennung, Ben at
 * the Flur's west end. The tests run it on fake timers, a second a round at a station.
 */

/** The seed the harness and the smoke pin Blackout to (core test/blackoutPlan.ts). */
export const BLACKOUT_SEED = 5;

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

/** A crew of Anna and Ben in Blackout on BLACKOUT_SEED, the opening skipped: the lights out. */
export function blackoutRun(onRunFinished?: RunListener): {
  room: Room;
  anna: Member;
  ben: Member;
} {
  const room = new Room('SNAP', blackoutMission(), onRunFinished, BLACKOUT_SEED);
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
 * The open station worked by its module's solver on the views at its consoles until it is
 * solved: `operator` at console a, or at the station where it has one, `partner` at console b
 * or beside the operator; a round a second.
 */
function work(room: Room, operator: Member, partner: Member): void {
  const index = lastView(operator).currentPuzzleIndex;
  const def = blackoutMission().puzzles[index];
  if (def === undefined) {
    throw new Error(`Blackout has no station ${index + 1}`);
  }
  const station = moduleFor(def.type);
  const two = station.consoles === 2;
  for (let round = 0; round < 60 && lastView(operator).currentPuzzleIndex === index; round++) {
    const views = { operator: puzzleOf(operator), partner: puzzleOf(partner) };
    const edgework = lastView(operator).edgework ?? lastView(partner).edgework;
    const perspectives = {
      operator: views.operator,
      ...(two ? { partner: views.partner } : {}),
      reader: views.partner,
    };
    const aid = { transcript: [], remainingSec: null };
    play(room, station.solve(def, perspectives, edgework, aid), operator, partner);
    vi.advanceTimersByTime(1000);
  }
  if (lastView(operator).currentPuzzleIndex === index) {
    throw new Error(`${def.title} is not solved after a minute`);
  }
}

/**
 * Blackout's first three stations solved and the spare fuse in Anna's hands: the Notlicht's
 * main switch thrown together in the Flur; Ben on the plate that holds the Maschinenraum door
 * for Anna, then at the meter while she cuts at the fuse box; Ben at console A of the
 * Signalkette, Anna at console B; then Anna fetches the fuse from the Archiv. The Flur's patrol
 * is out from then on, and the run's first emergency is due.
 */
export function blackoutMidway(onRunFinished?: RunListener): {
  room: Room;
  anna: Member;
  ben: Member;
} {
  const { room, anna, ben } = blackoutRun(onRunFinished);
  // Anna steps past the Laborkennung, which the fuse box's rules read from.
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
  walk(room, anna, 9, 19);
  walk(room, ben, 29, 9);
  pressE(room, ben);
  work(room, ben, anna);
  walk(room, anna, 9, 7);
  pressE(room, anna);
  return { room, anna, ben };
}
