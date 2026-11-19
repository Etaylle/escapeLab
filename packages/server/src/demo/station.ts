import {
  moduleFor,
  type Move,
  type Perspectives,
  type PuzzleDef,
  type PuzzleInput,
  type PuzzleView,
  type SolveAid,
} from '@escapelab/core';
import { armedOn, emergencyOn } from './places.js';
import { pause, type Clock, type Dice, type Script } from './script.js';
import type { Seat } from './seat.js';

/**
 * A station worked by the demo crew: switched on with E, then move by move as its module's
 * solver finds them on what the two seats see (core `solve`, the crew's own knowledge and no
 * more) — one move at a time, a human's pause between two, the solver asked afresh for each, so
 * that no move is made on a view that has gone stale.
 */

/** A span of ms a pause is thrown from. */
type Span = readonly [number, number];

/**
 * The crew's pace, ms: how long it stands in the lobby and watches the opening, how long before
 * a hand presses E, between two inputs at a console, between the two presses of a move both
 * make, how long a source is read and a thing looked at, how long an emergency's instruction
 * takes from coming up to its handle being thrown, how long the Auswertung stands before the
 * next run, and how long the crew waits before it starts over after something went wrong.
 */
export const PACE = {
  lobbyMs: 4000,
  introMs: 12_000,
  press: [1000, 2000] as Span,
  input: [3000, 5200] as Span,
  beat: [250, 600] as Span,
  read: [14_000, 20_000] as Span,
  look: [900, 1600] as Span,
  relay: [3000, 4600] as Span,
  restMs: 20_000,
  againMs: 1500,
} as const;

/** Who works the station: at its console (a, where it has two), and at console b or its source. */
export interface Hands {
  operator: Seat;
  partner: Seat;
}

/** What the work goes by: the crew's clock and its dice. */
interface Going {
  clock: Clock;
  dice: Dice;
}

type Aid = SolveAid<PuzzleInput, PuzzleView>;
type Transcript = Aid['transcript'];

/** What the two seats see of the open puzzle; null while one of them sees none. */
function seenBy(def: PuzzleDef, { operator, partner }: Hands): Perspectives<PuzzleView> | null {
  const atA = operator.view?.puzzle ?? null;
  const atB = partner.view?.puzzle ?? null;
  if (atA === null || atB === null) {
    return null;
  }
  const two = moduleFor(def.type).consoles === 2;
  return { operator: atA, ...(two ? { partner: atB } : {}), reader: atB };
}

/** The mission clock as `seat`'s screen shows it at `now`. */
function clockOn(seat: Seat, now: number): Pick<Aid, 'remainingSec' | 'elapsedSec'> {
  const view = seat.view;
  const deadline = view?.deadlineAt ?? null;
  const from = view?.clockFrom;
  return {
    remainingSec: deadline === null ? null : Math.ceil((deadline - now) / 1000),
    ...(from === undefined ? {} : { elapsedSec: Math.floor((now - from) / 1000) }),
  };
}

/** `move` made: by the operator, by the partner, or by both, a beat apart. */
function* make(move: Move<PuzzleInput>, hands: Hands, going: Going): Script {
  const say = (seat: Seat): void => seat.say({ kind: 'puzzle-input', input: move.input });
  if (move.by !== 'partner') {
    say(hands.operator);
  }
  if (move.by === 'everyone') {
    yield* pause(going.clock, going.dice.between(PACE.beat));
  }
  if (move.by !== 'operator') {
    say(hands.partner);
  }
}

/** Whether the station of `def` is the one up on `operator`'s view, its run on. */
const upFor = (def: PuzzleDef, operator: Seat): boolean =>
  operator.view?.phase === 'playing' && armedOn(operator.view) === def.id;

/** What the solver finds next on `seen`, with what the crew did so far and its clock. */
function nextMoves(
  def: PuzzleDef,
  seen: Perspectives<PuzzleView>,
  { operator, partner }: Hands,
  aid: Pick<Aid, 'transcript' | 'at'>,
): Move<PuzzleInput>[] {
  const edgework = operator.view?.edgework ?? partner.view?.edgework ?? null;
  const clock = clockOn(operator, aid.at ?? 0);
  return moduleFor(def.type).solve(def, seen, edgework, { ...aid, ...clock });
}

/**
 * The station of `def` worked until it is solved — until another is armed, or the run is over:
 * switched on by the operator, and again after an emergency it rested through; then the
 * solver's next moves, a pause after each. While an emergency has the lab, nothing.
 */
export function* workStation(def: PuzzleDef, hands: Hands, going: Going): Script {
  const { operator } = hands;
  const transcript: Transcript = [];
  while (upFor(def, operator)) {
    const seen = emergencyOn(operator.view) ? null : seenBy(def, hands);
    if (seen === null) {
      yield* switchOn(def, hands, going);
      continue;
    }
    const moves = nextMoves(def, seen, hands, { transcript, at: going.clock.now });
    // Moves the solver gives together are one handgrip's steps: made in a row, none asked anew
    // — unless an emergency takes the consoles meanwhile: then the rest is dropped.
    for (const move of moves) {
      if (emergencyOn(operator.view) || seenBy(def, hands) === null) {
        break;
      }
      transcript.push({ ...move, before: seen });
      yield* make(move, hands, going);
      yield* pause(going.clock, going.dice.between(PACE.input));
    }
    // None: the crew waits for the clock, and looks again at the next tick.
    yield;
  }
}

/**
 * The station is not open on both seats' views: while an emergency has the lab, a tick's wait;
 * else the operator's E at it after a moment, then a moment for the panel to come up.
 */
function* switchOn(def: PuzzleDef, { operator }: Hands, going: Going): Script {
  if (emergencyOn(operator.view)) {
    yield;
    return;
  }
  yield* pause(going.clock, going.dice.between(PACE.press));
  const view = operator.view;
  if (view !== null && view.puzzle === null && !emergencyOn(view) && armedOn(view) === def.id) {
    operator.press();
  }
  yield* pause(going.clock, going.dice.between(PACE.look));
}
