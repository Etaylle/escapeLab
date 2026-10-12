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

/** The manual object a player can walk to soonest, one covering the armed station first. */
function nearestManual(seen) {
  const map = seen.view.map;
  const from = tileOf(seen);
  const armed = map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const options = map.manuals
    .map((manual) => ({ manual, path: from === null ? null : route(map, from, manual) }))
    .filter((option) => option.path !== null)
    .sort(
      (a, b) =>
        Number(b.manual.puzzleIds.includes(armed)) - Number(a.manual.puzzleIds.includes(armed)) ||
        a.path.length - b.path.length,
    );
  return options[0]?.manual ?? null;
}

/**
 * reading.png: a player walks to a manual object, presses E and reads. False
 * when no manual object is in reach for this player.
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
  await sleep(300);
  await page.screenshot({ path: join(OUT, 'reading.png') });
  const sections = await overlay.locator('.reading-section').count();
  const over = await sideways(page, '.reading-modal .panel');
  console.log(
    `reading.png        ${who}: "${manual.label}" (${manual.kind}), ${sections} section(s), ` +
      `panel ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
  );
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  return true;
}

/**
 * sign.png: the guest has just read the Laborkennung — the note up, the chip
 * in the HUD. The note waits for the briefing to end, so this may take a while.
 */
async function captureSign(page) {
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
    `sign.png           guest: note ${note ? 'up' : '!! missing'}, ` +
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
  await guest.locator('.roles').waitFor({ timeout: 10_000 });

  // roles, ready, start
  await host.locator('.role', { hasText: 'Anleitung' }).first().click();
  await guest.locator('.role', { hasText: 'Steuerpult' }).first().click();
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
  if (guestSeen.view?.map == null) {
    throw new Error('no running view on the guest socket — does the client still talk on /ws?');
  }

  // Spawned within sight of the Laborkennung, the guest gets the note as soon
  // as the briefing is gone: that is the moment for sign.png.
  const signAtSpawn = guestSeen.view.presence.signSeen;
  if (signAtSpawn) {
    await captureSign(guest);
  }
  // Let the briefing countdown finish; server and browsers share this clock.
  await sleep(Math.max(0, guestSeen.view.startedAt + 4200 - Date.now()));

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

  // --- reading, the sign, hints: the guest reads, then works the first station ---
  // The host's info panel may still be open; close it the way a player would.
  const closeInfo = host.locator('.info-card button', { hasText: 'Schließen' });
  if (await closeInfo.isVisible()) {
    await closeInfo.click();
  }
  // Whatever lies within the guest's reach is read; locked away from it, the
  // host reads instead.
  if (!(await captureReading(guest, guestSeen, 'guest'))) {
    console.log('reading.png        guest: no manual object in reach — the host reads instead');
    if (!(await captureReading(host, hostSeen, 'host'))) {
      console.log('reading.png        skipped: no manual object in reach of either player');
    }
  }

  const sign = guestSeen.view.map.edgeworkSign;
  if (!signAtSpawn) {
    if (sign === null) {
      console.log('sign.png           skipped: this map has no Laborkennung');
    } else if (await walkNear(guest, guestSeen, sign)) {
      await captureSign(guest);
    } else {
      console.log(`sign.png           skipped: the sign at ${sign.x},${sign.y} is out of reach`);
    }
  }

  const station = guestSeen.view.map.stations.find((s) => s.status === 'armed');
  if (station === undefined || !(await walkNear(guest, guestSeen, station))) {
    throw new Error(`guest cannot walk to the armed station "${station?.puzzleId ?? '(none)'}"`);
  }
  const modal = guest.locator('.station-modal');
  if (!(await interactUntil(guest, modal))) {
    throw new Error(`guest stands at "${station.puzzleId}", but no .station-modal after 3 tries`);
  }
  await sleep(300); // past its fade-in

  const strip = guest.locator('.hint-strip');
  const hintButton = guest.locator('.hint-request');
  await strip.scrollIntoViewIfNeeded();
  const stationSideways = await sideways(guest, '.station-modal .panel');
  await guest.screenshot({ path: join(OUT, 'hint-waiting.png') });
  console.log(
    `hint-waiting.png   guest: "${(await hintButton.innerText()).trim()}", ` +
      `panel ${stationSideways > 0 ? `!! +${stationSideways}px sideways` : 'fits sideways'}`,
  );

  // Mission control holds hints back for 45 s after a station opens.
  const readyBy = Date.now() + 55_000;
  let label = (await hintButton.innerText()).trim();
  while (!label.startsWith('Hinweis anfordern') && Date.now() < readyBy) {
    await sleep(1000);
    if (!(await modal.isVisible())) {
      throw new Error('the station closed while waiting for a hint (an emergency drops it)');
    }
    label = (await hintButton.innerText()).trim();
  }
  if (!label.startsWith('Hinweis anfordern')) {
    throw new Error(`hint button still reads "${label}" after 55 s`);
  }
  await strip.scrollIntoViewIfNeeded();
  await guest.screenshot({ path: join(OUT, 'hint-ready.png') });
  console.log(`hint-ready.png     guest: "${label}"`);

  await hintButton.click();
  await guest.locator('.hint-list li').first().waitFor({ timeout: 5000 });
  await sleep(600);
  await strip.scrollIntoViewIfNeeded();
  await guest.screenshot({ path: join(OUT, 'hint-revealed.png') });
  const guestHints = await guest.locator('.hint-list li').count();
  const next = (await hintButton.count()) > 0 ? (await hintButton.innerText()).trim() : 'none';
  console.log(`hint-revealed.png  guest: ${guestHints} hint(s), next button "${next}"`);
  await host.screenshot({ path: join(OUT, 'radio-banner.png') });
  const hostBanner = (await host.locator('.radio-banner').count()) > 0 ? 'up' : '!! missing';
  const hostPanel = (await host.locator('.station-modal').count()) > 0;
  console.log(
    `radio-banner.png   host: banner ${hostBanner}, ` +
      (hostPanel ? '!! station panel shown away from the station' : 'no station panel away'),
  );
  await captureLitRoom(guest, guestSeen);

  await browser.close();
  console.log('screenshots in', OUT);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
