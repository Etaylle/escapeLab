import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  moduleFor,
  MODULES,
  parseMission,
  puzzleDefSchema,
} from '../src/index.js';
import type {
  Mission,
  Perspectives,
  PuzzleView,
} from '../src/index.js';
import { labs } from './lab.js';
import { serialLastDigit } from '../src/edgework.js';
import { firewallMoves, fitsADropRule, type FirewallJudge } from '../src/puzzles/firewall.js';
import { describeMissionsPlayed, SEEDS } from './missionsPlayed.js';
import { playInstance, type Solver } from './solveModule.js';

/** Instance runs of the modules checked on their own, beyond the missions. */
const OWN_SEEDS = 100;

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

const cases = missions.flatMap((mission) =>
  mission.puzzles.map((def) => [`${mission.id}/${def.id} (${def.type})`, def] as const),
);

describe.each(cases)('%s', (_label, def) => {
  it(`is solved from the station's and the book's view, alarm-free, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playInstance(def, seed)).toBeGreaterThan(0);
    }
  });

  it('prints the same manual for every run', () => {
    const puzzleModule = moduleFor(def.type);
    const manual = puzzleModule.manual(def);
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every((section) => section.blocks.length > 0)).toBe(true);
    expect(puzzleModule.manual(structuredClone(def))).toEqual(manual);
  });
});

/** Modules on their own, and the move counts their runs take. */
const own = [
  { type: 'memory', id: 'speicherbank', moves: [5] },
  { type: 'button', id: 'knopf', moves: [1, 2] },
  // four stages of four signs
  { type: 'signal', id: 'signalkette', moves: [16] },
  // the same with the legend and the display grey from the first stage: read by the patterns
  { type: 'signal', id: 'signalkette-farblos', fields: { legend: true, greyFrom: 1 }, moves: [16] },
  // two doors, each a login, its token and the release
  { type: 'access', id: 'zugangskontrolle', moves: [6] },
  // two stages: a value set, the start and the breaker; then two values, the start, the breaker
  { type: 'startup', id: 'anlaufsteuerung', moves: [7] },
  { type: 'startup', id: 'anlaufsteuerung-drei', fields: { stages: 3 }, moves: [11] },
].map(({ type, id, fields = {}, moves }) => {
  const def = puzzleDefSchema.parse({ type, id, title: id, ...fields });
  return [id, def, moves] as const;
});

describe.each(own)('%s on its own', (_id, def, moves) => {
  it(`is solved through the harness without an alarm, for ${OWN_SEEDS} seeds`, () => {
    const taken = new Set<number>();
    for (let seed = 0; seed < OWN_SEEDS; seed++) {
      taken.add(playInstance(def, seed));
    }
    expect([...taken].sort()).toEqual(moves);
  });
});

describe('the Paketfilter on its own', () => {
  const def = puzzleDefSchema.parse({ type: 'firewall', id: 'paketfilter', title: 'Paketfilter' });
  /** A crew at the Paketfilter that marks by `judge` in place of the Sicherheitsrichtlinie. */
  const crewJudging = (judge: FirewallJudge): Solver => (d, views, edgework, aid) => {
    if (d.type !== 'firewall' || edgework === null || aid?.at === undefined) {
      throw new Error('a crew at the Paketfilter needs its def, the Laborkennung and the moment');
    }
    const seen = views as Perspectives<Extract<PuzzleView, { kind: 'firewall' }>>;
    return firewallMoves(d, seen, edgework, aid.at, judge);
  };
  /**
   * Crews that never read the policy: marking every packet, marking none, and marking whatever
   * a rule that drops fits — the rules read as a list of reasons to drop, not in their order.
   */
  const guesses: [string, FirewallJudge][] = [
    ['every packet', () => true],
    ['no packet', () => false],
    ['every reason to drop, in no order', (h, ew) => fitsADropRule(h, serialLastDigit(ew))],
  ];

  it(`is solved by the policy through the harness without an alarm, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playInstance(def, seed)).toBeGreaterThan(0);
    }
  });

  it(`takes an alarm in most seeds from a crew that learned half the page, of ${SEEDS}`, () => {
    // „the Wartungsnetz passes, the rest of UDP drops": rules 1 and 6 alone, no order kept
    const half: FirewallJudge = (h) => !h.source.startsWith('10.9.') && h.protocol === 'UDP';
    let alarms = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      try {
        playInstance(def, seed, crewJudging(half));
      } catch (error) {
        alarms += /alarm/.test(String(error)) ? 1 : 0;
      }
    }
    expect(alarms).toBeGreaterThanOrEqual(SEEDS * 0.9);
  });

  it.each(guesses)('takes an alarm in every seed from a crew marking %s', (_name, judge) => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(() => playInstance(def, seed, crewJudging(judge)), `seed ${seed}`).toThrow(/alarm/);
    }
  });
});

describe('the registry', () => {
  it('knows every module once, and every shipped puzzle type has a station module', () => {
    const types = MODULES.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    for (const [, def] of cases) {
      expect(moduleFor(def.type).type).toBe(def.type);
    }
  });

  it('never hands out the relay as a station module', () => {
    expect(() => moduleFor('relay')).toThrow(/not a station module/);
  });
});

// Every shipped mission and lab (lab.ts `labs`) but Blackout, whose runs have a file of their
// own (blackoutPlayed.test.ts).
describeMissionsPlayed([...missions.filter((mission) => mission.id !== 'blackout'), ...labs()]);
