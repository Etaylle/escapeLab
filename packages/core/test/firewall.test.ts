import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  moduleFor,
  puzzleDefSchema,
  puzzleDueAt,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { ConsoleId, GameState, PuzzleContext, Viewer } from '../src/index.js';
import { serialLastDigit } from '../src/edgework.js';
import { GameError } from '../src/errors.js';
import {
  BASE_RULE,
  decidingRule,
  dealWave,
  FIREWALL_LINES,
  FIREWALL_PAUSE_MS,
  FIREWALL_POLICY,
  firewallModule,
  RULES_HEADING,
  SAME_LINE_GAP,
  TRIP_GRACE_MS,
  fitsADropRule,
  widestHeader,
  hostileByPolicy,
  type FirewallDef,
  type FirewallHeader,
  type FirewallInput,
  type FirewallPacket,
  type FirewallState,
  type FirewallView,
} from '../src/puzzles/firewall.js';
import { mulberry32 } from '../src/rng.js';
import {
  FIREWALL_SEED,
  firewallPlan,
  firewallProbe,
  playFirewallProbe,
  SPARE_WAVES,
  type FirewallPlan,
} from './firewallPlan.js';
import { AT_BOOK, AT_CONSOLE_B, AT_STATION, AUDIENCE, ELSEWHERE, lineBack } from './lab.js';
import { serverDown } from './lab.js';
import { lightsOut, standing, started, T0 } from './lab.js';

const SEEDS = 200;

const defOf = (over: Record<string, unknown> = {}): FirewallDef =>
  puzzleDefSchema.parse({
    type: 'firewall',
    id: 'pf',
    title: 'Paketfilter',
    ...over,
  }) as FirewallDef;

const DEF = defOf();
const FALL_MS = DEF.fallSec * 1000;
/** A Laborkennung whose last digit is 4. */
const EDGEWORK = { serial: 'K7G3B-4', indicators: [], cells: 1 };
const BOTH = { a: ['op'], b: ['pt'] };
const NONE = { a: [], b: [] };

/** A moment of the station: at `at`, from `console`, the consoles manned as `atConsoles`. */
function ctx(
  at: number,
  console: ConsoleId | null = null,
  atConsoles: PuzzleContext['atConsoles'] = BOTH,
): PuzzleContext {
  return {
    edgework: EDGEWORK,
    alarms: 0,
    remainingSec: 600,
    at,
    crew: ['op', 'pt', 'rd'],
    console,
    atConsoles,
    readers: [],
  };
}

const fresh = (seed = 1, def = DEF): FirewallState =>
  firewallModule.init(def, mulberry32(seed), ctx(T0, null, NONE));

/** The station at `at` as the reducer brings it, consoles as `atConsoles`. */
const at = (state: FirewallState, when: number, atConsoles = BOTH, def = DEF) =>
  firewallModule.elapse?.(def, state, ctx(when, null, atConsoles)) ?? {
    state,
    solved: false,
    penalty: null,
  };

/** `input` at `when` from `console`, the station brought to that moment first. */
function moved(state: FirewallState, when: number, console: ConsoleId, input: FirewallInput) {
  const now = at(state, when).state;
  return firewallModule.apply(DEF, now, input, console === 'a' ? 'op' : 'pt', ctx(when, console));
}

const view = (state: FirewallState, viewer: Viewer): FirewallView =>
  firewallModule.view(DEF, state, viewer, {
    edgework: EDGEWORK,
    alarms: 0,
    crew: [],
    operators: [],
  });

/**
 * The station manned at T0 and its first wave started on the Freigabe key then: running from
 * T0.
 */
function running(seed = 1, def = DEF): FirewallState {
  const manned = at(fresh(seed, def), T0, BOTH, def).state;
  return firewallModule.apply(def, manned, { start: true }, 'op', ctx(T0, 'a')).state;
}

/** The epoch moment `packet` comes on, and reaches the Kern, in a wave started at `startedAt`. */
const enters = (state: FirewallState, i: number): number =>
  state.startedAt + (state.packets[i]?.enterMs ?? NaN);
const arrives = (state: FirewallState, i: number): number => enters(state, i) + FALL_MS;

const header = (source: string, port: number, protocol: 'TCP' | 'UDP'): FirewallHeader => ({
  source,
  port,
  protocol,
});

describe('the Sicherheitsrichtlinie', () => {
  it('lets the first fitting rule decide, the Grundregel where none fits', () => {
    const digit = 4;
    // Wartungsnetz before the remote ports: a Telnet packet from there passes.
    expect(decidingRule(header('10.9.1.4', 23, 'TCP'), digit)).toBe(0);
    // the remote ports before the Labornetz: Telnet from the lab is dropped.
    expect(decidingRule(header('10.4.2.17', 23, 'TCP'), digit)).toBe(1);
    // the Labornetz over TCP before the Laborkennung's digit
    expect(decidingRule(header('10.4.2.17', 514, 'TCP'), digit)).toBe(2);
    expect(decidingRule(header('10.4.2.17', 514, 'UDP'), digit)).toBe(3);
    // name service before UDP at large — but the digit before both
    expect(decidingRule(header('85.12.4.9', 53, 'UDP'), digit)).toBe(4);
    expect(decidingRule(header('85.12.4.9', 53, 'UDP'), 3)).toBe(3);
    expect(decidingRule(header('85.12.4.9', 161, 'UDP'), digit)).toBe(5);
    expect(decidingRule(header('10.6.3.3', 443, 'TCP'), digit)).toBe(BASE_RULE);
  });

  it('drops by the deciding rule alone, and reads the Laborkennung’s last digit', () => {
    const telnet = header('10.9.1.4', 23, 'TCP');
    expect(fitsADropRule(telnet, 4)).toBe(true);
    expect(hostileByPolicy(telnet, EDGEWORK)).toBe(false);
    const web = header('31.14.2.26', 8086, 'TCP');
    expect(hostileByPolicy(web, { ...EDGEWORK, serial: 'K7G3B-6' })).toBe(true);
    expect(hostileByPolicy(web, { ...EDGEWORK, serial: 'K7G3B-5' })).toBe(false);
  });

  it('prints its rules in their order on the page, the Grundregel last, nothing of a run', () => {
    const manual = firewallModule.manual(DEF);
    // the rules stand straight under the heading that says how they are read
    const policy = manual.find((section) => section.heading === RULES_HEADING);
    expect(policy?.blocks[0]?.kind).toBe('rules');
    const rules = policy?.blocks.find((block) => block.kind === 'rules');
    expect(rules?.kind === 'rules' && rules.items).toEqual([
      ...FIREWALL_POLICY.map((rule) => rule.text),
      'Andernfalls darf das Paket passieren.',
    ]);
    const printed = JSON.stringify(manual);
    const state = fresh(3);
    for (const packet of state.packets) {
      expect(printed).not.toContain(packet.header.source);
    }
  });
});

describe('the printed page on the waves', () => {
  const printed = (waves: number): string =>
    JSON.stringify(firewallModule.manual(defOf({ waves })));

  it('reads true of one wave: it waits for the Freigabe, and no next one follows', () => {
    const page = printed(1);
    expect(page).toContain('Es kommt eine Welle zu sieben Paketen');
    expect(page).toContain('sie wartet auf Freigabe. Ist sie sauber, ist der Kern frei.');
    expect(page).not.toContain('folgt die nächste');
  });

  it.each([2, 3, 4])('reads true of %i waves: the first waits, the next follows', (waves) => {
    const page = printed(waves);
    const count = ['zwei', 'drei', 'vier'][waves - 2];
    expect(page).toContain('Die erste wartet auf Freigabe');
    expect(page).toContain(`folgt die nächste von selbst; nach ${count} sauberen ist der Kern`);
    expect(page).not.toContain('eine Welle zu');
  });

  it.each([1, 2, 3, 4])('says of %i wave(s) that a wave called off waits again', (waves) => {
    expect(printed(waves)).toContain('ab; die neue Welle wartet auf Freigabe.');
  });
});

describe('the rules in play', () => {
  it('are by default the four simplest: 1, 2, 3 and 6; then 5; the Laborkennung’s 4 last', () => {
    const inPlay = (rules: number) => fresh(1, defOf({ rules })).exercised.map((r) => r + 1);
    expect(inPlay(3)).toEqual([1, 2, 3]);
    expect(fresh(1).exercised.map((r) => r + 1)).toEqual([1, 2, 3, 6]);
    expect(inPlay(5)).toEqual([1, 2, 3, 5, 6]);
    expect(inPlay(6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it(`never decide a default packet by the Laborkennung or a port pair, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed);
      const decided = [0, 1, 2].flatMap((wave) =>
        dealWave(DEF, state, wave).map((p) => decidingRule(p.header, state.digit)),
      );
      expect(decided.filter((rule) => rule === 3 || rule === 4), `seed ${seed}`).toEqual([]);
    }
  });
});

describe('the widest header', () => {
  it(`deals no header wider than the widest it names, part by part, for ${SEEDS} seeds`, () => {
    const widest = widestHeader();
    expect(widest).toEqual({ source: '31.14.9.98', port: 8080, protocol: 'TCP' });
    const seen = { source: 0, port: 0, protocol: 0 };
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed);
      for (const { header } of [0, 1, 2, 3].flatMap((wave) => dealWave(DEF, state, wave))) {
        seen.source = Math.max(seen.source, header.source.length);
        seen.port = Math.max(seen.port, String(header.port).length);
        seen.protocol = Math.max(seen.protocol, header.protocol.length);
      }
    }
    // as wide as the widest, and never wider
    expect(seen).toEqual({
      source: widest.source.length,
      port: String(widest.port).length,
      protocol: widest.protocol.length,
    });
  });
});

describe('a wave', () => {
  it(`varies what a default wave teaches of the order, for ${SEEDS} seeds`, () => {
    const fits = (rule: number, h: FirewallHeader) => FIREWALL_POLICY[rule]?.fits(h, 4) === true;
    const lab = (h: FirewallHeader) => h.source.startsWith('10.4.');
    // the four traps the simplest rules set, by what decides them and how they look
    const kinds: [string, (p: FirewallPacket) => boolean][] = [
      ['lab-tcp', (p) => !p.hostile && lab(p.header) && p.header.protocol === 'TCP'],
      ['lab-udp', (p) => p.hostile && lab(p.header) && p.header.protocol === 'UDP'],
      ['service-remote', (p) => !p.hostile && fits(0, p.header) && fits(1, p.header)],
      ['lab-remote', (p) => p.hostile && lab(p.header) && fits(1, p.header)],
    ];
    const seen = new Set<string>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed);
      const waves = [0, 1, 2, 3].map((wave) => dealWave(DEF, state, wave));
      const [first, second] = waves;
      // the Wartungsnetz's decoy, caught further down by rule 2 in one wave and rule 6 in the next
      const decoy = (wave: FirewallPacket[] = [], by: number) =>
        wave.some((p) => !p.hostile && fits(0, p.header) && fits(by, p.header));
      expect(decoy(first, 1), `seed ${seed}`).toBe(true);
      expect(decoy(second, 5), `seed ${seed}`).toBe(true);
      // a trap in every wave, and every kind of trap in the four waves
      const trapsOf = (wave: FirewallPacket[]) =>
        kinds.filter(([, is]) => wave.some(is)).map(([name]) => name);
      const present = waves.map(trapsOf);
      expect(present.every((names) => names.length > 0), `seed ${seed}`).toBe(true);
      expect(new Set(present.flat()), `seed ${seed}`).toEqual(new Set(kinds.map(([n]) => n)));
      present.flat().forEach((name) => seen.add(name));
    }
    expect(seen.size).toBe(4);
  });

  it(`has two or three hostile packets, by the policy, and a decoy, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed, defOf({ packets: 5 + (seed % 5) }));
      const hostile = state.packets.filter((p) => p.hostile);
      expect(hostile.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(hostile.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      for (const packet of state.packets) {
        const policy = hostileByPolicy(packet.header, EDGEWORK);
        expect(packet.hostile, `seed ${seed} ${packet.id}`).toBe(policy);
      }
      // a packet only the order lets through: a rule in play that drops fits it further down
      const drops = state.exercised.filter((r) => FIREWALL_POLICY[r]?.verdict === 'sperren');
      const caught = (h: FirewallHeader) => drops.some((r) => FIREWALL_POLICY[r]?.fits(h, 4));
      const decoys = state.packets.filter((p) => !p.hostile && caught(p.header));
      expect(decoys.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(decoys.every((p) => fitsADropRule(p.header, 4))).toBe(true);
    }
  });

  it(`is decided by the instance's rules, which its waves cover, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rules = 3 + (seed % 4);
      const def = defOf({ rules });
      const state = fresh(seed, def);
      expect(state.exercised, `seed ${seed}`).toHaveLength(rules);
      const verdicts = state.exercised.map((rule) => FIREWALL_POLICY[rule]?.verdict);
      expect(new Set(verdicts), `seed ${seed}`).toEqual(new Set(['sperren', 'durchlassen']));
      const decided = new Set(
        [0, 1, 2].flatMap((wave) =>
          dealWave(def, state, wave).map((p) => decidingRule(p.header, state.digit)),
        ),
      );
      const allowed = new Set([...state.exercised, BASE_RULE]);
      expect([...decided].filter((rule) => !allowed.has(rule)), `seed ${seed}`).toEqual([]);
      expect(state.exercised.filter((rule) => !decided.has(rule)), `seed ${seed}`).toEqual([]);
    }
  });

  it(`comes on one after another, 0.6 of a fall apart on a line, for ${SEEDS} seeds`, () => {
    // the share the consoles' geometry holds two cards of a line apart by (client firewall.css)
    expect(SAME_LINE_GAP).toBe(0.6);
    for (let seed = 0; seed < SEEDS; seed++) {
      const { packets } = fresh(seed, defOf({ packets: 9 }));
      expect(packets[0]?.enterMs).toBe(FIREWALL_PAUSE_MS);
      for (const [i, packet] of packets.entries()) {
        expect(packet.line).toBeGreaterThanOrEqual(0);
        expect(packet.line).toBeLessThan(FIREWALL_LINES);
        const before = packets.slice(0, i);
        expect(before.every((p) => p.enterMs < packet.enterMs)).toBe(true);
        const sameLine = before.filter((p) => p.line === packet.line);
        expect(sameLine.every((p) => packet.enterMs - p.enterMs >= FALL_MS * 0.6)).toBe(true);
      }
    }
  });

  it('is the same for the same seed and digit, another for another seed', () => {
    expect(fresh(5).packets).toEqual(fresh(5).packets);
    expect(fresh(5).packets).not.toEqual(fresh(6).packets);
  });
});

describe('the clock', () => {
  it('holds the first wave at its start until both consoles are manned and the Freigabe', () => {
    const state = fresh();
    expect(state).toMatchObject({ heldAt: T0, waiting: true });
    const onlyA = at(state, T0 + 60_000, { a: ['op'], b: [] }).state;
    expect(onlyA.entered).toBe(0);
    expect(onlyA.vacant).toEqual(['b']);
    const alone = () =>
      firewallModule.apply(DEF, onlyA, { start: true }, 'op', ctx(T0 + 61_000, 'a'));
    expect(alone).toThrow('Am Analysepult steht niemand.');
    const both = at(onlyA, T0 + 90_000).state;
    expect(both).toMatchObject({ heldAt: T0, waiting: true, vacant: [] });
    expect(firewallModule.dueAt?.(DEF, both)).toBeNull();
    // ten minutes later, still nothing has come on
    expect(at(both, T0 + 690_000).state.entered).toBe(0);
    const go = firewallModule.apply(DEF, both, { start: true }, 'op', ctx(T0 + 700_000, 'a'));
    expect(go.state).toMatchObject({ heldAt: null, waiting: false, startedAt: T0 + 700_000 });
    expect(go.state.event).toMatchObject({ kind: 'armed' });
    expect(firewallModule.dueAt?.(DEF, go.state)).toBe(enters(go.state, 0));
    const again = () =>
      firewallModule.apply(DEF, go.state, { start: true }, 'op', ctx(T0 + 700_001, 'a'));
    expect(again).toThrow('Die Welle läuft schon.');
    const atB = () => firewallModule.apply(DEF, both, { start: true }, 'pt', ctx(T0 + 1, 'b'));
    expect(atB).toThrow('Sperre und Freigabe bedient nur das Sperrpult.');
  });

  it('brings a packet onto its line at its moment, a second’s slack on either side', () => {
    const state = running();
    expect(at(state, enters(state, 0) - 1000).state.entered).toBe(0);
    expect(at(state, enters(state, 0) + 1000).state.entered).toBe(1);
    expect(at(state, enters(state, 2) + 1000).state.entered).toBe(3);
  });

  it('freezes the packets while a console stands empty, and moves the wave on by the hold', () => {
    const state = at(running(), T0 + FIREWALL_PAUSE_MS + 1000).state;
    const held = at(state, T0 + 6000, { a: ['op'], b: [] }).state;
    expect(held.heldAt).toBe(T0 + 6000);
    expect(firewallModule.dueAt?.(DEF, held)).toBeNull();
    // a whole fall later, held: nothing has reached the Kern, nothing more come on
    const later = at(held, T0 + 6000 + 5 * FALL_MS, { a: ['op'], b: [] });
    expect(later.penalty).toBeNull();
    expect(later.state.entered).toBe(held.entered);
    const back = at(later.state, T0 + 66_000).state;
    expect(back.heldAt).toBeNull();
    expect(back.startedAt).toBe(state.startedAt + 60_000);
  });

  it('calls a wave off once a hostile packet reaches the Kern: one alarm, a fresh wave', () => {
    const state = running();
    const first = state.packets.findIndex((p) => p.hostile);
    const early = at(state, arrives(state, first) - 1000);
    expect(early.penalty).toBeNull();
    const hit = at(early.state, arrives(state, first) + 1000);
    expect(hit.penalty).toBe('Paketfilter: Angriff im Kern');
    const judged = arrives(state, first) + TRIP_GRACE_MS;
    expect(hit.state).toMatchObject({ dealt: 2, startedAt: judged, heldAt: judged, waiting: true });
    expect(hit.state.event).toMatchObject({ kind: 'fault', at: judged });
    expect(hit.state.packets.map((p) => p.id.split('-')[0])).toEqual(
      hit.state.packets.map(() => '2'),
    );
  });

  it('charges a wave one alarm at most: its other attacks never reach the Kern', () => {
    let state = running();
    const end = arrives(state, state.packets.length - 1);
    let alarms = 0;
    for (let when = T0; when <= end; when += 500) {
      const result = at(state, when);
      alarms += result.penalty === null ? 0 : 1;
      state = result.state;
    }
    expect(alarms).toBe(1);
  });

  it('is ticked at the next packet coming on, the next attack judged, or the clean end', () => {
    const state = running();
    expect(firewallModule.dueAt?.(DEF, state)).toBe(enters(state, 0));
    const all = at(state, enters(state, state.packets.length - 1)).state;
    const hostile = all.packets.findIndex((p) => p.hostile);
    expect(firewallModule.dueAt?.(DEF, all)).toBe(arrives(all, hostile) + TRIP_GRACE_MS);
  });

});

describe('the clock, standing still', () => {
  it('never goes back in time: a moment before the hold counts as the hold’s', () => {
    const state = at(running(), T0 + 8000).state;
    const held = at(state, T0 + 9000, { a: ['op'], b: [] }).state;
    expect(held.heldAt).toBe(T0 + 9000);
    // both back, reported with a moment before the hold: the wave goes on as if from the hold
    const back = at(held, T0 + 5000).state;
    expect(back).toMatchObject({ heldAt: null, startedAt: state.startedAt });
    expect(back.entered).toBe(held.entered);
  });

  it('lets a crew standing still lose one alarm at most, from any moment, over ten minutes', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const stop of [0, 3, 8, 15, 30, 60, 120]) {
        let state = played(seed, stop);
        let alarms = 0;
        for (let when = T0 + stop * 1000; when <= T0 + (stop + 600) * 1000; when += 1000) {
          const result = at(state, when);
          alarms += result.penalty === null ? 0 : 1;
          state = result.state;
        }
        expect(alarms, `seed ${seed}, still from ${stop} s`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * The station of `seed` worked by the solver, both consoles manned, a second at a time for
 * `seconds`: where a crew may stop.
 */
function played(seed: number, seconds: number): FirewallState {
  let state = at(fresh(seed), T0).state;
  for (let s = 0; s < seconds; s++) {
    const when = T0 + s * 1000;
    state = at(state, when).state;
    const views = {
      operator: view(state, AT_STATION),
      partner: view(state, AT_CONSOLE_B),
      reader: view(state, AT_BOOK),
    };
    const aid = { transcript: [], remainingSec: 600, at: when };
    for (const { by, input } of firewallModule.solve(DEF, views, EDGEWORK, aid)) {
      const [who, from] = by === 'partner' ? (['pt', 'b'] as const) : (['op', 'a'] as const);
      state = firewallModule.apply(DEF, state, input, who, ctx(when, from)).state;
    }
  }
  return state;
}

/** Every hostile packet of the wave dropped as it comes on, from console a. */
function dropAll(state: FirewallState): FirewallState {
  return state.packets.reduce((now, packet, i) => {
    if (!packet.hostile) {
      return now;
    }
    const when = Math.max(enters(state, i) + 100, (now.event?.at ?? 0) + 1);
    const lower = now.packets.find(
      (p) => p.line === packet.line && p.enterMs < packet.enterMs && !now.dropped.includes(p.id),
    );
    const through = lower === undefined ? when : now.startedAt + lower.enterMs + FALL_MS;
    const free = Math.max(when, through);
    return moved(now, free + 1, 'a', { trip: packet.line }).state;
  }, state);
}

describe('a trip', () => {
  it('drops the lowest packet on its line at the server’s moment', () => {
    const state = running(2);
    const i = state.packets.findIndex((p) => p.hostile);
    const packet = state.packets[i];
    const later = state.packets.find((p, j) => j > i && p.line === packet?.line);
    const done = moved(state, enters(state, i) + 1000, 'a', { trip: packet?.line ?? 0 });
    expect(done.penalty).toBeNull();
    expect(done.state.dropped).toEqual([packet?.id]);
    expect(done.state.dropped).not.toContain(later?.id);
    expect(done.state.event).toMatchObject({ kind: 'drop', line: packet?.line });
  });

  it('that hits nothing is reported and costs nothing', () => {
    const state = running();
    const done = moved(state, T0 + 1000, 'a', { trip: 2 });
    expect(done.penalty).toBeNull();
    expect(done.state.event).toMatchObject({ kind: 'void', line: 2 });
    expect(done.state.dropped).toEqual([]);
  });

  it('on a packet the policy lets through is a fault: one alarm, a fresh wave from then', () => {
    const state = running();
    const i = state.packets.findIndex((p) => !p.hostile);
    const when = enters(state, i) + 1000;
    const done = moved(state, when, 'a', { trip: state.packets[i]?.line ?? 0 });
    expect(done.penalty).toBe('Paketfilter: zulässiges Paket gesperrt');
    expect(done.state).toMatchObject({ dealt: 2, startedAt: when, dropped: [], marks: [] });
    expect(done.state).toMatchObject({ waiting: true, heldAt: when });
  });

});

describe('a late trip', () => {
  it('takes the attack behind a packet just through, never the one let through', () => {
    const state = running();
    const benign = state.packets.find((p) => !p.hostile);
    const hostile = state.packets.find((p) => p.hostile);
    if (benign === undefined || hostile === undefined) {
      throw new Error('a wave without both kinds of packet');
    }
    const behind = { ...hostile, line: benign.line, enterMs: benign.enterMs + FALL_MS / 2 };
    const two = { ...state, packets: [{ ...benign }, behind], entered: 2 };
    const when = state.startedAt + benign.enterMs + FALL_MS + 100;
    const done = moved(two, when, 'a', { trip: benign.line });
    // the attack dropped, the other through: the wave of two is clean
    expect(done.penalty).toBeNull();
    expect(done.state).toMatchObject({ cleared: 1 });
  });

  it('still takes a marked packet just through the Kern line, 300 ms at most', () => {
    const unmarked = running(2);
    const i = unmarked.packets.findIndex((p) => p.hostile);
    const line = unmarked.packets[i]?.line ?? 0;
    const lower = unmarked.packets.some((p, j) => j < i && p.line === line);
    expect(lower, 'the first hostile packet is the first on its line').toBe(false);
    const state = { ...unmarked, marks: [unmarked.packets[i]?.id ?? ''] };
    // half a slow round trip after the packet reached the line on the server's clock
    const late = moved(state, arrives(state, i) + 200, 'a', { trip: line });
    expect(late.penalty).toBeNull();
    expect(late.state.dropped).toEqual([state.packets[i]?.id]);
    // unmarked, it is in the Kern once through: the grace answers no question of the policy's
    const blind = moved(unmarked, arrives(state, i) + 200, 'a', { trip: line });
    expect(blind.state).toMatchObject({ dropped: [] });
    expect(blind.state.event).toMatchObject({ kind: 'void' });
    expect(at(state, arrives(state, i) + 200).penalty).toBeNull();
    const tooLate = at(state, arrives(state, i) + 400);
    expect(tooLate.penalty).toBe('Paketfilter: Angriff im Kern');
    expect(TRIP_GRACE_MS).toBe(300);
  });

  it('is turned away at console b, and while the Analysepult stands empty', () => {
    const state = running();
    const atB = () => moved(state, T0 + 1000, 'b', { trip: 0 });
    expect(atB).toThrow('Sperre und Freigabe bedient nur das Sperrpult.');
    const held = at(state, T0 + 1000, { a: ['op'], b: [] }).state;
    const alone = () =>
      firewallModule.apply(DEF, held, { trip: 0 }, 'op', ctx(T0 + 1000, 'a', { a: ['op'], b: [] }));
    expect(alone).toThrow(GameError);
    expect(alone).toThrow('Am Analysepult steht niemand.');
  });

  it('clears the wave once every hostile packet is out and the others are through', () => {
    const state = running(4);
    const dropped = dropAll(state);
    expect(dropped.dropped.length).toBe(state.packets.filter((p) => p.hostile).length);
    const last = Math.max(
      ...state.packets.flatMap((p, i) => (p.hostile ? [] : [arrives(state, i)])),
    );
    expect(at(dropped, last - 1000).state.cleared).toBe(0);
    const clean = at(dropped, last + 1000);
    expect(clean.penalty).toBeNull();
    expect(clean.state).toMatchObject({ cleared: 1, dealt: 2, startedAt: last });
    expect(clean.state.event).toMatchObject({ kind: 'cleared', at: last });
  });

  it('solves the station with the last clean wave', () => {
    const def = defOf({ waves: 1 });
    const state = running(4, def);
    const dropped = dropAll(state);
    const last = Math.max(
      ...state.packets.flatMap((p, i) => (p.hostile ? [] : [arrives(state, i)])),
    );
    const done = at(dropped, last + 1000, BOTH, def);
    expect(done.solved).toBe(true);
    expect(done.state.event).toMatchObject({ kind: 'done' });
  });
});

/**
 * A Sperrpult on its own, which never marks and trips a line 150 ms after each packet left it,
 * whenever no other packet is on it — a hostile one would drop in a grace given to every packet,
 * a harmless one cost nothing —,
 * pressing the Freigabe for every wave: the waves it cleared, the packets it dropped, its alarms.
 */
function graceAlone(seed: number, waves: number) {
  let state = running(seed);
  const tally = { cleared: 0, dropped: 0, alarms: 0 };
  for (let wave = 0; wave < waves; wave++) {
    state = graceTrips(state, tally);
    const end = at(state, state.startedAt + 120_000);
    tally.alarms += end.penalty === null ? 0 : 1;
    tally.cleared = Math.max(tally.cleared, end.state.cleared);
    const go = state.startedAt + 130_000;
    state = firewallModule.apply(DEF, at(end.state, go).state, { start: true }, 'op', ctx(go, 'a'))
      .state;
  }
  return tally;
}

/** The trips of `graceAlone` in one wave, noted in `tally`: the state once its wave is over. */
function graceTrips(start: FirewallState, tally: { dropped: number; alarms: number }) {
  let state = start;
  const trips = state.packets
    .map((p) => ({ when: state.startedAt + p.enterMs + FALL_MS + 150, line: p.line, id: p.id }))
    .sort((p, q) => p.when - q.when);
  for (const { when, line, id } of trips) {
    const t = when - state.startedAt;
    const others = state.packets.some(
      (p) => p.id !== id && p.line === line && p.enterMs <= t && t < p.enterMs + FALL_MS,
    );
    const now = at(state, when);
    tally.alarms += now.penalty === null ? 0 : 1;
    if (now.state.dealt !== start.dealt) {
      return now.state;
    }
    if (!others) {
      const tripped = firewallModule.apply(DEF, now.state, { trip: line }, 'op', ctx(when, 'a'));
      tally.alarms += tripped.penalty === null ? 0 : 1;
      tally.dropped += tripped.state.event?.kind === 'drop' ? 1 : 0;
      state = tripped.state;
    }
  }
  return state;
}

describe('the grace', () => {
  it('answers no question of the policy: a Sperrpult alone, tripping in it, drops nothing', () => {
    for (let seed = 0; seed < 100; seed++) {
      // the bound: in three waves not one packet dropped, not one wave clean, an alarm in each
      expect(graceAlone(seed, 3), `seed ${seed}`).toEqual({ cleared: 0, dropped: 0, alarms: 3 });
    }
  });
});

describe('a mark', () => {
  it('is set and taken back at console b, on a packet on its line', () => {
    const state = running();
    const when = enters(state, 0) + 1000;
    const id = state.packets[0]?.id ?? '';
    const set = moved(state, when, 'b', { mark: id });
    expect(set.penalty).toBeNull();
    expect(set.state.marks).toEqual([id]);
    expect(moved(set.state, when + 1, 'b', { mark: id }).state.marks).toEqual([]);
  });

  it('is turned away at console a, before its packet comes on and after it is through', () => {
    const state = running();
    const id = state.packets[0]?.id ?? '';
    expect(() => moved(state, enters(state, 0) + 1000, 'a', { mark: id })).toThrow(
      'Markierungen setzt nur das Analysepult.',
    );
    expect(() => moved(state, enters(state, 0) - 1000, 'b', { mark: id })).toThrow(
      'Dieses Paket ist nicht in der Leitung.',
    );
    const through = state.packets[0]?.hostile === true ? null : arrives(state, 0) + 1000;
    if (through !== null) {
      expect(() => moved(state, through, 'b', { mark: id })).toThrow(
        'Dieses Paket ist nicht in der Leitung.',
      );
    }
    // the trip's grace is no mark's: 100 ms through, a packet takes none
    const hostile = state.packets.findIndex((p) => p.hostile);
    const late = () =>
      moved(state, arrives(state, hostile) + 100, 'b', { mark: state.packets[hostile]?.id ?? '' });
    expect(late).toThrow('Dieses Paket ist nicht in der Leitung.');
  });
});

/** The first wave 20 s in, its first hostile packet on the lines marked; dealt as a test asks. */
function markedWave() {
  const state = at(running(3), T0 + 20_000).state;
  const hostile = state.packets
    .slice(0, state.entered)
    .filter((p) => p.hostile)
    .map((p) => p.id);
  return { state, hostile, marked: { ...state, marks: hostile.slice(0, 1) } };
}

describe('the views', () => {

  it('show the Sperrpult the packets and their rings, never a header', () => {
    const { state, hostile, marked } = markedWave();
    const gate = view(marked, AT_STATION);
    expect(gate.role).toBe('gate');
    expect(gate.packets?.length).toBe(state.entered);
    expect(gate.packets?.every((p) => p.header === null)).toBe(true);
    expect(gate.packets?.filter((p) => p.marked).map((p) => p.id)).toEqual(hostile.slice(0, 1));
    const wire = JSON.stringify(gate);
    for (const packet of state.packets) {
      expect(wire).not.toContain(packet.header.source);
    }
  });

  it('show the Analysepult the same packets with their headers', () => {
    const { state, marked } = markedWave();
    const analysis = view(marked, AT_CONSOLE_B);
    expect(analysis.role).toBe('analysis');
    expect(analysis.packets?.map((p) => p.header)).toEqual(
      state.packets.slice(0, state.entered).map((p) => p.header),
    );
    expect(analysis.packets?.map(({ id, line, enterMs }) => ({ id, line, enterMs }))).toEqual(
      view(marked, AT_STATION).packets?.map(({ id, line, enterMs }) => ({ id, line, enterMs })),
    );
  });

  it('show no packet still to come, and nobody which packet is hostile', () => {
    const { state, marked } = markedWave();
    for (const viewer of [AT_STATION, AT_CONSOLE_B, AT_BOOK, ELSEWHERE, AUDIENCE]) {
      const wire = JSON.stringify(view(marked, viewer));
      expect(wire).not.toContain('hostile');
      expect(wire).not.toContain(`"${state.packets[state.entered]?.id}"`);
    }
  });

  it('show the policy and everybody away nothing, the audience the consoles', () => {
    const { marked } = markedWave();
    for (const viewer of [AT_BOOK, ELSEWHERE]) {
      const away = view({ ...marked, event: { n: 1, kind: 'drop', at: T0, line: 0 } }, viewer);
      expect(away).toMatchObject({ role: null, packets: null, clock: null, vacant: [] });
      expect(away.event).toBeNull();
    }
    const audience = view(marked, AUDIENCE);
    expect(audience.packets?.every((p) => p.header !== null)).toBe(true);
  });
});

const mission = firewallProbe();
const consoleB = stationKey({ puzzleId: 'filter', console: 'b' });
const both = { stations: { filter: ['p1'], [consoleB]: ['p2'] } };
/** The station on at T0 + 500, p1 at console a, p2 at b from T0 + 1000. */
const manned = (seed = 3): GameState => {
  const atA = standing(lightsOut(started(mission, seed)), {
    stations: { filter: ['p1'] },
    signSeen: ['p1', 'p2'],
  });
  const on = applyAction(atA, { type: 'interact', playerId: 'p1', at: T0 + 500 });
  return standing(on, { ...both, at: T0 + 1000 });
};
/** The same, the Freigabe pressed at T0 + 1000: the first wave runs from then. */
const open = (seed = 3): GameState => {
  const input = { start: true };
  const move = { type: 'puzzle-input' as const, playerId: 'p1', at: T0 + 1000, input };
  return applyAction(manned(seed), move);
};
const fw = (state: GameState): FirewallState => state.puzzleState as FirewallState;

/**
 * A run, and a moment just after its first hostile packet reached the Kern with no tick since,
 * at which a packet the policy lets through is the lowest on its line; null where the seed
 * deals none.
 */
const lateTrip = (seed: number) => {
  const state = open(seed);
  const { packets, startedAt } = fw(state);
  const fall = 10_000;
  const hostile = packets.find((p) => p.hostile);
  const at = startedAt + (hostile?.enterMs ?? 0) + fall + TRIP_GRACE_MS + 200;
  const falling = (p: (typeof packets)[number]) =>
    startedAt + p.enterMs <= at && at < startedAt + p.enterMs + fall;
  const lowest = (l: number) => packets.find((p) => p.line === l && falling(p));
  const line = [0, 1, 2, 3, 4].find((l) => lowest(l)?.hostile === false);
  return line === undefined ? null : { state, at, line };
};

describe('the Paketfilter through the reducer', () => {
  it('starts the wave on the Freigabe, both manned, and holds it as one is left', () => {
    expect(fw(manned())).toMatchObject({ heldAt: T0 + 500, waiting: true, vacant: [] });
    const state = open();
    expect(fw(state)).toMatchObject({ heldAt: null, startedAt: T0 + 1000, vacant: [] });
    const left = standing(state, { stations: { filter: ['p1'] }, at: T0 + 3000 });
    expect(fw(left)).toMatchObject({ heldAt: T0 + 3000, vacant: ['b'] });
    const gate = viewFor(left, 'p1').puzzle;
    expect(gate?.kind === 'firewall' && gate.vacant).toEqual(['b']);
    const input = { trip: 0 };
    const move = { type: 'puzzle-input' as const, playerId: 'p1', at: T0 + 4000, input };
    const trip = () => applyAction(left, move);
    expect(trip).toThrow('Am Analysepult steht niemand.');
  });

  it('holds the wave while the run stands still for the server, and goes on after', () => {
    const down = applyAction(open(), serverDown(T0 + 2000));
    expect(fw(down)).toMatchObject({ heldAt: T0 + 2000, vacant: ['a', 'b'] });
    const back = [lineBack('p1', T0 + 30_000), lineBack('p2', T0 + 32_000)].reduce(
      applyAction,
      down,
    );
    expect(back.paused).toBeNull();
    expect(fw(back)).toMatchObject({ heldAt: null, vacant: [], startedAt: T0 + 31_000 });
  });

  it('brings the station to a move’s moment first: the Kern is the alarm, the move none', () => {
    const late = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(lateTrip).find((found) => found !== null);
    if (late === undefined || late === null) {
      throw new Error('no seed deals a packet let through on its line as the first attack lands');
    }
    const input = { trip: late.line };
    const move = { type: 'puzzle-input' as const, playerId: 'p1', at: late.at, input };
    const after = applyAction(late.state, move);
    const alarms = after.events.filter((e) => e.kind === 'penalty').map((e) => e.label);
    expect(alarms).toEqual(['Paketfilter: Angriff im Kern']);
    // the move was made on the wave the alarm called off: it counts for nothing, refused by none
    expect(fw(after)).toMatchObject({ waiting: true, dropped: [] });
    expect(fw(after).event).toMatchObject({ kind: 'fault' });
  });

});

/**
 * The probe on `seed` worked by the solver through the reducer, a second at a time, ticked as the
 * room ticks it, up to the moment its last wave is clean on the clock — not ticked to it: the
 * state then, and that moment.
 */
function beforeTheSolve(seed: number): { state: GameState; clean: number } {
  let state = open(seed);
  for (let second = 2; second < 600; second++) {
    const at = T0 + second * 1000;
    const due = puzzleDueAt(state);
    if (lastWaveOut(fw(state)) && due !== null) {
      return { state, clean: due };
    }
    state = due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
    state = solverMoves(state, at);
  }
  throw new Error(`seed ${seed}: the probe's last wave never stood before its clean end`);
}

/** Whether the probe's last wave has every hostile packet out: its clean end is all that is due. */
function lastWaveOut(station: FirewallState): boolean {
  const out = (p: FirewallPacket): boolean => !p.hostile || station.dropped.includes(p.id);
  return station.cleared === 1 && station.packets.every(out);
}

/** The solver's moves on the probe's views at `at`, through the reducer. */
function solverMoves(start: GameState, at: number): GameState {
  const [def] = start.mission.puzzles;
  if (def === undefined) {
    throw new Error('the probe has no station');
  }
  const views = { operator: firewallViewOf(start, 'p1'), partner: firewallViewOf(start, 'p2') };
  const aid = { transcript: [], remainingSec: null, at };
  const seen = { ...views, reader: views.partner };
  return moduleFor(def.type)
    .solve(def, seen, start.edgework, aid)
    .reduce((state, { by, input }) => {
      const playerId = by === 'partner' ? 'p2' : 'p1';
      return applyAction(state, { type: 'puzzle-input', playerId, at, input });
    }, start);
}

/** The open Paketfilter as `playerId` sees it. */
function firewallViewOf(state: GameState, playerId: string): FirewallView {
  const view = viewFor(state, playerId).puzzle;
  if (view?.kind !== 'firewall') {
    throw new Error(`${playerId} sees no open Paketfilter`);
  }
  return view;
}

describe('the Paketfilter through the reducer, on its own', () => {
  it('answers a move the clock’s solve overtook with the solve, refusing none', () => {
    const { state, clean } = beforeTheSolve(3);
    expect(state.currentPuzzleIndex).toBe(0);
    const input = { trip: 0 };
    const late = { type: 'puzzle-input' as const, playerId: 'p1', at: clean + 500, input };
    const after = applyAction(state, late);
    expect(after.currentPuzzleIndex).toBe(1);
    expect(after.penaltySeq).toBe(0);
  });

  it('charges a hostile packet in the Kern on the room’s tick, to nobody', () => {
    const state = open();
    const first = fw(state).packets.findIndex((p) => p.hostile);
    const due = fw(state).startedAt + (fw(state).packets[first]?.enterMs ?? 0) + 10_000;
    let now = state;
    for (let guard = 0; guard < 20 && now.penaltySeq === 0; guard++) {
      const next = puzzleDueAt(now);
      now = applyAction(now, { type: 'puzzle-tick', at: next ?? due });
    }
    expect(now.penaltySeq).toBe(1);
    const kern = { kind: 'penalty', label: 'Paketfilter: Angriff im Kern' };
    expect(now.events.at(-1)).toMatchObject(kern);
    expect(Object.values(now.credits).every((credit) => (credit.alarms ?? 0) === 0)).toBe(true);
  });

  it('shows through the game’s views the headers at console b alone, hostility to nobody', () => {
    const state = applyAction(open(), { type: 'puzzle-tick', at: T0 + 16_000 });
    const sources = fw(state)
      .packets.slice(0, fw(state).entered)
      .map((p) => p.header.source);
    expect(sources.length).toBeGreaterThan(0);
    const atA = JSON.stringify(viewFor(state, 'p1'));
    const atB = JSON.stringify(viewFor(state, 'p2'));
    const watching = JSON.stringify(viewForSpectator(state));
    for (const source of sources) {
      expect(atA).not.toContain(source);
      expect(atB).toContain(source);
      expect(watching).toContain(source);
    }
    for (const wire of [atA, atB, watching]) {
      expect(wire).not.toContain('hostile');
    }
    const away = standing(state, { stations: {}, at: T0 + 16_500 });
    expect(JSON.stringify(viewFor(away, 'p2'))).not.toContain(sources[0]);
  });
});

describe('the harness’s scratch mission', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../../tools/fixtures/firewall-plan.json', import.meta.url), 'utf8'),
  ) as FirewallPlan;

  it('is a lab for two: the consoles apart, the policy in a binder, the sign, a way out', () => {
    const mission = firewallProbe();
    expect(mission).toMatchObject({ id: 'custom-filterprobe', title: 'Filterprobe' });
    expect(mission.players).toEqual({ min: 2, max: 2 });
    expect(mission.puzzles).toMatchObject([{ type: 'firewall', id: 'filter', waves: 2 }]);
    const consoles = mission.map.stations.filter((s) => s.puzzleId === 'filter');
    expect(consoles.map((s) => s.console)).toEqual(['a', 'b']);
    expect(mission.map.manuals).toMatchObject([
      { kind: 'book', label: 'SICHERHEITSRICHTLINIE', puzzleIds: ['filter'] },
    ]);
    expect(mission.map.edgeworkSign).toBeDefined();
    expect(mission.map.exit).toBeDefined();
  });

  it('is solved through the reducer on its pinned seed, every hostile packet marked first', () => {
    const { state, plan } = playFirewallProbe();
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
    const digit = Number(plan.serial.at(-1));
    const [def] = firewallProbe().puzzles;
    const played = plan.waves.slice(0, def?.type === 'firewall' ? def.waves : 0);
    const hostile = played.flat().filter((p) => fitsADropRule(p.header, digit));
    expect(hostile.length).toBeGreaterThan(0);
    const marks = plan.moves.flatMap((move) => ('mark' in move.input ? [move.input.mark] : []));
    const edgework = { serial: plan.serial, indicators: [], cells: 0 };
    const byPolicy = played.flat().filter((p) => hostileByPolicy(p.header, edgework));
    expect(marks.sort()).toEqual(byPolicy.map((p) => p.id).sort());
    // the plan says of every wave it may deal what the policy says of its packets
    const all = plan.waves.flat();
    expect(all.map((p) => p.hostile)).toEqual(all.map((p) => hostileByPolicy(p.header, edgework)));
    expect(plan.waves).toHaveLength(played.length + SPARE_WAVES);
    // solved on the clock as the last packet went through: both consoles worked it
    expect(state.credits['p1']?.operated).toBe(1);
    expect(state.credits['p2']?.operated).toBe(1);
    expect(serialLastDigit(edgework)).toBe(digit);
  });

  it('carries the solver’s own plan in tools/fixtures/firewall-plan.json', () => {
    // Regenerate the file from `firewallPlan()` when the probe or the module changes.
    expect(fixture).toEqual(firewallPlan());
    expect(fixture).toMatchObject({ mission: 'custom-filterprobe', seed: FIREWALL_SEED });
  });

  it('is solved alarm-free on every seed the harness might be pinned to', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { state } = playFirewallProbe(seed);
      expect(state.currentPuzzleIndex, `seed ${seed}`).toBe(1);
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
    }
  });
});

describe('the solver', () => {
  it('needs both consoles, the Laborkennung and the moment', () => {
    const state = running();
    const views = { operator: view(state, AT_STATION), reader: view(state, AT_BOOK) };
    const aid = { transcript: [], remainingSec: 600, at: T0 };
    expect(() => firewallModule.solve(DEF, views, EDGEWORK, aid)).toThrow(/Analysepult/);
    const both = { ...views, partner: view(state, AT_CONSOLE_B) };
    expect(() => firewallModule.solve(DEF, both, null, aid)).toThrow(/Laborkennung/);
    expect(() => firewallModule.solve(DEF, both, EDGEWORK)).toThrow(/moment/);
  });

  it('marks a hostile packet as it comes on, and trips its line once it is the lowest', () => {
    const state = running(4);
    const i = state.packets.findIndex((p) => p.hostile);
    const when = enters(state, i) + 1000;
    const now = at(state, when).state;
    const seen = (s: FirewallState) => ({
      operator: view(s, AT_STATION),
      partner: view(s, AT_CONSOLE_B),
      reader: view(s, AT_BOOK),
    });
    const aid = { transcript: [], remainingSec: 600, at: when };
    const marks = firewallModule.solve(DEF, seen(now), EDGEWORK, aid);
    expect(marks).toContainEqual({ by: 'partner', input: { mark: state.packets[i]?.id } });
    const ringed = { ...now, marks: [state.packets[i]?.id ?? ''] };
    const lower = state.packets.some(
      (p, j) => j < i && p.line === state.packets[i]?.line && when < arrives(state, j),
    );
    const trips = firewallModule.solve(DEF, seen(ringed), EDGEWORK, aid);
    expect(trips.some((move) => 'trip' in move.input)).toBe(!lower);
    expect(serialLastDigit(EDGEWORK)).toBe(4);
  });
});
