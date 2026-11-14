import { describe, expect, it } from 'vitest';
import {
  applyAction,
  castFor,
  castOf,
  initialState,
  inService,
  parseMission,
  personOf,
  radioLines,
  RADIO_MOMENTS,
  roleOf,
  ROLES,
  ROSTER,
  rosterSchema,
  sayersOf,
  shownText,
  speakerAt,
  speakingFor,
  viewFor,
  viewForSpectator,
  type GameState,
  type Mission,
  type Person,
  type Roster,
} from '../src/index.js';
import { labMission, started, T0 } from './lab.js';
import { offVoice, WORLD } from './voice.js';

/**
 * The radio's cast (cast.ts): the persons of the roster who speak for each role, who of them is
 * on duty a night, the role each moment wants, and what of them a player's view carries — a
 * role and an id, never a voice. The lines' audio tags are for the render alone (radio.ts
 * `shownText`).
 */

/** A person for a test's roster, by id, with a voice where `voiced`. */
const person = (id: string, voiced = true): Person => ({
  id,
  name: `${id.charAt(0).toUpperCase()}${id.slice(1)}`,
  character: 'Arbeitet in der Leitstelle.',
  prompt: 'A calm German voice on a two-way radio, clean studio recording.',
  ...(voiced ? { voiceId: `${id}Voice0000000` } : {}),
});

/** A roster of three voiced operators, two voiced leads and one plant's voice. */
const VOICED: Roster = {
  pa: [person('anlage')],
  operator: [person('helmut'), person('marta'), person('jonas')],
  lead: [person('kessler'), person('brandt')],
};

describe('the roster in cast.json', () => {
  it('names the plant’s voice, three Leitstellen and the Schichtleitung, every id its own', () => {
    expect(ROSTER.pa.map((p) => p.id)).toEqual(['anlage']);
    expect(ROSTER.operator.map((p) => p.id)).toEqual(['helmut', 'marta', 'jonas']);
    expect(ROSTER.lead.map((p) => p.id)).toEqual(['kessler']);
    const ids = ROLES.flatMap((role) => ROSTER[role].map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    // Helmut keeps the library voice every recorded line was made with, and its model.
    expect(personOf('helmut')).toMatchObject({
      name: 'Helmut',
      voiceId: 'g1jpii0iyvtRs8fqXsd1',
      model: 'eleven_v4',
    });
    expect(personOf('nobody')).toBeUndefined();
  });

  it('says who each is in the world’s voice, and asks Voice Design for them in English', () => {
    const everyone = ROLES.flatMap((role) => ROSTER[role]);
    expect(offVoice(everyone.map((p) => p.character), WORLD)).toEqual([]);
    for (const { id, prompt, name } of everyone) {
      expect(name, id).toMatch(/^[A-ZÄÖÜ]/);
      expect(prompt.length, id).toBeGreaterThanOrEqual(20);
      expect(prompt.length, id).toBeLessThanOrEqual(1000);
      expect(prompt, id).toMatch(/German/);
      expect(prompt, id).toMatch(/studio recording without background noise/);
    }
  });

  it('refuses a roster that a run could not cast from', () => {
    const json = JSON.parse(JSON.stringify(ROSTER)) as Record<string, unknown[]>;
    expect(rosterSchema.safeParse(json).success).toBe(true);
    const twice = { ...json, lead: [person('helmut')] };
    expect(rosterSchema.safeParse(twice).success).toBe(false);
    expect(rosterSchema.safeParse({ ...json, lead: [] }).success).toBe(false);
    const leaderless = Object.fromEntries(Object.entries(json).filter(([role]) => role !== 'lead'));
    expect(rosterSchema.safeParse(leaderless).success).toBe(false);
    const stray = { ...json, pa: [{ ...person('anlage'), voiceId: '../voice' }] };
    expect(rosterSchema.safeParse(stray).success).toBe(false);
    const extra = { ...json, pa: [{ ...person('anlage'), apiKey: 'x' }] };
    expect(rosterSchema.safeParse(extra).success).toBe(false);
  });
});

describe('who is on duty', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);

  it('is the same cast for the same seed, every time', () => {
    for (const seed of seeds) {
      expect(castOf(seed, VOICED)).toEqual(castOf(seed, VOICED));
    }
    expect(castOf(42)).toEqual(castOf(42));
  });

  it('spreads the nights over the operators in service, across 200 seeds', () => {
    const nights = new Map<string, number>();
    for (const seed of seeds) {
      const { operator } = castOf(seed, VOICED);
      nights.set(operator, (nights.get(operator) ?? 0) + 1);
    }
    expect([...nights.keys()].sort()).toEqual(['helmut', 'jonas', 'marta']);
    for (const [who, count] of nights) {
      // A third each, give or take: never under a fifth of the nights.
      expect(count, who).toBeGreaterThanOrEqual(45);
    }
  });

  it('draws each role on its own: every operator meets every lead', () => {
    const pairs = new Set(seeds.map((seed) => JSON.stringify(castOf(seed, VOICED))));
    expect(pairs.size).toBe(3 * 2);
  });

  it('puts nobody on duty without a voice: the plant’s and the desk’s first stand in', () => {
    const one: Roster = { ...VOICED, operator: [person('helmut', false), person('marta')] };
    expect(new Set(seeds.map((seed) => castOf(seed, one).operator))).toEqual(new Set(['marta']));
    const silent: Roster = { ...VOICED, pa: [person('anlage', false)] };
    expect(new Set(seeds.map((seed) => castOf(seed, silent).pa))).toEqual(new Set(['anlage']));
    // A Schichtleitung without a voice: nobody of it on duty.
    const none: Roster = { ...VOICED, lead: [person('kessler', false), person('brandt', false)] };
    expect(new Set(seeds.map((seed) => castOf(seed, none).lead))).toEqual(new Set([null]));
    expect(inService('lead', none)).toEqual([]);
    expect(inService('operator', VOICED).map((p) => p.id)).toEqual(['helmut', 'marta', 'jonas']);
    // The shipped roster: Helmut's voice is the one kept so far, and he has every night.
    for (const seed of seeds) {
      expect(castOf(seed)).toEqual({ pa: 'anlage', operator: 'helmut', lead: null });
    }
  });

  it('has the operator on duty speak for a Schichtleitung without a voice', () => {
    const none: Roster = { ...VOICED, lead: [person('kessler', false)] };
    expect([speakingFor('lead', none), speakingFor('lead', VOICED)]).toEqual(['operator', 'lead']);
    expect([speakingFor('pa', none), speakingFor('operator', none)]).toEqual(['pa', 'operator']);
    expect(sayersOf('lead', none).map((p) => p.id)).toEqual(['helmut', 'marta', 'jonas']);
    expect(sayersOf('lead', VOICED).map((p) => p.id)).toEqual(['kessler', 'brandt']);
    // On a night: the clock's call is the desk's, said by whoever has the desk.
    const night = { phase: 'playing', runs: 1, castSeed: 3 } as const;
    const desk = castFor(night, none).operator;
    expect(speakerAt(night, 'clock', none)).toEqual({ role: 'operator', person: desk });
    const lead = castFor(night, VOICED).lead;
    expect(speakerAt(night, 'lost', VOICED)).toEqual({ role: 'lead', person: lead });
    expect(['kessler', 'brandt']).toContain(lead);
  });
});

describe('the role at each moment', () => {
  it('gives the plant the loudspeakers, the Schichtleitung the clock and a run lost', () => {
    const roles = Object.fromEntries(RADIO_MOMENTS.map((moment) => [moment, roleOf(moment)]));
    expect(roles).toEqual({
      pa: 'pa',
      start: 'operator',
      nudge: 'operator',
      solved: 'operator',
      escape: 'operator',
      announce: 'pa',
      emergency: 'operator',
      cleared: 'operator',
      missed: 'operator',
      alarm: 'operator',
      clock: 'lead',
      won: 'operator',
      lost: 'lead',
      lobby: 'operator',
    });
  });
});

describe('a line’s audio tags', () => {
  it('are taken out of what is shown, with the space around them', () => {
    expect(shownText('[sighs] Das war’s.')).toBe('Das war’s.');
    expect(shownText('Reaktor läuft. [exhales] Durchatmen.')).toBe('Reaktor läuft. Durchatmen.');
    expect(shownText('Gerade noch [laughs], raus da.')).toBe('Gerade noch, raus da.');
    expect(shownText('Ruhig bleiben. [long pause]')).toBe('Ruhig bleiben.');
    expect(shownText('[calm] [clears throat] Funkprobe.')).toBe('Funkprobe.');
    expect(shownText('Eins. [x] [y] Zwei.')).toBe('Eins. Zwei.');
    // A line without tags stays as written, to the character.
    const plain = 'Leitstelle an Nachtschicht. Pult A — Pult B, 23:47 Uhr.';
    expect(shownText(plain)).toBe(plain);
  });

  it('may not be all a line says', () => {
    const station = { type: 'button-sync', id: 'eins', title: 'Eins' };
    const lab = JSON.parse(JSON.stringify(labMission([station])));
    expect(() => parseMission({ ...lab, radio: { start: '[sighs]' } })).toThrow();
    expect(() => parseMission({ ...lab, radio: { start: ['Los.', '[sighs] '] } })).toThrow();
    expect(parseMission({ ...lab, radio: { start: '[sighs] Los.' } }).radio.start).toBe(
      '[sighs] Los.',
    );
  });
});

/** Lines on the radio and over the loudspeakers, some of them tagged for their delivery. */
const LINES = {
  lobby: '[clears throat] Funkprobe, Nachtschicht.',
  start: 'Leitstelle an Nachtschicht. [exhales] Strom weg.',
  escape: 'Raus da!',
  alarm: 'Alarm bei mir.',
  clock: { fiveMinutes: 'Noch fünf Minuten.', lastMinute: 'Letzte Minute.' },
  emergency: { start: 'Notfall, los.' },
  won: { plenty: 'Viel Zeit übrig.', tight: 'Knapp war das.', lastMinute: 'Gerade noch.' },
  lost: { time: '[sighs] Die Zeit ist um.' },
};

/** Two stations the whole crew presses, an intro, an emergency, and every line above. */
function castMission(): Mission {
  const lab = labMission(
    [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'zwei', title: 'Zwei' },
    ],
    'besetzung',
  );
  const json = JSON.parse(JSON.stringify(lab));
  return parseMission({
    ...json,
    intro: { lightsSec: 3, pa: ['Durchsage für Trakt C. [pause] Es ist 23 Uhr 47.'] },
    radio: LINES,
    map: {
      ...json.map,
      sabotage: {
        label: 'KÜHLUNG',
        afterSolved: 0,
        announce: 'Störung im Kühlkreislauf.',
        panels: [
          { id: 'links', x: 2, y: 1 },
          { id: 'rechts', x: 2, y: 2 },
        ],
      },
    },
  });
}

const mission = castMission();

/** The lobby of a room for `mission`, its crew of two joined and ready. */
function lobby(castSeed?: number): GameState {
  const room = initialState(mission, null, 'normal', castSeed);
  return [
    { type: 'player-join', playerId: 'p1', name: 'Anna' } as const,
    { type: 'player-join', playerId: 'p2', name: 'Ben' } as const,
    { type: 'set-ready', playerId: 'p2', ready: true } as const,
  ].reduce(applyAction, room);
}

/** A run of `mission` with every kind of line said: its start, an emergency, the clock, the end. */
function heardRun(): GameState {
  const run = applyAction(started(mission), { type: 'lights-out', at: T0 + 3000 });
  const alarmed = applyAction(run, {
    type: 'drone-spotted',
    at: T0 + 5000,
    penaltySec: 20,
    playerId: 'p1',
  });
  const emergency = applyAction(alarmed, { type: 'sabotage-start', at: T0 + 6000 });
  const deadline = emergency.deadlineAt ?? 0;
  const called = applyAction(emergency, { type: 'clock-call', at: deadline - 299_000 });
  return applyAction(called, { type: 'time-expired', at: deadline });
}

describe('a line heard in a run', () => {
  const run = heardRun();
  const heard = run.events.filter((event) => event.moment !== undefined);

  it('carries its role and the person of the night’s cast who says it', () => {
    expect(heard.map((event) => [event.moment, event.speaker])).toEqual([
      ['start', { role: 'operator', person: 'helmut' }],
      ['alarm', { role: 'operator', person: 'helmut' }],
      ['announce', { role: 'pa', person: 'anlage' }],
      ['emergency', { role: 'operator', person: 'helmut' }],
      // The Schichtleitung has no voice yet: the desk says its lines.
      ['clock', { role: 'operator', person: 'helmut' }],
      ['lost', { role: 'operator', person: 'helmut' }],
    ]);
    // Every other line of the report names nobody.
    const rest = run.events.filter((event) => event.moment === undefined);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((event) => !('speaker' in event))).toBe(true);
    expect(viewFor(run, 'p1').cast).toEqual({ pa: 'anlage', operator: 'helmut', lead: null });
  });

  it('shows its words without the audio tags, which only its recording hears', () => {
    expect(heard.find((event) => event.moment === 'start')?.label).toBe(
      'Leitstelle an Nachtschicht. Strom weg.',
    );
    expect(heard.find((event) => event.moment === 'lost')?.label).toBe('Die Zeit ist um.');
    expect(viewFor(lobby(), 'p1').radioCheck).toBe('Funkprobe, Nachtschicht.');
    expect(viewFor(started(mission), 'p1').intro?.pa).toEqual([
      'Durchsage für Trakt C. Es ist 23 Uhr 47.',
    ]);
    const texts = radioLines(mission).map((line) => line.text);
    expect(texts.filter((text) => /[[\]]/.test(text))).toEqual([]);
    expect(texts).toContain('Die Zeit ist um.');
  });

  it('keeps every voice, its prompt and its model out of a player’s view', () => {
    const everyone = ROLES.flatMap((role) => ROSTER[role]);
    const secrets = everyone.flatMap((p) => [p.prompt, p.character, p.voiceId, p.model]);
    const kept = secrets.filter((secret): secret is string => secret !== undefined);
    expect(kept).toContain('g1jpii0iyvtRs8fqXsd1');
    const views = [lobby(), started(mission), run].flatMap((state) => [
      viewFor(state, 'p1'),
      viewForSpectator(state),
    ]);
    for (const view of views) {
      const json = JSON.stringify(view);
      for (const secret of kept) {
        expect(json.includes(secret), secret).toBe(false);
      }
    }
    // What a view says of the cast is the role and the person's id, and nothing else.
    const lost = viewFor(run, 'p1').events.at(-1);
    expect(JSON.stringify(lost?.speaker)).toBe('{"role":"operator","person":"helmut"}');
  });
});

describe('a room’s nights', () => {
  it('are staffed from the pinned seed in a pinned room, else from the server’s draw', () => {
    expect(initialState(mission).castSeed).toBe(0);
    expect(initialState(mission, 5150).castSeed).toBe(5150);
    expect(initialState(mission, null, 'normal', 77).castSeed).toBe(77);
    // The lobby before the room's first run, that run and its end card: one night.
    const room = lobby(77);
    expect(castFor(room)).toEqual(castOf(77));
    const run = applyAction(room, { type: 'start-mission', playerId: 'p1', at: T0, seed: 9 });
    expect(run.castSeed).toBe(77);
    expect(castFor(run)).toEqual(castOf(77));
    const over = applyAction(run, { type: 'time-expired', at: T0 + 600_000 });
    expect(castFor(over)).toEqual(castOf(77));
    // Back in the lobby, the next night.
    const back = applyAction(over, { type: 'back-to-lobby', playerId: 'p1' });
    expect(castFor(back)).toEqual(castOf(78));
    expect(viewFor(back, 'p2').cast).toEqual(castOf(78));
  });
});
