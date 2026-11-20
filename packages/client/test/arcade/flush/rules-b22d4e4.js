// The rules of Ferret Flush, with no drawing and no browser in them, so every rule can be tested:
// three games, rounds of ten targets, three shells per flush, a pass mark that rises, ducks and
// clay discs that get faster, and what the ferret is busy with. The page calls update() once per
// frame and reads the state; what happened in that frame is listed in game.events.

import { angleDelta, clamp, lerp } from './kit-b22d4e4.js';

export const W = 1280;
export const H = 720;
/** The sky the ducks fly in: they turn back at its edges. */
export const FIELD = { left: 70, right: W - 70, top: 112, bottom: 452 };
/** Ducks rise from behind the bank at this height and fall back to it. */
export const REED_LINE = 640;
export const SHELLS = 3;
export const ROUND_TARGETS = 10;
export const DUCK_HIT_R = 50;
export const CLAY_HIT_R = 36;
export const CLAY_POINTS = 100;
export const PERFECT_BONUS = 1000;
/** Where the ferret watches the clay discs from. */
export const SPECTATOR_X = 150;

export const MODES = {
	single: { target: 'duck', perWave: 1 },
	pair: { target: 'duck', perWave: 2 },
	clay: { target: 'clay', perWave: 2 }
};

/** The rarer the duck, the faster it flies and turns, and the more it is worth. */
export const KINDS = [
	{ name: 'mallard', points: 100, speed: 1, turn: 1 },
	{ name: 'pintail', points: 150, speed: 1.12, turn: 1.3 },
	{ name: 'ruddy duck', points: 250, speed: 1.25, turn: 1.7 }
];

export const CLAY_INTRO = 1.7;
export const LAUNCH_TIME = 0.7;
export const HIT_STUN = 0.24;
/** Seconds the ferret is up after a flush, by its mood. */
export const RETRIEVE_TIME = { proud: 1.7, double: 2.1, flop: 2.2, cheer: 1, nod: 0.9, shrug: 1 };
export const TALLY_STEP = 0.13;
export const TALLY_HOLD = 0.7;
export const CLEARED_TIME = 2.6;
export const FAILED_TIME = 2.8;

const TURN_RATE = 5.5;
const MAX_PITCH = 0.95;
const GRAVITY = 1500;
const OUT_OF_SHELLS_WAIT = 0.3;
const IN_THE_AIR = new Set(['waiting', 'rising', 'flying']);
const CAN_BE_HIT = new Set(['rising', 'flying']);

/** The ferret's entrance in seconds: it runs in, sniffs, stands alert and pounces. */
export function introPlan(round) {
	const [run, sniff, alert, pounce] = round === 1 ? [1.5, 1.2, 0.7, 0.7] : [0.9, 0, 0.4, 0.6];
	return { run, sniff, alert, pounce, total: run + sniff + alert + pounce };
}

/** How many of the ten targets a round needs: six at first, one more every five rounds. */
export function quotaFor(round) {
	return clamp(6 + Math.floor((round - 1) / 5), 6, ROUND_TARGETS);
}

/** Points are worth more every five rounds, up to four times. */
export function multiplier(round) {
	return clamp(1 + Math.floor((round - 1) / 5), 1, 4);
}

export function pointsFor(target, kind, round) {
	return (target === 'clay' ? CLAY_POINTS : KINDS[kind].points) * multiplier(round);
}

/** Pixels per second: every round is faster, up to round 23. */
export function duckSpeed(round, kind) {
	return (235 + 17 * Math.min(round - 1, 22)) * KINDS[kind].speed;
}

/** Seconds before the ducks of a flush leave on their own. */
export function flightTime(round, perWave) {
	return Math.max(3.4, 5.6 - 0.09 * (round - 1)) + (perWave - 1) * 1.6;
}

/** Seconds a clay disc stays in the air. */
export function clayTime(round) {
	return Math.max(1.7, 3 - 0.065 * (round - 1));
}

/** Targets hit so far in this round. */
export function hitCount(game) {
	return game.tracker.filter((mark) => mark === 'hit').length;
}

export function createGame({ rng = Math.random, best = {} } = {}) {
	return {
		rng,
		screen: 'title',
		mode: 'single',
		phase: 'intro',
		phaseTime: 0,
		time: 0,
		round: 0,
		score: 0,
		best: { single: 0, pair: 0, clay: 0, ...best },
		newBest: false,
		shells: SHELLS,
		wave: 0,
		tracker: [],
		birds: [],
		caught: [],
		nextId: 1,
		flightLeft: 0,
		fleeIn: null,
		lastX: W / 2,
		ferret: { side: 1, flushX: W / 2, fromX: W / 2, popX: W / 2, mood: 'idle', catch: [] },
		tally: { shown: 0, hits: 0, perfect: false, bonus: 0 },
		stats: { shots: 0, hits: 0 },
		events: []
	};
}

/** A new game of one of the three kinds: score and rounds from the start. */
export function startGame(game, mode) {
	game.mode = mode;
	game.screen = 'playing';
	game.round = 0;
	game.score = 0;
	game.newBest = false;
	game.stats = { shots: 0, hits: 0 };
	game.events.push({ type: 'start', mode });
	startRound(game);
}

/** One frame. `input` is where the sight is, whether it fired, and a choice made on a menu. */
export function update(game, dt, input) {
	game.time += dt;
	if (game.screen === 'title') {
		if (Object.hasOwn(MODES, input.choose ?? '')) startGame(game, input.choose);
	} else if (input.choose === 'menu') {
		game.screen = 'title';
		game.birds = [];
	} else if (game.screen === 'over') {
		if (input.choose === 'again') startGame(game, game.mode);
	} else {
		game.phaseTime += dt;
		PHASES[game.phase](game, dt, input);
	}
}

const clayGame = (game) => MODES[game.mode].target === 'clay';

function setPhase(game, phase) {
	game.phase = phase;
	game.phaseTime = 0;
}

/** A place in the reeds for the next flush, away from the edges. */
function spot(game) {
	return lerp(260, W - 260, game.rng());
}

function startRound(game) {
	game.round++;
	game.wave = 0;
	game.tracker = Array(ROUND_TARGETS).fill('wait');
	game.birds = [];
	game.shells = SHELLS;
	game.tally = { shown: 0, hits: 0, perfect: false, bonus: 0 };
	game.ferret.side = game.rng() < 0.5 ? 1 : -1;
	game.ferret.flushX = spot(game);
	game.ferret.mood = 'idle';
	setPhase(game, 'intro');
	game.events.push({ type: 'round', round: game.round, quota: quotaFor(game.round) });
}

/** True in the one frame in which the clock of the phase passes `at`. */
function passes(game, dt, at) {
	return game.phaseTime >= at && game.phaseTime - dt < at;
}

function intro(game, dt) {
	if (clayGame(game)) {
		if (game.phaseTime >= CLAY_INTRO) beginLaunch(game);
		return;
	}
	const plan = introPlan(game.round);
	if (plan.sniff && passes(game, dt, plan.run)) game.events.push({ type: 'sniff' });
	if (passes(game, dt, plan.run + plan.sniff)) game.events.push({ type: 'alert' });
	if (passes(game, dt, plan.total - plan.pounce)) game.events.push({ type: 'pounce' });
	if (game.phaseTime < plan.total) return;
	game.events.push({ type: 'flush', x: game.ferret.flushX });
	launchWave(game);
}

/** The pause between two flushes: the hidden ferret dashes to a new spot, or a disc is called. */
function beginLaunch(game) {
	const { ferret } = game;
	ferret.fromX = ferret.popX;
	setPhase(game, 'launch');
	if (clayGame(game)) {
		game.events.push({ type: 'pull' });
		return;
	}
	ferret.flushX = spot(game);
	game.events.push({ type: 'scurry', from: ferret.fromX, to: ferret.flushX });
}

function launch(game) {
	if (game.phaseTime >= LAUNCH_TIME) launchWave(game);
}

function launchWave(game) {
	const { target, perWave } = MODES[game.mode];
	game.shells = SHELLS;
	game.caught = [];
	game.fleeIn = null;
	game.flightLeft = flightTime(game.round, perWave);
	for (let i = 0; i < perWave; i++) {
		const slot = game.wave * perWave + i;
		game.tracker[slot] = 'live';
		game.birds.push(target === 'clay' ? makeClay(game, slot, i) : makeDuck(game, slot, i));
	}
	setPhase(game, 'flight');
	for (const bird of game.birds) if (bird.state !== 'waiting') announce(game, bird);
}

function announce(game, bird) {
	const { type: target, kind, x, y } = bird;
	game.events.push({ type: 'launch', target, kind, x, y });
}

/** Mallards are common; pintails and ruddy ducks turn up more often in later rounds. */
function pickKind(game) {
	const roll = game.rng();
	const ruddy = Math.min(0.06 + 0.02 * game.round, 0.3);
	const pintail = Math.min(0.18 + 0.03 * game.round, 0.4);
	if (roll < ruddy) return 2;
	return roll < ruddy + pintail ? 1 : 0;
}

function makeDuck(game, slot, index) {
	const kind = pickKind(game);
	const first = game.birds[0];
	const side = first ? -first.facing : game.rng() < 0.5 ? -1 : 1;
	const heading = -Math.PI / 2 + side * (0.3 + game.rng() * 0.45);
	return {
		id: game.nextId++,
		type: 'duck',
		kind,
		slot,
		state: 'rising',
		x: clamp(game.ferret.flushX + index * side * 70, FIELD.left + 30, FIELD.right - 30),
		y: REED_LINE,
		heading,
		target: heading,
		turnIn: 0,
		speed: duckSpeed(game.round, kind),
		facing: side,
		flip: side,
		age: 0,
		stun: 0,
		vx: 0,
		vy: 0,
		angle: 0,
		spin: 0
	};
}

/** Two discs leave one trap in opposite directions, the second a moment after the first. */
function makeClay(game, slot, index) {
	const first = game.birds[0];
	const x0 = first ? first.x0 : lerp(W / 2 - 280, W / 2 + 280, game.rng());
	const dir = first ? -first.dir : game.rng() < 0.5 ? -1 : 1;
	return {
		id: game.nextId++,
		type: 'clay',
		kind: 0,
		slot,
		state: index ? 'waiting' : 'flying',
		dir,
		x0,
		x1: clamp(x0 + dir * (140 + game.rng() * 330), FIELD.left + 40, FIELD.right - 40),
		y1: 395 + game.rng() * 30,
		arc: 290 + game.rng() * 90,
		delay: index * 0.45,
		age: 0,
		life: clayTime(game.round),
		x: x0,
		y: REED_LINE,
		scale: 1.2
	};
}

/** A new direction: mostly onward, sometimes back, never straight up or down. */
function retarget(game, duck) {
	const onward = Math.cos(duck.heading) < 0 ? -1 : 1;
	const side = game.rng() < 0.32 ? -onward : onward;
	const pitch = (game.rng() * 2 - 1) * MAX_PITCH;
	duck.target = side > 0 ? pitch : Math.PI - pitch;
	duck.turnIn = (0.35 + game.rng() * 0.85) / KINDS[duck.kind].turn;
}

function advance(duck, dt) {
	const turn = TURN_RATE * KINDS[duck.kind].turn * dt;
	duck.heading += clamp(angleDelta(duck.heading, duck.target), -turn, turn);
	duck.x += Math.cos(duck.heading) * duck.speed * dt;
	duck.y += Math.sin(duck.heading) * duck.speed * dt;
	const across = Math.cos(duck.heading);
	if (Math.abs(across) > 0.25) duck.facing = across < 0 ? -1 : 1;
	duck.flip = clamp(duck.flip + clamp(duck.facing - duck.flip, -9 * dt, 9 * dt), -1, 1);
}

const beyond = (value, low, high, motion) =>
	(value < low && motion < 0) || (value > high && motion > 0);

/** A duck that reaches an edge of the field bounces off it. */
function turnBack(duck) {
	if (beyond(duck.x, FIELD.left, FIELD.right, Math.cos(duck.heading))) {
		duck.heading = Math.PI - duck.heading;
		duck.target = Math.PI - duck.target;
	}
	const free = duck.state === 'flying';
	if (free && beyond(duck.y, FIELD.top, FIELD.bottom, Math.sin(duck.heading))) {
		duck.heading = -duck.heading;
		duck.target = -duck.target;
	}
}

const DUCK_MOVES = {
	rising(game, duck, dt) {
		advance(duck, dt);
		turnBack(duck);
		if (duck.y < FIELD.bottom - 50) duck.state = 'flying';
	},
	flying(game, duck, dt) {
		duck.turnIn -= dt;
		if (duck.turnIn <= 0) retarget(game, duck);
		advance(duck, dt);
		turnBack(duck);
	},
	fleeing(game, duck, dt) {
		advance(duck, dt);
		if (duck.y < -90) duck.state = 'gone';
	},
	falling(game, duck, dt) {
		duck.stun -= dt;
		if (duck.stun > 0) return;
		duck.vy += GRAVITY * dt;
		duck.x += duck.vx * dt;
		duck.y += duck.vy * dt;
		duck.angle += duck.spin * dt;
		if (duck.y < REED_LINE) return;
		duck.state = 'gone';
		game.lastX = duck.x;
		game.events.push({ type: 'landed', x: duck.x, kind: duck.kind });
	}
};

/** A disc flies away from you: it slows on the screen and shrinks until it lands far off. */
function moveClay(game, clay, dt) {
	clay.age += dt;
	if (clay.state === 'waiting') {
		if (clay.age < clay.delay) return;
		clay.state = 'flying';
		clay.age = 0;
		announce(game, clay);
	}
	const away = 1 - (1 - Math.min(clay.age / clay.life, 1)) ** 1.7;
	clay.x = lerp(clay.x0, clay.x1, away);
	clay.y = lerp(REED_LINE, clay.y1, away) - clay.arc * 4 * away * (1 - away);
	clay.scale = lerp(1.2, 0.34, away);
	if (clay.age < clay.life) return;
	clay.state = 'gone';
	game.tracker[clay.slot] = 'miss';
	game.events.push({ type: 'lost', x: clay.x, y: clay.y });
}

function moveBirds(game, dt) {
	for (const bird of game.birds) {
		if (bird.type === 'clay') moveClay(game, bird, dt);
		else {
			bird.age += dt;
			DUCK_MOVES[bird.state](game, bird, dt);
		}
	}
	game.birds = game.birds.filter((bird) => bird.state !== 'gone');
}

/** The target nearest to the shot and inside its hit circle, or null. A far disc is small. */
function targetAt(game, x, y) {
	let nearest = null;
	let least = Infinity;
	for (const bird of game.birds) {
		if (!CAN_BE_HIT.has(bird.state)) continue;
		const reach = bird.type === 'clay' ? Math.max(18, CLAY_HIT_R * bird.scale) : DUCK_HIT_R;
		const distance = Math.hypot(bird.x - x, bird.y - y);
		if (distance <= reach && distance < least) {
			nearest = bird;
			least = distance;
		}
	}
	return nearest;
}

function strike(game, bird) {
	const { type: target, kind, x, y } = bird;
	const value = pointsFor(target, kind, game.round);
	game.score += value;
	game.stats.hits++;
	game.tracker[bird.slot] = 'hit';
	game.caught.push(kind);
	game.events.push({ type: 'hit', target, kind, x, y, scale: bird.scale ?? 1, value });
	if (target === 'clay') {
		bird.state = 'gone';
		return;
	}
	bird.state = 'falling';
	bird.stun = HIT_STUN;
	bird.vx = Math.cos(bird.heading) * bird.speed * 0.25;
	bird.vy = -190;
	bird.spin = bird.facing * (7 + game.rng() * 4);
}

/** One shell: it brings down at most one target. Without shells the hammer only clicks. */
function shoot(game, x, y) {
	if (game.shells === 0) {
		game.events.push({ type: 'dry' });
		return;
	}
	game.shells--;
	game.stats.shots++;
	game.events.push({ type: 'shot', x, y, shells: game.shells });
	const bird = targetAt(game, x, y);
	if (bird) strike(game, bird);
	else game.events.push({ type: 'miss', x, y });
	if (game.shells === 0) game.fleeIn = OUT_OF_SHELLS_WAIT;
}

/** Ducks that were not hit leave over the top: when the time is up or the shells are gone. */
function flee(game, ducks) {
	for (const duck of ducks) {
		duck.state = 'fleeing';
		duck.target = -Math.PI / 2 + duck.facing * 0.3;
		duck.speed *= 1.7;
		game.tracker[duck.slot] = 'miss';
		game.lastX = duck.x;
	}
	game.events.push({ type: 'away', count: ducks.length });
}

function flight(game, dt, input) {
	if (input.fire) shoot(game, input.x, input.y);
	moveBirds(game, dt);
	game.flightLeft -= dt;
	if (game.fleeIn !== null) game.fleeIn -= dt;
	const aloft = game.birds.filter((bird) => IN_THE_AIR.has(bird.state));
	if (aloft.length === 0) {
		setPhase(game, 'settle');
		return;
	}
	const spent = game.fleeIn !== null && game.fleeIn <= 0;
	if (!clayGame(game) && (spent || game.flightLeft <= 0)) flee(game, aloft);
}

/** After the shooting: hit ducks fall into the reeds, the others leave the sky. */
function settle(game, dt) {
	moveBirds(game, dt);
	if (game.birds.length > 0) return;
	const clay = clayGame(game);
	const moods = clay ? ['shrug', 'nod', 'cheer'] : ['flop', 'proud', 'double'];
	const { ferret } = game;
	ferret.mood = moods[game.caught.length];
	ferret.catch = clay ? [] : game.caught;
	ferret.popX = clay ? SPECTATOR_X : clamp(game.lastX, 190, W - 190);
	setPhase(game, 'retrieve');
	game.events.push({ type: 'popup', mood: ferret.mood, x: ferret.popX });
}

/** The ferret shows what it found, or what it thinks; then the next flush or the count. */
function retrieve(game) {
	if (game.phaseTime < RETRIEVE_TIME[game.ferret.mood]) return;
	game.wave++;
	game.ferret.mood = 'idle';
	if (game.wave * MODES[game.mode].perWave < ROUND_TARGETS) beginLaunch(game);
	else setPhase(game, 'tally');
}

/** The ten targets are counted one by one; then the round is passed or lost. */
function tally(game) {
	const count = game.tally;
	const due = Math.min(ROUND_TARGETS, Math.floor(game.phaseTime / TALLY_STEP));
	while (count.shown < due) {
		const hit = game.tracker[count.shown] === 'hit';
		if (hit) count.hits++;
		game.events.push({ type: 'tick', index: count.shown, hit, hits: count.hits });
		count.shown++;
	}
	if (game.phaseTime < ROUND_TARGETS * TALLY_STEP + TALLY_HOLD) return;
	const quota = quotaFor(game.round);
	if (count.hits < quota) {
		setPhase(game, 'failed');
		game.events.push({ type: 'failed', hits: count.hits, quota });
		return;
	}
	count.perfect = count.hits === ROUND_TARGETS;
	count.bonus = count.perfect ? PERFECT_BONUS * multiplier(game.round) : 0;
	game.score += count.bonus;
	setPhase(game, 'cleared');
	const { perfect, bonus } = count;
	game.events.push({ type: 'cleared', round: game.round, perfect, bonus });
}

function cleared(game) {
	if (game.phaseTime >= CLEARED_TIME) startRound(game);
}

function failed(game) {
	if (game.phaseTime < FAILED_TIME) return;
	game.screen = 'over';
	game.newBest = game.score > game.best[game.mode];
	if (game.newBest) game.best[game.mode] = game.score;
	game.events.push({ type: 'over', score: game.score, newBest: game.newBest });
}

const PHASES = { intro, launch, flight, settle, retrieve, tally, cleared, failed };
