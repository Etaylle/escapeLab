/**
 * press.ts: E as one screen keeps it. A press a moment before the prompt can show — the
 * player walks up and presses as they arrive — waits PRESS_BUFFER_MS for reach and is fired
 * as reach comes (GameWorld's frame step). What the server decides goes out with the spot the
 * player stood on (`interact`, the server judges it there) and waits for its answer: the
 * station's chirp plays as the server takes it, never on the press; a refusal turns the prompt
 * pill amber with the server's words for REFUSAL_PILL_MS, where the player looks — never only
 * in the banner, and no position going out wipes it. Presses come seconds apart, so the
 * latest ask of a kind is the one an answer of that kind is for.
 */

import type { ClientMessage, PlayerView, ServerMessage } from '@escapelab/core';
import { stationChirp } from './audio.js';
import { contextAction, type ContextAction } from './interact.js';

/** How long a press made out of reach waits for it, ms. */
export const PRESS_BUFFER_MS = 150;
/** How long a refusal stays on the prompt pill, ms. */
export const REFUSAL_PILL_MS = 2500;
/** How long an ask waits for its answer before it is forgotten, ms: the line may have dropped. */
export const ANSWER_WAIT_MS = 3000;

/** What E asks the server: to do what E does there, or to search a locker, unlock a cabinet. */
export type AskKind = 'interact' | 'open-source';

/** An ask out: where its prompt stood (tiles), when it went (performance.now). */
export interface Ask {
  x: number;
  y: number;
  at: number;
}

/** The pill turned amber: the server's words, where, and until when (performance.now). */
export interface Refused {
  text: string;
  x: number;
  y: number;
  until: number;
}

/** E on one screen: a press waiting for reach, the latest ask of each kind, a refusal shown. */
export interface Presses {
  /** when a press made out of reach came, performance.now; null for none */
  waiting: number | null;
  asks: Partial<Record<AskKind, Ask>>;
  refused: Refused | null;
}

export function newPresses(): Presses {
  return { waiting: null, asks: {}, refused: null };
}

/** A press out of reach at `now`: it waits PRESS_BUFFER_MS for reach. */
export function holdPress(presses: Presses, now: number): void {
  presses.waiting = now;
}

/** Whether a press waits for reach at `now`; one waiting longer than PRESS_BUFFER_MS goes. */
export function pressWaiting(presses: Presses, now: number): boolean {
  if (presses.waiting !== null && now - presses.waiting > PRESS_BUFFER_MS) {
    presses.waiting = null;
  }
  return presses.waiting !== null;
}

/** An ask of `of` goes out; whatever waited for reach is done with. */
export function ask(presses: Presses, of: AskKind, sent: Ask): void {
  presses.waiting = null;
  presses.asks[of] = sent;
}

/** The ask of `of` out at `now`, taken off: the one an answer of that kind is for. */
function takeAsk(presses: Presses, of: AskKind, now: number): Ask | null {
  const out = presses.asks[of];
  delete presses.asks[of];
  return out !== undefined && now - out.at <= ANSWER_WAIT_MS ? out : null;
}

/** The server took the press of `of` out at `now`: whether one was (its chirp is due). */
export function taken(presses: Presses, of: AskKind, now: number): boolean {
  return takeAsk(presses, of, now) !== null;
}

/**
 * The server refused the ask of `of` out at `now` with `text`: the pill at its prompt turns
 * amber with the words for REFUSAL_PILL_MS. A refusal of no ask of this screen's leaves the
 * pill be.
 */
export function refuse(presses: Presses, of: AskKind, text: string, now: number): void {
  const refused = takeAsk(presses, of, now);
  if (refused !== null) {
    presses.refused = { text, x: refused.x, y: refused.y, until: now + REFUSAL_PILL_MS };
  }
}

/** The refusal on the pill at `now`; none once its time is up. */
export function refusalAt(presses: Presses, now: number): Refused | null {
  const shown = presses.refused;
  return shown !== null && now < shown.until ? shown : null;
}

/** Whether a refusal of a message of `kind` is one of E's asks, answered on the prompt pill. */
export function asksOf(kind: string | undefined): kind is AskKind {
  return kind === 'interact' || kind === 'open-source';
}

/** What E needs of the world it is pressed in (GameWorld.tsx hands it over). */
export interface PressWorld {
  /** the view as the screen last rendered it */
  view: PlayerView;
  /** where the avatar stands, the frame it was walked in (performance.now), and E's state */
  sim: { self: { x: number; y: number }; selfAt: number; presses: Presses };
  /** nothing may be worked now: a panel, pages or the pause lie over it, the opening holds */
  shut: boolean;
  send: (msg: ClientMessage) => void;
  onRead: (manualId: string) => void;
  onReadNote: (index: number) => void;
  onOperate: () => void;
}

/** What E does where the avatar stands now; null where it does nothing. */
function actionHere(world: PressWorld): ContextAction | null {
  const { view } = world;
  return view.map === null
    ? null
    : contextAction(
        view.map,
        world.sim.self,
        view.you.id,
        view.sourcesHere,
        view.puzzle !== null,
        view.noteHere,
      );
}

/**
 * E pressed at `now` (performance.now): the one context action. Reading and working an open
 * station stay on this client; everything else the server decides. A note of the last crew
 * comes up here at once, and the server hears of the read for the run report. A locked
 * cabinet only says what is missing. A press a moment before reach waits for it
 * (`holdPress`): the frame step fires it as it comes (`pressWhenInReach`).
 */
export function pressE(world: PressWorld, now: number): void {
  if (world.view.map === null || world.shut) {
    return;
  }
  const action = actionHere(world);
  if (action === null) {
    holdPress(world.sim.presses, now);
    return;
  }
  if (action.kind === 'locked') {
    return;
  }
  if (action.kind === 'open') {
    ask(world.sim.presses, 'open-source', { x: action.x, y: action.y, at: now });
    world.send({ kind: 'open-source', manualId: action.manualId });
    return;
  }
  workOn(world, action, now);
}

/**
 * E at a source that is open, a note, or the armed station: read it or work it — with the
 * chirp at once, nobody else having to say yes — or ask the server, with the spot the avatar
 * stands on and the frame it was walked in: the chirp waits for its yes (`hearAnswer`).
 */
function workOn(world: PressWorld, action: ContextAction, now: number): void {
  if (action.kind === 'read') {
    stationChirp();
    world.onRead(action.manualId);
    return;
  }
  if (action.kind === 'note') {
    stationChirp();
    world.onReadNote(action.index);
    world.send({ kind: 'read-note', note: action.index });
    return;
  }
  if (action.kind === 'operate') {
    world.onOperate();
    if (world.view.puzzle !== null) {
      stationChirp();
      return;
    }
  }
  const { sim } = world;
  ask(sim.presses, 'interact', { x: action.x, y: action.y, at: now });
  world.send({
    kind: 'interact',
    x: Math.round(sim.self.x * 1000) / 1000,
    y: Math.round(sim.self.y * 1000) / 1000,
    t: Math.round((performance.timeOrigin + sim.selfAt) * 10) / 10,
  });
}

/** A press that waited for reach is fired as reach comes, at `now`; one waiting too long goes. */
export function pressWhenInReach(world: PressWorld, now: number): void {
  if (pressWaiting(world.sim.presses, now) && actionHere(world) !== null) {
    pressE(world, now);
  }
}

/**
 * What the server says to E, at `now`: the station's chirp as it takes a press, the prompt pill
 * amber with its words as it refuses one.
 */
export function hearAnswer(presses: Presses, msg: ServerMessage, now: number): void {
  if (msg.kind === 'interacted' && taken(presses, 'interact', now)) {
    stationChirp();
  } else if (msg.kind === 'error' && asksOf(msg.of)) {
    refuse(presses, msg.of, msg.message, now);
  }
}
