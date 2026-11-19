import {
  moduleFor,
  type ConsoleId,
  type DemoDoing,
  type MapDef,
  type Mission,
  type PlayerView,
  type PuzzleDef,
  type RelayView,
} from '@escapelab/core';
import {
  armedOn,
  atHand,
  consoleOn,
  emergencyOn,
  nearestOf,
  stepsOver,
  tilesBy,
} from './places.js';
import {
  distance,
  groundOf,
  keyOf,
  middleOf,
  shutOn,
  tileOf,
  wayOver,
  type Spot,
} from './route.js';
import { both, Dice, pause, until, type Clock, type Script } from './script.js';
import type { CrewSeat as Seat } from './seat.js';
import { PACE, workStation, type Hands } from './station.js';
import { Walks } from './walks.js';

/**
 * The crew of two the demo room is played by (host.ts): it starts the run, sits through the
 * opening, and takes the mission station by station as a crew that knows the lab does — a part
 * carried in, the rules read at their source, each at a console, the station worked by its
 * module's solver on what the two seats see (station.ts) — past the drones (walks.ts), through
 * the emergencies, and out through the hatch; then it says yes to the next run.
 *
 * What it knows: the mission as its file has it — where the consoles stand, where a source may
 * lie, the patrols' beats, as a crew knows its lab — and what its two seats' lines carried. It
 * holds no room and no game: all it does is say what a page says.
 */

type Source = MapDef['manuals'][number];
type Part = MapDef['items'][number];
/** An instruction of an emergency at the relay, as its holder's view has it. */
type Order = NonNullable<RelayView['instruction']>;

/** One of the crew at a station: the seat, the thing it stands by, what it does first. */
interface Place {
  seat: Seat;
  /** the tile of the console or the source it takes its place by */
  thing: Spot;
  /** what it does before it takes its place: a part carried in, the rules read */
  first: (() => Script)[];
  /** the tile it stands on, once it has taken its place */
  tile: Spot | null;
  /** the tile it is on its way to, to stand on: the other of the crew takes another */
  bound?: Spot;
  /** it stays where what it did first left it: reading at the source */
  stays?: true;
}

/** The console of an emergency at the relay on `seat`'s view; null while none runs. */
const relayOn = (seat: Seat): RelayView | null => seat.view?.map?.sabotage?.relay ?? null;

/** Whether `a` and `b` are the same tile; false where either is none. */
const same = (a: Spot | undefined, b: Spot | undefined): boolean =>
  a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;

/** What a seat does that nothing else is said of: it stands and waits. */
const IDLE: DemoDoing = { what: 'idle', sourceId: null };

/** How long a figure stands in the open where it works a thing before it is in cover or off, s. */
const HOLD_S = 2.5;

export class DemoCrew {
  private readonly clock: Clock = { now: 0 };
  private readonly dice = new Dice(1);
  private readonly walks: Walks;
  private script: Script | null = null;
  /** nothing is done before this moment: after something went wrong, the crew starts over */
  private idleUntil = 0;
  /** the run the memory below is of, by its `startedAt` */
  private run: number | null = null;
  /** the stations whose rules one of the crew has read at their source this run, by puzzle id */
  private readonly read = new Set<string>();
  /** the plate each seat is asked to hold for the other, by its tile */
  private readonly asked = new Map<Seat, Spot>();
  /** when each instruction of an emergency is carried out, by what it says */
  private readonly orders = new Map<string, number>();
  /** what each seat is doing now, as its script says it (`doing`) */
  private readonly doings = new Map<Seat, DemoDoing>();

  /** `complain` hears what went wrong, for the log: the crew starts over from where it stands. */
  constructor(
    private readonly mission: Mission,
    private readonly seats: readonly [Seat, Seat],
    private readonly complain: (why: string) => void = () => undefined,
  ) {
    this.walks = new Walks(mission, this.clock, () => emergencyOn(this.view));
  }

  /**
   * What `seat` is doing now — walking, carrying, reading at a source, at a console — as the
   * crew's script has it: the demo's director cuts by it (director.ts), and the audience reads it.
   */
  doing(seat: Seat): DemoDoing {
    return this.doings.get(seat) ?? IDLE;
  }

  /** `seat` does `what` for as long as `script` runs, then what it did before. */
  private *as<T>(
    seat: Seat,
    what: DemoDoing['what'],
    script: Script<T>,
    sourceId: string | null = null,
  ): Script<T> {
    const before = this.doings.get(seat);
    this.doings.set(seat, { what, sourceId });
    try {
      return yield* script;
    } finally {
      if (before === undefined) {
        this.doings.delete(seat);
      } else {
        this.doings.set(seat, before);
      }
    }
  }

  /** Both of the crew do `what` for as long as `script` runs. */
  private bothAs(what: DemoDoing['what'], script: Script): Script {
    const [a, b] = this.seats;
    return this.as(a, what, this.as(b, what, script));
  }

  /** The crew's next moment, at `now` (epoch ms): a step of each of its figures, a move, a wait. */
  tick(now: number): void {
    this.clock.now = now;
    this.turnRun();
    this.answerEmergency();
    if (now < this.idleUntil) {
      return;
    }
    this.script ??= this.act();
    try {
      if (this.script.next().done === true) {
        this.script = null;
      }
    } catch (err) {
      this.script = null;
      this.asked.clear();
      this.doings.clear();
      this.idleUntil = now + PACE.againMs;
      this.complain(err instanceof Error ? err.message : String(err));
    }
  }

  /** The view the crew goes by: its first seat's. */
  private get view(): PlayerView | null {
    return this.seats[0].view;
  }

  /** A new run forgets what the last one knew. */
  private turnRun(): void {
    const run = this.view?.startedAt ?? null;
    if (run !== this.run) {
      this.run = run;
      this.read.clear();
      this.asked.clear();
      this.orders.clear();
      this.dice.again();
      this.script = null;
      this.doings.clear();
    }
  }

  /** What the crew does next, by where the room stands. */
  private *act(): Script {
    const view = this.view;
    if (view === null || this.seats.some((seat) => seat.view === null)) {
      yield;
    } else if (view.phase === 'lobby') {
      yield* this.muster();
    } else if (view.phase === 'playing') {
      yield* this.playOn(view);
    } else {
      yield* this.rest();
    }
  }

  /** In the lobby: everybody ready, and the host starts the run. */
  private *muster(): Script {
    yield* pause(this.clock, PACE.lobbyMs);
    for (const seat of this.seats) {
      if (seat.view?.you.isHost !== true && seat.view?.you.ready !== true) {
        seat.say({ kind: 'set-ready', ready: true });
      }
    }
    this.seats.find((seat) => seat.view?.you.isHost)?.say({ kind: 'start-mission' });
    yield* pause(this.clock, PACE.againMs);
  }

  /** After a run: the Auswertung stands for a while, then everybody says yes to the next. */
  private *rest(): Script {
    yield* pause(this.clock, PACE.restMs);
    for (const seat of this.seats) {
      seat.say({ kind: 'set-ready', ready: true });
    }
    yield* pause(this.clock, PACE.againMs);
  }

  /** In a run: the opening sat through, the station up taken, or the way out. */
  private *playOn(view: PlayerView): Script {
    if (!view.lights.out) {
      yield* this.bothAs('intro', this.opening());
    } else if (view.map?.exit?.open === true) {
      yield* this.bothAs('escape', this.escape(view.map.exit));
    } else {
      const armed = armedOn(view);
      const def = this.mission.puzzles.find((puzzle) => puzzle.id === armed);
      if (def === undefined) {
        yield;
      } else {
        yield* this.station(def);
      }
    }
  }

  /** The opening watched for a while, then left by both: the lights go out. */
  private *opening(): Script {
    yield* pause(this.clock, PACE.introMs);
    for (const seat of this.seats) {
      if (seat.view?.intro?.done.includes(seat.id) !== true) {
        seat.say({ kind: 'intro-done' });
      }
    }
    yield* until(() => this.view?.lights.out === true || this.view?.phase !== 'playing');
  }

  /** Both out through the open hatch. */
  private *escape(exit: Spot): Script {
    const hatch = middleOf(exit);
    yield* both(this.walks.to(this.seats[0], hatch), this.walks.to(this.seats[1], hatch));
    yield* until(() => this.view?.phase !== 'playing');
  }

  /** The station of `def`, from the walk up to it to its solve. */
  private *station(def: PuzzleDef): Script {
    const [one, other] = this.castFor(def);
    yield* both(this.settle(one, other), this.settle(other, one));
    const hands: Hands = { operator: one.seat, partner: other.seat };
    const work = workStation(def, hands, { clock: this.clock, dice: this.dice });
    // Who stayed at the source reads on while the other works the console.
    const reads = other.stays === true ? (this.sourceFor(def)?.id ?? null) : null;
    const partner = this.as(other.seat, reads === null ? 'operate' : 'read', work, reads);
    yield* this.as(one.seat, 'operate', partner);
  }

  /** The source that prints the rules of `def`'s station; undefined where none does. */
  private sourceFor(def: PuzzleDef): Source | undefined {
    return this.mission.map.manuals.find((manual) => manual.puzzleIds.includes(def.id));
  }

  /**
   * Who takes which place at the station of `def`, the one who switches it on first: both at a
   * station the whole crew works; one at each console of a station with two; else one at its
   * console and one at its source. Who reads the rules — the nearer to where they may lie — does
   * that first; the other carries in what the station waits for.
   */
  private castFor(def: PuzzleDef): [Place, Place] {
    const { wholeCrew, consoles } = moduleFor(def.type);
    const source = wholeCrew ? undefined : this.sourceFor(def);
    const things: [Spot, Spot] =
      consoles === 2
        ? [this.consoleOf(def, 'a'), this.consoleOf(def, 'b')]
        : [this.consoleOf(def, null), this.consoleOf(def, null)];
    if (source === undefined) {
      const [first, second] = this.shared(things, null);
      return [
        { seat: first, thing: things[0], first: this.errandsFor(def, first), tile: null },
        { seat: second, thing: things[1], first: [], tile: null },
      ];
    }
    return consoles === 2
      ? this.castAtConsoles(def, source, things)
      : this.castWithReader(def, source, things[0]);
  }

  /**
   * A station of one console whose rules lie at `source`: the nearer to the source reads there
   * and stays, the other carries in what the station waits for and works its console.
   */
  private castWithReader(def: PuzzleDef, source: Source, console: Spot): [Place, Place] {
    const reader = this.nearerTo(source.spots[0] ?? console);
    const worker = this.otherThan(reader);
    const study = [(): Script => this.study(reader, source, def)];
    return [
      { seat: worker, thing: console, first: this.errandsFor(def, worker), tile: null },
      { seat: reader, thing: console, first: study, tile: null, stays: true },
    ];
  }

  /**
   * A station of two consoles, at `things`, whose rules lie at `source`: the nearer to the source
   * reads them first, unless the crew has this run; the other carries in what the station waits
   * for; then each takes the console that makes the shorter way for both.
   */
  private castAtConsoles(def: PuzzleDef, source: Source, things: [Spot, Spot]): [Place, Place] {
    const from = this.sourceAt(source.id) ?? source.spots[0] ?? things[0];
    const reader = this.nearerTo(from);
    const study = this.read.has(def.id) ? [] : [(): Script => this.study(reader, source, def)];
    const errands = this.errandsFor(def, this.otherThan(reader));
    const [first, second] = this.shared(things, { seat: reader, from });
    return [
      { seat: first, thing: things[0], first: first === reader ? study : errands, tile: null },
      { seat: second, thing: things[1], first: second === reader ? study : errands, tile: null },
    ];
  }

  /** The seat of the crew that is not `seat`. */
  private otherThan(seat: Seat): Seat {
    return this.seats[0] === seat ? this.seats[1] : this.seats[0];
  }

  /** Where the console `console` of `def`'s station stands, as the crew's view shows it. */
  private consoleOf(def: PuzzleDef, console: ConsoleId | null): Spot {
    const spot = consoleOn(this.seats[0].map, def.id, console);
    if (spot === null) {
      throw new Error(`the view shows no console of "${def.id}"`);
    }
    return spot;
  }

  /**
   * Who of the crew takes the first and who the second of `things` — the consoles of a station:
   * the shorter way for both together, the plate doors taken as open, and `reading` setting out
   * from the source it reads at first.
   */
  private shared(things: [Spot, Spot], reading: { seat: Seat; from: Spot } | null): [Seat, Seat] {
    const [a, b] = this.seats;
    const held = this.plateDoors();
    const steps = (seat: Seat, thing: Spot): number => {
      const ground = groundOf(seat.map, held);
      const from = tileOf(seat === reading?.seat ? middleOf(reading.from) : seat.at);
      const ways = tilesBy(ground, thing, new Set()).map((tile) => stepsOver(ground, from, tile));
      return Math.min(Infinity, ...ways);
    };
    const straight = steps(a, things[0]) + steps(b, things[1]);
    const crossed = steps(b, things[0]) + steps(a, things[1]);
    return straight <= crossed ? [a, b] : [b, a];
  }

  /** The seat standing nearer to the tile `spot`, as the crow flies. */
  private nearerTo(spot: Spot): Seat {
    const [a, b] = this.seats;
    return distance(a.at, middleOf(spot)) <= distance(b.at, middleOf(spot)) ? a : b;
  }

  /** The ids of the mission's doors a plate holds open. */
  private plateDoors(): Set<string> {
    const doors = this.mission.map.doors.filter((door) => door.opensBy.kind === 'plate');
    return new Set(doors.map((door) => door.id));
  }

  /**
   * What `seat` does before the station of `def` is worked, beside reading: the Laborkennung
   * read off its sign where a station of the mission goes by it and nobody has yet, and every
   * part the station waits for carried in.
   */
  private errandsFor(def: PuzzleDef, seat: Seat): (() => Script)[] {
    const parts = this.mission.map.items.filter((item) => item.requiredFor === def.id);
    return [
      () => this.as(seat, 'sign', this.readSign(seat)),
      ...parts.map((part) => () => this.as(seat, 'carry', this.carryIn(seat, part))),
    ];
  }

  /**
   * `me` does what it does first, then takes its place by its thing and stays — stepping onto a
   * plate meanwhile whenever `other` asks for one, and back after — until both have taken theirs.
   */
  private *settle(me: Place, other: Place): Script {
    for (const errand of me.first) {
      yield* this.holding(me);
      yield* errand();
    }
    if (me.stays === true) {
      me.tile = tileOf(me.seat.at);
    }
    while (me.tile === null || other.tile === null) {
      yield* this.holding(me);
      if (me.tile === null) {
        yield* this.as(me.seat, 'walk', this.takePlace(me, other));
      } else {
        yield;
      }
    }
  }

  /**
   * While `me` is asked to hold a plate: off its place, onto the plate, and there until the ask
   * is over.
   */
  private *holding(me: Place): Script {
    const plate = this.asked.get(me.seat);
    if (plate !== undefined) {
      me.tile = null;
      const held = until(() => !same(this.asked.get(me.seat), plate));
      yield* this.as(me.seat, 'walk', this.walks.to(me.seat, middleOf(plate)));
      yield* this.as(me.seat, 'plate', held);
    }
  }

  /**
   * `me` walks to its place by its thing, a tile `other` neither stands on nor is bound for; where
   * a door a plate opens stands shut in the way, `other` is asked onto the plate and the walk
   * waits a tick.
   */
  private *takePlace(me: Place, other: Place): Script {
    const { seat, thing } = me;
    const tile = this.tileBy(seat, thing, other.tile ?? other.bound ?? null);
    me.bound = tile;
    if (this.walks.reaches(seat, tile)) {
      yield* this.walks.to(seat, middleOf(tile), HOLD_S);
      seat.lookAt(middleOf(thing));
      me.tile = tile;
      this.asked.delete(other.seat);
      return;
    }
    this.asked.set(other.seat, this.plateTo(seat, tile));
    yield;
  }

  /**
   * The tile `seat` stands on to work or read the thing on `thing`: beside it, a haven where
   * there is one, never `taken`; the nearest of the best, the plate doors taken as open.
   */
  private tileBy(seat: Seat, thing: Spot, taken: Spot | null = null): Spot {
    const held = this.plateDoors();
    const safe = this.walks.havensFor(seat);
    const tiles = tilesBy(groundOf(seat.map, held), thing, safe).filter(
      (tile) => taken === null || keyOf(tile) !== keyOf(taken),
    );
    const tile = nearestOf(seat.map, tileOf(seat.at), tiles, safe, held);
    if (tile === null) {
      throw new Error(`${seat.name} finds no tile to stand on by ${keyOf(thing)}`);
    }
    return tile;
  }

  /** The plate that opens the first shut door on `seat`'s way to `goal`; throws where none does. */
  private plateTo(seat: Seat, goal: Spot): Spot {
    const way = wayOver(groundOf(seat.map, this.plateDoors()), tileOf(seat.at), goal) ?? [];
    const shut = shutOn(seat.map);
    const stop = way.find((tile) => shut.has(keyOf(tile)));
    const door = this.mission.map.doors.find((d) => d.x === stop?.x && d.y === stop.y);
    const plateId = door?.opensBy.kind === 'plate' ? door.opensBy.plateId : undefined;
    const plate = this.mission.map.plates.find((p) => p.id === plateId);
    if (plate === undefined) {
      throw new Error(`no way for ${seat.name} to ${keyOf(goal)}, and no plate opens one`);
    }
    return { x: plate.x, y: plate.y };
  }

  /** Where the crew has seen the source `id` lie: its tile; null while nobody has. */
  private sourceAt(id: string): Spot | null {
    for (const seat of this.seats) {
      const seen = seat.view?.map?.manuals.find((manual) => manual.id === id);
      if (seen !== undefined) {
        return { x: seen.x, y: seen.y };
      }
    }
    return null;
  }

  /**
   * `seat` reads the rules of `def`'s station at `source`: a cabinet's key fetched first, the
   * source looked for where it may lie, opened where it is shut, and read for a while.
   */
  private *study(seat: Seat, source: Source, def: PuzzleDef): Script {
    const key = this.mission.map.items.find((item) => item.id === source.needsKey);
    if (key !== undefined && !this.opened(source)) {
      yield* this.as(seat, 'carry', this.take(seat, key));
    }
    const at = yield* this.as(seat, 'walk', this.lookFor(seat, source));
    yield* this.as(seat, 'read', this.readAt(seat, source, at), source.id);
    const pages = seat.view?.manualsHere.flatMap((manual) => manual.sections) ?? [];
    if (!pages.some((page) => page.puzzleId === def.id)) {
      throw new Error(`${seat.name} reads nothing of "${def.id}" at ${source.id}`);
    }
    this.read.add(def.id);
  }

  /** `seat`, standing by `source` on the tile `at`, opens it where it is shut and reads a while. */
  private *readAt(seat: Seat, source: Source, at: Spot): Script {
    yield* this.open(seat, source, at);
    yield* pause(this.clock, this.dice.between(PACE.read));
  }

  /** Whether the crew knows `source` to stand open. */
  private opened(source: Source): boolean {
    return this.seats.some((seat) =>
      seat.view?.map?.manuals.some((m) => m.id === source.id && m.known && m.opened),
    );
  }

  /**
   * `seat` walks to where `source` lies — to each spot it may lie on in turn, until one of the
   * crew has seen it — and stands by it, at hand: its tile.
   */
  private *lookFor(seat: Seat, source: Source): Script<Spot> {
    const tried: Spot[] = [];
    for (;;) {
      const target =
        this.sourceAt(source.id) ?? source.spots.find((spot) => !tried.some((t) => same(t, spot)));
      if (target === undefined) {
        throw new Error(`${seat.name} did not find ${source.id} where it may lie`);
      }
      tried.push(target);
      yield* this.walks.to(seat, atHand(this.tileBy(seat, target), target), HOLD_S);
      seat.lookAt(middleOf(target));
      yield* pause(this.clock, this.dice.between(PACE.look));
      // Seen from the wrong spot, it lies on the other: the next round walks up to it.
      if (same(this.sourceAt(source.id) ?? undefined, target)) {
        return target;
      }
    }
  }

  /** `seat`, standing by `source` on the tile `at`, opens it where it is shut. */
  private *open(seat: Seat, source: Source, at: Spot): Script {
    const here = (): boolean =>
      seat.view?.sourcesHere.some((s) => s.id === source.id && s.opened) === true;
    if (here()) {
      return;
    }
    yield* pause(this.clock, this.dice.between(PACE.press));
    if (source.needsKey === undefined) {
      seat.say({ kind: 'open-source', manualId: source.id });
    } else {
      seat.press();
    }
    yield* pause(this.clock, this.dice.between(PACE.look));
    if (!here()) {
      throw new Error(`${source.id} at ${keyOf(at)} did not open for ${seat.name}`);
    }
  }

  /** Where the part `part` lies or is carried, as the crew's views have it. */
  private partOn(part: Part): { tile: Spot; carriedBy: string | null; delivered: boolean } {
    for (const seat of this.seats) {
      const seen = seat.view?.map?.items.find((item) => item.id === part.id);
      if (seen?.known === true) {
        return { tile: tileOf(seen), carriedBy: seen.carriedBy, delivered: seen.delivered };
      }
    }
    return { tile: { x: part.x, y: part.y }, carriedBy: null, delivered: false };
  }

  /** `seat` takes up `part` where it lies. */
  private *take(seat: Seat, part: Part): Script {
    const { tile, carriedBy, delivered } = this.partOn(part);
    if (carriedBy === seat.id || delivered) {
      return;
    }
    yield* this.walks.to(seat, middleOf(tile), HOLD_S);
    yield* pause(this.clock, this.dice.between(PACE.press));
    seat.press();
    yield* pause(this.clock, this.dice.between(PACE.look));
    if (this.partOn(part).carriedBy !== seat.id) {
      throw new Error(`${seat.name} did not take up ${part.id} at ${keyOf(tile)}`);
    }
  }

  /** `seat` fetches `part` and sets it in where it belongs. */
  private *carryIn(seat: Seat, part: Part): Script {
    if (part.deliverTo === undefined || this.partOn(part).delivered) {
      return;
    }
    yield* this.take(seat, part);
    const goal = part.deliverTo;
    yield* this.walks.to(seat, atHand(this.tileBy(seat, goal), goal), HOLD_S);
    seat.lookAt(middleOf(goal));
    yield* pause(this.clock, this.dice.between(PACE.press));
    seat.press();
    yield* pause(this.clock, this.dice.between(PACE.look));
    if (!this.partOn(part).delivered) {
      throw new Error(`${part.id} did not go in at ${keyOf(goal)}`);
    }
  }

  /**
   * `seat` walks up to the Laborkennung's sign where a station of the mission reads from it and
   * nobody of the crew has yet.
   */
  private *readSign(seat: Seat): Script {
    const sign = this.mission.map.edgeworkSign;
    const needed = this.mission.puzzles.some((puzzle) => moduleFor(puzzle.type).usesEdgework);
    const known = (): boolean => this.seats.some((s) => s.view?.edgework != null);
    if (sign === undefined || !needed || known()) {
      return;
    }
    yield* this.walks.to(seat, middleOf(this.tileBy(seat, sign)), HOLD_S);
    seat.lookAt(middleOf(sign));
    yield* pause(this.clock, this.dice.between(PACE.look));
    if (!known()) {
      throw new Error(`${seat.name} did not read the sign at ${keyOf(sign)}`);
    }
  }

  /**
   * An emergency at the relay: each instruction one of the crew holds is carried out at the
   * console it names, a while after it came up — read out, found, done.
   */
  private answerEmergency(): void {
    if (!emergencyOn(this.view)) {
      this.orders.clear();
      return;
    }
    for (const holder of this.seats) {
      const order = relayOn(holder)?.instruction ?? null;
      if (order !== null) {
        this.answer(holder, order);
      }
    }
  }

  /** `order`, which `holder` reads out, carried out once its while is over: once. */
  private answer(holder: Seat, order: Order): void {
    const key = `${holder.id}|${order.control}|${String(order.value)}|${order.expiresAt}`;
    const due = this.orders.get(key) ?? this.clock.now + this.dice.between(PACE.relay);
    this.orders.set(key, due);
    if (this.clock.now < due) {
      return;
    }
    for (const owner of this.seats.filter((seat) => seat.name === order.playerName)) {
      const control = relayOn(owner)?.controls.find((c) => c.name === order.control);
      if (control !== undefined) {
        const input = { kind: 'set', control: control.id, value: order.value };
        owner.say({ kind: 'puzzle-input', input });
        this.orders.set(key, Infinity);
      }
    }
  }
}
