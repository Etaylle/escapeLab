import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  armedTarget,
  consoleTarget,
  COUNT_WAIT,
  lagging,
  noteTarget,
  presenceSaid,
  presentAt,
  PRESSES,
  pressSaid,
  pressUntilShown,
  sourceTarget,
  stateSaid,
  targetSaid,
} from './presence.mjs';

/** Two rooms, a wall at x 4 between them and a door through it at 4,2. */
const TILES = ['#########', '#...#...#', '#.......#', '#########'];
const DOOR = { id: 'tuer', x: 4, y: 2 };

const SIGNAL_A = {
  puzzleId: 'signalkette',
  x: 6,
  y: 1,
  title: 'Signalkette',
  status: 'armed',
  console: 'a',
  found: false,
  known: true,
};
const SIGNAL_B = { ...SIGNAL_A, x: 2, y: 2, console: 'b', found: true };
const NOTSTROM_A = {
  ...SIGNAL_A,
  puzzleId: 'notstrom',
  x: 1,
  y: 1,
  title: 'Notstrom-Kasten',
  status: 'done',
};
const RADIO = {
  puzzleId: 'frequenz',
  x: 6,
  y: 2,
  title: 'Frequenz-Abgleich',
  status: 'armed',
  found: true,
  known: true,
};
const CLIPBOARD = { id: 'klemmbrett', label: 'KLEMMBRETT', kind: 'clipboard', x: 3, y: 1 };

/** What a test view holds unless a test says otherwise. */
const VIEW = {
  presence: {},
  sourcesHere: [],
  noteHere: null,
  stations: [NOTSTROM_A, SIGNAL_A, SIGNAL_B],
  manuals: [],
  notes: [],
  doorOpen: false,
  index: 2,
};

/** A player's view as the server sends it, with what the tests need of it. */
function viewOf(options = {}) {
  const { presence, sourcesHere, noteHere, stations, manuals, notes, doorOpen, index } = {
    ...VIEW,
    ...options,
  };
  return {
    currentPuzzleIndex: index,
    presence: { stationId: null, console: null, manualId: null, signSeen: false, ...presence },
    sourcesHere,
    noteHere,
    map: { tiles: TILES, doors: [{ ...DOOR, open: doorOpen }], stations, manuals, notes },
  };
}

describe('presentAt — what the view counts its player at', () => {
  it('counts a player at the console they stand at, and not at the other one', () => {
    const atB = viewOf({ presence: { stationId: 'signalkette', console: 'b' } });
    assert.equal(presentAt(atB, consoleTarget(SIGNAL_B)), true);
    assert.equal(presentAt(atB, consoleTarget(SIGNAL_A)), false);
  });

  it('counts nobody at the armed station while the view still has them at the one before', () => {
    const stale = viewOf({ presence: { stationId: 'notstrom', console: 'a' } });
    assert.equal(presentAt(stale, consoleTarget(SIGNAL_A)), false);
    assert.equal(presentAt(stale, armedTarget(stale)), false);
  });

  it('takes a station with one console as console a', () => {
    const view = viewOf({ presence: { stationId: 'frequenz', console: 'a' }, stations: [RADIO] });
    assert.equal(presentAt(view, consoleTarget(RADIO)), true);
    assert.equal(presentAt(view, armedTarget(view)), true);
  });

  it('counts a player at either console of the armed station where no side is named', () => {
    const atA = viewOf({ presence: { stationId: 'signalkette', console: 'a' } });
    assert.equal(presentAt(atA, armedTarget(atA)), true);
  });

  it('counts nobody where no station is armed, nor without a view', () => {
    const none = viewOf({ stations: [NOTSTROM_A] });
    assert.deepEqual(armedTarget(none).consoles, []);
    assert.equal(presentAt(none, armedTarget(none)), false);
    assert.equal(presentAt(null, consoleTarget(SIGNAL_A)), false);
  });

  it('counts a player at a source they stand at, open or shut, and at a note by its index', () => {
    const shut = { id: 'spind', kind: 'locker', label: 'SPIND', opened: false, needsKey: null };
    const view = viewOf({ sourcesHere: [shut], noteHere: { index: 3, text: 'Kalt.' } });
    assert.equal(presentAt(view, sourceTarget({ id: 'spind', x: 1, y: 2 })), true);
    assert.equal(presentAt(view, sourceTarget(CLIPBOARD)), false);
    assert.equal(presentAt(view, noteTarget(3, { x: 2, y: 1 })), true);
    assert.equal(presentAt(view, noteTarget(1, { x: 2, y: 1 })), false);
  });
});

describe('targetSaid — a target as the log names it', () => {
  it('names a console by its side and title, a station with one console by its title', () => {
    assert.equal(targetSaid(consoleTarget(SIGNAL_A)), 'console A of „Signalkette"');
    assert.equal(targetSaid(consoleTarget(RADIO)), 'the console of „Frequenz-Abgleich"');
    assert.equal(targetSaid(armedTarget(viewOf())), '„Signalkette"');
  });

  it('names a source by its label and a note by the tile it is read from', () => {
    assert.equal(targetSaid(sourceTarget(CLIPBOARD)), '„KLEMMBRETT"');
    assert.equal(targetSaid(sourceTarget({ id: 'spind', x: 1, y: 2 })), '„spind"');
    assert.equal(targetSaid(noteTarget(3, { x: 2, y: 1 })), 'the note read at 2,1');
  });
});

/**
 * E as `pressUntilShown` drives it, faked on a clock of its own: the view counts the player
 * from `countedAt` ms on, and what E opens shows from press `shownAt` on (never for null) — at
 * once where `already`. `steps` keeps what was done, in order, with the clock.
 */
function fakeE({ countedAt = 0, shownAt = 1, already = false } = {}) {
  let t = 0;
  let presses = 0;
  const steps = [];
  const up = () => already || (shownAt !== null && presses >= shownAt);
  const hands = {
    now: () => t,
    sleep: async (ms) => {
      steps.push(`sleep ${ms}`);
      t += ms;
    },
    counted: () => t >= countedAt,
    shown: async () => up(),
    press: async () => {
      presses += 1;
      steps.push(`press at ${t}`);
    },
    waitShown: async (ms) => {
      steps.push(`wait ${ms}`);
      if (!up()) {
        t += ms;
      }
    },
  };
  return { hands, steps };
}

describe('pressUntilShown — E only once the view counts the player there', () => {
  it('presses at once where the view counts the player, and stops once it shows', async () => {
    const { hands, steps } = fakeE();
    assert.deepEqual(await pressUntilShown(hands), { shown: true, countedMs: 0, presses: 1 });
    assert.deepEqual(steps, ['press at 0', `wait ${PRESSES.ms / PRESSES.tries}`]);
  });

  it('presses no earlier than the count comes, looking again every 100 ms', async () => {
    const { hands, steps } = fakeE({ countedAt: 300 });
    assert.deepEqual(await pressUntilShown(hands), { shown: true, countedMs: 300, presses: 1 });
    assert.deepEqual(steps.slice(0, 4), ['sleep 100', 'sleep 100', 'sleep 100', 'press at 300']);
  });

  it('waits the whole 6 s for a count that never comes, then presses all the same', async () => {
    const { hands, steps } = fakeE({ countedAt: Infinity, shownAt: 2 });
    assert.deepEqual(await pressUntilShown(hands), { shown: true, countedMs: null, presses: 2 });
    const looks = steps.filter((step) => step === `sleep ${COUNT_WAIT.everyMs}`);
    assert.equal(looks.length, COUNT_WAIT.ms / COUNT_WAIT.everyMs);
    assert.equal(steps.indexOf('press at 6000'), looks.length);
  });

  it('gives up after six presses a second apart where nothing shows', async () => {
    const { hands, steps } = fakeE({ shownAt: null });
    assert.deepEqual(await pressUntilShown(hands), { shown: false, countedMs: 0, presses: 6 });
    const presses = steps.filter((step) => step.startsWith('press'));
    assert.deepEqual(presses, [0, 1000, 2000, 3000, 4000, 5000].map((t) => `press at ${t}`));
  });

  it('stops pressing as soon as it shows, and presses nothing where it is up already', async () => {
    assert.equal((await pressUntilShown(fakeE({ shownAt: 3 }).hands)).presses, 3);
    const up = fakeE({ already: true });
    assert.deepEqual(await pressUntilShown(up.hands), { shown: true, countedMs: 0, presses: 0 });
    assert.deepEqual(up.steps, []);
  });
});

describe('pressSaid — the log’s words on an E that waited', () => {
  it('says nothing where the count came within a second and it showed', () => {
    assert.equal(pressSaid({ shown: true, countedMs: 900, presses: 1 }, 'the panel'), null);
  });

  it('names a slow count, or one that never came, beside the press that opened it', () => {
    assert.equal(
      pressSaid({ shown: true, countedMs: 1400, presses: 1 }, 'the panel'),
      'counted there after 1.4 s, the panel up at press 1',
    );
    assert.equal(
      pressSaid({ shown: true, countedMs: null, presses: 2 }, 'the pages'),
      '!! not counted there in 6.0 s, the pages up at press 2',
    );
    assert.equal(
      pressSaid({ shown: true, countedMs: 2000, presses: 0 }, 'the slip'),
      'counted there after 2.0 s, the slip up already',
    );
  });

  it('flags what never came up after its presses', () => {
    assert.equal(
      pressSaid({ shown: false, countedMs: 200, presses: 6 }, 'the panel'),
      'counted there after 0.2 s, !! the panel not up after 6 presses',
    );
  });
});

describe('stateSaid — where the server has the player, for a failed E', () => {
  const server = { x: 2.5, y: 1.5, facing: Math.PI / 2, moving: false, t: null, rt: 9700 };
  const stale = viewOf({ presence: { stationId: 'notstrom', console: 'a' } });

  it('tells a player stood at the station before from the console the step meant', () => {
    const said = stateSaid({
      name: 'Ben',
      view: stale,
      server,
      sent: { x: 2.5, y: 1.5 },
      target: consoleTarget(SIGNAL_A),
      now: 10_000,
    });
    assert.equal(
      said,
      'the server has had Ben at 2.50,1.50 facing 90° for 0.3 s (the page sent 2.50,1.50); ' +
        'console A at 6,1 4.0 tiles off (counted within 1.6), out of sight, not found; ' +
        "Ben's view: station notstrom/a, sources —, reading —, note —; " +
        'armed signalkette (index 2)',
    );
  });

  it('sees a console through an open door and not through a shut one', () => {
    const at = { ...server, y: 2.5 };
    const through = (doorOpen) =>
      stateSaid({
        name: 'Ben',
        view: viewOf({ doorOpen, stations: [RADIO] }),
        server: at,
        sent: null,
        target: consoleTarget(RADIO),
        now: 9700,
      });
    assert.match(through(true), /the console at 6,2 4\.0 tiles off \(counted within 1\.6\), in/);
    assert.match(through(false), /4\.0 tiles off \(counted within 1\.6\), out of sight, found/);
    assert.match(through(false), /\(the page sent nothing yet\)/);
  });

  it('lists every console of the armed station where no side was named', () => {
    const said = stateSaid({
      name: 'Anna',
      view: stale,
      server: { ...server, x: 2.5, y: 2.5 },
      sent: null,
      target: armedTarget(stale),
      now: 9700,
    });
    assert.match(said, /console A at 6,1 .*out of sight, not found; console B at 2,2 /);
    assert.match(said, /console B at 2,2 0\.0 tiles off \(counted within 1\.6\), in sight, found/);
  });

  it('says whether a source was found, and nothing of sight there', () => {
    const view = viewOf({ manuals: [{ ...CLIPBOARD, found: true, known: true, opened: true }] });
    const said = stateSaid({
      name: 'Ben',
      view,
      server,
      sent: null,
      target: sourceTarget(CLIPBOARD),
      now: 9700,
    });
    assert.match(said, /the source at 3,1 1\.0 tiles off \(counted within 1\.6\), found;/);
    assert.doesNotMatch(said, /sight/);
  });

  it('says so where the stream has no position of the player', () => {
    const said = stateSaid({
      name: 'Ben',
      view: stale,
      server: undefined,
      sent: null,
      target: consoleTarget(SIGNAL_A),
      now: 0,
    });
    assert.equal(said, `no position of Ben on the stream; Ben's view: ${presenceSaid(stale)}`);
  });
});

describe('lagging — the pages a solve has not reached yet', () => {
  it('names the views behind the furthest, a missing one among them', () => {
    const at = (index) => ({ currentPuzzleIndex: index });
    assert.deepEqual(lagging([at(2), at(1)]), [1]);
    assert.deepEqual(lagging([at(3), at(1), at(3)]), [1]);
    assert.deepEqual(lagging([null, at(1)]), [0]);
  });

  it('names none where every view shows the same station', () => {
    assert.deepEqual(lagging([{ currentPuzzleIndex: 2 }, { currentPuzzleIndex: 2 }]), []);
  });
});
