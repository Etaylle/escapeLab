import { readFileSync } from 'node:fs';
import { applyAction, moduleFor, parseMission, stationKey, viewFor } from '../src/index.js';
import type {
  Action,
  GameState,
  Mission,
  Move,
  PlayerView,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
  ServerRow,
} from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * Blackout on the seed the harness pins its room to, played through the
 * reducer the way tools/shots.mjs plays it in two browsers — and what that
 * run deals, station by station, as the harness carries it: Node cannot load
 * core's TypeScript, so tools/fixtures/blackout-plan.json holds this plan,
 * blackoutPlan.test.ts keeps it the solvers' own, and the harness checks
 * every instance in the browser against it before it plays the answer.
 * Player p1 is the host, who joins first; p2 the guest.
 */

export const PINNED_SEED = 5;

interface Spot {
  x: number;
  y: number;
}

/** A stage of the Signalkette: who sends, what, and the keys the other console presses. */
interface SignalStage {
  sends: 'a' | 'b';
  sequence: string[];
  keys: { row: number; shape: string }[];
}

export interface BlackoutPlan {
  mission: string;
  seed: number;
  /** where the draw puts the host and the guest */
  spawns: { host: Spot; guest: Spot };
  /** where this run lays each source, by its id */
  places: Record<string, Spot>;
  /** the Laborkennung's serial: its last digit says which wire the fuse box's rules name */
  serial: string;
  /** the fuse box's wires from the top, and each round: what the meter reads, the wire cut */
  notstrom: { wires: string[]; rounds: { readings: (number | null)[]; cut: number }[] };
  /** every stage of the Signalkette */
  signalkette: { stages: SignalStage[] };
  /** the terminal's table as it opens, and the moves at the terminal and the rack */
  subsysteme: { rows: ServerRow[]; moves: Move<PuzzleInput>[] };
  /** the lamp's pattern, where the dial starts, and the steps to turn it (− down, + up) */
  frequenz: { pattern: string; dial: number; turns: number };
  /** where the spare fuse lies and where it goes */
  ersatzsicherung: { from: Spot; to: Spot };
  /** the reactor's presses: one from each of the crew within its window */
  reaktorstart: { presses: number; windowMs: number };
}

/** One round at a station: the views the crew held, the moves it made. */
interface Round {
  views: { operator: PuzzleView; partner: PuzzleView | null };
  moves: Move<PuzzleInput>[];
}

const missionsDir = new URL('../../../missions/', import.meta.url);

export function blackoutMission(): Mission {
  return parseMission(JSON.parse(readFileSync(new URL('blackout.json', missionsDir), 'utf8')));
}

const CREW = ['p1', 'p2'] as const;

/**
 * The current station switched on the way the crew walks up to it: its part
 * carried in, its shut source opened by p2 (a cabinet with its key), p1 at
 * the station or console a, p2 at console b or at the source — both at a
 * station the whole crew works — and p1's E.
 */
function switchOn(state: GameState, def: PuzzleDef, at: number): GameState {
  const map = state.mission.map;
  const errands = map.items
    .filter((item) => item.requiredFor === def.id)
    .flatMap((item): Action[] => [
      { type: 'pick-item', playerId: 'p1', itemId: item.id, at },
      { type: 'deliver-item', playerId: 'p1', itemId: item.id, at },
    ]);
  let next = errands.reduce(applyAction, state);
  const source = map.manuals.find((m) => m.puzzleIds.includes(def.id));
  const { wholeCrew, consoles } = moduleFor(def.type);
  if (source !== undefined && !next.opened.includes(source.id) && consoles !== 2) {
    const key: Action[] =
      source.needsKey === undefined
        ? []
        : [{ type: 'pick-item', playerId: 'p2', itemId: source.needsKey, at }];
    const open: Action = { type: 'open-source', playerId: 'p2', manualId: source.id, at };
    next = [...key, open].reduce(applyAction, standing(next, { manuals: { [source.id]: ['p2'] } }));
  }
  const here = wholeCrew
    ? { stations: { [def.id]: [...CREW] } }
    : consoles === 2
      ? { stations: { [def.id]: ['p1'], [stationKey({ puzzleId: def.id, console: 'b' })]: ['p2'] } }
      : {
          stations: { [def.id]: ['p1'] },
          manuals: source === undefined ? {} : { [source.id]: ['p2'] },
        };
  return applyAction(standing(next, here), { type: 'interact', playerId: 'p1', at });
}

/** The open puzzle as `view` shows it; throws where none is open. */
function puzzleOf(view: PlayerView): PuzzleView {
  if (view.puzzle === null) {
    throw new Error(`blackout: ${view.you.id} sees no open puzzle`);
  }
  return view.puzzle;
}

/** Every move as the puzzle-inputs it takes: p1's, p2's, or both. */
function inputs(moves: Move<PuzzleInput>[], at: number): Action[] {
  return moves.flatMap((move) => {
    const by = move.by === 'everyone' ? CREW : move.by === 'partner' ? ['p2'] : ['p1'];
    return by.map(
      (playerId): Action => ({ type: 'puzzle-input', playerId, at, input: move.input }),
    );
  });
}

/**
 * The whole mission through the reducer on `seed`: both walk past the sign,
 * then every station is worked by its module's solver on the views p1 and
 * p2 hold, a second a round. Returns the state once the hatch opens and
 * every station's rounds.
 */
export function playBlackout(seed = PINNED_SEED): { state: GameState; rounds: Round[][] } {
  const mission = blackoutMission();
  let state = standing(lightsOut(started(mission, seed)), { signSeen: [...CREW] });
  const rounds: Round[][] = mission.puzzles.map(() => []);
  for (let round = 1; state.currentPuzzleIndex < mission.puzzles.length && round < 600; round++) {
    const index = state.currentPuzzleIndex;
    const def = mission.puzzles[index];
    if (def === undefined) {
      break;
    }
    const at = T0 + round * 1000;
    state = state.puzzleState === null ? switchOn(state, def, at) : state;
    const atA = viewFor(state, 'p1');
    const atB = viewFor(state, 'p2');
    const views = { operator: puzzleOf(atA), partner: puzzleOf(atB) };
    const two = moduleFor(def.type).consoles === 2;
    const moves = moduleFor(def.type).solve(
      def,
      {
        operator: views.operator,
        ...(two ? { partner: views.partner } : {}),
        reader: views.partner,
      },
      atA.edgework,
      { transcript: [], remainingSec: null },
    );
    const held = { operator: views.operator, partner: two ? views.partner : null };
    rounds[index]?.push({ views: held, moves });
    state = inputs(moves, at).reduce(applyAction, state);
  }
  return { state, rounds };
}

/** The open puzzle of `round` at console `side`, of the kind `kind`; throws for another. */
function seen<K extends PuzzleView['kind']>(
  round: Round | undefined,
  kind: K,
  side: 'operator' | 'partner' = 'operator',
): Extract<PuzzleView, { kind: K }> {
  const view = round?.views[side];
  if (view?.kind !== kind) {
    throw new Error(`blackout plan: expected the ${kind} at the ${side}, not ${view?.kind}`);
  }
  return view as Extract<PuzzleView, { kind: K }>;
}

/** The fuse box: its wires, and each round the meter's readings and the wire the box cuts. */
function notstromOf(rounds: Round[]): BlackoutPlan['notstrom'] {
  const wires = (seen(rounds[0], 'circuit').wires ?? []).map((wire) => wire.colour);
  const cuts = rounds.flatMap((round) => {
    const [move] = round.moves;
    if (move === undefined || !('cut' in move.input)) {
      return [];
    }
    const readings = [...(seen(round, 'circuit', 'partner').readings ?? [])];
    return [{ readings, cut: move.input.cut }];
  });
  return { wires, rounds: cuts };
}

/** Each stage of the Signalkette: the sending console, its sequence, the keys pressed for it. */
function signalketteOf(rounds: Round[]): BlackoutPlan['signalkette'] {
  const stages = rounds.flatMap((round): SignalStage[] => {
    const views = [seen(round, 'signal'), seen(round, 'signal', 'partner')];
    const sender = views.find((view) => view.role === 'sender');
    const keys = round.moves.flatMap((move) => ('key' in move.input ? [move.input.key] : []));
    return sender?.sequence == null || keys.length === 0
      ? []
      : [{ sends: sender.sends, sequence: [...sender.sequence], keys }];
  });
  return { stages };
}

/** The Serverraum: the terminal's table as it opens, and every move to the solve. */
function subsystemeOf(rounds: Round[]): BlackoutPlan['subsysteme'] {
  const rows = seen(rounds[0], 'servers').rows ?? [];
  return { rows: rows.map((row) => ({ ...row })), moves: rounds.flatMap((round) => round.moves) };
}

/** The radio panel: the lamp's pattern, the dial's start, and the turns the solver makes. */
function frequenzOf(rounds: Round[]): BlackoutPlan['frequenz'] {
  const lamp = seen(rounds[0], 'morse');
  const turns = rounds
    .flatMap((round) => round.moves)
    .reduce((sum, move) => sum + ('tune' in move.input ? move.input.tune : 0), 0);
  return { pattern: lamp.pattern ?? '', dial: lamp.dial, turns };
}

/** Blackout on `seed`, as the harness walks it: who starts where, and every station's answer. */
export function blackoutPlan(seed = PINNED_SEED): BlackoutPlan {
  const { state, rounds } = playBlackout(seed);
  const mission = state.mission;
  const spawn = (id: string): Spot => {
    const at = state.players.find((p) => p.id === id)?.spawn;
    if (at == null) {
      throw new Error(`blackout plan: ${id} drew no spawn`);
    }
    return { x: at.x, y: at.y };
  };
  const fuse = mission.map.items.find((item) => item.requiredFor === 'reaktorstart');
  const reactor = mission.puzzles.find((p) => p.id === 'reaktorstart');
  if (fuse?.deliverTo === undefined || reactor?.type !== 'button-sync') {
    throw new Error('blackout plan: the reactor needs its spare fuse and a sync press');
  }
  const presses = inputs((rounds[5] ?? []).flatMap((round) => round.moves), T0).length;
  return {
    mission: mission.id,
    seed,
    spawns: { host: spawn('p1'), guest: spawn('p2') },
    places: Object.fromEntries(Object.entries(state.places).map(([id, at]) => [id, { ...at }])),
    serial: state.edgework?.serial ?? '',
    notstrom: notstromOf(rounds[1] ?? []),
    signalkette: signalketteOf(rounds[2] ?? []),
    subsysteme: subsystemeOf(rounds[3] ?? []),
    frequenz: frequenzOf(rounds[4] ?? []),
    ersatzsicherung: { from: { x: fuse.x, y: fuse.y }, to: { ...fuse.deliverTo } },
    reaktorstart: { presses, windowMs: reactor.windowMs ?? 0 },
  };
}
