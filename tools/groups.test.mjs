import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  checkGroups,
  GROUP_NAMES,
  GROUPS,
  groupClock,
  groupNames,
  groupOf,
  misfiled,
  planGroups,
  reaches,
  spentText,
  stepGates,
  summaryText,
} from './groups.mjs';

/** The walkthrough's source, read as text: shots.mjs runs its walkthrough as it loads. */
const SHOTS = readFileSync(fileURLToPath(new URL('./shots.mjs', import.meta.url)), 'utf8');

/**
 * Every capture the walkthrough's source names: each string literal that is a file name ending
 * in .png — a value spliced into a template (`${…}`, spaces and all) standing as `*` — and the
 * label of every skip line. A name put together with `+` escapes this scan, so the walkthrough
 * may build none (`concatenatedIn`); and every name it takes, however built, it holds to the
 * table as it runs (shots.mjs `checkGroup`).
 */
function capturesIn(source) {
  const quoted = /(['"])((?:(?!\1)[^\s\\])+?\.png)\1/g;
  const templated = /`((?:[^`\s\\$]|\$\{[^}]*\})+?\.png)`/g;
  const spliced = /\$\{[^}]*\}/g;
  const files = [
    ...[...source.matchAll(quoted)].map(([, , name]) => name),
    ...[...source.matchAll(templated)].map(([, name]) => name.replace(spliced, '*')),
  ];
  const labels = [...source.matchAll(/\bskip\(\s*'([^']+)'/g)].map(([, label]) => label);
  return [...new Set([...files, ...labels])];
}

/** The capture names `source` puts together with `+` — a `.png` tail added on — as written. */
function concatenatedIn(source) {
  const appended = /\+\s*(['"`])[^'"`\n]*\.png\1/g;
  const bare = /(['"`])\.png\1/g;
  return [...source.matchAll(appended), ...source.matchAll(bare)].map(([found]) => found);
}

/** Every group a step of the walkthrough is gated by, as its source names it. */
function gatesIn(source) {
  const steps = [...source.matchAll(/\b(?:inGroup|whenOn|asStage)\(\s*'([^']+)'/g)];
  const drills = [...source.matchAll(/\[\s*'([^']+)',\s*capture[A-Z]\w*\s*\]/g)];
  return [...new Set([...steps, ...drills].map(([, name]) => name))];
}

/**
 * The body of the top-level function `name` in `source`, from its signature's line to the brace
 * that closes it at the start of a line; throws where `source` has no such function.
 */
function bodyOf(source, name) {
  const signature = `\\n(?:async )?function ${name}\\(.*?\\) \\{\\n`;
  const found = source.match(new RegExp(`${signature}([\\s\\S]*?)\\n\\}`));
  if (found === null) {
    throw new Error(`tools/shots.mjs has no function ${name}`);
  }
  return found[1];
}

/** Whether the table entry `entry` names `capture`: the same, or a pattern that matches it. */
function entryNames(entry, capture) {
  const parts = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return entry === capture || new RegExp(`^${parts.join('.*')}$`).test(capture);
}

/** A fake clock: `now` reads it, `pass` moves it on by `ms`. */
function fakeTime() {
  let at = 1000;
  return {
    now: () => at,
    pass: (ms) => {
      at += ms;
    },
  };
}

describe('the capture groups against the walkthrough', () => {
  const captures = capturesIn(SHOTS);

  it('finds the walkthrough’s captures and skip labels in its source', () => {
    // A pattern that broke would find a handful; the walkthrough names some 160.
    assert.ok(captures.length >= 150, `only ${captures.length} captures found`);
    assert.ok(captures.includes('beacon-sweep-b.png') && captures.includes('frames'));
    assert.ok(captures.includes('game-*.png') && captures.includes('device-phone-*-*.png'));
  });

  it('reads a name with spaces in its splice, and finds one put together with +', () => {
    const source = [
      "capture(page, `device-phone-${size === turned ? 'a' : 'b'}-${slug}.png`);",
      "capture(page, 'plain.png');",
      'capture(page, "double.png");',
    ].join('\n');
    assert.deepEqual(capturesIn(source).sort(), [
      'device-phone-*-*.png',
      'double.png',
      'plain.png',
    ]);
    assert.equal(concatenatedIn(source).length, 0);
    assert.ok(concatenatedIn("capture(page, 'menu-' + size + '.png');").length > 0);
    assert.ok(concatenatedIn('capture(page, name + `-phone.png`);').length > 0);
  });

  it('builds no capture’s name with +, which the scan could not read', () => {
    assert.deepEqual(concatenatedIn(SHOTS), []);
  });

  it('puts every capture the walkthrough names in a group', () => {
    const loose = captures.filter((capture) => groupOf(capture) === null);
    assert.deepEqual(loose, [], `add these to a group in tools/groups.mjs: ${loose.join(', ')}`);
  });

  it('names no capture the walkthrough no longer takes', () => {
    const stale = GROUPS.flatMap(({ name, captures: entries }) =>
      entries
        .filter((entry) => !captures.some((capture) => entryNames(entry, capture)))
        .map((entry) => `${name}: ${entry}`),
    );
    assert.deepEqual(stale, []);
  });

  it('lets every group within the run need run, which pulls the mission in', () => {
    const within = GROUPS.filter(({ name, stage }) => stage === 'run' && name !== 'run');
    assert.ok(within.length >= 7, `only ${within.length} groups within the run`);
    assert.deepEqual(
      within.filter(({ needs }) => !needs.includes('run')).map(({ name }) => name),
      [],
    );
  });

  it('gates the walkthrough’s steps by groups the table has, each of them', () => {
    const gates = gatesIn(SHOTS);
    assert.deepEqual(
      gates.filter((name) => !GROUP_NAMES.includes(name)),
      [],
    );
    assert.deepEqual(
      GROUP_NAMES.filter((name) => !gates.includes(name)),
      [],
    );
  });

  it('holds every capture and skip the walkthrough counts to the gate of its step', () => {
    // Each capture is counted in taken(), each skip in skip(), both through checkGroup...
    assert.equal(SHOTS.match(/tally\.taken \+=/g)?.length, 1);
    assert.equal(SHOTS.match(/tally\.skipped \+=/g)?.length, 1);
    assert.match(bodyOf(SHOTS, 'capture'), /\btaken\(name\);/);
    assert.match(bodyOf(SHOTS, 'taken'), /^\s*checkGroup\(name\);\s*tally\.taken \+= 1;$/);
    assert.match(bodyOf(SHOTS, 'skip'), /^\s*checkGroup\(label\);/);
    // ...which fails the run on what misfiled() says of it under the step's gate...
    const check = bodyOf(SHOTS, 'checkGroup');
    assert.match(check, /const wrong = misfiled\(label, gates\.now\(\)\);/);
    assert.match(check, /if \(wrong !== null\) \{\s*fail\(wrong\);/);
    // ...the gate inGroup and whenOn set for the step's group.
    assert.match(bodyOf(SHOTS, 'inGroup'), /return gates\.run\(name, async \(\) => \{/);
    assert.match(bodyOf(SHOTS, 'whenOn'), /groupOn\(name\) \? gates\.run\(name, start\) :/);
  });
});

describe('groupOf — the group a capture or a skip label belongs to', () => {
  it('finds a name by itself, a templated one by its pattern, a label with its `*`', () => {
    assert.equal(groupOf('menu.png'), 'screens');
    assert.equal(groupOf('game-laptop-13.png'), 'hud');
    assert.equal(groupOf('device-phone-932-notlicht.png'), 'devices');
    assert.equal(groupOf('device-notepad-phone.png'), 'reading');
    assert.equal(groupOf('hint-*.png'), 'reading');
    assert.equal(groupOf('frames'), 'perf');
  });

  it('finds no group for a name the table has nowhere', () => {
    assert.equal(groupOf('nowhere.png'), null);
    assert.equal(groupOf('game-laptop-13.jpg'), null);
  });
});

describe('misfiled — a capture held to the group of the step that takes it', () => {
  it('passes a capture its own group’s step takes', () => {
    assert.equal(misfiled('menu.png', 'screens'), null);
    assert.equal(misfiled('device-phone-932-notlicht.png', 'devices'), null);
  });

  it('fails a capture taken in another group’s step, as a misfiled one is', () => {
    // cold-open.png is intro's: filed under screens, intro's step would take it all the same.
    const said = misfiled('cold-open.png', 'screens') ?? '';
    assert.ok(said.startsWith('cold-open.png: tools/groups.mjs files it under intro'), said);
    assert.match(said, /but it was taken in a step of screens/);
  });

  it('fails a capture taken outside every step, and one no group files', () => {
    assert.match(misfiled('menu.png', null) ?? '', /under screens, but it was taken outside/);
    assert.match(misfiled('nowhere.png', 'run') ?? '', /nowhere\.png: no capture group names it/);
  });
});

describe('stepGates — the gate of the step that runs now', () => {
  it('names no group outside every step', () => {
    assert.equal(stepGates().now(), null);
  });

  it('names the innermost step’s group, past an await and back out of it', async () => {
    const gates = stepGates();
    const seen = [];
    await gates.run('run', async () => {
      await Promise.resolve();
      seen.push(gates.now());
      await gates.run('devices', async () => {
        await new Promise((done) => setTimeout(done, 5));
        seen.push(gates.now());
      });
      seen.push(gates.now());
    });
    assert.deepEqual(seen, ['run', 'devices', 'run']);
    assert.equal(gates.now(), null);
  });

  it('keeps each of two steps running side by side to its own group', async () => {
    const gates = stepGates();
    const later = (ms) => new Promise((done) => setTimeout(done, ms));
    const step = (ms) => async () => {
      await later(ms);
      return gates.now();
    };
    const groups = await Promise.all([
      gates.run('intro', step(10)),
      gates.run('screens', step(1)),
    ]);
    assert.deepEqual(groups, ['intro', 'screens']);
  });
});

describe('checkGroups — a capture in two groups refused', () => {
  const group = (name, captures) => ({ name, stage: 'run', needs: [], captures });

  it('passes groups whose names and patterns meet nowhere', () => {
    checkGroups([group('a', ['one.png', 'two-*.png']), group('b', ['twofold.png'])]);
  });

  it('throws for a name in two groups, naming it and both', () => {
    const twice = [group('a', ['one.png']), group('b', ['one.png'])];
    assert.throws(() => checkGroups(twice), /one\.png \(a and b\)/);
  });

  it('throws for a pattern of one group that matches a name of another', () => {
    const met = [group('a', ['game-*.png']), group('b', ['game-phone.png'])];
    assert.throws(() => checkGroups(met), /game-\*\.png \(a and b\)/);
  });

  it('throws for a group named twice', () => {
    assert.throws(() => checkGroups([group('a', []), group('a', [])]), /a named twice/);
  });
});

describe('groupNames — the groups a variable lists', () => {
  it('reads none from an unset or empty variable', () => {
    assert.deepEqual(groupNames('SHOTS_ONLY', undefined), []);
    assert.deepEqual(groupNames('SHOTS_ONLY', ''), []);
    assert.deepEqual(groupNames('SHOTS_ONLY', ' , '), []);
  });

  it('trims each name and keeps it once', () => {
    assert.deepEqual(groupNames('SHOTS_ONLY', ' screens, intro ,screens'), ['screens', 'intro']);
  });

  it('throws for a name no group has, naming the variable and the groups there are', () => {
    assert.throws(
      () => groupNames('SHOTS_SKIP', 'screens,scren'),
      /SHOTS_SKIP names groups of editor, .*perf, not "scren"/,
    );
  });
});

describe('planGroups — what SHOTS_ONLY and SHOTS_SKIP leave a run to play', () => {
  const on = (plan) => GROUP_NAMES.filter((name) => plan.on.has(name));
  const others = (...names) => GROUP_NAMES.filter((name) => !names.includes(name));

  it('plays every group without either variable, and says nothing', () => {
    const plan = planGroups(undefined, undefined);
    assert.deepEqual(on(plan), GROUP_NAMES);
    assert.deepEqual(plan.lines, []);
  });

  it('plays only the groups SHOTS_ONLY names, a line for each one left out', () => {
    const plan = planGroups('screens,intro', undefined);
    assert.deepEqual(on(plan), ['screens', 'intro']);
    assert.deepEqual(
      plan.lines,
      others('screens', 'intro').map(
        (name) => `${`group ${name}`.padEnd(18)} skipped: SHOTS_ONLY leaves it out`,
      ),
    );
  });

  it('plays every group but those SHOTS_SKIP names, a line for each', () => {
    const plan = planGroups(undefined, 'perf, art');
    assert.deepEqual(on(plan), others('perf', 'art'));
    assert.deepEqual(plan.lines, [
      'group art          skipped: SHOTS_SKIP names it',
      'group perf         skipped: SHOTS_SKIP names it',
    ]);
  });

  it('pulls in the group a group needs, saying which needed it', () => {
    const plan = planGroups('devices', undefined);
    assert.deepEqual(on(plan), ['run', 'devices']);
    assert.ok(plan.lines.includes('group run          pulled in: devices needs it'));
    assert.equal(plan.lines.length, GROUP_NAMES.length - 1);
  });

  it('refuses each group that needs one SHOTS_SKIP leaves out, a line each', () => {
    const plan = planGroups(undefined, 'run');
    const inRun = GROUPS.filter((group) => group.needs.includes('run')).map(({ name }) => name);
    assert.deepEqual(on(plan), others('run', ...inRun));
    const refused = (name) => `${`group ${name}`.padEnd(18)} refused: it needs run, which`;
    assert.deepEqual(
      plan.lines.filter((line) => line.includes('refused')),
      inRun.map((name) => `${refused(name)} SHOTS_SKIP leaves out`),
    );
    assert.ok(plan.lines.includes('group run          skipped: SHOTS_SKIP names it'));
  });

  it('throws where the two leave no group to play, the refusal that emptied it said first', () => {
    const refusal = 'group devices      refused: it needs run, which SHOTS_SKIP leaves out';
    assert.throws(
      () => planGroups('devices', 'run'),
      ({ message }) => {
        const lines = message.split('\n');
        const at = lines.indexOf(refusal);
        return at >= 0 && at < lines.length - 1 && /leave no group to play/.test(lines.at(-1));
      },
    );
    assert.throws(() => planGroups('run', 'run'), /leave no group to play/);
  });

  it('throws for a name no group has', () => {
    assert.throws(() => planGroups('screen', undefined), /SHOTS_ONLY names groups of/);
  });
});

describe('reaches — how far into the walkthrough the groups on go', () => {
  it('stops a drill alone before the walkthrough', () => {
    const on = new Set(['editor']);
    assert.equal(reaches(on, 'drills'), true);
    assert.equal(reaches(on, 'lobby'), false);
  });

  it('takes screens to the started run and intro through the opening, no further', () => {
    assert.equal(reaches(new Set(['screens']), 'lobby'), true);
    assert.equal(reaches(new Set(['screens']), 'opening'), false);
    assert.equal(reaches(new Set(['screens', 'intro']), 'opening'), true);
    assert.equal(reaches(new Set(['screens', 'intro']), 'run'), false);
  });

  it('takes a group of the run to its end, every stage before on the way', () => {
    const on = new Set(['perf', 'run']);
    assert.deepEqual(
      ['drills', 'lobby', 'opening', 'run'].map((stage) => reaches(on, stage)),
      [true, true, true, true],
    );
  });
});

describe('groupClock — the time each group takes', () => {
  it('counts a step to its group, a step within it to the inner one', () => {
    const time = fakeTime();
    const clock = groupClock(time.now);
    time.pass(300);
    clock.enter('run');
    time.pass(1000);
    clock.enter('devices');
    time.pass(250);
    clock.leave();
    time.pass(500);
    clock.leave();
    time.pass(50);
    const spent = clock.spent();
    assert.equal(spent.get('run'), 1500);
    assert.equal(spent.get('devices'), 250);
    assert.equal(spent.get(null), 350);
  });

  it('counts a group entered again on top of what it took before', () => {
    const time = fakeTime();
    const clock = groupClock(time.now);
    for (const ms of [100, 200]) {
      clock.enter('screens');
      time.pass(ms);
      clock.leave();
    }
    assert.equal(clock.spent().get('screens'), 300);
  });

  it('counts a group still open up to the moment it is read', () => {
    const time = fakeTime();
    const clock = groupClock(time.now);
    clock.enter('intro');
    time.pass(700);
    assert.equal(clock.spent().get('intro'), 700);
    time.pass(300);
    assert.equal(clock.spent().get('intro'), 1000);
  });
});

describe('spentText — the line before the summary', () => {
  it('gives each group played its seconds in the table’s order, then the rest', () => {
    const spent = new Map([
      ['intro', 41_000],
      ['screens', 60_240],
      [null, 12_340],
    ]);
    const on = new Set(['intro', 'screens', 'editor']);
    assert.equal(
      spentText(spent, on),
      'editor 0.0 s, screens 60.2 s, intro 41.0 s; outside them 12.3 s',
    );
  });
});

describe('summaryText — the summary’s words', () => {
  const on = new Set(['intro', 'screens']);

  it('names the groups played in the table’s order, and ends with what failed', () => {
    const tally = { taken: 26, skipped: 1, failures: ['menu.png: off', 'frames: slow'] };
    assert.equal(
      summaryText(tally, on),
      '26 captures taken, 1 skipped, 2 failed (groups screens, intro) — ' +
        'menu.png: off; frames: slow',
    );
  });

  it('ends with the groups played where nothing failed', () => {
    assert.equal(
      summaryText({ taken: 3, skipped: 0, failures: [] }, on),
      '3 captures taken, 0 skipped, 0 failed (groups screens, intro)',
    );
  });
});
