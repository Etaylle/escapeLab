import { z } from 'zod';
import rosterFile from './cast.json' with { type: 'json' };
import { ROLES, roleOf, type RadioMoment, type Role, type Speaker } from './radio.js';
import { pickOf } from './rng.js';
import type { GameState } from './state.js';

/**
 * The radio's cast: the persons who can speak for each role (radio.ts `ROLES`) — the plant's
 * loudspeakers, the Leitstelle on duty, the Schichtleitung — as the roster in cast.json names
 * them, and who of them is on duty a night (`castOf`), so that crews hear different people on
 * different nights. A line's words, the manuals and the rules are the same whoever speaks; only
 * the voice differs. The roster keeps the voice kept for each person on the ElevenLabs account and
 * the model it reads with (client scripts/voice.ts), neither of which reaches a player's view: a
 * run names its speakers by role and id alone. How a voice is asked for — the Voice-Design
 * prompts, the library voices to choose from — stays with the voice script
 * (client scripts/casting.json), out of the game.
 */

/** A person of the roster, who can fill a role on the radio. */
export interface Person {
  /** what a run's lines and the recordings name them by (radio.ts `Speaker`): small letters */
  readonly id: string;
  /** their name, as the objective bar names them beside the role („Leitstelle · Laura") */
  readonly name: string;
  /** who they are, a line of the world's voice: the audition page (/voices) shows it */
  readonly character: string;
  /** their voice on the ElevenLabs account (`--keep`); without one, nobody hears them yet */
  readonly voiceId?: string;
  /** the model their voice reads with: eleven_v4 for a library voice, eleven_v3 for a designed */
  readonly model?: string;
}

/**
 * The persons for each role, in the roster's order: the plant's and the Leitstelle's first stands
 * in where none of theirs has a voice (`inService`).
 */
export type Roster = Readonly<Record<Role, readonly Person[]>>;

const personSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+$/),
  name: z.string().min(1),
  character: z.string().min(1),
  voiceId: z
    .string()
    .regex(/^[A-Za-z0-9]{8,64}$/)
    .exactOptional(),
  model: z
    .string()
    .regex(/^eleven_[a-z0-9_]+$/)
    .exactOptional(),
});

const personsSchema = z.array(personSchema).min(1);

/** Whether every person of `roster` has an id of their own, across the roles too. */
const idsApart = (roster: Roster): boolean => {
  const ids = ROLES.flatMap((role) => roster[role].map((person) => person.id));
  return new Set(ids).size === ids.length;
};

/** The roster as cast.json must have it: a person or more for each role, every id its own. */
export const rosterSchema = z
  .strictObject({ pa: personsSchema, operator: personsSchema, lead: personsSchema })
  .refine(idsApart, 'cast.json: two persons share an id');

/** The shipped roster, read from cast.json as the game loads: a broken one fails it at once. */
export const ROSTER: Roster = rosterSchema.parse(rosterFile);

/**
 * Who speaks for each role on one night, by the persons' ids: no Schichtleitung (null) while
 * nobody of it has a voice — the operator on duty says its lines then (`speakingFor`).
 */
export interface Cast {
  readonly pa: string;
  readonly operator: string;
  readonly lead: string | null;
}

/**
 * The persons of `role` who can be on duty: those whose voice is kept on the account — a person
 * goes on duty with their voice, so that no night's lines wait for a render. Where none of them
 * has one yet, the plant's and the Leitstelle's first, whose lines the game has as they are; the
 * Schichtleitung nobody, its lines going to the Leitstelle on duty (`speakingFor`).
 */
export function inService(role: Role, roster: Roster = ROSTER): readonly Person[] {
  const persons = roster[role];
  const voiced = persons.filter((person) => person.voiceId !== undefined);
  return voiced.length > 0 || role === 'lead' ? voiced : persons.slice(0, 1);
}

/**
 * The role whose person on duty says `role`'s lines: the role itself, or — for the Schichtleitung
 * while nobody of it has a voice kept — the Leitstelle, so that its calls are heard as the
 * operator on duty's and no banner names a person nobody hears.
 */
export function speakingFor(role: Role, roster: Roster = ROSTER): Role {
  return inService(role, roster).length > 0 ? role : 'operator';
}

/**
 * Everybody who says `role`'s lines on some night (`speakingFor`): the persons who need a
 * recording of each of them.
 */
export function sayersOf(role: Role, roster: Roster = ROSTER): readonly Person[] {
  return inService(speakingFor(role, roster), roster);
}

/**
 * Who is on duty on the night `seed` names: for each role one of its persons in service, by the
 * seed and the role (rng.ts `pickOf`) — one seed always the same, the seeds spread over them —
 * and no Schichtleitung where none is in service.
 */
export function castOf(seed: number, roster: Roster = ROSTER): Cast {
  const pick = (role: Role): string | null =>
    pickOf(inService(role, roster), seed, `cast:${role}`)?.id ?? null;
  return { pa: pick('pa') ?? '', operator: pick('operator') ?? '', lead: pick('lead') };
}

/**
 * The night `state` stands at, counted from 0 as the room's runs are: in the lobby the next
 * run's, in a run — and on its end card — its own.
 */
function nightOf(state: Pick<GameState, 'phase' | 'runs'>): number {
  return state.phase === 'lobby' ? state.runs : state.runs - 1;
}

/** What of a room's state its nights are staffed by. */
type Night = Pick<GameState, 'phase' | 'runs' | 'castSeed'>;

/**
 * The cast of the night `state` stands at (`GameState.castSeed`): the lobby's Funkprobe is said
 * by the operator who then has the run.
 */
export function castFor(state: Night, roster: Roster = ROSTER): Cast {
  return castOf((state.castSeed + nightOf(state)) >>> 0, roster);
}

/**
 * Who says a line heard at `moment` on `state`'s night: the role that speaks it (`speakingFor`)
 * and the person filling that role.
 */
export function speakerAt(state: Night, moment: RadioMoment, roster: Roster = ROSTER): Speaker {
  const role = speakingFor(roleOf(moment), roster);
  return { role, person: castFor(state, roster)[role] ?? '' };
}

/**
 * Who says mission control's word outside a moment of the radio — that a crew member is gone
 * (actions.ts `lineDropped`) — on `state`'s night: the Leitstelle on duty.
 */
export function deskAt(state: Night, roster: Roster = ROSTER): Speaker {
  return { role: 'operator', person: castFor(state, roster).operator };
}

/** The person of `roster` whose id is `id`; undefined where there is none. */
export function personOf(id: string, roster: Roster = ROSTER): Person | undefined {
  return ROLES.flatMap((role) => roster[role]).find((person) => person.id === id);
}
