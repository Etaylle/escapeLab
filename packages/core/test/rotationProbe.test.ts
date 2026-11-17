import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  doorOpen,
  drawPools,
  findables,
  moduleFor,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState, Mission, PlayerView } from '../src/index.js';
import { standing, started, T0 } from './lab.js';
import {
  playProbe,
  PROBE_POOL,
  probeSeeds,
  rotationPlan,
  rotationProbe,
  seedDrawing,
} from './rotationPlan.js';

/**
 * The Wechselprobe (tools/fixtures/rotation-probe.json) station by station: a chain of the
 * Zeichentastenfeld, the pool of Funkfeuer, Signalkette and Notstromkasten, and the Leitungsnetz
 * behind the door the pool opens. On the walkthrough's played seed the Funkfeuer is in service.
 */

/** A fresh run of the probe on the walkthrough's played seed. */
const freshRun = (): GameState => started(rotationProbe(), probeSeeds().played);

/** The stations out of service in that run. */
const RESTING = ['signalkette', 'notstrom'];

/**
 * Everything a station out of service could give away, as text a view would carry: its printed
 * rules, its notes, mission control's lines about it.
 */
function secretsOf(mission: Mission, puzzleId: string): string[] {
  const def = mission.puzzles.find((p) => p.id === puzzleId);
  if (def === undefined) {
    throw new Error(`no puzzle "${puzzleId}"`);
  }
  const rules = moduleFor(def.type)
    .manual(def)
    .map((section) => JSON.stringify(section));
  const lines = [def.onSolved, ...def.nudges].flatMap((line) =>
    line === undefined ? [] : [JSON.stringify(line)],
  );
  return [...rules, ...def.hints.map((hint) => JSON.stringify(hint)), ...lines];
}

/**
 * The crew at every place the station `puzzleId` has — p1 at its consoles and p2 at its source,
 * then the other way round.
 */
function everywhereAt(state: GameState, puzzleId: string): GameState[] {
  const { stations, manuals } = state.mission.map;
  const spots = stations
    .filter((s) => s.puzzleId === puzzleId)
    .map((s) => (s.console === 'b' ? `${s.puzzleId}/b` : s.puzzleId));
  const sources = manuals.filter((m) => m.puzzleIds.includes(puzzleId)).map((m) => m.id);
  const at = (consoles: string, books: string): GameState =>
    standing(state, {
      stations: Object.fromEntries(spots.map((key) => [key, [consoles]])),
      manuals: Object.fromEntries(sources.map((id) => [id, [books]])),
      signSeen: ['p1', 'p2'],
    });
  return [at('p1', 'p2'), at('p2', 'p1')];
}

/** The run before its first station is switched on, and with that station open. */
function stages(): GameState[] {
  const fresh = freshRun();
  const open = applyAction(standing(fresh, { stations: { tastenfeld: ['p1'] } }), {
    type: 'interact',
    playerId: 'p1',
    at: T0 + 1000,
  });
  return [fresh, open];
}

/** Every state to hold the views of: each stage, the crew at every place of each `RESTING`. */
const everywhere = (): { resting: string; state: GameState }[] =>
  RESTING.flatMap((resting) =>
    stages().flatMap((stage) => everywhereAt(stage, resting).map((state) => ({ resting, state }))),
  );

describe('rotation: the probe on the walkthrough’s seeds', () => {
  it('draws a different station on each', () => {
    const mission = rotationProbe();
    const seeds = probeSeeds();
    expect(drawPools(mission.puzzles, seeds.played)).toEqual({ [PROBE_POOL]: 'funkfeuer' });
    expect(drawPools(mission.puzzles, seeds.other)).toEqual({ [PROBE_POOL]: 'signalkette' });
  });

  it('is won on every draw by the solvers, the door opening with the drawn station', () => {
    const mission = rotationProbe();
    for (const member of ['funkfeuer', 'signalkette', 'notstrom']) {
      const { state, stations } = playProbe(seedDrawing(mission, member));
      expect(state.phase, member).toBe('won');
      expect(stations.map((s) => s.id)).toEqual(['tastenfeld', member, 'leitungsnetz']);
      expect(state.penaltySeq).toBe(0);
      expect(doorOpen(state.mission.map, state, 'schleuse')).toBe(true);
      const said = state.events.filter((e) => e.kind === 'radio').map((e) => e.label);
      expect(said.filter((line) => line.includes('Die Schleuse ist frei'))).toHaveLength(1);
    }
  });

  it('keeps the plan the walkthrough plays the draw’s and the solvers’ own', () => {
    const file = new URL('../../../tools/fixtures/rotation-plan.json', import.meta.url);
    const fixture: unknown = JSON.parse(readFileSync(file, 'utf8'));
    // Regenerate the file with writeRotation.ts when the probe or one of its modules changes.
    expect(fixture).toEqual(rotationPlan());
  });
});

describe('rotation: what the views give of a station out of service', () => {
  it('gives none of its rules, notes or lines to a player, wherever they stand', () => {
    for (const { resting, state } of everywhere()) {
      const secrets = secretsOf(state.mission, resting);
      expect(secrets.length).toBeGreaterThan(1);
      for (const playerId of ['p1', 'p2']) {
        const text = JSON.stringify(viewFor(state, playerId));
        expect(secrets.filter((secret) => text.includes(secret)), resting).toEqual([]);
      }
    }
    const won = JSON.stringify(viewFor(playProbe(probeSeeds().played).state, 'p1'));
    expect(RESTING.flatMap((id) => secretsOf(freshRun().mission, id)).filter((s) => won.includes(s)))
      .toEqual([]);
  });

  it('counts a player at its console or its source at no place, with no page and no device', () => {
    for (const { resting, state } of everywhere()) {
      const title = state.mission.puzzles.find((p) => p.id === resting)?.title;
      for (const playerId of ['p1', 'p2']) {
        const view = viewFor(state, playerId);
        expect(view.manualsHere).toEqual([]);
        expect(view.presence).toMatchObject({ stationId: null, manualId: null });
        expect(view.puzzle?.title).not.toBe(title);
      }
    }
  });

  it('gives the audience, which sees everything, none of it either', () => {
    for (const { resting, state } of everywhere()) {
      const view = viewForSpectator(state);
      const text = JSON.stringify(view);
      const secrets = secretsOf(state.mission, resting);
      expect(secrets.filter((secret) => text.includes(secret)), resting).toEqual([]);
      // No instance: the one open puzzle, if any, is the run's own first station.
      expect(view.puzzle?.title ?? 'Zeichentastenfeld').toBe('Zeichentastenfeld');
      expect(view.players.map((p) => p.presence.stationId)).toEqual([null, null]);
      const spots = view.map?.stations.filter((s) => s.puzzleId === resting) ?? [];
      expect(spots.map((s) => (s.known ? s.status : 'glimpsed'))).toEqual(spots.map(() => 'out'));
    }
  });
});

/** p1's view with p1 at the source `manualId`. */
const atSource = (state: GameState, manualId: string): PlayerView =>
  viewFor(standing(state, { manuals: { [manualId]: ['p1'] } }), 'p1');

/** The status of every station on the audience's map, by puzzle id. */
function statuses(state: GameState): Record<string, string> {
  const stations = viewForSpectator(state).map?.stations ?? [];
  return Object.fromEntries(
    stations.map((s) => [s.puzzleId, 'status' in s ? s.status : 'glimpsed']),
  );
}

describe('rotation: what the views tell the world to show', () => {
  it('marks the consoles and sources out of service', () => {
    const state = standing(freshRun(), {
      found: { p1: ['source:buch-signalkette', 'source:buch-funkfeuer'] },
    });
    expect(statuses(state)).toEqual({
      tastenfeld: 'armed',
      funkfeuer: 'locked',
      signalkette: 'out',
      notstrom: 'out',
      leitungsnetz: 'locked',
    });
    const sources = viewFor(state, 'p1').map?.manuals ?? [];
    const known = Object.fromEntries(sources.map((m) => [m.id, m.known ? m : null]));
    expect(known['buch-signalkette']).toMatchObject({ puzzleIds: [], outOfService: true });
    expect(known['buch-funkfeuer']).toMatchObject({ puzzleIds: ['funkfeuer'] });
    expect(known['buch-funkfeuer']).not.toHaveProperty('outOfService');
    expect(atSource(state, 'buch-signalkette').sourcesHere).toEqual([
      expect.objectContaining({ id: 'buch-signalkette', outOfService: true }),
    ]);
    expect(atSource(state, 'buch-signalkette').manualsHere).toEqual([]);
    expect(atSource(state, 'buch-funkfeuer').sourcesHere[0]).not.toHaveProperty('outOfService');
    expect(atSource(state, 'buch-funkfeuer').manualsHere).toHaveLength(1);
  });

  it('shows the tag at a glimpse, and lets its console be found up close without a chime', () => {
    const fresh = freshRun();
    const keys = findables(fresh).map((thing) => thing.key);
    expect(keys).toEqual(expect.arrayContaining(['console:signalkette/b', 'console:notstrom/a']));
    expect(keys).not.toContain('console:funkfeuer/-');
    const spotOf = (state: GameState): unknown =>
      viewFor(state, 'p1').map?.stations.find((s) => s.puzzleId === 'notstrom' && s.x === 12);
    expect(spotOf(fresh)).toBeUndefined();
    const inSight = standing(fresh, { sight: { p1: ['console:notstrom/a'] } });
    expect(spotOf(inSight)).toMatchObject({ known: false, out: true, look: 'fusebox' });
    const locked = viewFor(standing(fresh, { sight: { p1: ['console:funkfeuer/-'] } }), 'p1');
    expect(locked.map?.stations.find((s) => s.puzzleId === 'funkfeuer')).not.toHaveProperty('out');
    const found = standing(fresh, { found: { p1: ['console:notstrom/a'] } });
    expect(spotOf(found)).toMatchObject({ known: true, found: true, status: 'out' });
    expect(spotOf(found)).not.toHaveProperty('out');
    expect(found.discoveries['p1'] ?? []).toEqual([]);
  });
});
