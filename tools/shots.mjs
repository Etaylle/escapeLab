/**
 * Visual check: drives two real browsers through join → lobby → running
 * mission and captures the result at several window sizes, so layout work
 * can be looked at instead of guessed.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers \
 *     [SHOTS_MISSION=Systemcheck] node tools/shots.mjs [baseUrl] [outDir]
 *
 * SHOTS_MISSION names the mission card to start (default Blackout); the
 * crew is two players. Where the first station is a sync station, both
 * press it together, and the run fails unless it solves. Where the station
 * after it has two consoles, each takes one and both panels are captured;
 * a Signalkette, as in the Systemcheck, they work from both sides until it
 * solves too. Where the first station has two consoles, as Blackout's
 * Notstrom-Kasten, the guest holds the plate door for the host on the way
 * to console A where needed, then both consoles are captured and the meter
 * measures every wire once; nothing is cut.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? '/tmp/escapelab-shots';
const MISSION = process.env.SHOTS_MISSION || 'Blackout';

const SIZES = [
  { name: 'laptop-13', width: 1440, height: 820 },
  { name: 'split-screen', width: 960, height: 760 },
  { name: 'phone', width: 420, height: 760 },
];

/** Avatar speed in tiles per second, as the client walks. */
const SPEED = 4.2;
/** How close to a tile centre a step has to land, in tiles. */
const STEP_TOLERANCE = 0.15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reports how far the main area overflows its window. A screen that scrolls
 * is a layout bug here, so this is printed next to every capture.
 */
async function overflow(page, label) {
  const { scroll, client, parts } = await page.evaluate(() => {
    const el = document.querySelector('.content');
    const name = (n) => `${n.tagName.toLowerCase()}.${n.className.split(' ')[0] || '-'}`;
    const measure = (node, depth) =>
      depth === 0
        ? []
        : Array.from(node.children).flatMap((c) => [
            `${'  '.repeat(3 - depth)}${name(c)} ${Math.round(c.getBoundingClientRect().height)}`,
            ...measure(c, depth - 1),
          ]);
    return {
      scroll: el.scrollHeight,
      client: el.clientHeight,
      parts: measure(el.firstElementChild ?? el, 2),
    };
  });
  const over = scroll - client;
  console.log(`${over > 1 ? '!! scrolls' : 'ok  fits  '} ${label}: ${scroll}/${client} (+${over})`);
  if (over > 1) {
    console.log(parts.join('\n'));
  }
}

/** How far a modal's panel runs out sideways, in px; 0 when it fits. */
async function sideways(page, selector) {
  return page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    return panel === null ? 0 : panel.scrollWidth - panel.clientWidth;
  }, selector);
}

/** Click a button whose visible text contains `text`. */
async function clickText(page, text) {
  const button = page.locator('button', { hasText: text }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
}

/**
 * Listens in on one player's socket: the newest view the server sent it and
 * where its avatar last reported itself. The walks below steer by these, so
 * they depend neither on the map's layout nor on how fast the page renders.
 * On the audience's socket it keeps the spectator view, which places every
 * source before the crew has come across it.
 */
function eavesdrop(page) {
  const seen = { view: null, pos: null };
  page.on('websocket', (socket) => {
    if (!socket.url().endsWith('/ws')) {
      return;
    }
    socket.on('framereceived', ({ payload }) => {
      const msg = JSON.parse(String(payload));
      if (msg.kind === 'view' || msg.kind === 'spectator-view') {
        seen.view = msg.view;
      }
    });
    socket.on('framesent', ({ payload }) => {
      const msg = JSON.parse(String(payload));
      if (msg.kind === 'pos') {
        seen.pos = { x: msg.x, y: msg.y };
      }
    });
  });
  return seen;
}

/** Where the avatar is, in tiles: its last report, or its spawn before it ever moved. */
function whereIs(seen) {
  const spawn = seen.view?.map?.yourSpawn;
  return seen.pos ?? (spawn === undefined ? null : { x: spawn.x + 0.5, y: spawn.y + 0.5 });
}

/** Shortest walk over floor and open doors, as tiles from `from` to `to`; null if none. */
function route(map, from, to) {
  const key = (x, y) => `${x},${y}`;
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const walkable = (x, y) => map.tiles[y]?.[x] === '.' && !closed.has(key(x, y));
  const cameFrom = new Map([[key(from.x, from.y), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at.x === to.x && at.y === to.y) {
      const path = [];
      for (let step = at; step !== null; step = cameFrom.get(key(step.x, step.y))) {
        path.unshift(step);
      }
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (walkable(next.x, next.y) && !cameFrom.has(key(next.x, next.y))) {
        cameFrom.set(key(next.x, next.y), at);
        queue.push(next);
      }
    }
  }
  return null;
}

/** The tile the avatar stands on. */
function tileOf(seen) {
  const at = whereIs(seen);
  return at === null ? null : { x: Math.floor(at.x), y: Math.floor(at.y) };
}

/** Steers the avatar onto a tile centre with short key presses, checking each result. */
async function stepTo(page, seen, tx, ty) {
  for (let i = 0; i < 30; i++) {
    const at = whereIs(seen);
    const dx = tx - at.x;
    const dy = ty - at.y;
    if (Math.abs(dx) < STEP_TOLERANCE && Math.abs(dy) < STEP_TOLERANCE) {
      return true;
    }
    const keys = [];
    if (Math.abs(dx) >= STEP_TOLERANCE) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) >= STEP_TOLERANCE) keys.push(dy > 0 ? 's' : 'w');
    // Never more than a tile's worth at once, so a slow frame cannot carry it far off.
    const ms = Math.min(240, (Math.hypot(dx, dy) / SPEED) * 1000);
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of keys) await page.keyboard.up(key);
    await sleep(140); // the avatar reports itself every 80 ms
  }
  return false;
}

/**
 * Walks the avatar to the tile before `target` on the way there, or leaves it
 * where it is when it already stands next to it. False when no open way
 * leads there or the avatar gets stuck.
 */
async function walkNear(page, seen, target) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const from = tileOf(seen);
    const path = from === null ? null : route(seen.view.map, from, target);
    if (path === null) {
      return false;
    }
    let arrived = true;
    for (const tile of path.slice(1, -1)) {
      if (!(await stepTo(page, seen, tile.x + 0.5, tile.y + 0.5))) {
        arrived = false;
        break;
      }
    }
    if (arrived) {
      return true;
    }
  }
  return false;
}

/** Polls `check` until it holds or `ms` have passed; whether it held in the end. */
async function until(check, ms) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) {
    await sleep(100);
  }
  return check();
}

/** Presses E until `locator` shows: the server takes a moment to count the avatar as there. */
async function interactUntil(page, locator) {
  for (let i = 0; i < 3 && !(await locator.isVisible()); i++) {
    await sleep(300);
    await page.keyboard.press('e');
    await locator.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined);
  }
  return locator.isVisible();
}

/** Steps from where a player stands to `target` over floor and open doors; Infinity if none. */
function stepsTo(seen, target) {
  const from = tileOf(seen);
  const path = from === null ? null : route(seen.view.map, from, target);
  return path === null ? Infinity : path.length;
}

/**
 * Nobody has a role: as in the smoke script, whoever the draw put nearer the
 * armed station works it, and the other one reads.
 */
function operatorFirst(players) {
  const station = players[0].seen.view.map.stations.find((s) => s.status === 'armed');
  return station === undefined
    ? players
    : [...players].sort((a, b) => stepsTo(a.seen, station) - stepsTo(b.seen, station));
}

/** The open manual object a player can walk to soonest, one covering the armed station first. */
function nearestManual(seen) {
  const map = seen.view.map;
  const from = tileOf(seen);
  const armed = map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const options = map.manuals
    .filter((manual) => manual.opened)
    .map((manual) => ({ manual, path: from === null ? null : route(map, from, manual) }))
    .filter((option) => option.path !== null)
    .sort(
      (a, b) =>
        Number(b.manual.puzzleIds.includes(armed)) - Number(a.manual.puzzleIds.includes(armed)) ||
        a.path.length - b.path.length,
    );
  return options[0]?.manual ?? null;
}

/** Text of the first match, trimmed; null when nothing matches. */
async function textOf(locator) {
  return (await locator.count()) === 0 ? null : (await locator.first().innerText()).trim();
}

/** Book pages whose text runs past their foot: the pagination estimate fell short there. */
async function pagesRunningOver(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('.reading-modal .page-text')].filter(
        (text) => text.scrollHeight - text.clientHeight > 1,
      ).length,
  );
}

/**
 * reading-page2.png: one page turned — by a swipe across the pages, falling
 * back to the arrow key if the swipe did nothing — forwards unless the
 * source opened at its end. A wall chart has nothing to turn.
 */
async function capturePageTurn(page, overlay, who) {
  const where = overlay.locator('.book-where, .terminal-status');
  const before = await textOf(where);
  if (before === null) {
    console.log(`reading-page2.png  skipped: ${who} reads a wall chart, it has no pages`);
    return;
  }
  const forwards = !(await overlay.locator('.turn-next').isDisabled());
  if (!forwards && (await overlay.locator('.turn-back').isDisabled())) {
    console.log(`reading-page2.png  skipped: "${before}" is all there is`);
    return;
  }
  const box = await overlay.locator('.book-pages, .terminal-body').first().boundingBox();
  if (box !== null) {
    const y = box.y + box.height / 2;
    const [from, to] = forwards ? [0.75, 0.2] : [0.25, 0.8];
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
    await page.mouse.up();
  }
  await sleep(450);
  let after = await textOf(where);
  let how = 'swiped';
  if (after === before) {
    await page.keyboard.press(forwards ? 'ArrowRight' : 'ArrowLeft');
    await sleep(450);
    after = await textOf(where);
    how = '!! the swipe did nothing, turned by key';
  }
  await page.screenshot({ path: join(OUT, 'reading-page2.png') });
  console.log(
    `reading-page2.png  ${who}: "${before}" → "${after}" ` +
      `(${after === before ? '!! did not turn' : how}), ` +
      `${await pagesRunningOver(page)} page(s) run over`,
  );
}

/**
 * reading.png: a player walks to a manual object, presses E and reads; then
 * turns a page. False when no manual object is in reach for this player.
 */
async function captureReading(page, seen, who) {
  const manual = nearestManual(seen);
  if (manual === null || !(await walkNear(page, seen, manual))) {
    return false;
  }
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(page, overlay))) {
    throw new Error(`${who} stands at "${manual.id}", but no .reading-modal opened after 3 tries`);
  }
  await sleep(400); // past the page's fade-in
  await page.screenshot({ path: join(OUT, 'reading.png') });
  const shows = await textOf(overlay.locator('.book-where, .terminal-status'));
  const over = await sideways(page, '.reading-modal .panel');
  console.log(
    `reading.png        ${who}: "${manual.label}" (${manual.kind}), ${shows ?? 'one sheet'}, ` +
      `${await pagesRunningOver(page)} page(s) run over, ` +
      `panel ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
  );
  await capturePageTurn(page, overlay, who);
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  return true;
}

/**
 * A sync station takes every press within its window: both players click
 * its button at the same moment, and the station has to solve — the lit
 * rooms grow, and the LED strip moves on for both. Throws when it does not.
 */
async function pressTogether(players, station) {
  const [first] = players;
  const litBefore = first.seen.view.map.litRooms.length;
  const done = (page) => page.locator('.led-strip .led-done');
  const doneBefore = await Promise.all(players.map(({ page }) => done(page).count()));
  await Promise.all(players.map(({ page }) => page.locator('.station-modal .big-button').click()));
  const lit = await until(() => first.seen.view.map.litRooms.length > litBefore, 5000);
  const moved = await Promise.all(
    players.map(({ page }, i) =>
      done(page)
        .nth(doneBefore[i])
        .waitFor({ state: 'attached', timeout: 5000 })
        .then(
          () => true,
          () => false,
        ),
    ),
  );
  const stuck = players.filter((_, i) => !moved[i]).map(({ name }) => name);
  if (!lit || stuck.length > 0) {
    const why = [
      ...(lit ? [] : ['no room lit up']),
      ...(stuck.length === 0 ? [] : [`the LED strip stood still for ${stuck.join(' and ')}`]),
    ];
    throw new Error(`both pressed "${station.title}", but it did not solve: ${why.join(', ')}`);
  }
  console.log(
    `sync               ${players.map(({ name }) => name).join(' and ')} pressed ` +
      `"${station.title}" together: solved, ${first.seen.view.map.litRooms.join(', ')} lit`,
  );
}

/**
 * station-both.png: while the operator keeps the station open, the reader
 * walks up as well and presses E — the panel has to show for both of them.
 * At a sync station both then press it together. Then the reader leaves it
 * and walks back to where it stood.
 */
async function captureBothAtStation(reader, operator, station, sync) {
  const back = tileOf(reader.seen);
  if (!(await walkNear(reader.page, reader.seen, station))) {
    if (sync) {
      throw new Error(`${reader.name} has no way to the sync station "${station.title}"`);
    }
    console.log(`station-both.png   skipped: ${reader.name} has no way to "${station.puzzleId}"`);
    return;
  }
  const readerSees = await interactUntil(reader.page, reader.page.locator('.station-modal'));
  const operatorSees = await operator.page.locator('.station-modal').isVisible();
  await sleep(400); // past the panel's fade-in
  await reader.page.screenshot({ path: join(OUT, 'station-both.png') });
  const missing = [
    ...(readerSees ? [] : [reader.name]),
    ...(operatorSees ? [] : [operator.name]),
  ];
  console.log(
    `station-both.png   ${reader.name} joins ${operator.name} at "${station.title}": ` +
      (missing.length === 0
        ? 'panel up for both'
        : `!! no .station-modal for ${missing.join(' and ')}`),
  );
  if (sync) {
    if (missing.length > 0) {
      const who = missing.join(' and ');
      throw new Error(`"${station.title}" wants both presses, but ${who} has no panel`);
    }
    await pressTogether([operator, reader], station);
  }
  // Whatever E opened instead of the panel locks the avatar too.
  await reader.page.keyboard.press('Escape');
  await sleep(300);
  const returned = back !== null && (await walkNear(reader.page, reader.seen, back));
  console.log(
    `station-both       ${reader.name}: ` +
      (returned ? `back near ${back.x},${back.y}` : '!! could not walk back'),
  );
}

/** Resolves true once `locator` is in the page, false after `ms`. */
function attached(locator, ms) {
  return locator.waitFor({ state: 'attached', timeout: ms }).then(
    () => true,
    () => false,
  );
}

/** The console a player works, as its view names it: „Pult A". */
function seatOf(player) {
  return `Pult ${String(player.seen.view.puzzle?.console ?? '?').toUpperCase()}`;
}

/**
 * One stage of the Signalkette: `presser` clicks the keys of the sequence the
 * sender's view shows, in its order and ~150 ms apart, each press counted
 * before the next and its done-lamp lit on both panels. The last press moves
 * the stage on, or solves the station. Throws at the press that fails; returns
 * how many signs went in.
 */
async function pressStage(sender, presser) {
  const { puzzle, currentPuzzleIndex } = sender.seen.view;
  const { stage, sequence } = puzzle;
  const keys = '.station-modal .signal-key';
  // `waitFor` wants one element: the first key stands for the twelve.
  if (!(await attached(presser.page.locator(keys).first(), 3000))) {
    throw new Error(`${presser.name} is to press stage ${stage}, but the panel has no ${keys}`);
  }
  const through = () => {
    const view = presser.seen.view;
    return view.currentPuzzleIndex > currentPuzzleIndex || (view.puzzle?.stage ?? 0) > stage;
  };
  const lamp = (page, i) => page.locator('.station-modal .signal-lamp--lit').nth(i);
  for (const [i, token] of sequence.entries()) {
    await presser.page.locator(`${keys}[data-token="${token}"]`).click({ timeout: 3000 });
    const last = i === sequence.length - 1;
    const counted = await until(
      () => (last ? through() : presser.seen.view.puzzle?.done === i + 1),
      3000,
    );
    if (!counted) {
      const now = presser.seen.view.puzzle;
      throw new Error(
        `${presser.name} pressed "${token}", sign ${i + 1} of ${sequence.length} in stage ` +
          `${stage}, but it did not count (done ${now?.done}, last result ${now?.lastResult})`,
      );
    }
    // The last press clears the lamps: the next stage starts dark.
    if (!last) {
      const panels = [sender, presser];
      const lit = await Promise.all(panels.map(({ page }) => attached(lamp(page, i), 2000)));
      const dark = panels.filter((_, k) => !lit[k]).map(({ name }) => name);
      if (dark.length > 0) {
        throw new Error(`sign ${i + 1} counted, but its lamp is dark for ${dark.join(' and ')}`);
      }
    }
    await sleep(150);
  }
  return sequence.length;
}

/**
 * console-a.png, console-b.png: a station with two consoles, whatever its
 * kind — the one after a solved sync station, or a first one the crew got
 * into (`manBothConsoles`). The operator walks to console A, the reader to
 * console B, and E opens each; both panels are captured at laptop size, the
 * guest's window going back to its phone size after, and the log names the
 * panel's kind. A Signalkette the crew then works until it solves
 * (`solveSignal`); at a fuse box the meter measures every wire once
 * (`measureEveryWire`); any other kind is left open. Throws with the step
 * that failed.
 */
async function captureConsoles(operator, reader) {
  const armed = operator.seen.view.map.stations.filter((s) => s.status === 'armed');
  const consoleA = armed.find((s) => s.console === 'a');
  const consoleB = armed.find((s) => s.console === 'b');
  if (consoleA === undefined || consoleB === undefined) {
    console.log(`console-*.png      skipped: "${armed[0]?.title ?? '?'}" has one console`);
    return;
  }
  const title = consoleA.title;
  const crew = [operator, reader];
  const seats = [
    [operator, consoleA],
    [reader, consoleB],
  ];
  for (const [player, spot] of seats) {
    if (!(await walkNear(player.page, player.seen, spot))) {
      throw new Error(
        `${player.name} found no way to console ${spot.console} of "${title}" ` +
          `at ${spot.x},${spot.y}`,
      );
    }
  }
  for (const [player, spot] of seats) {
    if (!(await interactUntil(player.page, player.page.locator('.station-modal')))) {
      throw new Error(
        `${player.name} stands at console ${spot.console} of "${title}", ` +
          'but no .station-modal after 3 tries',
      );
    }
  }
  const kindOf = (player) => player.seen.view.puzzle?.kind ?? null;
  await until(() => crew.every((p) => kindOf(p) !== null), 3000);
  const kind = kindOf(operator);
  if (kind === null || kindOf(reader) !== kind) {
    const panels = crew.map((p) => `${p.name} ${kindOf(p)}`).join(', ');
    throw new Error(`both stand at "${title}", but not at one open panel: ${panels}`);
  }

  const sizes = crew.map(({ page }) => page.viewportSize());
  await Promise.all(crew.map(({ page }) => page.setViewportSize(SIZES[0])));
  await sleep(500); // the layout settles, the panel past its fade-in
  for (const [player, spot] of seats) {
    await player.page.screenshot({ path: join(OUT, `console-${spot.console}.png`) });
    const over = await sideways(player.page, '.station-modal .panel');
    console.log(
      `console-${spot.console}.png      ${player.name} at ${seatOf(player)}: "${title}", ` +
        `${kind} panel, ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
    );
  }
  for (const [i, { page }] of crew.entries()) {
    if (sizes[i] !== null) {
      await page.setViewportSize(sizes[i]);
    }
  }
  if (kind === 'signal') {
    await solveSignal(crew, title);
  } else if (kind === 'circuit') {
    await measureEveryWire(reader, title);
  } else {
    console.log(`consoles           "${title}" is a ${kind} panel: captured, left open`);
  }
}

/**
 * At a fuse box's meter: every probe key pressed once, its wire's reading
 * in the meter's view before the next key. Nothing is cut. Throws at the
 * key whose reading stays empty.
 */
async function measureEveryWire(meter, title) {
  const count = meter.seen.view.puzzle?.count ?? 0;
  const keys = await meter.page.locator('.station-modal .circuit-probe[data-index]').count();
  if (count === 0 || keys !== count) {
    throw new Error(`"${title}": the meter shows ${keys} probe keys for ${count} wires`);
  }
  for (let i = 0; i < count; i++) {
    const key = meter.page.locator(`.station-modal .circuit-probe[data-index="${i}"]`);
    await key.click({ timeout: 3000 });
    if (!(await until(() => meter.seen.view.puzzle?.readings?.[i] != null, 3000))) {
      throw new Error(
        `${meter.name} measured wire ${i + 1} of "${title}", but its reading stayed empty`,
      );
    }
    await sleep(150);
  }
  const readings = meter.seen.view.puzzle?.readings ?? [];
  const volts = readings.map((reading) => `${reading} V`).join(', ');
  console.log(
    `circuit            ${meter.name} at ${seatOf(meter)} measured all ${count} wires: ` +
      `${volts}; nothing cut`,
  );
}

/** Steps onto a plate's tile and stays there; throws unless the view counts the plate held. */
async function holdPlate(player, plate) {
  const held = () => player.seen.view.map.plates.some((p) => p.id === plate.id && p.pressed);
  const onIt =
    (await walkNear(player.page, player.seen, plate)) &&
    (await stepTo(player.page, player.seen, plate.x + 0.5, plate.y + 0.5));
  if (!onIt || !(await until(held, 3000))) {
    throw new Error(`${player.name} could not get onto the plate at ${plate.x},${plate.y}`);
  }
}

/**
 * How `box` gets to console A: on their own, or through the plate door that
 * `meter` holds — the nearest plate `meter` reaches. Null when neither works.
 */
function entryPlan([box, meter], consoleA, plates) {
  if (stepsTo(box.seen, consoleA) !== Infinity) {
    return { box, meter, plate: null };
  }
  const steps = (plate) => stepsTo(meter.seen, plate);
  const [nearest] = plates
    .filter((plate) => steps(plate) !== Infinity)
    .sort((one, other) => steps(one) - steps(other));
  return nearest === undefined ? null : { box, meter, plate: nearest };
}

/**
 * A first station worked at two consoles, as Blackout's Notstrom-Kasten,
 * whose console A may lie behind a plate door. Whoever reaches console A on
 * their own works it, the host before the guest; otherwise the host does,
 * and the guest holds the nearest plate in reach until the host is through.
 * The plate holder then walks on to console B, and both consoles are
 * captured (`captureConsoles`). Returns who stands at A and who at B; null,
 * with a log line, when the draw lets nobody through.
 */
async function manBothConsoles(players) {
  const map = players[0].seen.view.map;
  const consoleA = map.stations.find((s) => s.status === 'armed' && s.console === 'a');
  if (consoleA === undefined) {
    throw new Error('the armed station has no console A');
  }
  // Camera plates hold drones still, not doors.
  const plates = map.plates.filter((plate) => !plate.freezesDrone);
  const plan = [players, [...players].reverse()]
    .map((pair) => entryPlan(pair, consoleA, plates))
    .find((option) => option !== null);
  if (plan === undefined) {
    console.log(
      `console-*.png      skipped: nobody reaches console A of "${consoleA.title}", ` +
        'and nobody else a plate to hold the way open',
    );
    return null;
  }
  const { box, meter, plate } = plan;
  if (plate !== null) {
    await holdPlate(meter, plate);
    const open = await until(() => stepsTo(box.seen, consoleA) !== Infinity, 3000);
    if (!open || !(await walkNear(box.page, box.seen, consoleA))) {
      throw new Error(
        `${meter.name} holds the plate at ${plate.x},${plate.y}, but ${box.name} found no ` +
          `way through to console A of "${consoleA.title}"`,
      );
    }
    console.log(
      `plate              ${meter.name} holds "${plate.label}" at ${plate.x},${plate.y}, ` +
        `${box.name} walked through to console A`,
    );
  }
  await captureConsoles(box, meter);
  return { box, meter };
}

/**
 * A Signalkette with both consoles open: the receiving side clicks what the
 * sending side's view shows, and the direction swaps after each stage, until
 * it solves. Throws with the step that failed.
 */
async function solveSignal(crew, title) {
  const roleOf = (player) => player.seen.view.puzzle?.role ?? null;
  const roles = () => crew.map((p) => `${p.name} ${roleOf(p)}`).join(', ');
  await until(() => crew.every((p) => roleOf(p) !== null), 3000);
  const sender = crew.find((p) => roleOf(p) === 'sender');
  const receiver = crew.find((p) => roleOf(p) === 'receiver');
  if (sender === undefined || receiver === undefined) {
    throw new Error(`both stand at "${title}", but the Signalkette has no roles: ${roles()}`);
  }
  const signs = await sender.page.locator('.station-modal .signal-strip .signal-sign').count();
  const keys = await receiver.page.locator('.station-modal .signal-key[data-token]').count();
  console.log(
    `signal             ${sender.name} at ${seatOf(sender)} sends ${signs} signs, ` +
      `${receiver.name} at ${seatOf(receiver)} has ${keys} keys`,
  );
  const { length, stages } = sender.seen.view.puzzle;
  if (signs !== length || keys !== 12) {
    throw new Error(
      `"${title}": the sending panel shows ${signs} of ${length} signs, ` +
        `the receiving one ${keys} of 12 keys`,
    );
  }

  const index = sender.seen.view.currentPuzzleIndex;
  const solved = () => crew.every((p) => p.seen.view.currentPuzzleIndex > index);
  let [sending, pressing] = [sender, receiver];
  for (let stage = 1; stage <= stages; stage++) {
    const count = await pressStage(sending, pressing);
    const line =
      `signal             ${sending.name} sends, ${pressing.name} presses: ` +
      `${count}/${count}, stage ${stage} of ${stages}`;
    if (stage === stages) {
      if (!(await until(solved, 5000))) {
        throw new Error(`the last stage of "${title}" is in, but the station did not solve`);
      }
      console.log(`${line}: "${title}" solved`);
      return;
    }
    // The former receiver sends now: its view has the sequence.
    const swapped = await until(
      () =>
        roleOf(pressing) === 'sender' &&
        pressing.seen.view.puzzle?.sequence != null &&
        roleOf(sending) === 'receiver',
      3000,
    );
    if (!swapped) {
      throw new Error(`stage ${stage} of "${title}" is in, but the roles did not swap: ${roles()}`);
    }
    console.log(`${line} through, roles swapped`);
    [sending, pressing] = [pressing, sending];
  }
}

/**
 * The world canvas's size in CSS pixels — the zoom follows its height — with
 * what shares the column with it: the HUD's height and the banners up.
 */
async function layoutOf(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.world-canvas');
    const hud = document.querySelector('.hud');
    return {
      size: canvas === null ? 'no canvas' : `${canvas.clientWidth}x${canvas.clientHeight}`,
      hud: hud === null ? 0 : hud.offsetHeight,
      banners: ['.alarm', '.sabotage', '.banner.error'].filter(
        (selector) => document.querySelector(selector) !== null,
      ),
    };
  });
}

/** Whether two boxes overlap; a missing box overlaps nothing. */
function overlapping(a, b) {
  return (
    a !== null &&
    b !== null &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * notepad.png: the guest opens the notepad from the HUD, writes a line and
 * takes the Laborkennung over. The pad is kept per room, so a reload has to
 * bring the text back.
 */
async function captureNotepad(page, seen) {
  const pad = page.locator('.notepad');
  await page.locator('.hud-notes').click();
  await pad.waitFor({ state: 'visible', timeout: 3000 });
  await pad.locator('textarea').fill('Spalte 4: Ω ☆ ¶ Ѭ');
  const take = pad.locator('.notepad-take');
  const offered = !(await take.isDisabled());
  if (offered) {
    await take.click();
  }
  await sleep(300);
  await page.screenshot({ path: join(OUT, 'notepad.png') });
  const written = await pad.locator('textarea').inputValue();
  const dpad = await page.locator('.world-dpad').boundingBox();
  const blocks = overlapping(await pad.boundingBox(), dpad);
  // The pad offers the Laborkennung only to a player who has read the sign.
  const kennung = offered
    ? 'Laborkennung taken over'
    : seen.view.edgework === null
      ? 'no Laborkennung read yet, none to take over'
      : '!! Laborkennung read but not offered';
  console.log(
    `notepad.png        guest: ${kennung}, ` +
      `${blocks ? '!! covers the steering pad' : 'clear of the steering pad'}`,
  );

  await page.reload();
  await page.locator('.stage').waitFor({ timeout: 10_000 });
  await page.locator('.overlay.pause').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.locator('.hud-notes').click();
  await pad.waitFor({ state: 'visible', timeout: 3000 });
  const kept = (await pad.locator('textarea').inputValue()) === written;
  console.log(
    `notepad            guest: ${kept ? 'text kept over a reload' : '!! text lost on reload'}`,
  );
  await pad.locator('.notepad-close').click();
  await pad.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * An emergency closes whatever a player has open, and nothing reopens by
 * itself. The walkthrough works no console and mans no valve, so it waits
 * the emergency out and presses E again. Returns how long that took, in ms;
 * throws when `overlay` closed with no emergency on or stays shut after it.
 */
async function reopenAfterEmergency(page, seen, overlay, who) {
  const sabotage = seen.view.map.sabotage;
  if (sabotage === null) {
    throw new Error(`${who}: the book closed while waiting for a note, with no emergency on`);
  }
  const from = Date.now();
  const onTop =
    sabotage.relay === undefined
      ? 'valves'
      : (await page.locator('.relay-modal').isVisible())
        ? 'relay console up'
        : '!! no relay console';
  const over = await until(
    () => seen.view.map.sabotage === null,
    Math.max(0, sabotage.endsAt - Date.now()) + 10_000,
  );
  if (!over || !(await interactUntil(page, overlay))) {
    throw new Error(`${who}: "${sabotage.label}" closed the book, and it did not open again after`);
  }
  console.log(
    `emergency          ${who}: "${sabotage.label}" closed the book (${onTop}), ` +
      'E opened it again after it',
  );
  return Date.now() - from;
}

/**
 * hint-*.png: at a source covering the open station, a player asks the last
 * crew for a note in the book's margin — while it is still held back, once it
 * may be asked for, and with the note written in; the other player hears it
 * on the radio meanwhile. False when no such source is in this player's reach.
 */
async function captureNotes(page, seen, who, other) {
  const armed = seen.view.map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const source = nearestManual(seen);
  const covers = source !== null && source.puzzleIds.includes(armed);
  if (!covers || !(await walkNear(page, seen, source))) {
    return false;
  }
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(page, overlay))) {
    throw new Error(`${who} stands at "${source.id}", but no .reading-modal opened after 3 tries`);
  }
  const ask = overlay.locator('.note-ask');
  await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if ((await ask.count()) === 0) {
    throw new Error(`${who} reads "${source.id}", but no .note-ask beside the open station`);
  }
  await page.screenshot({ path: join(OUT, 'hint-waiting.png') });
  let label = (await ask.innerText()).trim();
  console.log(`hint-waiting.png   ${who}: "${label}"`);

  // The last crew's notes are held back for 45 s after a station opens.
  let readyBy = Date.now() + 60_000;
  while (!label.startsWith('Notiz der letzten Crew') && Date.now() < readyBy) {
    await sleep(1000);
    if (!(await overlay.isVisible())) {
      readyBy += await reopenAfterEmergency(page, seen, overlay, who);
    }
    label = (await ask.innerText()).trim();
  }
  if (!label.startsWith('Notiz der letzten Crew')) {
    throw new Error(`the ask button still reads "${label}" after 60 s`);
  }
  await page.screenshot({ path: join(OUT, 'hint-ready.png') });
  console.log(`hint-ready.png     ${who}: "${label}"`);

  await ask.click();
  await overlay.locator('.margin-note').first().waitFor({ timeout: 5000 });
  await sleep(600);
  await page.screenshot({ path: join(OUT, 'hint-revealed.png') });
  const notes = await overlay.locator('.margin-note').count();
  const next = (await textOf(ask)) ?? 'none';
  console.log(`hint-revealed.png  ${who}: ${notes} note(s) in the margin, next button "${next}"`);
  await other.screenshot({ path: join(OUT, 'radio-banner.png') });
  const banner = (await other.locator('.radio-banner').count()) > 0 ? 'up' : '!! missing';
  const panel = (await other.locator('.station-modal').count()) > 0;
  console.log(
    `radio-banner.png   the other player: banner ${banner}, ` +
      (panel ? '!! station panel shown away from the station' : 'no station panel away'),
  );
  return true;
}

/**
 * hint-*.png from the first of two players who reaches a source on the open
 * station, `first` before `second`; a log line when neither does.
 */
async function askForNotes(first, second) {
  if (await captureNotes(first.page, first.seen, first.name, second.page)) {
    return;
  }
  console.log(
    `hint-*.png         ${first.name}: no source on the open station in reach — ` +
      `${second.name} asks`,
  );
  if (!(await captureNotes(second.page, second.seen, second.name, first.page))) {
    console.log('hint-*.png         skipped: no source on the open station in reach of either');
  }
}

/**
 * sign.png: a player has just read the Laborkennung — the note up, the chip
 * in the HUD. The note waits for the briefing to end and for the radio lines
 * queued before it, so this may take a while.
 */
async function captureSign(page, who) {
  const note = await page
    .locator('.toast')
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(400); // past its fade-in
  await page.screenshot({ path: join(OUT, 'sign.png') });
  const chip = (await page.locator('.hud .edgework').count()) > 0;
  console.log(
    `sign.png           ${who}: note ${note ? 'up' : '!! missing'}, ` +
      `chip in the HUD ${chip ? 'shown' : '!! missing'}`,
  );
}

/**
 * locker.png: the guest stands before the nearest locker it can walk to,
 * „Durchsuchen" on offer, then searches it — the find has to reach the HUD
 * line. Lockers lie undiscovered at first, so where they are comes from the
 * audience's view.
 */
async function captureLocker(page, seen, audience) {
  const everything = audience.view?.map ?? seen.view.map;
  const lockers = everything.manuals.filter((m) => m.kind === 'locker' && !m.opened);
  const from = tileOf(seen);
  const options = lockers
    .map((locker) => ({ locker, path: from === null ? null : route(seen.view.map, from, locker) }))
    .filter((option) => option.path !== null)
    .sort((a, b) => a.path.length - b.path.length);
  const locker = options[0]?.locker;
  if (locker === undefined || !(await walkNear(page, seen, locker))) {
    const where = lockers.map((l) => `${l.x},${l.y}`).join(' · ');
    console.log(
      lockers.length === 0
        ? 'locker.png         skipped: no closed locker on this map'
        : `locker.png         skipped: no locker in the guest's reach (${where})`,
    );
    return;
  }
  const here = await until(() => seen.view.sourcesHere.some((s) => s.id === locker.id), 3000);
  await sleep(400); // the prompt is drawn from the next frame on
  await page.screenshot({ path: join(OUT, 'locker.png') });
  await page.keyboard.press('e');
  const searched = await until(
    () => seen.view.map.manuals.some((m) => m.id === locker.id && m.opened),
    3000,
  );
  const hud = page.locator('.hud-radio');
  const line = searched && (await hud.count()) > 0 ? (await hud.innerText()).trim() : '';
  console.log(
    `locker.png         guest: "${locker.label}" at ${locker.x},${locker.y}, ` +
      `${here ? 'counted at it' : '!! not counted at it'}; E: ` +
      (searched ? `searched, HUD line "${line}"` : '!! still shut'),
  );
}

/**
 * lit-room.png: the first room a solved station lit, with the guest walked
 * inside where a way leads there. The walkthrough solves a sync station
 * only, so elsewhere litRooms stays empty and this only says so.
 */
async function captureLitRoom(page, seen) {
  const map = seen.view?.map;
  const room = map?.litRooms[0];
  if (map == null || room === undefined) {
    console.log('lit-room.png       skipped: litRooms is empty — no station solved in this run');
    return;
  }
  await page.keyboard.press('Escape');
  const label = map.labels.find((l) => l.text === room);
  const inside = label !== undefined && (await walkNear(page, seen, label));
  await sleep(1200); // past the lights coming up
  await page.screenshot({ path: join(OUT, 'lit-room.png') });
  console.log(
    `lit-room.png       guest: ${map.litRooms.join(', ')} lit, ` +
      (inside ? `guest inside ${room}` : `!! guest outside ${room}, no way in`),
  );
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- host: create a room and grab the code ---------------------------
  const hostCtx = await browser.newContext({ viewport: SIZES[0] });
  const host = await hostCtx.newPage();
  const hostSeen = eavesdrop(host);
  host.on('console', (m) => {
    if (m.type() === 'error') console.log('[host console]', m.text());
  });
  host.on('pageerror', (e) => console.log('[host error]', e.message));
  await host.goto(BASE);
  await host.getByPlaceholder('z. B. Anna').fill('Anna');
  await host.locator('.mission').first().waitFor({ timeout: 10_000 });
  // The join screen, every mission in view, has to fit a laptop window too.
  await host.screenshot({ path: join(OUT, 'join.png') });
  await overflow(host, 'join @ 1440x820');
  await host.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(host, 'join @ 1280x720');
  await host.screenshot({ path: join(OUT, 'join-1280.png') });
  await host.setViewportSize(SIZES[0]);
  await sleep(300);
  const card = host.locator('.mission', { hasText: MISSION }).first();
  if ((await card.count()) === 0) {
    throw new Error(`no mission card reads "${MISSION}" — SHOTS_MISSION has to name one`);
  }
  await card.click();
  await clickText(host, 'Runde eröffnen');
  await host.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.locator('.room-code strong').innerText()).trim();
  console.log('room code:', code, `(${MISSION})`);
  await host.screenshot({ path: join(OUT, 'lobby-host.png') });

  // --- guest: join by code ---------------------------------------------
  // Touch-capable on purpose: the on-screen D-pad is hidden for `pointer:
  // fine`, so a default context would never show it.
  const guestCtx = await browser.newContext({ viewport: SIZES[2], hasTouch: true });
  const guest = await guestCtx.newPage();
  const guestSeen = eavesdrop(guest);
  await guest.goto(BASE);
  await guest.getByPlaceholder('z. B. Anna').fill('Ben');
  // On a phone the join screen stacks and scrolls; this shows its top.
  await guest.locator('.mission').first().waitFor({ timeout: 10_000 });
  await guest.screenshot({ path: join(OUT, 'join-phone.png') });
  await guest.getByLabel('Raumcode').fill(code);
  await clickText(guest, 'Beitreten');
  await guest.locator('.lobby').waitFor({ timeout: 10_000 });

  // crew, ready, start — nothing to pick: the start draws who begins where
  await host.locator('.seat .seat-name', { hasText: /^Ben$/ }).waitFor({ timeout: 10_000 });
  await sleep(300);
  await host.screenshot({ path: join(OUT, 'lobby-filled.png') });
  await guest.screenshot({ path: join(OUT, 'lobby-phone.png') });
  // A phone scrolls the lobby down and the crew's row sideways, but nothing
  // else may run out past the window's edge.
  const phoneOver = await sideways(guest, '.content');
  console.log(
    `lobby-phone.png    Ben's lobby @ 420x760 ` +
      (phoneOver > 0 ? `!! +${phoneOver}px sideways` : 'fits sideways'),
  );
  await overflow(host, 'lobby @ 1440x820');
  await host.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(host, 'lobby @ 1280x720');
  await host.screenshot({ path: join(OUT, 'lobby-1280.png') });
  await host.setViewportSize(SIZES[0]);
  await sleep(300);
  await clickText(guest, 'Ich bin bereit');
  await sleep(300);
  await clickText(host, 'Mission starten');
  await host.locator('.stage').waitFor({ timeout: 10_000 });
  await guest.locator('.stage').waitFor({ timeout: 10_000 });
  await sleep(500); // presence follows the start within a tick
  if (guestSeen.view?.map == null || hostSeen.view?.map == null) {
    throw new Error('no running view on the sockets — does the client still talk on /ws?');
  }
  const anna = { name: 'Anna', page: host, seen: hostSeen };
  const ben = { name: 'Ben', page: guest, seen: guestSeen };
  const [operator, reader] = operatorFirst([anna, ben]);
  console.log(`the draw:          ${operator.name} works the first station, ${reader.name} reads`);

  // Spawned within sight of the Laborkennung, a player gets the note as soon
  // as the briefing is gone: that is the moment for sign.png.
  const atSign = [reader, operator].find((p) => p.seen.view.presence.signSeen);
  if (atSign !== undefined) {
    await captureSign(atSign.page, atSign.name);
  }
  // Let the briefing countdown finish; server and browsers share this clock.
  await sleep(Math.max(0, guestSeen.view.startedAt + 4200 - Date.now()));
  // The world's zoom follows the canvas height: nothing the run brings up in
  // the HUD — the sign's chip, a long radio line, the notes — may change it.
  const steady = [
    { name: 'Anna', page: host, start: await layoutOf(host) },
    { name: 'Ben', page: guest, start: await layoutOf(guest) },
  ];

  for (const size of SIZES) {
    await host.setViewportSize({ width: size.width, height: size.height });
    await sleep(700);
    await host.screenshot({ path: join(OUT, `game-${size.name}.png`) });
    await overflow(host, `game @ ${size.width}x${size.height}`);
  }
  // The guest's window is phone-sized and touch-capable all along.
  await guest.screenshot({ path: join(OUT, 'game-phone-touch.png') });

  // info panel and spectator view at laptop size
  await host.setViewportSize(SIZES[0]);
  await sleep(400);
  await host.keyboard.press('i');
  await sleep(400);
  await host.screenshot({ path: join(OUT, 'info-panel.png') });
  await host.keyboard.press('Escape');

  const watcherCtx = await browser.newContext({ viewport: SIZES[0] });
  const watcher = await watcherCtx.newPage();
  const watcherSeen = eavesdrop(watcher);
  await watcher.goto(BASE);
  await watcher.getByLabel('Raumcode').fill(code);
  await clickText(watcher, 'Mit Code zuschauen');
  await watcher.locator('.spectate').waitFor({ timeout: 10_000 });
  await sleep(1200);
  await watcher.screenshot({ path: join(OUT, 'spectate.png') });
  await overflow(watcher, 'spectate @ 1440x820');

  await captureLocker(guest, guestSeen, watcherSeen);

  // --- reading, the sign, notes: the guest reads, opens the first station, asks for a note ---
  // The host's info panel may still be open; close it the way a player would.
  const closeInfo = host.locator('.info-card button', { hasText: 'Schließen' });
  if (await closeInfo.isVisible()) {
    await closeInfo.click();
  }
  // Whatever lies within the reader's reach is read; locked away from it, the
  // operator reads instead.
  if (!(await captureReading(reader.page, reader.seen, reader.name))) {
    console.log(
      `reading.png        ${reader.name}: no manual object in reach — ` +
        `${operator.name} reads instead`,
    );
    if (!(await captureReading(operator.page, operator.seen, operator.name))) {
      console.log('reading.png        skipped: no manual object in reach of either player');
    }
  }

  const sign = reader.seen.view.map.edgeworkSign;
  if (atSign === undefined) {
    if (sign === null) {
      console.log('sign.png           skipped: this map has no Laborkennung');
    } else if (await walkNear(reader.page, reader.seen, sign)) {
      await captureSign(reader.page, reader.name);
    } else {
      console.log(`sign.png           skipped: the sign at ${sign.x},${sign.y} is out of reach`);
    }
  }
  await captureNotepad(guest, guestSeen);

  const firstSpots = operator.seen.view.map.stations.filter((s) => s.status === 'armed');
  // The draw may leave both starts shut off from the first station until a
  // plate is held; then there is no station to capture this time — unless it
  // is worked at two consoles, where one holds the plate for the other.
  const station = firstSpots[0];
  if (firstSpots.some((s) => s.console === 'b')) {
    const pair = await manBothConsoles([anna, ben]);
    if (pair !== null) {
      // The last crew's notes come only for an open station: leave it open, go read.
      for (const { page } of [pair.box, pair.meter]) {
        await page.keyboard.press('Escape');
        await page.locator('.station-modal').waitFor({ state: 'hidden', timeout: 3000 });
      }
      await askForNotes(pair.meter, pair.box);
    }
  } else if (station === undefined || stepsTo(operator.seen, station) === Infinity) {
    console.log('station            skipped: no open way from either start to the armed station');
  } else {
    if (!(await walkNear(operator.page, operator.seen, station))) {
      throw new Error(`${operator.name} got stuck on the way to "${station.puzzleId}"`);
    }
    const modal = operator.page.locator('.station-modal');
    if (!(await interactUntil(operator.page, modal))) {
      throw new Error(
        `${operator.name} stands at "${station.puzzleId}", but no .station-modal after 3 tries`,
      );
    }
    await sleep(300); // past its fade-in
    const stationSideways = await sideways(operator.page, '.station-modal .panel');
    await operator.page.screenshot({ path: join(OUT, 'station.png') });
    console.log(
      `station.png        ${operator.name}: "${station.title}", panel ` +
        (stationSideways > 0 ? `!! +${stationSideways}px sideways` : 'fits sideways'),
    );
    // A sync station needs the whole crew's press: the walkthrough solves it.
    const sync = operator.seen.view.puzzle?.kind === 'button-sync';
    await captureBothAtStation(reader, operator, station, sync);
    // The last crew's notes come only for an open station: leave it open, go read.
    await operator.page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3000 });
    if (sync) {
      console.log('hint-*.png         skipped: the station is solved, the next waits for its E');
      // Where the next station has two consoles, the crew captures both; a Signalkette it works.
      await captureConsoles(operator, reader);
    } else {
      await askForNotes(reader, operator);
    }
  }
  await captureLitRoom(guest, guestSeen);

  for (const { name, page, start } of steady) {
    const end = await layoutOf(page);
    const banners = end.banners.length === 0 ? '' : `, ${end.banners.join(' ')} up`;
    console.log(
      `canvas             ${name}: ${start.size} after the briefing, ${end.size} at the end` +
        (end.size === start.size
          ? ', the world zoom held'
          : ` — !! the world zoom moved (HUD ${start.hud} → ${end.hud}px${banners})`),
    );
  }

  await browser.close();
  console.log('screenshots in', OUT);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
