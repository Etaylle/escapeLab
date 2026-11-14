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
 * the voice differs. The roster also keeps what makes each voice — its Voice-Design prompt, the
 * voice kept on the ElevenLabs account and the model it reads with (client scripts/voice.ts) —
 * none of which reaches a player's view: a run names its speakers by role and id alone.
 */

/** A person of the roster, who can fill a role on the radio. */
export interface Person {
  /** what a run's lines and the recordings name them by (radio.ts `Speaker`): small letters */
  readonly id: string;
  /** their name, as the objective bar names them beside the role („Leitstelle · Marta") */
  readonly name: string;
  /** who they are, a line of the world's voice: the audition page (/voices) shows it */
  readonly character: string;
  /** the description, in English, that Voice Design makes their voice from (`--design`) */
  readonly prompt: string;
  /** their voice on the ElevenLabs account (`--keep`); without one, nobody hears them yet */
  readonly voiceId?: string;
  /** the model their voice reads with: eleven_v4 for a library voice, eleven_v3 for a designed */
  readonly model?: string;
}

/** The persons for each role, in the roster's order: the first stands in where none has a voice. */
export type Roster = Readonly<Record<Role, readonly Person[]>>;

const personSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+$/),
  name: z.string().min(1),
  character: z.string().min(1),
  // Voice Design takes a description of 20 to 1,000 characters.
  prompt: z.string().min(20).max(1000),
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

/** Who speaks for each role on one night, by the persons' ids. */
export type Cast = Readonly<Record<Role, string>>;

/**
 * The persons of `role` who can be on duty: those whose voice is kept on the account — a person
 * goes on duty with their voice, so that no night's lines wait for a render — and where none of
 * them has one yet, the role's first, whose lines the game has as they are.
 */
export function inService(role: Role, roster: Roster = ROSTER): readonly Person[] {
  const persons = roster[role];
  const voiced = persons.filter((person) => person.voiceId !== undefined);
  return voiced.length > 0 ? voiced : persons.slice(0, 1);
}

/**
 * Who is on duty on the night `seed` names: for each role one of its persons in service, by the
 * seed and the role (rng.ts `pickOf`) — one seed always the same, the seeds spread over them.
 */
export function castOf(seed: number, roster: Roster = ROSTER): Cast {
  const pick = (role: Role): string =>
    pickOf(inService(role, roster), seed, `cast:${role}`)?.id ?? '';
  return { pa: pick('pa'), operator: pick('operator'), lead: pick('lead') };
}

/**
 * The night `state` stands at, counted from 0 as the room's runs are: in the lobby the next
 * run's, in a run — and on its end card — its own.
 */
function nightOf(state: Pick<GameState, 'phase' | 'runs'>): number {
  return state.phase === 'lobby' ? state.runs : state.runs - 1;
}

/**
 * The cast of the night `state` stands at (`GameState.castSeed`): the lobby's Funkprobe is said
 * by the operator who then has the run.
 */
export function castFor(state: Pick<GameState, 'phase' | 'runs' | 'castSeed'>): Cast {
  return castOf((state.castSeed + nightOf(state)) >>> 0);
}

/** Who says a line heard at `moment` on `state`'s night: its role, and the person filling it. */
export function speakerAt(
  state: Pick<GameState, 'phase' | 'runs' | 'castSeed'>,
  moment: RadioMoment,
): Speaker {
  const role = roleOf(moment);
  return { role, person: castFor(state)[role] };
}

/** The person of `roster` whose id is `id`; undefined where there is none. */
export function personOf(id: string, roster: Roster = ROSTER): Person | undefined {
  return ROLES.flatMap((role) => roster[role]).find((person) => person.id === id);
}
