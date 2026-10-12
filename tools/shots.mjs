/**
 * Visual check: drives two real browsers through join → lobby → running
 * mission and captures the result at several window sizes, so layout work
 * can be looked at instead of guessed.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers \
 *     node tools/shots.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? '/tmp/escapelab-shots';

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
 * station-both.png: while the operator keeps the station open, the reader
 * walks up as well and presses E — the panel has to show for both of them.
 * Then the reader leaves it and walks back to where it stood.
 */
async function captureBothAtStation(reader, operator, station) {
  const back = tileOf(reader.seen);
  if (!(await walkNear(reader.page, reader.seen, station))) {
    console.log(`station-both.png   skipped: ${reader.name} has no way to "${station.puzzleId}"`);
    return;
  }
  const readerSees = await interactUntil(reader.page, reader.page.locator('.station-modal'));
  const operatorSees = await operator.page.locator('.station-modal').isVisible();
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
  // Whatever E opened instead of the panel locks the avatar too.
  await reader.page.keyboard.press('Escape');
  await sleep(300);
  const returned = back !== null && (await walkNear(reader.page, reader.seen, back));
  console.log(
    `station-both       ${reader.name}: ` +
      (returned ? `back near ${back.x},${back.y}` : '!! could not walk back'),
  );
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
async function captureNotepad(page) {
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
  console.log(
    `notepad.png        guest: ` +
      `${offered ? 'Laborkennung taken over' : '!! Laborkennung not offered'}, ` +
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
  const readyBy = Date.now() + 60_000;
  while (!label.startsWith('Notiz der letzten Crew') && Date.now() < readyBy) {
    await sleep(1000);
    if (!(await overlay.isVisible())) {
      throw new Error('the book closed while waiting for a note');
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
 * sign.png: a player has just read the Laborkennung — the note up, the chip
 * in the HUD. The note waits for the briefing to end, so this may take a while.
 */
async function captureSign(page, who) {
  const note = await page
    .locator('.toast')
    .waitFor({ state: 'visible', timeout: 6000 })
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
 * inside where a way leads there. This walkthrough solves no station itself,
 * so while litRooms is empty it only says so.
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
  await host.locator('.mission', { hasText: 'Blackout' }).first().click();
  await clickText(host, 'Runde eröffnen');
  await host.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.locator('.room-code strong').innerText()).trim();
  console.log('room code:', code);
  await host.screenshot({ path: join(OUT, 'lobby-host.png') });

  // --- guest: join by code ---------------------------------------------
  // Touch-capable on purpose: the on-screen D-pad is hidden for `pointer:
  // fine`, so a default context would never show it.
  const guestCtx = await browser.newContext({ viewport: SIZES[2], hasTouch: true });
  const guest = await guestCtx.newPage();
  const guestSeen = eavesdrop(guest);
  await guest.goto(BASE);
  await guest.getByPlaceholder('z. B. Anna').fill('Ben');
  await guest.getByLabel('Raumcode').fill(code);
  await clickText(guest, 'Beitreten');
  await guest.locator('.lobby').waitFor({ timeout: 10_000 });

  // crew, ready, start — nothing to pick: the start draws who begins where
  await host.locator('.seat .seat-name', { hasText: /^Ben$/ }).waitFor({ timeout: 10_000 });
  await sleep(300);
  await host.screenshot({ path: join(OUT, 'lobby-filled.png') });
  await guest.screenshot({ path: join(OUT, 'lobby-phone.png') });
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
  const [operator, reader] = operatorFirst([
    { name: 'Anna', page: host, seen: hostSeen },
    { name: 'Ben', page: guest, seen: guestSeen },
  ]);
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
  await captureNotepad(guest);

  // The draw may leave both starts shut off from the first station until a
  // plate is held; then there is no station to capture this time.
  const station = operator.seen.view.map.stations.find((s) => s.status === 'armed');
  if (station === undefined || stepsTo(operator.seen, station) === Infinity) {
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
    await captureBothAtStation(reader, operator, station);
    // The last crew's notes come only for an open station: leave it open, go read.
    await operator.page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3000 });
    if (!(await captureNotes(reader.page, reader.seen, reader.name, operator.page))) {
      console.log(`hint-*.png         ${reader.name}: no source on the open station in reach — ${operator.name} asks`);
      if (!(await captureNotes(operator.page, operator.seen, operator.name, reader.page))) {
        console.log('hint-*.png         skipped: no source on the open station in reach of either');
      }
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
