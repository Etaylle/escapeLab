import { readFileSync } from 'node:fs';
import {
  applyAction,
  drawPools,
  moduleFor,
  parseMission,
  stationKey,
  stationsOfRun,
  viewFor,
} from '../src/index.js';
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
  ShownSign,
} from '../src/index.js';
import { wavesOf, type FirewallPlanPacket } from './firewallPlan.js';
import { ticked } from './hallPlan.js';
import { lightsOut, standing, started, T0 } from './lab.js';
import { noted, stageOf, type StartupPlanStage } from './startupPlan.js';

/**
 * Blackout on the seeds the harness pins its rooms to, played through the reducer the way
 * tools/shots.mjs plays it in two browsers — and what each run deals, station by station, as
 * the harness carries it: Node cannot load core's TypeScript, so
 * tools/fixtures/blackout-plan.json holds these plans, blackoutPlan.test.ts keeps them the
 * solvers' own, and the harness checks every instance in the browser against them before it
 * plays the answer. Blackout's fifth place is a Wechselplatz (pool `wechsel`): a run has the
 * Signalkette, the Funkpult or the Notstromkasten there, by its seed. One plan a draw —
 * `PINNED_SEED`'s, the Signalkette's, is the walkthrough's own; the other two are the shorter
 * proofs'. The three seeds deal the same start: the host in the Archiv, the guest at the Flur's
 * west end, the Betriebsbuch, the Spind and the Aushang on the same spots. Player p1 is the
 * host, who joins first; p2 the guest. Each round is a second on the clock, the open station
 * ticked as the room ticks it. The Anlaufsteuerung's breakers and the Paketfilter's trips hang
 * on that clock: the harness makes them by what its pages show, not by the plan's seconds.
 */

/** The pool of Blackout's fifth place. */
export const BLACKOUT_POOL = 'wechsel';

/** The seed each draw is played on: the first is the walkthrough's own. */
export const DRAW_SEEDS = { signalkette: 12, frequenz: 56, notstrom: 93 } as const;

export const PINNED_SEED = DRAW_SEEDS.signalkette;

interface Spot {
  x: number;
  y: number;
}

/**
 * A stage of the Signalkette: who sends, what its display shows — each sign in its colour, or
 * in a grey stage by its form and pattern alone — and the keys the other console presses.
 */
interface SignalStage {
  sends: 'a' | 'b';
  sequence: ShownSign[];
  keys: { row: number; shape: string }[];
}

export interface BlackoutPlan {
  mission: string;
  seed: number;
  /** the Wechselplatz's pool, the station this seed has there, and the two out of service */
  pool: string;
  drawn: string;
  outOfService: string[];
  /** where the draw puts the host and the guest */
  spawns: { host: Spot; guest: Spot };
  /** where this run lays each source, by its id */
  places: Record<string, Spot>;
  /** the Laborkennung's serial: its last digit says which wire the fuse box's rules name */
  serial: string;
  /** the Anlaufsteuerung stage by stage: the load, the lamps, the values set, the breaker */
  anlauf: { stages: StartupPlanStage[] };
  /** every wave the Paketfilter may deal — its own and those a fault calls in */
  paketfilter: { waves: FirewallPlanPacket[][] };
  /** the terminal's table as it opens, and the moves at the terminal and the rack */
  subsysteme: { rows: ServerRow[]; moves: Move<PuzzleInput>[] };
  /** where the Signalkette has the place: every stage of it */
  signalkette?: { stages: SignalStage[] };
  /** where the Funkpult has it: the lamp's pattern, the dial's start, the steps to turn it */
  frequenz?: { pattern: string; dial: number; turns: number };
  /** where the Notstromkasten has it: its wires from the top, each round's readings and cut */
  notstrom?: { wires: string[]; rounds: { readings: (number | null)[]; cut: number }[] };
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

/** A station as the run played it: its def, as it was dealt, and its rounds. */
interface Played {
  def: PuzzleDef;
  dealt: GameState;
  rounds: Round[];
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

/** One round of the crew at the open station `def` at `at`: the views held, the solver's moves. */
function roundAt(state: GameState, def: PuzzleDef, at: number): { state: GameState; round: Round } {
  const atA = viewFor(state, 'p1');
  const views = { operator: puzzleOf(atA), partner: puzzleOf(viewFor(state, 'p2')) };
  const two = moduleFor(def.type).consoles === 2;
  const moves = moduleFor(def.type).solve(
    def,
    {
      operator: views.operator,
      ...(two ? { partner: views.partner } : {}),
      reader: views.partner,
    },
    atA.edgework,
    { transcript: [], remainingSec: null, at },
  );
  const round = { views: { operator: views.operator, partner: two ? views.partner : null }, moves };
  return { state: inputs(moves, at).reduce(applyAction, state), round };
}

/**
 * The whole mission through the reducer on `seed`: both walk past the sign,
 * then every station of the run is worked by its module's solver on the views
 * p1 and p2 hold, a second a round, the open station ticked as the room ticks
 * it. Returns the state once the hatch opens and every station as played, in
 * the run's order.
 */
export function playBlackout(seed: number = PINNED_SEED): { state: GameState; played: Played[] } {
  let state = standing(lightsOut(started(blackoutMission(), seed)), { signSeen: [...CREW] });
  const played: Played[] = [];
  for (let second = 1; state.currentPuzzleIndex < stationsOfRun(state) && second < 900; second++) {
    const index = state.currentPuzzleIndex;
    const def = state.mission.puzzles[index];
    if (def === undefined) {
      break;
    }
    const at = T0 + second * 1000;
    if (state.puzzleState === null) {
      state = switchOn(state, def, at);
      played.push({ def, dealt: state, rounds: [] });
    }
    state = ticked(state, at);
    // The Paketfilter's last wave is clean on the clock, as its last packet reaches the Kern.
    if (state.currentPuzzleIndex !== index) {
      continue;
    }
    const next = roundAt(state, def, at);
    played.at(-1)?.rounds.push(next.round);
    state = next.state;
  }
  return { state, played };
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

/** The Anlaufsteuerung stage by stage: what each opens on, and what the solver sets and closes. */
function anlaufOf(rounds: Round[]): BlackoutPlan['anlauf'] {
  const stages: StartupPlanStage[] = [];
  for (const round of rounds) {
    const views = [seen(round, 'startup'), seen(round, 'startup', 'partner')];
    const typing = views.find((view) => view.role === 'terminal');
    const board = views.find((view) => view.role === 'board');
    if (typing === undefined || board === undefined) {
      throw new Error('blackout plan: the Anlaufsteuerung shows no terminal, or no Schaltfeld');
    }
    if (stages.at(-1)?.stage !== typing.stage) {
      stages.push(stageOf(typing, board));
    }
    const current = stages.at(-1);
    round.moves.forEach((move) => current !== undefined && noted(current, move));
  }
  return { stages };
}

/** The fuse box: its wires, and each round the meter's readings and the wire the box cuts. */
function notstromOf(rounds: Round[]): NonNullable<BlackoutPlan['notstrom']> {
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
function signalketteOf(rounds: Round[]): NonNullable<BlackoutPlan['signalkette']> {
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
function frequenzOf(rounds: Round[]): NonNullable<BlackoutPlan['frequenz']> {
  const lamp = seen(rounds[0], 'morse');
  const turns = rounds
    .flatMap((round) => round.moves)
    .reduce((sum, move) => sum + ('tune' in move.input ? move.input.tune : 0), 0);
  return { pattern: lamp.pattern ?? '', dial: lamp.dial, turns };
}

/** The station of the Wechselplatz as the run played it, under its own id. */
function wechselOf({
  def,
  rounds,
}: Played): Pick<BlackoutPlan, 'signalkette' | 'frequenz' | 'notstrom'> {
  switch (def.type) {
    case 'signal':
      return { signalkette: signalketteOf(rounds) };
    case 'morse':
      return { frequenz: frequenzOf(rounds) };
    case 'circuit':
      return { notstrom: notstromOf(rounds) };
    default:
      throw new Error(`blackout plan: no plan for a ${def.type} at the Wechselplatz`);
  }
}

/** The station of `played` with the id `id`; throws where the run has none. */
function stationOf(played: Played[], id: string): Played {
  const station = played.find((entry) => entry.def.id === id);
  if (station === undefined) {
    throw new Error(`blackout plan: the run has no station "${id}"`);
  }
  return station;
}

/** Where the spare fuse lies and goes, and the reactor's presses within its window. */
function finaleOf(
  mission: Mission,
  played: Played[],
): Pick<BlackoutPlan, 'ersatzsicherung' | 'reaktorstart'> {
  const fuse = mission.map.items.find((item) => item.requiredFor === 'reaktorstart');
  const reactor = stationOf(played, 'reaktorstart');
  if (fuse?.deliverTo === undefined || reactor.def.type !== 'button-sync') {
    throw new Error('blackout plan: the reactor needs its spare fuse and a sync press');
  }
  const presses = inputs(reactor.rounds.flatMap((round) => round.moves), T0).length;
  return {
    ersatzsicherung: { from: { x: fuse.x, y: fuse.y }, to: { ...fuse.deliverTo } },
    reaktorstart: { presses, windowMs: reactor.def.windowMs ?? 0 },
  };
}

/** Blackout on `seed`, as the harness walks it: who starts where, and every station's answer. */
export function blackoutPlan(seed: number = PINNED_SEED): BlackoutPlan {
  const { state, played } = playBlackout(seed);
  const mission = state.mission;
  const spawn = (id: string): Spot => {
    const at = state.players.find((p) => p.id === id)?.spawn;
    if (at == null) {
      throw new Error(`blackout plan: ${id} drew no spawn`);
    }
    return { x: at.x, y: at.y };
  };
  const drawn = drawPools(mission.puzzles, seed)[BLACKOUT_POOL] ?? '';
  const members = mission.puzzles.filter((p) => p.pool === BLACKOUT_POOL).map((p) => p.id);
  const filter = stationOf(played, 'paketfilter');
  return {
    mission: mission.id,
    seed,
    pool: BLACKOUT_POOL,
    drawn,
    outOfService: members.filter((id) => id !== drawn),
    spawns: { host: spawn('p1'), guest: spawn('p2') },
    places: Object.fromEntries(Object.entries(state.places).map(([id, at]) => [id, { ...at }])),
    serial: state.edgework?.serial ?? '',
    anlauf: anlaufOf(stationOf(played, 'anlauf').rounds),
    paketfilter: { waves: wavesOf(filter.def, filter.dealt) },
    subsysteme: subsystemeOf(stationOf(played, 'subsysteme').rounds),
    ...wechselOf(stationOf(played, drawn)),
    ...finaleOf(mission, played),
  };
}

/** What tools/fixtures/blackout-plan.json holds: the pinned seed, and a plan for every draw. */
export interface BlackoutPlans {
  mission: string;
  /** the seed the walkthrough plays to the won card */
  pinned: number;
  /** one plan a draw, the pinned seed's first */
  runs: BlackoutPlan[];
}

/** Every draw's plan, as the harness carries them. */
export function blackoutPlans(): BlackoutPlans {
  return {
    mission: blackoutMission().id,
    pinned: PINNED_SEED,
    runs: Object.values(DRAW_SEEDS).map((seed) => blackoutPlan(seed)),
  };
}
