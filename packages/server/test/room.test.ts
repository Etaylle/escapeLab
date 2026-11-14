import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  moduleFor,
  parseMission,
  scaleMission,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

/** The host's start now requires everyone else to have confirmed. */
function ready(room: Room, ...players: { playerId: string }[]): void {
  for (const player of players) {
    room.setReady(player.playerId, true);
  }
}

const load = (id: string): Mission =>
  parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${id}.json`, import.meta.url), 'utf8')),
  );

/**
 * The tutorial: a press for the whole crew in the Leitstand (12,1), the
 * Signalprobe at its two consoles there, a (8,5) and b (13,5), the wiring
 * box in the Kontrolle (2,4) behind a door held by the plate (7,2), whose
 * rules lie in the locker (7,1) beside the plate, and the finale in the
 * Spulen (16,4). Its spawns are (8,1) beside the locker and (12,4) beside the
 * sign (13,3).
 */
const mission = load('systemcheck');

/** Collects every message pushed to one player. */
function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]) {
  const views = messages.filter((m) => m.kind === 'view');
  const last = views.at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected at least one view message');
  }
  return last.view;
}

/** The first part of the map, as the last view tells it once known; undefined till then. */
function firstPart(messages: ServerMessage[]) {
  const item = lastView(messages).map?.items[0];
  return item?.known === true ? item : undefined;
}

/** Anna and Ben connected, each with how to let go of their connection (`detach`). */
function fullLobby(room: Room) {
  const seat = (name: string) => {
    const player = { ...room.join(name, passFor(name)), ...collector() };
    return { ...player, detach: room.attach(player.playerId, player.listen) };
  };
  return { anna: seat('Anna'), ben: seat('Ben') };
}

/**
 * A started run with Anna on the mission's first spawn and Ben on the
 * second — in the tutorial, Anna beside the book and Ben beside the sign.
 * The room draws the spawns, so runs are started until it draws that way.
 */
function startedRoom(fixture: Mission = mission) {
  const [first] = fixture.map.spawns;
  for (let attempt = 0; attempt < 64; attempt++) {
    const room = new Room('TEST', fixture);
    const crew = fullLobby(room);
    ready(room, crew.ben);
    room.act(crew.anna.playerId, { kind: 'start-mission' });
    if (JSON.stringify(lastView(crew.anna.messages).map?.yourSpawn) === JSON.stringify(first)) {
      return { room, ...crew };
    }
    room.dispose();
  }
  throw new Error('64 runs, and Anna never drew the first spawn');
}

/** Walk an avatar to a tile; the room derives plates, presence and interact range from this. */
function moveTo(room: Room, player: Walker, x: number, y: number): void {
  walkTo(room, player, x + 0.5, y + 0.5);
}

/** Walk an avatar to an exact spot, in tiles. */
function placeAt(room: Room, player: Walker, x: number, y: number): void {
  walkTo(room, player, x, y);
}

describe('Room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Station 2, the Signalprobe: Anna walks up to console a, Ben to console b,
   * Anna switches it on, and every stage is pressed at the console that
   * receives it, worked out from the two views alone.
   */
  function sendSignals(room: Room, anna: Walker, ben: Walker): void {
    const signal = mission.puzzles[1];
    moveTo(room, anna, 8, 4);
    moveTo(room, ben, 13, 4);
    pressE(room, anna);
    while (lastView(anna.messages).currentPuzzleIndex === 1) {
      const operator = lastView(anna.messages).puzzle;
      const partner = lastView(ben.messages).puzzle;
      if (signal?.type !== 'signal' || operator === null || partner === null) {
        throw new Error('expected the open Signalprobe');
      }
      const views = { operator, partner, reader: operator };
      const moves = moduleFor(signal.type).solve(signal, views, null);
      if (moves.length === 0) {
        throw new Error('the Signalprobe is open, but its views show nothing to press');
      }
      for (const { by, input } of moves) {
        room.act((by === 'partner' ? ben : anna).playerId, { kind: 'puzzle-input', input });
      }
    }
  }

  it('runs a full game: all at the press, the box read at the locker, out by the hatch', () => {
    const { room, anna, ben } = startedRoom();
    // Ben walked past the sign on his first step; Anna stands at the locker, still shut.
    expect(lastView(ben.messages).presence.signSeen).toBe(true);
    expect(lastView(anna.messages).sourcesHere).toEqual([
      { id: 'spind-leitstand', kind: 'locker', label: 'SPIND', opened: false, needsKey: null },
    ]);
    expect(lastView(anna.messages).presence.manualId).toBeNull();

    // Station 1 sits in the Leitstand: the whole crew walks there and presses.
    moveTo(room, ben, 12, 2);
    moveTo(room, anna, 11, 1);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(1);

    // Station 2 is the Signalprobe, worked from its two consoles in the Leitstand.
    sendSignals(room, anna, ben);
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(2);

    // Station 3 is wiring: Anna holds the Kontrolle door and searches the locker beside it, Ben
    // works the box.
    moveTo(room, anna, 7, 2);
    expect(lastView(ben.messages).map?.doors.find((d) => d.id === 'kontrolltuer')?.open).toBe(true);
    room.act(anna.playerId, { kind: 'open-source', manualId: 'spind-leitstand' });
    expect(lastView(anna.messages).presence.manualId).toBe('spind-leitstand');
    moveTo(room, ben, 2, 3);
    pressE(room, ben);
    const wiring = mission.puzzles[2];
    const annaView = lastView(anna.messages);
    const benView = lastView(ben.messages);
    if (wiring === undefined || annaView.puzzle === null || benView.puzzle === null) {
      throw new Error('expected the open wiring station');
    }
    const views = { operator: benView.puzzle, reader: annaView.puzzle };
    for (const { input } of moduleFor(wiring.type).solve(wiring, views, benView.edgework)) {
      room.act(ben.playerId, { kind: 'puzzle-input', input });
    }
    expect(lastView(anna.messages).currentPuzzleIndex).toBe(3);
    // Solving it opened the Spulen for good.
    expect(lastView(ben.messages).map?.doors.find((d) => d.id === 'halteschott')?.open).toBe(true);

    moveTo(room, ben, 16, 3);
    moveTo(room, anna, 16, 5);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });

    // All puzzles done: still playing, but the hatch is open — since the last press — and
    // nobody stands on it yet.
    const afterPuzzles = lastView(anna.messages);
    expect(afterPuzzles.phase).toBe('playing');
    const unlocked = afterPuzzles.events.find((e) => e.kind === 'escape')?.at;
    expect(afterPuzzles.map?.exit).toMatchObject({ open: true, openedAt: unlocked, atExit: [] });

    // One player at the hatch is not enough; the checklist ticks Ben off for both of them.
    moveTo(room, ben, 10, 1);
    expect(lastView(ben.messages).phase).toBe('playing');
    expect(lastView(anna.messages).map?.exit?.atExit).toEqual([ben.playerId]);
    // A step off the hatch takes him off the list again.
    placeAt(room, ben, 10.5, 2.3);
    expect(lastView(anna.messages).map?.exit?.atExit).toEqual([]);
    moveTo(room, ben, 10, 1);
    moveTo(room, anna, 10, 1);
    expect(lastView(anna.messages).phase).toBe('won');
    expect(lastView(ben.messages).phase).toBe('won');
    // The last view of the run had both on the hatch: the views and the escape agree.
    const lastPlaying = anna.messages
      .filter((m) => m.kind === 'view' && m.view.phase === 'playing')
      .at(-1);
    const both = [anna.playerId, ben.playerId].sort();
    expect(lastPlaying?.kind === 'view' && lastPlaying.view.map?.exit?.atExit).toEqual(both);
    room.dispose();
  });

  it('derives presence from positions, leaving at a wider radius than it enters', () => {
    const { room, ben } = startedRoom();
    const at = () => lastView(ben.messages).presence.stationId;
    // The press station sits at (12,1); its centre is (12.5, 1.5).
    placeAt(room, ben, 12.5, 3.0);
    expect(at()).toBe('init');
    placeAt(room, ben, 12.5, 3.4);
    expect(at()).toBe('init');
    placeAt(room, ben, 12.5, 3.6);
    expect(at()).toBeNull();
    placeAt(room, ben, 12.5, 3.4);
    expect(at()).toBeNull();
    room.dispose();
  });

  it('sends a view only when somebody arrives or leaves, not on every step', () => {
    const { room, ben } = startedRoom();
    const views = (): number => ben.messages.filter((m) => m.kind === 'view').length;
    // Up from the sign and along row 3, out of reach of every console.
    moveTo(room, ben, 12, 3);
    moveTo(room, ben, 8, 3);
    const before = views();
    for (const x of [9, 8, 9, 8]) {
      moveTo(room, ben, x, 3);
    }
    expect(views()).toBe(before);
    room.dispose();
  });

  it('keeps the sign with whoever walked up to it', () => {
    const { room, anna, ben } = startedRoom();
    expect(lastView(anna.messages).presence.signSeen).toBe(false);
    expect(lastView(anna.messages).edgework).toBeNull();
    moveTo(room, anna, 12, 4);
    moveTo(room, anna, 8, 1);
    expect(lastView(anna.messages).presence.signSeen).toBe(true);
    expect(lastView(anna.messages).edgework).toEqual(lastView(ben.messages).edgework);
    room.dispose();
  });

  it('refuses a puzzle input from a player away from the station', () => {
    const { room, anna, ben } = startedRoom();
    moveTo(room, ben, 12, 2);
    pressE(room, ben);
    expect(lastView(anna.messages).puzzle).not.toBeNull();
    expect(() =>
      room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } }),
    ).toThrow('Eingabe nur am Pult.');
    room.dispose();
  });

  it('takes a disconnected player off every station and book, but not off the sign', () => {
    const { room, anna, ben } = startedRoom();
    const audience = collector();
    room.attachSpectator(audience.listen);
    moveTo(room, ben, 12, 2);
    ben.detach();
    expect(lastView(anna.messages).away.map((away) => away.name)).toEqual(['Ben']);
    const watched = audience.messages.filter((m) => m.kind === 'spectator-view').at(-1);
    const gone =
      watched?.kind === 'spectator-view'
        ? watched.view.players.find((p) => p.id === ben.playerId)?.presence
        : undefined;
    expect(gone).toEqual({ stationId: null, console: null, manualId: null, signSeen: true });
    room.resume(passFor('Ben'));
    const back = collector();
    room.attach(ben.playerId, back.listen);
    expect(lastView(back.messages).presence).toEqual({
      stationId: 'init',
      console: 'a',
      manualId: null,
      signSeen: true,
    });
    room.dispose();
  });

  it('resolves one key into pick up, deliver or activate by what is at hand', () => {
    // A tiny mission whose second station waits for a carried fuse.
    const withItem = parseMission({
      ...JSON.parse(JSON.stringify(mission)),
      id: 'carrytest',
      map: {
        ...JSON.parse(JSON.stringify(mission.map)),
        items: [
          {
            id: 'sicherung',
            label: 'SICHERUNG',
            x: 1,
            y: 1,
            deliverTo: { x: 3, y: 4 },
            requiredFor: 'doppelbestaetigung',
          },
        ],
      },
    });
    const { room, anna, ben } = startedRoom(withItem);

    // The fuse lies in the Kontrolle; Ben holds its door. Out of reach of the
    // fuse, the key does nothing useful.
    moveTo(room, ben, 7, 2);
    moveTo(room, anna, 5, 1);
    expect(() => pressE(room, anna)).toThrow(/Zu weit weg/);

    // At the fuse it picks it up — and full hands switch station one on like empty ones.
    moveTo(room, anna, 1, 1);
    pressE(room, anna);
    expect(firstPart(anna.messages)?.carriedBy).toBe(anna.playerId);
    moveTo(room, anna, 11, 1);
    moveTo(room, ben, 12, 2);
    pressE(room, anna);
    expect(lastView(anna.messages).puzzle).not.toBeNull();
    expect(firstPart(anna.messages)?.carriedBy).toBe(anna.playerId);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    // Full hands press signs as well as empty ones.
    sendSignals(room, anna, ben);

    // The gated station asks for the fuse, from empty hands and from full ones
    // alike. Anna holds the door for Ben, and it shuts behind her.
    moveTo(room, anna, 7, 2);
    moveTo(room, ben, 2, 3);
    expect(() => pressE(room, ben)).toThrow(/fehlt noch: SICHERUNG/);
    moveTo(room, anna, 2, 3);
    expect(() => pressE(room, anna)).toThrow(/fehlt noch: SICHERUNG/);

    // Carrying it anywhere else refuses politely.
    moveTo(room, anna, 5, 1);
    expect(() => pressE(room, anna)).toThrow(/markierten Platz/);

    // Q drops it right where she stands, and it can be picked up again.
    room.act(anna.playerId, { kind: 'drop-item' });
    expect(lastView(anna.messages).map?.items[0]).toMatchObject({ carriedBy: null, x: 5.5 });
    pressE(room, anna);

    // On the slot the same key installs it and the station comes alive.
    moveTo(room, anna, 3, 4);
    pressE(room, anna);
    expect(firstPart(anna.messages)?.delivered).toBe(true);
    pressE(room, ben);
    expect(lastView(ben.messages).puzzle).not.toBeNull();
    room.dispose();
  });

  it('starts the next run by itself once the whole crew confirms', () => {
    const { room, anna, ben } = startedRoom();
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
    expect(lastView(anna.messages).phase).toBe('lost');
    // Finishing cleared the confirmations from the first start.
    expect(lastView(anna.messages).players.every((p) => !p.ready)).toBe(true);

    room.setReady(ben.playerId, true);
    expect(lastView(anna.messages).phase).toBe('lost');
    room.setReady(anna.playerId, true);

    const restarted = lastView(anna.messages);
    expect(restarted.phase).toBe('playing');
    expect(restarted.currentPuzzleIndex).toBe(0);
    // The fresh report holds nothing but mission control's opener.
    const report = restarted.events.map((e) => [e.kind, e.label]);
    expect(report).toEqual([['radio', mission.radio.start]]);
    expect(restarted.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(mission.map.spawns).toContainEqual(restarted.map?.yourSpawn);
    room.dispose();
  });

  it('does not restart while someone is still disconnected', () => {
    const { room, anna, ben } = startedRoom();
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);

    room.setReady(ben.playerId, true);
    ben.detach();
    room.setReady(anna.playerId, true);
    expect(lastView(anna.messages).phase).toBe('lost');
    room.dispose();
  });

  it('goes on to the mission the host named, at the room\'s difficulty, once all agree', () => {
    // The tutorial on „hart", over: the server finds Blackout in the catalog and scales it so.
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.switchMission(anna.playerId, scaleMission(mission, 'hart'), 'hart');
    ready(room, ben);
    room.act(anna.playerId, { kind: 'start-mission' });
    vi.advanceTimersByTime(scaleMission(mission, 'hart').timeLimitSec * 1000 + 1);
    expect(lastView(anna.messages)).toMatchObject({ phase: 'lost', nextMissionId: 'blackout' });
    const blackout = scaleMission(load('blackout'), room.difficulty);

    room.setReady(anna.playerId, true, blackout);
    expect(lastView(ben.messages).phase).toBe('lost');
    room.setReady(ben.playerId, true);
    const next = lastView(ben.messages);
    expect(next).toMatchObject({ phase: 'playing', missionId: 'blackout', difficulty: 'hart' });
    expect(next.timeLimitSec).toBe(blackout.timeLimitSec);
    expect(blackout.timeLimitSec).not.toBe(load('blackout').timeLimitSec);
    expect(blackout.map.spawns).toContainEqual(next.map?.yourSpawn);
    expect(room.summary()).toMatchObject({ missionId: 'blackout', phase: 'playing' });
    room.dispose();
  });

  it('takes the next mission from the host only, and plays the same again once taken back', () => {
    const { room, anna, ben } = startedRoom();
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
    const blackout = load('blackout');
    expect(() => room.setReady(ben.playerId, true, blackout)).toThrow(
      'Den nächsten Einsatz wählt der Host.',
    );
    expect(lastView(anna.messages).players.every((p) => !p.ready)).toBe(true);

    // „Weiter", then the yes taken back, then „Nochmal": the tutorial again.
    room.setReady(anna.playerId, true, blackout);
    room.setReady(anna.playerId, false);
    room.setReady(anna.playerId, true);
    room.setReady(ben.playerId, true);
    expect(lastView(anna.messages)).toMatchObject({ phase: 'playing', missionId: mission.id });
    room.dispose();
  });

  it('runs a lone press out on the room\'s clock and tells its owner, nobody else', () => {
    const init = mission.puzzles[0];
    if (init?.type !== 'button-sync' || init.windowMs === undefined) {
      throw new Error('the tutorial should open on a sync station with a window');
    }
    const { windowMs } = init;
    const { room, anna, ben } = startedRoom();
    moveTo(room, ben, 12, 2);
    moveTo(room, anna, 11, 1);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    const pressedAt = Date.now();
    expect(lastView(anna.messages).puzzle).toMatchObject({
      style: 'lever',
      press: { at: pressedAt, expiresAt: pressedAt + windowMs },
    });
    expect(lastView(ben.messages).puzzle).toMatchObject({ partnerPressed: true, press: null });

    // Exactly as old as the mission's window the press still lives; a moment later it is dropped.
    vi.advanceTimersByTime(windowMs);
    expect(lastView(anna.messages).puzzle).toMatchObject({ lastResult: null, youPressed: true });
    vi.advanceTimersByTime(1);
    expect(lastView(anna.messages).puzzle).toMatchObject({ press: null, lastResult: 'expired' });
    const benSees = lastView(ben.messages).puzzle;
    expect(benSees).toMatchObject({ partnerPressed: false, lastResult: null });
    expect(lastView(anna.messages).alarms.count).toBe(0);

    // Both together this time: the station solves.
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(1);
    room.dispose();
  });

  it('passes a request for a note at the locker to the reducer on the server clock', () => {
    // The locker beside Anna's spawn covers the first station too, with a note for it.
    const hinted = parseMission({
      ...JSON.parse(JSON.stringify(mission)),
      id: 'hinttest',
      puzzles: mission.puzzles.map((puzzle) => ({
        ...puzzle,
        hints: ['Alle an die Station.'],
      })),
      map: {
        ...JSON.parse(JSON.stringify(mission.map)),
        manuals: mission.map.manuals.map((m) => ({
          ...m,
          puzzleIds: ['init', ...m.puzzleIds],
        })),
      },
    });
    const { room, anna, ben } = startedRoom(hinted);
    const deadline = lastView(anna.messages).deadlineAt ?? 0;

    room.act(anna.playerId, { kind: 'open-source', manualId: 'spind-leitstand' });
    moveTo(room, ben, 12, 2);
    pressE(room, ben);
    expect(() => room.act(ben.playerId, { kind: 'request-hint' })).toThrow(/bei den Regeln/);
    expect(() => room.act(anna.playerId, { kind: 'request-hint' })).toThrow(/Moment/);
    vi.advanceTimersByTime(hinted.hintDelaySec * 1000);
    room.act(anna.playerId, { kind: 'request-hint' });

    const view = lastView(anna.messages);
    const page = view.manualsHere[0]?.sections.find((s) => s.puzzleId === 'init');
    expect(page?.notes).toEqual(['Alle an die Station.']);
    expect(view.hintsUsed).toBe(1);
    expect(view.credits[anna.playerId]?.hints).toBe(1);
    expect(lastView(ben.messages).deadlineAt).toBe(deadline - hinted.hintCostSec * 1000);
    room.dispose();
  });

  it('passes a puzzle input on to the open puzzle, which turns down what it does not take', () => {
    const { room, anna, ben } = startedRoom();
    moveTo(room, ben, 12, 2);
    moveTo(room, anna, 11, 1);
    pressE(room, ben);

    expect(() =>
      room.act(ben.playerId, { kind: 'puzzle-input', input: { wireId: 'w1' } }),
    ).toThrow(/Ungültige Eingabe/);
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(0);
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(1);
    room.dispose();
  });

  it('rejects an interact from too far away', () => {
    const { room, ben } = startedRoom();
    // Ben spawns across the Leitstand from the first station.
    expect(() => pressE(room, ben)).toThrow(/Zu weit weg/);
    room.dispose();
  });

  it('says who holds a plate, by the reach that holds it, and nobody once they step off', () => {
    const blackout = load('blackout');
    const plate = blackout.map.plates.find((p) => p.id === 'flurplatte') ?? { x: 0, y: 0 };
    const { room, anna, ben } = startedRoom(blackout);
    const onPlates = () => room.snapshot().state.presence.plates;
    expect(onPlates()).toEqual({});
    moveTo(room, anna, plate.x, plate.y);
    expect(onPlates()).toEqual({ flurplatte: [anna.playerId] });
    // Pressed, the plate keeps its holder past its press reach (0.55) up to its release reach
    // (0.75): 0.64 off, in its tile's corner, Anna still holds it.
    placeAt(room, anna, plate.x + 0.95, plate.y + 0.95);
    expect(onPlates()).toEqual({ flurplatte: [anna.playerId] });
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    placeAt(room, anna, plate.x + 1.7, plate.y + 0.5);
    expect(onPlates()).toEqual({});
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(false);
    room.dispose();
  });

  it('broadcasts a loss when the mission timer expires', () => {
    const { room, anna } = startedRoom();

    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);

    expect(lastView(anna.messages).phase).toBe('lost');
    room.dispose();
  });

  it('marks a detached player and lets them resume with their pass', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);

    ben.detach();
    expect(
      lastView(anna.messages).players.find((p) => p.id === ben.playerId)?.connected,
    ).toBe(false);

    const benAgain = collector();
    room.resume(passFor('Ben'));
    room.attach(ben.playerId, benAgain.listen);
    expect(lastView(benAgain.messages).you.id).toBe(ben.playerId);
    expect(
      lastView(anna.messages).players.find((p) => p.id === ben.playerId)?.connected,
    ).toBe(true);
    room.dispose();
  });

  it('keeps a player who resumed on a new connection when the old one is found dead late', () => {
    const { room, anna, ben } = startedRoom();
    const benAgain = collector();
    room.resume(passFor('Ben'));
    room.attach(ben.playerId, benAgain.listen);
    // The old socket's end comes only now: the heartbeat terminating it, say.
    ben.detach();
    expect(lastView(anna.messages).away).toEqual([]);
    const benSeen = lastView(anna.messages).players.find((p) => p.id === ben.playerId);
    expect(benSeen?.connected).toBe(true);
    room.ping(anna.playerId, 3, 3);
    expect(benAgain.messages.at(-1)).toEqual({ kind: 'ping', playerId: anna.playerId, x: 3, y: 3 });
    room.dispose();
  });

  it('binds each seat to its pass: a wrong secret or a stranger’s pass holds none', () => {
    const room = new Room('TEST', mission);
    const anna = room.join('Anna', passFor('Anna'));
    expect(room.seatOf(passFor('Anna'))).toBe(anna.playerId);
    const forged = { ...passFor('Anna'), secret: passFor('Mallory').secret };
    expect(room.seatOf(forged)).toBeNull();
    expect(() => room.resume(forged)).toThrow(/Wiederverbinden/);
    expect(room.seatOf(passFor('Mallory'))).toBeNull();
    expect(() => room.resume(passFor('Mallory'))).toThrow(/Wiederverbinden/);
    expect(room.resume(passFor('Anna'))).toBe(anna.playerId);
    room.dispose();
  });

  it("keeps the wires off the reader's wire and the rules off the operator's", () => {
    const { room, anna, ben } = startedRoom();
    moveTo(room, ben, 12, 2);
    moveTo(room, anna, 11, 1);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    sendSignals(room, anna, ben);
    // The way into the Kontrolle runs past the locker: Ben goes in while it is still shut.
    moveTo(room, anna, 7, 2);
    moveTo(room, ben, 2, 3);
    room.act(anna.playerId, { kind: 'open-source', manualId: 'spind-leitstand' });
    pressE(room, ben);
    const benView = lastView(ben.messages);
    const wires = benView.puzzle?.kind === 'wiring' ? benView.puzzle.wires : null;
    expect(wires).not.toBeNull();
    expect(JSON.stringify(anna.messages)).not.toContain(JSON.stringify(wires));
    // The three-wire list in the locker never reached Ben, who stands at the box.
    const threeWireRule = 'mehr als ein schwarzes Kabel vorhanden ist';
    expect(JSON.stringify(anna.messages)).toContain(threeWireRule);
    expect(JSON.stringify(ben.messages)).not.toContain(threeWireRule);
    room.dispose();
  });
});

describe('Room with somebody away', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on while someone is disconnected: the crew plays, the clock counts', () => {
    const { room, anna, ben } = startedRoom();
    const deadline = lastView(anna.messages).deadlineAt ?? 0;

    // Anna is standing right at the first station when Ben drops out.
    moveTo(room, anna, 12, 2);
    ben.detach();
    const gone = lastView(anna.messages);
    expect(gone.away.map((away) => away.name)).toEqual(['Ben']);
    expect(gone.pausedAt).toBeNull();
    // The crew on the line plays on: Anna switches the station on.
    pressE(room, anna);
    expect(lastView(anna.messages).puzzle).not.toBeNull();

    vi.advanceTimersByTime(30_000);
    const benAgain = collector();
    room.resume(passFor('Ben'));
    room.attach(ben.playerId, benAgain.listen);
    const back = lastView(anna.messages);
    expect(back.away).toEqual([]);
    // The clock ran all along: no time given back for the drop.
    expect(back.deadlineAt).toBe(deadline);
    expect(lastView(benAgain.messages).deadlineAt).toBe(deadline);
    room.dispose();
  });

  it('expires the mission timer with someone away, and not while the server goes down', () => {
    const { room, anna, ben } = startedRoom();
    ben.detach();
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1000);
    expect(lastView(anna.messages).phase).toBe('lost');
    room.dispose();

    const down = startedRoom();
    const downAt = Date.now();
    down.room.goDown(downAt);
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 60_000);
    expect(lastView(down.anna.messages)).toMatchObject({ phase: 'playing', pausedAt: downAt });
    down.room.dispose();
  });

  it('keeps a plate down under its holder whose line drops, the run going on', () => {
    // Blackout: the Flur plate holds the Maschinenraum door.
    const blackout = load('blackout');
    const plate = blackout.map.plates.find((p) => p.id === 'flurplatte') ?? { x: 0, y: 0 };
    const { room, anna, ben } = startedRoom(blackout);
    moveTo(room, anna, plate.x, plate.y);
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    anna.detach();
    // Her avatar stands where it stood: its weight is on the plate, and the door stays open.
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    expect(lastView(ben.messages).away.map((away) => away.name)).toEqual(['Anna']);
    // The crew's hands name her as the plate's holder still.
    expect(room.snapshot().state.presence.plates).toEqual({ flurplatte: [anna.playerId] });
    vi.advanceTimersByTime(30_000);
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    room.dispose();
  });
});

describe('RoomManager', () => {
  it('creates rooms with unique codes and sweeps empty ones after the TTL', () => {
    const manager = new RoomManager();
    const room = manager.create(mission);
    expect(manager.get(room.code.toLowerCase())).toBe(room);

    const player = { ...room.join('Anna', passFor('Anna')), ...collector() };
    const detach = room.attach(player.playerId, player.listen);
    detach();

    manager.sweep(Date.now() + 11 * 60 * 1000);
    expect(() => manager.get(room.code)).toThrow(/existiert nicht/);
  });

  it('fails with a clear message for unknown room codes', () => {
    expect(() => new RoomManager().get('XXXX')).toThrow(/existiert nicht/);
  });
});
