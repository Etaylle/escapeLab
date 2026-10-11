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

/** Click a button whose visible text contains `text`. */
async function clickText(page, text) {
  const button = page.locator('button', { hasText: text }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
}

/** Hold a key long enough for the world's render loop to walk on it. */
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- host: create a room and grab the code ---------------------------
  const hostCtx = await browser.newContext({ viewport: SIZES[0] });
  const host = await hostCtx.newPage();
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
  await sleep(4200); // let the briefing countdown finish

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
  await watcher.goto(BASE);
  await watcher.getByLabel('Raumcode').fill(code);
  await clickText(watcher, 'Mit Code zuschauen');
  await watcher.locator('.spectate').waitFor({ timeout: 10_000 });
  await sleep(1200);
  await watcher.screenshot({ path: join(OUT, 'spectate.png') });
  await overflow(watcher, 'spectate @ 1440x820');

  // --- hints: the guest walks to the first station and asks for help ----
  // The host's info panel may still be open; close it the way a player would.
  const closeInfo = host.locator('.info-card button', { hasText: 'Schließen' });
  if (await closeInfo.isVisible()) {
    await closeInfo.click();
  }
  // The guest spawns at (3,10) between two pillars, so up first, then left
  // along row 9 to the station at (1,9). Retries nudge the same way: walls
  // stop the avatar inside the station's reach.
  const modal = guest.locator('.puzzle-modal');
  for (let attempt = 0; attempt < 4 && !(await modal.isVisible()); attempt++) {
    await hold(guest, 'w', attempt === 0 ? 400 : 250);
    await hold(guest, 'a', attempt === 0 ? 900 : 500);
    await sleep(250);
    await guest.keyboard.press('e');
    await modal.waitFor({ state: 'visible', timeout: 2500 }).catch(() => undefined);
  }
  if (!(await modal.isVisible())) {
    throw new Error('guest never reached the first station: no .puzzle-modal after 4 tries');
  }

  const strip = guest.locator('.hint-strip');
  const hintButton = guest.locator('.hint-request');
  await strip.scrollIntoViewIfNeeded();
  const sideways = await guest.evaluate(() => {
    const panel = document.querySelector('.puzzle-modal .panel');
    return panel === null ? 0 : panel.scrollWidth - panel.clientWidth;
  });
  await guest.screenshot({ path: join(OUT, 'hint-waiting.png') });
  console.log(
    `hint-waiting.png   guest: "${(await hintButton.innerText()).trim()}", ` +
      `panel ${sideways > 0 ? `!! +${sideways}px sideways` : 'fits sideways'}`,
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
  const hostHints = await host.locator('.hint-list li').count();
  console.log(
    `radio-banner.png   host: banner ${hostBanner} (under the open station), ` +
      `${hostHints} hint(s) in its strip`,
  );

  await browser.close();
  console.log('screenshots in', OUT);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
