/**
 * Visual check: drives two real browsers through join → lobby → running
 * mission and captures the result at several window sizes, so layout work
 * can be looked at instead of guessed.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers \
 *     [SHOTS_MISSION=Systemcheck] [SHOTS_FRAME_P95_MS=40] [SHOTS_CPU_SLOWDOWN=4] \
 *     [SHOTS_SOFTWARE_GL=1] [SHOTS_WEBGL=1] [SHOTS_HEADED=1] [SHOTS_AUDIO_OFF=beds,music] \
 *     node tools/shots.mjs [baseUrl] [outDir]
 *
 * SHOTS_MISSION names the mission card to start (default Blackout); the
 * crew is two players. Where the first station is a sync station, both
 * press it together, and the run fails unless it solves; right after the
 * presses device-solved.png catches the solved device, its status strip
 * sweeping green, before it closes itself — the run fails where any sync
 * station never shows solved, is gone before it is looked at, lies under an
 * overlay, or does not close itself. A shot that lands only after the device
 * closed itself — the machine under load — fails nothing: the next sync
 * station of the run is shot instead, and where that one is late too, or
 * none follows, device-solved.png is skipped with the times measured.
 * Where the station after it has two consoles, each takes one and
 * both panels are captured; a Signalkette, as in the Systemcheck, they work
 * from both sides until it solves too.
 * Where the first station has two consoles, as Blackout's Notstrom-Kasten,
 * the guest holds the plate door for the host on the way to console A where
 * needed, then both consoles are captured and the meter measures every wire
 * once; nothing is cut. The first reading that moves the needle is shot
 * within 250 ms of its probe, the needle still swinging (meter-swing.png),
 * or the run fails.
 *
 * Cold open: a mission with an intro, as Blackout, opens with the power on.
 * While NORMALBETRIEB shows, the host's window grows to 1440×1000, the host
 * steps into its room and the guest walks three tiles towards it — the
 * host's frames meanwhile are the sample of the lit scene — and
 * cold-open.png catches the host's room lit whole and warm: the run fails
 * unless the floor of the host's own room comes out bright on the canvas and
 * the Serverraum's and the Labor's dark, tile by tile through the camera the
 * traced page reports. A player spawned at the Laborkennung gets its note at
 * once (sign.png). Two seconds after the clock starts counting comes
 * blackout.png, the emergency lamps red. Then both go to the first station,
 * a main switch — whoever is locked in let out over a plate first — and E
 * opens its panel for each (lever.png, every lamp lit, DU under the own
 * lever). Where the view gives a press its expiry, the host throws alone:
 * lever-ring.png catches the ring round its grip draining, and the lever has
 * to spring back once the window shuts, the device saying so. Then both
 * throw together, the run fails unless the lights come up, and lit-flur.png
 * shows the room it lit, the panel closed by itself. The log says how long
 * the lever took from the blackout. A mission without an intro skips all of
 * this.
 *
 * On the way, both open the Bestenliste from the join screen (history.png,
 * history-phone.png): measured like the join screen, at 1280×720 too, and on
 * the phone for running out sideways. The host's lobby, with its strip of
 * mission cards, is captured on a phone held sideways as well
 * (lobby-landscape.png). Once the sign is read, the guest's phone is turned
 * sideways and the HUD's Info button has to lie whole inside the window —
 * where the host read the sign, in the host's window at that size too — or
 * the run fails: the Laborkennung's chip may never push it off the screen.
 *
 * The Systemcheck on its pinned seed is played to the end: after the
 * Signalprobe the guest holds the Kontrolle's plate beside the locker — the
 * rules — while the host cuts the wiring box's wire; the seed pins the box,
 * so the walkthrough carries its answer (PINNED_WIRING) and fails, naming the
 * seed, where the box shows other wires. Both press the Synchronkalibrierung
 * together, the hatch opens and the siren sounds: the guest steps onto the
 * hatch, the host's frames are sampled on the way to it, and escape.png
 * shows the red light, the open hatch, the clock amber and the checklist
 * with the guest ticked off. The host steps on, the run is won: pullback.png
 * catches the world lit and the camera pulling back, won.png the title card
 * with the crew outside, end.png the whole end screen, won-phone.png the
 * guest's card on a phone, won-landscape.png on the phone held sideways — in
 * two columns, the facts in the window, the top bar on one line; the
 * audience's page has to show the same card (won-audience.png).
 * The won tutorial leads on to Blackout: next-mission.png shows the end
 * screen's „Weiter: Blackout im Labor" beside „Nochmal", both click it — the
 * guest first, the host's click naming the mission — and the run fails
 * unless Blackout opens on both pages with the power on.
 *
 * The base URL is the Vite dev server by default (`pnpm dev`), or the
 * production server (`pnpm build && pnpm start`, http://localhost:3001) as in
 * CI. The host's page opens with `?trace=1`, so the world keeps its frame
 * durations (animation frame to animation frame, 16.7 ms at 60 Hz). Three
 * times the run resets them and samples two quiet seconds, with no
 * screenshot, resize or click in them: the host pacing inside its tile after
 * the game screenshots, idle at an open station panel, and pacing again after
 * the station step — and in a mission with an intro once more, shorter, in
 * the lit lab before the blackout. Each sample logs p50 and p95; a p95 above
 * SHOTS_FRAME_P95_MS (default 40) fails the run, as does any step that
 * throws. SHOTS_CPU_SLOWDOWN (default 1) slows every page's main thread that
 * many times (Chromium's CPU throttling), so a fast machine measures the
 * frames as a CI runner without a GPU would; SHOTS_SOFTWARE_GL=1 composes the
 * pages on SwiftShader, so that the compositor's share shows too. The first
 * line says what draws the pages. A capture the draw leaves out is logged as
 * `skipped:` with why, and fails nothing. The last line counts the captures
 * taken, skipped and failed; the exit code is 1 when any failed.
 *
 * Light: every world's light takes the WebGL light layer or the Canvas pass
 * (client world/gl/path.ts): a software renderer — headless Chromium's
 * SwiftShader, as on CI — keeps the Canvas pass. Before the frame sample
 * after the game screenshots the host's light probe is read and logged; under
 * SHOTS_SOFTWARE_GL anything but the Canvas pass fails the run. SHOTS_WEBGL=1
 * adds ?gl=1 to every page, which forces the layer on, software renderer or
 * not: the probe then has to report it, or the run fails. At the blackout.png
 * and lit-flur.png moments the host's world is measured both ways — the mean
 * luma of its canvas on the layer and, three frames later, on the Canvas pass,
 * which may lie at most 10 % apart, or the run fails — and light-gl.png and
 * light-gl-flur.png are shot on the layer, right before blackout.png and
 * lit-flur.png, which under SHOTS_WEBGL are shot on the Canvas pass: each pair
 * shows the same moment both ways. On SwiftShader the layer's frames may well
 * pass the budget (raise SHOTS_FRAME_P95_MS to log them without failing);
 * SHOTS_HEADED=1 opens real windows instead, drawn on the machine's GPU, to
 * measure the same frame windows there.
 *
 * Voice: Chromium runs with a fake microphone that needs no prompt (its beeps
 * are the voice), and both players switch theirs on in the lobby. Both pages
 * open with `?trace=1`, so their voice links can be read off
 * `window.__escapelab.voice`. In the run both ends of the link have to reach
 * `connected`, and while the host holds V for two seconds the speaking mark
 * has to show for the host on both pages (voice.png, voice-phone.png). After
 * the guest's reload the link has to come up again. Any of these that fails,
 * fails the run.
 *
 * Sound: the pages' audio probe (`window.__escapelab.audio`, client
 * world/ambience.ts, music.ts, radioVoice.ts, spatial.ts) is read as the run
 * goes. After the blackout — in a mission without an intro, once the briefing
 * is over — the bed of the host's room has to be dead, its powered layer
 * down; once the lever or a sync station has lit the room its player stands
 * in, that bed has to be alive again. The line that comes over the radio with
 * each of those solves has to be spoken by a recording from the manifest the
 * server hands out, saying the banner's line, for a second at least. In the
 * escape the music's pressure has to stand at 0.8 or more, its pressure layer
 * up and the pad gone under the siren. Wherever the partner stands half a tile
 * or more to one side (after the blackout, at the hatch — and after the lever,
 * where the guest walks three to five tiles along the corridor for it and
 * back) the probe's pan has to point there, and that has to be checked once a
 * run at least. Once a run the radio's chain is rendered offline in the page on
 * white noise: above 4 kHz it has to come out at least 10 dB under the band
 * from 300 Hz to 3.4 kHz, and 15 dB further down than the noise was
 * (spectrum.mjs). Any of these that fails, fails the run.
 *
 * What the sound costs: after every frame sample a line `cpu` gives the cores
 * each kind of the browser's processes kept busy meanwhile (CDP SystemInfo)
 * and what the host's audio thread renders (the probe's census: sources
 * playing, nodes wired into the output, beds built); a line `pages` gives each
 * page's renderer CPU, its main thread's task time, Chrome's count of its live
 * audio nodes (wired, or waiting to be collected) and its heap; a line `sound
 * js` the main thread's milliseconds a second each sound system took. With
 * SHOTS_AUDIO_OFF=beds,music,spatial those systems stay off on every page
 * (`?audio-off=`), to tell their cost apart — their sound checks then fail.
 *
 * Editor: before the walkthrough a page of its own opens the editor from the
 * join screen, paints a 7 × 5 room, places a start and a station and
 * captures what the validator says (editor.png, and the layout at
 * 1280×720 and on a phone); a second start and a book make the mission
 * sound, it is saved as custom-probe and has to show on the join screen.
 * Then the editor, opened at /editor, imports tools/fixtures/probe-mission.json
 * („Probe", custom-probe) and starts a test run from it: the lobby has to
 * show the probe (editor-play.png), „Zurück zum Editor" in the top bar has
 * to bring the editor back with the draft, and the link „Teilen" makes —
 * off the clipboard, or out of the box the editor marks it in — has to open
 * the same mission in a page of its own (editor-shared.png). custom-probe is
 * deleted again through the API whatever happened before.
 *
 * Art (a Blackout run only): before the walkthrough, a scratch copy of
 * Blackout — custom-blackout, ten seconds of power before the lights fail,
 * its two starts in the Archiv and the Maschinenraum — is saved through the
 * editor's route and played by two, the audience watching from the lobby on:
 * art-overview.png catches the audience's whole lab lit, room-archive.png and
 * room-machine.png each player in the room it starts in, lit (1440×1000), and
 * art-dark.png the Maschinenraum two seconds into the dark, its standby glows
 * and the flashlight. The copy is deleted again whatever happened. Every walk
 * goes round the map's furniture (map.decor), which nobody walks through.
 *
 * Figures: the crew stands as client world/figure.ts poses it, and four shots
 * at 1440×1000 show it. lobby-idle.png catches a lobby figure turned in a
 * glance round the room, when the figures' probe (`?trace=1`,
 * `window.__escapelab.figures`) says one is. After Blackout's lever the host
 * picks up the fuse lying in the Archiv, is shot holding it before the chest
 * (figure-carry.png) and puts it down again with Q. At the Systemcheck's
 * Signalkette the sending side closes its panel and the pressing side presses
 * one wrong sign on purpose — the one alarm the run spends — and the sender's
 * world is shot within 150 ms of the press, the crew mid-flinch
 * (figure-flinch.png). The won card is shot with a figure high in its jump
 * (figure-celebrate.png), and the audience's card has to show its crew
 * celebrating too. A mission the walkthrough does not take that far skips
 * what it leaves out.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium, request } from 'playwright';
import { percentile } from './percentile.mjs';
import { bandPowers, decibels } from './spectrum.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? '/tmp/escapelab-shots';
const MISSION = process.env.SHOTS_MISSION || 'Blackout';
const FRAME_P95_MS = frameBudget(process.env.SHOTS_FRAME_P95_MS);
/**
 * How many times slower than this machine every page runs: SHOTS_CPU_SLOWDOWN,
 * 1 when unset. Chromium's own throttle (CDP Emulation.setCPUThrottlingRate)
 * slows each page's main thread, so a fast machine measures the frame budget
 * as a CI runner, with no GPU and little CPU, would.
 */
const CPU_SLOWDOWN = cpuSlowdown(process.env.SHOTS_CPU_SLOWDOWN);
/**
 * Whether the pages are composed without a GPU, SHOTS_SOFTWARE_GL=1: on
 * SwiftShader, ANGLE's GPU in the CPU, so that what composing costs — off the
 * page's main thread, where SHOTS_CPU_SLOWDOWN does not reach — shows here as
 * on a CI runner. The canvas and the tiles are still drawn in software, as
 * there: a canvas on SwiftShader makes every frame of the world take some
 * 120 ms on this kind of machine, while CI's runner keeps the world at 60 fps.
 */
const SOFTWARE_GL = switchedOn('SHOTS_SOFTWARE_GL', process.env.SHOTS_SOFTWARE_GL);
const SOFTWARE_GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu-rasterization',
];
/**
 * Whether every page asks for the WebGL light layer, SHOTS_WEBGL=1: ?gl=1
 * forces it on even on a software renderer, so that its look and its frames
 * can be told apart from the Canvas pass's.
 */
const WEBGL = switchedOn('SHOTS_WEBGL', process.env.SHOTS_WEBGL);
/** Whether the browser opens real windows, SHOTS_HEADED=1: drawn on this machine's GPU. */
const HEADED = switchedOn('SHOTS_HEADED', process.env.SHOTS_HEADED);
/**
 * The client's sound systems switched off on every page, SHOTS_AUDIO_OFF=beds,music,spatial
 * (`?audio-off=`, client world/audio.ts): to tell what each costs the frames. None when unset;
 * the sound checks fail for a system switched off.
 */
const AUDIO_OFF = audioOff(process.env.SHOTS_AUDIO_OFF);
/** How far a frame's mean luma on the light layer may lie from the Canvas pass's, as a share. */
const LUMA_TOLERANCE = 0.1;
/**
 * The seed the host's room is pinned to (`?seed=`, taken by a server with
 * ALLOW_SEED=1 as `pnpm dev` and CI set it), so that who starts where, where
 * the sources lie and every station repeat from run to run. SHOTS_SEED
 * overrides it; another mission goes unpinned, and the skips below still say
 * what its draw left out. Found by printing the core's draw of a crew of two
 * for seeds 1…50 and replaying the steps below that depend on it, in a room:
 *
 * - Blackout 5: Anna starts in the Archiv by the sign (sign.png, at once with
 *   the power on), Ben at the west end of the Flur beside the Klemmbrett.
 *   With the power on, Anna's step into the Archiv brings the book at (2,1)
 *   into sight, and Ben walks towards her (cold-open.png). Nobody starts
 *   behind a door: both walk up to the lever (lever.png). Then Ben reads the
 *   book (reading), holds the plate for Anna on her way to console A of the
 *   Notstrom-Kasten, works console B and asks for the notes (console-*,
 *   hint-*). Ben's start replaced the Maschinenraum's in the mission's list
 *   of spawns, so the seed draws as it did before: Anna in the Archiv, Ben
 *   on the spawn that took the Maschinenraum's place.
 * - Systemcheck 1: the usual, Ben by the first station and the sign works it,
 *   Anna by the locker reads it.
 */
const SEEDS = new Map([
  ['blackout', 5],
  ['systemcheck', 1],
]);
const SEED = seedFor(process.env.SHOTS_SEED, SEEDS.get(MISSION.toLowerCase()));
/**
 * The Systemcheck's wiring box (Kabelprüfung) as its pinned seed draws it:
 * the wires' colours from the top, and the one the printed list for three
 * wires says to cut, counted from the top — gelb, gelb, gelb: rule 2, the
 * last wire is yellow, cut the first. Found by drawing the box from the
 * seed with the core's own module; a seed that draws another box fails the
 * run by name.
 */
const PINNED_WIRING = new Map([[1, { colors: ['gelb', 'gelb', 'gelb'], cut: 1 }]]);

/**
 * The host's window for cold-open.png: as wide as a laptop's, a little
 * taller, so that both starts of Blackout's draw fit in it.
 */
const COLD_OPEN = { width: 1440, height: 1000 };

const SIZES = [
  { name: 'laptop-13', width: 1440, height: 820 },
  { name: 'split-screen', width: 960, height: 760 },
  { name: 'phone', width: 420, height: 760 },
  // A phone held sideways, as a run turns it. Only a touch window shows its layout (the query
  // asks for a coarse pointer), so the guest's phone is turned, not the host's window.
  { name: 'phone-landscape', width: 844, height: 390, hasTouch: true },
];

/** Avatar speed in tiles per second, as the client walks. */
const SPEED = 4.2;
/** How close to a tile centre a step has to land, in tiles. */
const STEP_TOLERANCE = 0.15;
/** How long a frame sample runs, in ms. */
const SAMPLE_MS = 2000;
/**
 * Chromium's switches for the voice: a fake microphone (it beeps) handed out
 * without a prompt, links between two pages on this one machine even with no
 * network, and sound that plays without a click first.
 */
const VOICE_FLAGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--allow-loopback-in-peer-connection',
  '--autoplay-policy=no-user-gesture-required',
];
/** How long the voice links get to come up, in ms. */
const LINK_MS = 15_000;
/** How long a page gets to switch its microphone on, in ms. */
const MIC_MS = 15_000;
/** How long a started run gets to show on both pages, in ms. */
const START_MS = 20_000;
/** How long the host holds V, in ms. */
const TALK_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The p95 frame duration the run fails above, in ms: SHOTS_FRAME_P95_MS, or
 * 40 when unset, loose enough for a shared CI machine.
 */
function frameBudget(text) {
  if (text === undefined || text === '') {
    return 40;
  }
  const ms = Number(text);
  if (!(ms > 0)) {
    throw new Error(`SHOTS_FRAME_P95_MS has to be a number of milliseconds above 0, not "${text}"`);
  }
  return ms;
}

/** The slowdown of every page: SHOTS_CPU_SLOWDOWN, a factor from 1 up, or 1 when unset. */
function cpuSlowdown(text) {
  if (text === undefined || text === '') {
    return 1;
  }
  const rate = Number(text);
  if (!(rate >= 1)) {
    throw new Error(`SHOTS_CPU_SLOWDOWN has to be a factor of 1 or more, not "${text}"`);
  }
  return rate;
}

/** The sound systems SHOTS_AUDIO_OFF names, comma-separated; throws for one it does not know. */
function audioOff(text) {
  const named = (text ?? '').split(',').filter((name) => name !== '');
  const unknown = named.find((name) => !['beds', 'music', 'spatial'].includes(name));
  if (unknown !== undefined) {
    throw new Error(`SHOTS_AUDIO_OFF names beds, music and spatial, not "${unknown}"`);
  }
  return named;
}

/** Whether the switch `name` (`text`, its value) is on: 1 is on, 0 or unset off. */
function switchedOn(name, text) {
  if (text === undefined || text === '' || text === '0') {
    return false;
  }
  if (text !== '1') {
    throw new Error(`${name} has to be 1 (on) or 0 (off), not "${text}"`);
  }
  return true;
}

/**
 * Logs what draws the pages — the GL renderer, and whether compositing and the
 * 2D canvas run on it or in software. Under SOFTWARE_GL anything but pages
 * composed on SwiftShader stops the run: its frames would not measure that.
 */
async function logRendering() {
  const cdp = await browser.newBrowserCDPSession();
  const { gpu } = await cdp.send('SystemInfo.getInfo');
  await cdp.detach();
  const renderer = gpu.auxAttributes?.glRenderer ?? gpu.devices?.[0]?.deviceString ?? 'unknown';
  const status = gpu.featureStatus ?? {};
  const compositing = status.gpu_compositing ?? 'unknown';
  console.log(
    `gpu                ${renderer}: compositing ${compositing}, ` +
      `2d canvas ${status['2d_canvas'] ?? 'unknown'}` +
      (SOFTWARE_GL ? ' (SHOTS_SOFTWARE_GL)' : '') +
      (WEBGL ? ' (SHOTS_WEBGL: ?gl=1 on every page)' : '') +
      (HEADED ? ' (SHOTS_HEADED: real windows)' : ''),
  );
  if (SOFTWARE_GL && (!/SwiftShader/.test(renderer) || compositing !== 'enabled')) {
    throw new Error(
      `SHOTS_SOFTWARE_GL=1, but the pages are not composed on SwiftShader (renderer ` +
        `"${renderer}", compositing ${compositing}): check that ` +
        `${SOFTWARE_GL_FLAGS.join(' ')} still selects it in this Playwright build`,
    );
  }
}

/** A new page in `context`, its main thread slowed down CPU_SLOWDOWN times before it loads. */
async function openPage(context, name = 'page') {
  const page = await context.newPage();
  named.set(page, name);
  if (CPU_SLOWDOWN > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  }
  return page;
}

/**
 * The seed of the host's room: SHOTS_SEED where set, else `pinned`, the
 * mission's; null for none, which leaves the room to chance.
 */
function seedFor(text, pinned) {
  if (text === undefined || text === '') {
    return pinned ?? null;
  }
  if (!/^\d{1,10}$/.test(text) || Number(text) > 0xffffffff) {
    throw new Error(`SHOTS_SEED has to be a whole number from 0 to 4294967295, not "${text}"`);
  }
  return Number(text);
}

/** `url` with `?seed=` where this run has a seed: the room the host opens there is pinned to it. */
function seeded(url) {
  if (SEED === null) {
    return url;
  }
  const withSeed = new URL(url);
  withSeed.searchParams.set('seed', String(SEED));
  return withSeed.href;
}

/** What the run did, for the summary at its end. */
const tally = { taken: 0, skipped: 0, failures: [] };

/** The browser of this run; closed at its end, however that comes. */
let browser = null;

/** Whether a frame sample was taken at an open station panel; a run without one says so. */
let panelSampled = false;

/** Saves what `page` shows as `name` in the output folder, and counts it. */
async function capture(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  tally.taken += 1;
}

/** Logs a capture this run leaves out, and why. A skip fails nothing. */
function skip(label, why) {
  console.log(`${label.padEnd(18)} skipped: ${why}`);
  tally.skipped += 1;
}

/** Notes a check that fails the run; the walkthrough goes on, so every capture is still taken. */
function fail(what) {
  tally.failures.push(what);
}

/** `url` with `?trace=1` added: the world then keeps its frame durations for `sampleFrames`. */
function traced(url) {
  const withFlag = new URL(url);
  withFlag.searchParams.set('trace', '1');
  return paged(withFlag.href);
}

/**
 * `url` as every page of this run opens it: with `?gl=1` under SHOTS_WEBGL, and the sound
 * systems SHOTS_AUDIO_OFF names switched off.
 */
function paged(url) {
  if (!WEBGL && AUDIO_OFF.length === 0) {
    return url;
  }
  const withFlags = new URL(url);
  if (WEBGL) {
    withFlags.searchParams.set('gl', '1');
  }
  if (AUDIO_OFF.length > 0) {
    withFlags.searchParams.set('audio-off', AUDIO_OFF.join(','));
  }
  return withFlags.href;
}

/** The run's pages by the name they were opened under: the per-page cost is logged by it. */
const named = new Map();

/** Each page's CDP session for its performance metrics, opened once: they count from then on. */
const metricSessions = new WeakMap();

/**
 * A page's renderer as Chrome counts it: CPU seconds, main-thread task seconds, live audio
 * nodes (wired or awaiting collection) and the JS heap in use, MB.
 */
async function pageCost(page) {
  let cdp = metricSessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    metricSessions.set(page, cdp);
  }
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    cpu: value('ProcessTime'),
    main: value('TaskDuration'),
    audio: value('AudioHandlers'),
    heap: value('JSHeapUsedSize') / 1e6,
  };
}

/** Every open page of the run, with its cost so far. */
async function pageCosts() {
  const open = [...named.keys()].filter((page) => !page.isClosed());
  return new Map(await Promise.all(open.map(async (page) => [page, await pageCost(page)])));
}

/** Each page's cores busy between two readings `seconds` apart, and its audio nodes, as text. */
function pageCostText(before, after, seconds) {
  return [...after]
    .map(([page, now]) => {
      const was = before.get(page) ?? now;
      const cores = ((now.cpu - was.cpu) / seconds).toFixed(2);
      const main = ((now.main - was.main) / seconds).toFixed(2);
      const heap = now.heap.toFixed(0);
      return `${named.get(page)} ${cores} (main ${main}), ${now.audio} audio nodes, ${heap} MB`;
    })
    .join('; ');
}

/** CPU seconds the browser's processes have used so far, summed by their type (CDP SystemInfo). */
async function processCpu() {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const byType = {};
    for (const { type, cpuTime } of processInfo) {
      byType[type] = (byType[type] ?? 0) + cpuTime;
    }
    return byType;
  } finally {
    await cdp.detach();
  }
}

/** The cores each type of process kept busy between two readings `seconds` apart, as text. */
function busyCores(before, after, seconds) {
  return Object.keys(after)
    .sort()
    .map((type) => {
      const busy = (after[type] - (before[type] ?? 0)) / seconds;
      return `${type.replace(/\.mojom\./, ' ')} ${busy.toFixed(2)}`;
    })
    .join(', ');
}

/**
 * Samples a page opened with `traced`: resets its frame trace, lets `quiet`
 * fill the window and logs p50 and p95 of the durations recorded meanwhile.
 * Nothing in `quiet` may screenshot, resize or click: those stalls are the
 * harness's, not the game's. A p95 over the budget fails the run, as does a
 * page without a trace or a window without frames.
 */
async function sampleFrames(page, when, quiet) {
  // The probes hold the voice as well: the frames are there only while a world is up.
  const found = await page.evaluate(() => {
    const probe = globalThis.__escapelab;
    if (typeof probe?.resetFrames !== 'function') {
      return false;
    }
    probe.resetFrames();
    return true;
  });
  if (!found) {
    console.log(`frames             !! no trace ${when}: the page keeps none under ?trace=1`);
    fail(`no frame trace ${when}`);
    return;
  }
  const cpuBefore = await processCpu();
  const pagesBefore = await pageCosts();
  const spentBefore = await page.evaluate(() => globalThis.__escapelab?.audio?.spent ?? null);
  const quietSince = Date.now();
  await quiet();
  const seconds = (Date.now() - quietSince) / 1000;
  const cores = busyCores(cpuBefore, await processCpu(), seconds);
  const perPage = pageCostText(pagesBefore, await pageCosts(), seconds);
  const frames = await page.evaluate(() => globalThis.__escapelab?.frames ?? []);
  const nodes = await page.evaluate(() => globalThis.__escapelab?.audio?.nodes ?? null);
  const spentAfter = await page.evaluate(() => globalThis.__escapelab?.audio?.spent ?? null);
  if (frames.length === 0) {
    console.log(`frames             !! no frames recorded ${when}`);
    fail(`no frames recorded ${when}`);
    return;
  }
  const p95 = percentile(frames, 95);
  const over = p95 > FRAME_P95_MS;
  console.log(
    `frames             p50 ${percentile(frames, 50).toFixed(1)} ms · p95 ${p95.toFixed(1)} ms ` +
      `(${frames.length}) ${when}: ` +
      (over ? `!! over the budget of ${FRAME_P95_MS} ms` : `within ${FRAME_P95_MS} ms`),
  );
  console.log(`cpu                cores busy: ${cores}; sound: ${soundSources(nodes)}`);
  console.log(`pages              ${perPage}`);
  const js = soundJs(spentBefore, spentAfter, seconds);
  console.log(`sound js           ms a second on the host's main thread: ${js}`);
  if (over) {
    fail(`frame p95 ${p95.toFixed(1)} ms ${when}, over ${FRAME_P95_MS} ms`);
  }
}

/** What the host's audio thread renders, from the probe's census (`audio.nodes`), as text. */
function soundSources(nodes) {
  if (nodes?.playing === undefined) {
    return 'no audio probe';
  }
  const { playing, total, wired, beds } = nodes;
  return (
    `playing ${playing.oscillator} oscillators, ${playing.buffer} buffer sources; ` +
    `${total} nodes wired (${countsOf(wired)}); ${beds} beds`
  );
}

/** The main thread's ms a second each sound system took between two readings of `audio.spent`. */
function soundJs(before, after, seconds) {
  if (after === null) {
    return 'none';
  }
  return Object.keys(after)
    .sort()
    .map((name) => `${name} ${((after[name] - (before?.[name] ?? 0)) / seconds).toFixed(2)}`)
    .join(', ');
}

/** The run's last line: captures taken, skipped and failed, and what failed. */
function summarize() {
  const { taken, skipped, failures } = tally;
  console.log(
    `summary            ${taken} captures taken, ${skipped} skipped, ${failures.length} failed` +
      (failures.length === 0 ? '' : ` — ${failures.join('; ')}`),
  );
}

/**
 * Reports how far the main area overflows its window. A screen that scrolls
 * is a layout bug here, so this is printed next to every capture.
 */
async function overflow(page, label) {
  const { scroll, client, parts } = await page.evaluate(() => {
    const el = document.querySelector('.content');
    // An SVG icon's className is an SVGAnimatedString, so read the attribute.
    const name = (n) =>
      `${n.tagName.toLowerCase()}.${(n.getAttribute('class') ?? '').split(' ')[0] || '-'}`;
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

/**
 * The Bestenliste off the join screen, captured as `name` once it is loaded:
 * measured like the join screen — at 1280×720 too where the window is a
 * laptop's, sideways on a phone — and left the way a player goes back.
 */
async function captureHistory(page, name) {
  await clickText(page, 'Bestenliste');
  const loaded = page.locator('.history-board, .history [role="alert"]').first();
  await loaded.waitFor({ timeout: 10_000 });
  await sleep(300);
  await capture(page, `${name}.png`);
  const { width, height } = page.viewportSize();
  await overflow(page, `${name} @ ${width}x${height}`);
  if (width >= 1280) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(400);
    await overflow(page, `${name} @ 1280x720`);
    await page.setViewportSize({ width, height });
    await sleep(300);
  } else {
    const over = await sideways(page, '.content');
    console.log(`${name}.png`.padEnd(19) + (over > 0 ? `!! +${over}px sideways` : 'fits sideways'));
  }
  await clickText(page, 'Zurück');
  await page.locator('.mission').first().waitFor({ timeout: 10_000 });
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

/** The tiles the map's furniture stands on, by key: solid for every step, as walls are. */
function furniture(map) {
  return new Set((map.decor ?? []).map((piece) => `${piece.x},${piece.y}`));
}

/**
 * Shortest walk over floor and open doors, round the furniture, as tiles from
 * `from` to `to`; null if none.
 */
function route(map, from, to) {
  const key = (x, y) => `${x},${y}`;
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const solid = furniture(map);
  const walkable = (x, y) =>
    map.tiles[y]?.[x] === '.' && !closed.has(key(x, y)) && !solid.has(key(x, y));
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
 * Walks `player` to and fro inside the tile it stands on for `ms`, then back
 * to the tile's centre. The lamp moves, so every moving frame works its light
 * out anew, as in play, where a lamp standing still reuses its last sight.
 * A fifth of a tile each way presses no plate on a tile next door, and stays
 * inside the radius that keeps the player present wherever it already was.
 */
async function pace(player, ms) {
  const home = tileOf(player.seen);
  if (home === null) {
    await sleep(ms);
    return;
  }
  const [x, y] = [home.x + 0.5, home.y + 0.5];
  const end = Date.now() + ms;
  for (let leg = 0; Date.now() < end; leg++) {
    await stepTo(player.page, player.seen, x + (leg % 2 === 0 ? 0.2 : -0.2), y);
  }
  await stepTo(player.page, player.seen, x, y);
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
    skip('reading-page2.png', `${who} reads a wall chart, it has no pages`);
    return;
  }
  const forwards = !(await overlay.locator('.turn-next').isDisabled());
  if (!forwards && (await overlay.locator('.turn-back').isDisabled())) {
    skip('reading-page2.png', `"${before}" is the whole source, no page to turn either way`);
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
  await capture(page, 'reading-page2.png');
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
  await capture(page, 'reading.png');
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
  // The line that comes with the solve speaks a second after it: listen from the presses on.
  const listening = hearRadio(first, 9000);
  if (station.look !== 'lever') {
    await captureSolved(first, station);
  }
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
  return { listening, lit: first.seen.view.map.litRooms.slice(litBefore) };
}

/** How long after a solve a device closes itself, as puzzles/Device.tsx says (SOLVED_CLOSE_MS). */
const SOLVED_CLOSE_MS = 500;

/**
 * device-solved.png as the run takes it: whether a shot landed while the
 * device still showed solved, and when those that landed after its close did,
 * ms after it showed solved. The first sync station the run solves is shot; a
 * late shot is taken again at the next one, and one late there too is skipped.
 */
const solvedShot = { taken: false, late: [] };

/** Whether device-solved.png is still to be shot: none in time yet, no second chance spent. */
function shootingSolved() {
  return !solvedShot.taken && solvedShot.late.length < 2;
}

/**
 * Counts the shot of a solved device, `shot` ms after it showed solved (null
 * where none was taken): in time before its close; after it, late — and the
 * second late one is skipped at once.
 */
function noteShot(shot) {
  if (shot === null) {
    return;
  }
  if (shot < SOLVED_CLOSE_MS) {
    solvedShot.taken = true;
  } else {
    solvedShot.late.push(shot);
    if (solvedShot.late.length === 2) {
      skipLateShot();
    }
  }
}

/** Logs device-solved.png as skipped: its shots landed after the device's close, at these times. */
function skipLateShot() {
  const times = solvedShot.late.map((ms) => `${ms} ms`).join(', ');
  skip('device-solved.png', `the solved-device shot landed late under load (${times})`);
}

/**
 * What a solved device shows at its shot: the status strip's LEDs gone green
 * so far, and any overlay lying over the device — nothing may cover it, its
 * own sweep is the solve's whole show.
 */
function solvedLook(page) {
  return page.evaluate(() => {
    const view = document.defaultView;
    const device = document.querySelector('.station-modal .device--solved');
    const strip = [...document.querySelectorAll('.station-modal .device-strip-led')];
    const green = (led) => {
      const [r, g] = (view.getComputedStyle(led).backgroundColor.match(/\d+/g) ?? []).map(Number);
      return g > 150 && g > r;
    };
    const box = device?.getBoundingClientRect();
    const over = (el) => {
      const r = el.getBoundingClientRect();
      const meets = box !== undefined && r.left < box.right && r.right > box.left;
      return meets && r.top < box.bottom && r.bottom > box.top;
    };
    const covers = [...document.querySelectorAll('.overlay')]
      .filter((el) => over(el) && Number(view.getComputedStyle(el).opacity) > 0.05)
      .map((el) => el.getAttribute('class'));
    return { lit: strip.filter(green).length, all: strip.length, covers };
  });
}

/**
 * A sync station right after the crew's presses: it has to show solved — its
 * status strip sweeping green along the bezel's foot, its plate dimmed — with
 * nothing over it, and close itself SOLVED_CLOSE_MS later. The first one the
 * run solves is shot as it sweeps (device-solved.png), the next one again
 * where that shot landed after the close (noteShot). Fails where it never
 * shows solved, is gone before it is looked at, lies covered, or does not
 * close itself.
 */
async function captureSolved(player, station) {
  const solved = player.page.locator('.station-modal .device--solved');
  const since = Date.now();
  if (!(await attached(solved, 3000))) {
    console.log(`device-solved      !! "${station.title}" never showed solved for ${player.name}`);
    fail(`device-solved: "${station.title}" never showed solved`);
    return;
  }
  const seen = Date.now();
  await sleep(120); // the sweep under way along the strip
  const look = await solvedLook(player.page);
  const looked = Date.now() - seen;
  const shooting = shootingSolved();
  if (shooting) {
    await capture(player.page, 'device-solved.png');
  }
  const shot = shooting ? Date.now() - seen : null;
  const gone = await solved.waitFor({ state: 'detached', timeout: SOLVED_CLOSE_MS + 1500 }).then(
    () => Date.now() - seen,
    () => null,
  );
  noteShot(shot);
  const timing = { since: seen - since, looked, shot, gone };
  reportSolved(`${player.name}: "${station.title}"`, look, timing);
}

/**
 * A solved sync station in the log — when it showed solved after the presses,
 * when it was looked at and shot, what lay over it, when it closed itself —
 * and in the failures where it was gone before it was looked at, covered, or
 * never closed itself. A shot after its close is no failure (noteShot).
 */
function reportSolved(what, look, { since, looked, shot, gone }) {
  const late = shot !== null && shot >= SOLVED_CLOSE_MS;
  const lateSaid = late ? ' (late: after its close)' : '';
  const shotSaid = shot === null ? '' : `, shot ${shot} ms${lateSaid}`;
  const covered = look.covers.length > 0;
  const strip = `${look.lit} of ${look.all} strip LEDs green`;
  console.log(
    `${shot === null ? 'device-solved     ' : 'device-solved.png '} ${what} solved ${since} ms ` +
      `after the presses, looked at ${looked} ms into it${shotSaid} — ${strip}, ` +
      `${covered ? `!! under ${look.covers.join(', ')}` : 'nothing over it'}; ` +
      (gone === null ? '!! it stayed open' : `it closed itself after ${gone} ms`),
  );
  const why = [
    ...(look.all === 0 ? ['was gone before it was looked at'] : []),
    ...(covered ? ['lay covered'] : []),
    ...(gone === null ? ['stayed open'] : []),
  ];
  if (why.length > 0) {
    fail(`device-solved: ${what} ${why.join(', ')}`);
  }
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
    skip('station-both.png', `${reader.name} has no way to "${station.puzzleId}"`);
    return;
  }
  const readerSees = await interactUntil(reader.page, reader.page.locator('.station-modal'));
  const operatorSees = await operator.page.locator('.station-modal').isVisible();
  await sleep(400); // past the panel's fade-in
  await capture(reader.page, 'station-both.png');
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
    const solved = await pressTogether([operator, reader], station);
    await bedAlive(operator, solved.lit, `after "${station.title}"`);
    await checkRadioVoice(operator, solved.listening, `"${station.title}"`);
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

/**
 * Walks `player` up to `tiles` tiles along the shortest way to `target`,
 * planned as if every door stood open, and stops in front of one that is
 * shut. Returns how many tiles it walked.
 */
async function approach(player, target, tiles) {
  const map = player.seen.view.map;
  const from = tileOf(player.seen);
  // A map without doors: the way is planned as if every door stood open.
  const path = from === null ? null : route({ ...map, doors: [] }, from, target);
  const shut = new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));
  let walked = 0;
  for (const tile of (path ?? []).slice(1, tiles + 1)) {
    if (shut.has(`${tile.x},${tile.y}`)) {
      break;
    }
    if (!(await stepTo(player.page, player.seen, tile.x + 0.5, tile.y + 0.5))) {
      break;
    }
    walked += 1;
  }
  return walked;
}

/**
 * One step from where `player` stands into its room — north, east, south or
 * west, the first that is floor — as a player does first, which brings more
 * of the room into sight. The player stays there.
 */
async function stepIntoRoom(player) {
  const home = tileOf(player.seen);
  const map = player.seen.view.map;
  const solid = furniture(map);
  const step = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ].find(
    ([dx, dy]) =>
      home !== null &&
      map.tiles[home.y + dy]?.[home.x + dx] === '.' &&
      !solid.has(`${home.x + dx},${home.y + dy}`),
  );
  if (home === null || step === undefined) {
    return;
  }
  await stepTo(player.page, player.seen, home.x + step[0] + 0.5, home.y + step[1] + 0.5);
}

/**
 * The floor of the room round `from`, as tiles: every floor tile reachable
 * without crossing a door, open or not — the room the power lights whole.
 */
function roomFloorOf(map, from) {
  const key = (x, y) => `${x},${y}`;
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const inside = (x, y) => map.tiles[y]?.[x] === '.' && !doors.has(key(x, y));
  if (!inside(from.x, from.y)) {
    return [];
  }
  const seen = new Set([key(from.x, from.y)]);
  const room = [{ x: from.x, y: from.y }];
  for (let i = 0; i < room.length; i++) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: room[i].x + dx, y: room[i].y + dy };
      if (inside(next.x, next.y) && !seen.has(key(next.x, next.y))) {
        seen.add(key(next.x, next.y));
        room.push(next);
      }
    }
  }
  return room;
}

/**
 * How bright the floor of a room comes out on a traced page's world canvas: the
 * mean luma, 0 to 255, of a few pixels at the middle of each of its tiles on
 * the canvas — mapped by the camera the page reports — and how many tiles
 * that was; a mean of null where none of them is on the canvas.
 */
async function roomBrightness(page, tiles) {
  return page.evaluate((spots) => {
    const camera = globalThis.__escapelab?.camera;
    const canvas = document.querySelector('.world-canvas');
    const g = canvas?.getContext('2d');
    if (camera === undefined || g == null) {
      return { mean: null, tiles: 0 };
    }
    const { width: w, height: h } = canvas;
    let sum = 0;
    let pixels = 0;
    let counted = 0;
    for (const { x, y } of spots) {
      const px = Math.round(w / 2 + (x + 0.5 - camera.x) * camera.scale);
      const py = Math.round(h / 2 + (y + 0.5 - camera.y) * camera.scale);
      if (px < 3 || py < 3 || px > w - 4 || py > h - 4) {
        continue;
      }
      counted += 1;
      const data = g.getImageData(px - 2, py - 2, 5, 5).data;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        pixels += 1;
      }
    }
    return { mean: pixels === 0 ? null : sum / pixels, tiles: counted };
  }, tiles);
}

/** The floor of a lit room comes out at least this bright with the power on, mean luma 0–255. */
const ROOM_LIT_LUMA = 45;
/** A room left in the dark comes out at most this bright. */
const ROOM_DARK_LUMA = 20;

/**
 * With the power on the host's own room is lit whole and warm, and the
 * Serverraum and the Labor — rooms of its map it is not in — stay dark: each
 * by the brightness of its floor on the host's canvas. Fails where one is
 * not; a room of these the map lacks, or the canvas does not show, is left
 * out of the check with a word.
 */
async function checkPowerRooms(host) {
  const map = host.seen.view.map;
  const own = roomFloorOf(map, tileOf(host.seen));
  const named = (text) => map.labels.find((label) => label.text === text);
  // The furniture's tiles show its sprites, not the floor: only bare floor is measured.
  const solid = furniture(map);
  const bare = (floor) => floor.filter((tile) => !solid.has(`${tile.x},${tile.y}`));
  const rooms = [
    { name: 'own room', floor: bare(own), lit: true },
    ...['SERVERRAUM', 'LABOR'].map((text) => {
      const label = named(text);
      const floor = label === undefined ? [] : bare(roomFloorOf(map, label));
      return { name: text, floor, lit: false };
    }),
  ];
  const said = [];
  for (const room of rooms) {
    const { mean, tiles } = await roomBrightness(host.page, room.floor);
    if (mean === null) {
      said.push(`${room.name} not on the canvas`);
      continue;
    }
    const ok = room.lit ? mean >= ROOM_LIT_LUMA : mean <= ROOM_DARK_LUMA;
    const luma = mean.toFixed(0);
    said.push(`${room.name} ${room.lit ? 'lit' : 'dark'} ${ok ? '' : '!! '}${luma} (${tiles} tiles)`);
    if (!ok) {
      const should = room.lit ? `be lit (≥ ${ROOM_LIT_LUMA})` : `be dark (≤ ${ROOM_DARK_LUMA})`;
      fail(`cold-open.png: the ${room.name} comes out at luma ${luma} with the power on — should ${should}`);
    }
  }
  return said.join(', ');
}

/**
 * cold-open.png: a mission with an intro opens with the power on —
 * NORMALBETRIEB where the clock will be, and the room each player stands in
 * lit whole and warm, the rest of the lab dark. The host's window grows to
 * COLD_OPEN; while the power is on, the host steps into its room and the
 * guest walks a few steps towards the host, and the host's frames meanwhile
 * are the sample of the lit scene. Fails unless the shot shows the host's
 * own room lit and the Serverraum and the Labor dark (`checkPowerRooms`);
 * throws when NORMALBETRIEB never shows or the lights are out before the
 * shot.
 */
async function captureColdOpen(host, guest) {
  if (!(await attached(host.page.locator('.stage-clock .power-status'), 5000))) {
    throw new Error('the run opened with the power on, but no NORMALBETRIEB shows');
  }
  await host.page.setViewportSize(COLD_OPEN);
  await sleep(250);
  const toward = tileOf(host.seen);
  let walked = 0;
  await sampleFrames(host.page, 'in the lit lab, the power still on', async () => {
    const [steps] = await Promise.all([
      toward === null ? 0 : approach(guest, toward, 3),
      stepIntoRoom(host),
    ]);
    walked = steps;
  });
  if (host.seen.view.lights.out) {
    throw new Error('the lights went out before cold-open.png');
  }
  await capture(host.page, 'cold-open.png');
  const status = await textOf(host.page.locator('.stage-clock .power-status'));
  const room = await textOf(host.page.locator('.stage-goal--power .stage-sub'));
  const rooms = await checkPowerRooms(host);
  const found = host.seen.view.map.manuals.map((manual) => manual.kind).join(', ') || 'none';
  console.log(
    `cold-open.png      ${host.name} @ ${COLD_OPEN.width}x${COLD_OPEN.height}: "${status}", ` +
      `"${room}"; ${rooms}; sources found: ${found}; ` +
      `${guest.name} walked ${walked} tile(s) towards ${host.name}`,
  );
  await host.page.setViewportSize(SIZES[0]);
}

/** The light probe of a traced page (client world/gl/path.ts), or null where it has none. */
function lightOf(page) {
  return page.evaluate(() => {
    const light = globalThis.__escapelab?.light;
    return light === undefined
      ? null
      : { path: light.path, renderer: light.renderer, reason: light.reason };
  });
}

/** Resolves after `count` more animation frames of `page`: the world has drawn as many. */
function framesOf(page, count) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const next = () => (--left <= 0 ? resolve() : globalThis.requestAnimationFrame(next));
        globalThis.requestAnimationFrame(next);
      }),
    count,
  );
}

/** Takes the light of `page` the way `path` says ('gl', 'canvas'), or back (null); waits it out. */
async function lightThrough(page, path) {
  await page.evaluate((way) => globalThis.__escapelab?.light?.use(way), path);
  await framesOf(page, 3);
}

/** The mean luma of `page`'s world canvas as its light probe reads it, 0–255; null without one. */
function canvasLuma(page) {
  return page.evaluate(() => globalThis.__escapelab?.light?.luma() ?? null);
}

/**
 * Logs which way the world's light takes on `player`'s page and why. Fails
 * the run where SHOTS_WEBGL asked for the light layer and it does not draw,
 * or where SHOTS_SOFTWARE_GL renders in software and it does.
 */
async function checkLight({ name, page }) {
  const light = await lightOf(page);
  const said = light === null ? '!! no light probe' : `${light.path} (${light.reason})`;
  console.log(`light              ${name}: ${said}, renderer ${light?.renderer ?? 'none'}`);
  if (WEBGL && light?.path !== 'gl') {
    const way = light?.path ?? 'no way';
    fail(`SHOTS_WEBGL asked for the light layer, but ${name}'s light takes ${way}`);
  } else if (SOFTWARE_GL && !WEBGL && light?.path !== 'canvas') {
    fail(`a software renderer keeps the Canvas pass, but ${name}'s light takes ${light?.path}`);
  }
}

/**
 * Under SHOTS_WEBGL, the moment about to be shot both ways on `page`: its
 * world's mean luma on the light layer and on the Canvas pass, which may lie
 * at most LUMA_TOLERANCE apart; `shot` taken on the layer, then the light
 * left on the Canvas pass for the shot the caller takes. Returns what takes
 * the light back to the layer. Without SHOTS_WEBGL, nothing.
 */
async function lightPair(page, shot) {
  if (!WEBGL) {
    return async () => undefined;
  }
  const light = await lightOf(page);
  if (light?.path !== 'gl') {
    console.log(`${shot.padEnd(18)} !! the light takes ${light?.path ?? 'no way'}, not the layer`);
    fail(`${shot}: the light probe reports ${light?.path ?? 'nothing'}, not gl`);
    return async () => undefined;
  }
  const onLayer = await canvasLuma(page);
  await lightThrough(page, 'canvas');
  const onCanvas = await canvasLuma(page);
  await lightThrough(page, null);
  await capture(page, shot);
  await lightThrough(page, 'canvas');
  if (onLayer === null || onCanvas === null) {
    console.log(`${shot.padEnd(18)} !! the world's canvas gave no luma to compare`);
    fail(`${shot}: no luma off the world's canvas`);
    return () => lightThrough(page, null);
  }
  const gap = onCanvas > 0 ? Math.abs(onLayer - onCanvas) / onCanvas : Infinity;
  const match = gap <= LUMA_TOLERANCE;
  console.log(
    `${shot.padEnd(18)} on the light layer (${light.renderer}): mean luma ${onLayer.toFixed(1)}, ` +
      `the Canvas pass ${onCanvas.toFixed(1)} — ${(gap * 100).toFixed(1)} % apart` +
      (match ? '' : ` !! more than ${LUMA_TOLERANCE * 100} %`),
  );
  if (!match) {
    fail(`${shot}: mean luma ${onLayer.toFixed(1)} on the layer, ${onCanvas.toFixed(1)} on Canvas`);
  }
  return () => lightThrough(page, null);
}

// --- sound (client world/ambience.ts, music.ts, radioVoice.ts, spatial.ts) ---

/** What a traced page's world sounds like, as its audio probe reads it; null without one. */
function soundOf(page) {
  return page.evaluate(() => {
    const audio = globalThis.__escapelab?.audio;
    if (audio === undefined) {
      return null;
    }
    const { room, kind, beds, power, music, voice, spatial } = audio;
    return { room, kind, beds, power, music, voice, spatial };
  });
}

/** Counts by name as text: "gain 12, filter 4". */
function countsOf(record) {
  return Object.entries(record ?? {}).map(([name, count]) => `${name} ${count}`).join(', ');
}

/** Levels by name as text: "archive 1.00, corridor 0.25". */
function levelsOf(record) {
  const named = Object.entries(record ?? {}).map(([name, level]) => `${name} ${level.toFixed(2)}`);
  return named.join(', ') || 'none';
}

/**
 * The bed of the room `player` stands in has collapsed to its dead variant
 * (`when`: after the blackout, or with the lights out from the start): its
 * powered layer — fans, hums, whines — is down. Fails otherwise.
 */
async function bedDead(player, when) {
  const sound = await soundOf(player.page);
  const kind = sound?.kind ?? null;
  const power = kind === null ? null : (sound.power[kind] ?? null);
  const dead = power !== null && power <= 0.05;
  const state = `${dead ? 'dead' : '!! not dead'} (power ${power?.toFixed(2) ?? 'none'})`;
  console.log(
    `sound              ${player.name} in ${sound?.room ?? '!! no room'} ${when}: the ` +
      `${kind ?? '?'} bed ${state}; beds ${levelsOf(sound?.beds)}`,
  );
  if (!dead) {
    fail(`sound ${when}: the bed of ${player.name}'s room is not dead (${kind}: ${power})`);
  }
}

/**
 * Once a station has lit rooms (`lit`), the bed of the one `player` stands
 * in is alive again, warmed up with the lights: waits up to 3 s for it. Fails
 * otherwise.
 */
async function bedAlive(player, lit, when) {
  let sound = null;
  const alive = () => {
    const kind = sound?.kind ?? null;
    return kind !== null && lit.includes(sound.room) && (sound.power[kind] ?? 0) >= 0.95;
  };
  for (const end = Date.now() + 3000; ; await sleep(100)) {
    sound = await soundOf(player.page);
    if (alive() || Date.now() >= end) {
      break;
    }
  }
  const kind = sound?.kind ?? '?';
  console.log(
    `sound              ${player.name} in ${sound?.room ?? '!! no room'} ${when}: the ${kind} ` +
      `bed ${alive() ? 'alive' : '!! not alive'} (power ${levelsOf(sound?.power)})`,
  );
  if (!alive()) {
    fail(`sound ${when}: the bed of ${player.name}'s lit room is not alive`);
  }
}

/**
 * Listens to `player`'s radio for up to `ms` from now: the first line that
 * speaks, by its recording's id, and from when to when it was heard speaking
 * (polled every 100 ms). Null where none spoke.
 */
async function hearRadio(player, ms) {
  const end = Date.now() + ms;
  let heard = null;
  while (Date.now() < end) {
    const voice = (await soundOf(player.page))?.voice;
    if (voice?.playing === true && (heard === null || voice.lastId === heard.id)) {
      heard ??= { id: voice.lastId, from: Date.now(), to: Date.now() };
      heard.to = Date.now();
    } else if (heard !== null) {
      break;
    }
    await sleep(100);
  }
  return heard;
}

/**
 * The line that came over the radio with a solve (`listening`, from
 * hearRadio): a recording from the manifest the server hands out has to have
 * spoken it — what the banner says, the view's last radio line — for a second
 * at least. Fails otherwise.
 */
async function checkRadioVoice(player, listening, after) {
  const heard = await listening;
  // A page without the recordings answers with something else: no manifest, and the check fails.
  const manifest = await player.page.evaluate(() =>
    globalThis
      .fetch('/voice/manifest.json')
      .then((res) => res.json())
      .catch(() => ({})),
  );
  const events = player.seen.view.events;
  const line = [...events].reverse().find((event) => event.kind === 'radio')?.label ?? null;
  const entry = heard === null ? undefined : manifest[heard.id];
  const spoke = heard === null ? 0 : heard.to - heard.from;
  const said = heard === null
    ? '!! no line spoke'
    : `${heard.id} „${entry?.text ?? '!! not in the manifest'}" speaking ${seconds(spoke)}`;
  console.log(`radio voice        ${player.name} after ${after}: ${said}; the banner: „${line}"`);
  if (entry === undefined || entry.text !== line || spoke < 1000) {
    fail(`radio voice after ${after}: ${heard?.id ?? 'nothing'} spoke ${spoke} ms for „${line}"`);
  }
}

/** How many times the partner's side was told apart, of the checks that could. */
const sides = { checked: 0 };

/**
 * Where `player` hears `partner`: the probe's pan has to point to the side
 * the partner stands on, wherever they stand half a tile or more apart
 * sideways (`where`: the moment). Fails on the wrong side.
 */
async function partnerSide(player, partner, where) {
  await sleep(300); // a placing round or two after the last step
  const at = whereIs(player.seen);
  const them = whereIs(partner.seen);
  const pan = (await soundOf(player.page))?.spatial?.partnerPan ?? null;
  const dx = them.x - at.x;
  if (Math.abs(dx) < 0.5) {
    console.log(`partner            ${where}: ${partner.name} stands in line with ${player.name}`);
    return;
  }
  sides.checked += 1;
  const right = pan !== null && Math.sign(pan) === Math.sign(dx);
  const side = dx > 0 ? 'right' : 'left';
  const heard = `${pan?.toFixed(2) ?? '!! none'}${right ? '' : ' !! wrong side'}`;
  console.log(
    `partner            ${where}: ${partner.name} ${Math.abs(dx).toFixed(1)} tiles to the ` +
      `${side} of ${player.name}, heard at pan ${heard}`,
  );
  if (!right) {
    fail(`partner ${where}: ${partner.name} stands ${side}, but pans ${pan}`);
  }
}

/**
 * The partner across the room from `player`: `partner` walks to bare floor
 * — no plate, station or furniture — three to five tiles to its side in its
 * row, is heard there on that side (partnerSide), and walks back. Throws
 * where the walk breaks off.
 */
async function partnerAcross(player, partner, where) {
  const map = player.seen.view.map;
  const at = tileOf(player.seen);
  const back = tileOf(partner.seen);
  const taken = new Set([
    ...map.plates.map((p) => `${p.x},${p.y}`),
    ...map.stations.map((s) => `${s.x},${s.y}`),
    ...furniture(map),
  ]);
  const away = (tile) => Math.abs(tile.x - at.x);
  const spot = roomFloorOf(map, at)
    .filter((tile) => tile.y === at.y && away(tile) >= 3 && away(tile) <= 5)
    .filter((tile) => !taken.has(`${tile.x},${tile.y}`))
    .sort((a, b) => away(a) - away(b))
    .find((tile) => stepsTo(partner.seen, tile) !== Infinity);
  if (spot === undefined) {
    skip('partner', `no bare floor three to five tiles beside ${player.name} in its row`);
    return;
  }
  if (!(await standOn(partner, spot))) {
    throw new Error(`${partner.name} found no way to ${spot.x},${spot.y} ${where}`);
  }
  await partnerSide(player, partner, where);
  if (back !== null && !(await standOn(partner, back))) {
    throw new Error(`${partner.name} found no way back to ${back.x},${back.y}`);
  }
}

/**
 * The radio's chain rendered once offline in the page, white noise in: its
 * band-pass has to show in the spectrum — the power above 4 kHz at least 10 dB
 * under the power from 300 Hz to 3.4 kHz, and 15 dB further down against it
 * than in the noise that went in. Fails otherwise.
 */
async function checkRadioBand(page) {
  const render = await page.evaluate(() => globalThis.__escapelab?.audio?.renderRadio() ?? null);
  if (render === null) {
    fail('radio band: the page has no audio probe to render the chain with');
    return;
  }
  const bands = [
    [300, 3400],
    [4000, render.rate / 2],
  ];
  const [inBand, inAbove] = bandPowers(render.input, render.rate, bands);
  const [outBand, outAbove] = bandPowers(render.output, render.rate, bands);
  const before = decibels(inAbove, inBand);
  const after = decibels(outAbove, outBand);
  const passes = after <= -10 && before - after >= 15;
  console.log(
    `radio band         above 4 kHz against 300–3400 Hz: ${before.toFixed(1)} dB in the noise, ` +
      `${after.toFixed(1)} dB out of the chain${passes ? '' : ' !! no band-pass'}`,
  );
  if (!passes) {
    fail(`radio band: ${after.toFixed(1)} dB above 4 kHz out, ${before.toFixed(1)} dB in`);
  }
}

/**
 * In the escape the music's pressure is 0.8 or more, its pressure layer up
 * and the siren has taken the pad away: waits up to 4 s for the crossfade.
 * Fails otherwise.
 */
async function escapeMusic(player) {
  let music = null;
  const pressed = () =>
    music !== null && music.level >= 0.8 && music.pressure >= 0.8 && music.calm <= 0.05;
  for (const end = Date.now() + 4000; ; await sleep(100)) {
    music = (await soundOf(player.page))?.music ?? null;
    if (pressed() || Date.now() >= end) {
      break;
    }
  }
  const level = music?.level.toFixed(2) ?? '!! none';
  console.log(
    `music              ${player.name} in the escape: pressure ${level}, layers calm ` +
      `${music?.calm.toFixed(2)}, pressure ${music?.pressure.toFixed(2)}, last ` +
      `${music?.last.toFixed(2)}${pressed() ? '' : ' !! not under pressure'}`,
  );
  if (!pressed()) {
    fail(`music in the escape: pressure ${music?.level}, layers ${JSON.stringify(music)}`);
  }
}

/**
 * blackout.png: two seconds after the clock has started counting on the
 * host's page — the flashlight on, the emergency lamps red in the dark.
 */
async function captureBlackout(host) {
  const clock = host.page.locator('.stage-clock .countdown');
  if (!(await attached(clock, 8000))) {
    throw new Error('the lights went out, but no clock ever counted');
  }
  await sleep(2000);
  const back = await lightPair(host.page, 'light-gl.png');
  await capture(host.page, 'blackout.png');
  await back();
  const { lights, startedAt, map } = host.seen.view;
  console.log(
    `blackout.png       ${host.name}: the lights went out ` +
      `${seconds(lights.outAt - startedAt)} into the run, clock "${await textOf(clock)}", ` +
      `${map.lamps.length} emergency lamp(s) on the map`,
  );
}

/**
 * Lets `walker` through a plate door to `target`: `holder` stands on the
 * nearest plate it reaches that opens the way. False when none does.
 */
async function letThrough(walker, holder, target) {
  const plates = holder.seen.view.map.plates
    .filter((plate) => !plate.freezesDrone && stepsTo(holder.seen, plate) !== Infinity)
    .sort((one, other) => stepsTo(holder.seen, one) - stepsTo(holder.seen, other));
  for (const plate of plates) {
    await holdPlate(holder, plate);
    if (await until(() => stepsTo(walker.seen, target) !== Infinity, 3000)) {
      console.log(
        `plate              ${holder.name} holds "${plate.label}" at ${plate.x},${plate.y}, ` +
          `${walker.name} walks out`,
      );
      return walkNear(walker.page, walker.seen, target);
    }
  }
  return false;
}

/**
 * Tiles beside `station` for `count` players to stand on, one each: floor
 * within reach of it, neither a plate, another station nor furniture,
 * nearest first.
 */
function spotsBy(station, map, count) {
  const taken = new Set([
    ...map.plates.map((p) => `${p.x},${p.y}`),
    ...map.stations.map((s) => `${s.x},${s.y}`),
    ...furniture(map),
  ]);
  const spots = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const spot = { x: station.x + dx, y: station.y + dy };
      if (map.tiles[spot.y]?.[spot.x] === '.' && !taken.has(`${spot.x},${spot.y}`)) {
        spots.push(spot);
      }
    }
  }
  const away = (spot) => Math.hypot(spot.x - station.x, spot.y - station.y);
  return spots.sort((a, b) => away(a) - away(b) || a.x - b.x).slice(0, count);
}

/**
 * Brings the whole crew to `station`: whoever cannot reach it is let through
 * a plate door by somebody who can, then each stands on a spot of its own
 * beside it, so that whoever held a plate steps off it and its door shuts,
 * as the steps after expect. Throws where somebody cannot get there.
 */
async function gatherAt(station, players) {
  const free = players.filter((player) => stepsTo(player.seen, station) !== Infinity);
  if (free.length === 0) {
    throw new Error(`nobody reaches the station at ${station.x},${station.y}`);
  }
  for (const walker of players.filter((player) => !free.includes(player))) {
    if (!(await letThrough(walker, free[0], station))) {
      throw new Error(`${walker.name} found no way to the station at ${station.x},${station.y}`);
    }
  }
  const spots = spotsBy(station, players[0].seen.view.map, players.length);
  for (const [i, player] of players.entries()) {
    const spot = spots[i] ?? station;
    const there =
      (await walkNear(player.page, player.seen, spot)) &&
      (await stepTo(player.page, player.seen, spot.x + 0.5, spot.y + 0.5));
    if (!there) {
      throw new Error(`${player.name} got stuck on the way to ${spot.x},${spot.y} by the station`);
    }
  }
}

/**
 * lever.png, lit-flur.png: the whole crew at the main switch the first
 * station is (gatherAt). E opens its panel on both pages, a lever lit for
 * each of them; both throw theirs together, the panel closes itself and the
 * room the station lights comes up warm. Logs how long the lever took from
 * the lights going out.
 */
async function throwLever(players) {
  const [first] = players;
  const lever = first.seen.view.map.stations.find((s) => s.status === 'armed');
  if (lever === undefined || lever.look !== 'lever') {
    skip('lever.png', 'the first station is no main switch');
    return;
  }
  await gatherAt(lever, players);
  for (const player of players) {
    if (!(await interactUntil(player.page, player.page.locator('.station-modal')))) {
      throw new Error(`${player.name} stands at the lever, but no .station-modal after 3 tries`);
    }
  }
  await sleep(500); // past the panel's fade-in
  await captureLeverPanel(first, players.length);
  await captureLeverRing(first);
  const solved = await pressTogether(players, lever);
  await captureLitFlur(first, lever);
  await bedAlive(first, solved.lit, 'after the lever');
  await checkRadioVoice(first, solved.listening, 'the lever');
  await partnerAcross(first, players[1], 'across the corridor');
}

/**
 * lever.png: the main switch's panel, the lamp over every lever burning with
 * the whole crew at the station, the names under the levers.
 */
async function captureLeverPanel(player, crew) {
  const here = await player.page.locator('.station-modal .lever-unit--here').count();
  const plate = await textOf(player.page.locator('.station-modal .lever-plate'));
  const names = await player.page.locator('.station-modal .lever-name').allInnerTexts();
  await capture(player.page, 'lever.png');
  console.log(
    `lever.png          ${player.name}: "${plate}", ${here} of ${crew} lamps lit, ` +
      `names ${names.join(', ') || '!! none'}`,
  );
  if (here !== crew || names[0] !== 'DU') {
    fail(`lever.png: ${here} of ${crew} lamps lit, names ${names.join(', ')}`);
  }
}

/**
 * lever-ring.png: the host throws its lever alone, and the shot catches the
 * ring round its grip draining while the press counts; then its window
 * shuts: the lever has to spring back up and the device say so. A main
 * switch without a window has nothing to drain — every press counts
 * whenever it comes — and is skipped.
 */
async function captureLeverRing(player) {
  if (player.seen.view.puzzle?.windowMs == null) {
    skip('lever-ring.png', 'this main switch has no window: a press never runs out');
    return;
  }
  const modal = player.page.locator('.station-modal');
  await modal.locator('button.lever-grip').click();
  if (!(await until(() => player.seen.view.puzzle?.press?.expiresAt != null, 3000))) {
    fail(`lever-ring.png: ${player.name} threw the lever, but the view gives no press running out`);
    return;
  }
  const { at, expiresAt } = player.seen.view.puzzle.press;
  await sleep(Math.max(0, at + 600 - Date.now())); // the ring a third drained
  const ring = await modal.locator('.lever-ring').count();
  await capture(player.page, 'lever-ring.png');
  await sleep(Math.max(0, expiresAt + 400 - Date.now()));
  const down = await modal.locator('.lever-unit').first().getAttribute('class');
  const says = await textOf(modal.locator('.warn'));
  const sprang = !(down ?? '').includes('lever-unit--down');
  console.log(
    `lever-ring.png     ${player.name} alone: ring ${ring > 0 ? 'draining' : '!! missing'} over ` +
      `${seconds(expiresAt - at)}; then ${sprang ? 'sprang back' : '!! stayed down'}, ` +
      `"${says ?? '!! no word of it'}"`,
  );
  if (ring === 0 || !sprang || says?.includes('Zug verfallen') !== true) {
    fail(`lever-ring.png: ring ${ring}, sprang back ${sprang}, says "${says}"`);
  }
}

/** lit-flur.png: the panel closed itself, the room the lever lit is up. */
async function captureLitFlur(player, lever) {
  const closed = await player.page
    .locator('.station-modal')
    .waitFor({ state: 'hidden', timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(1200); // past the lights coming up
  const back = await lightPair(player.page, 'light-gl-flur.png');
  await capture(player.page, 'lit-flur.png');
  await back();
  const { events, lights, map } = player.seen.view;
  const solved = events.find((e) => e.kind === 'puzzle' && e.label.startsWith(lever.title));
  const took = solved === undefined ? '!! no solve logged' : seconds(solved.at - lights.outAt);
  console.log(
    `lit-flur.png       ${player.name}: ${map.litRooms.join(', ')} lit, the panel ` +
      `${closed ? 'closed itself' : '!! stayed open'}; the lever took ${took} from the blackout`,
  );
  if (!closed) {
    fail('the lever\'s panel did not close itself after the levers dropped');
  }
}

/** The fuse lying loose for figure-carry.png, or any part lying loose where there is none. */
function looseItem(map) {
  const loose = map.items.filter((item) => item.carriedBy === null && !item.delivered);
  return loose.find((item) => /sicherung/i.test(item.label)) ?? loose[0];
}

/**
 * figure-carry.png: after the lever the host walks to the fuse lying in the
 * Archiv — any part lying loose, where a map has no fuse — picks it up with
 * E and is shot at 1440×1000 holding it before the chest. Then it puts it
 * down with Q and walks back to where it stood, so that the walkthrough
 * goes on with free hands. Skipped where nothing lies loose or no way leads
 * to it; fails where E picks nothing up or Q puts nothing down.
 */
async function captureCarry(player) {
  const item = looseItem(player.seen.view.map);
  if (item === undefined) {
    skip('figure-carry.png', 'nothing lies loose to carry on this map');
    return;
  }
  const home = tileOf(player.seen);
  const spot = { x: Math.floor(item.x), y: Math.floor(item.y) };
  if (home === null || !(await standOn(player, spot))) {
    skip('figure-carry.png', `no open way to "${item.label}" at ${spot.x},${spot.y}`);
    return;
  }
  const you = player.seen.view.you.id;
  const held = () =>
    player.seen.view.map.items.some((one) => one.id === item.id && one.carriedBy === you);
  for (let i = 0; i < 3 && !held(); i++) {
    await player.page.keyboard.press('e');
    await until(held, 1500);
  }
  if (!held()) {
    fail(`figure-carry.png: ${player.name} stood on "${item.label}", but E picked nothing up`);
    return;
  }
  await player.page.setViewportSize(COLD_OPEN);
  await sleep(600);
  await capture(player.page, 'figure-carry.png');
  await player.page.keyboard.press('q');
  const down = await until(() => !held(), 3000);
  console.log(
    `figure-carry.png   ${player.name} @ ${COLD_OPEN.width}x${COLD_OPEN.height} holds ` +
      `"${item.label}", picked up at ${spot.x},${spot.y}; ` +
      (down ? 'put down again with Q' : '!! Q put nothing down'),
  );
  if (!down) {
    fail(`figure-carry.png: ${player.name} pressed Q, but still carries "${item.label}"`);
  }
  await player.page.setViewportSize(SIZES[0]);
  await sleep(300);
  if (!(await standOn(player, home))) {
    throw new Error(`${player.name} found no way back to ${home.x},${home.y} from "${item.label}"`);
  }
}

/**
 * sign.png for a player spawned within sight of the Laborkennung: its note
 * is up at once. Returns that player, if any.
 */
async function signAtSpawn(players) {
  const atSign = players.find((p) => p.seen.view.presence.signSeen);
  if (atSign !== undefined) {
    await captureSign(atSign.page, atSign.name);
  }
  return atSign;
}

/**
 * A mission's intro, the power on, then the lights failing: cold-open.png,
 * sign.png for a player spawned at the Laborkennung (signAtSpawn),
 * blackout.png, and the lever the first station is (lever.png,
 * lit-flur.png). Returns the player sign.png caught, if any.
 */
async function coldOpen(host, guest) {
  await captureColdOpen(host, guest);
  const atSign = await signAtSpawn([host, guest]);
  await captureBlackout(host);
  await bedDead(host, 'after the blackout');
  await partnerSide(host, guest, 'after the blackout');
  await throwLever([host, guest]);
  return atSign;
}

/**
 * The run's first moments. A mission with an intro opens with the power on:
 * the cold open comes first, the lever with it. Then Anna carries what lies
 * loose for a moment (figure-carry.png), the draw — who works the first
 * station, who reads — and, without an intro, sign.png for a player spawned
 * at the Laborkennung, whose note is up as soon as the briefing is gone.
 * Returns both and the player sign.png caught, if any.
 */
async function firstMoments(anna, ben) {
  const intro = anna.seen.view.lights.out === false;
  const signedEarly = intro ? await coldOpen(anna, ben) : undefined;
  await captureCarry(anna);
  const [operator, reader] = operatorFirst([anna, ben]);
  console.log(`the draw:          ${operator.name} works the first station, ${reader.name} reads`);
  const atSign = intro ? signedEarly : await signAtSpawn([reader, operator]);
  return { operator, reader, atSign };
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
    skip(
      'console-*.png',
      armed.length === 0 ? 'no station is armed' : `"${armed[0].title}" has one console`,
    );
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
    await capture(player.page, `console-${spot.console}.png`);
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
  // The world under an open panel is the game's own cost: it keeps the budget too.
  const watched = crew.find((player) => player.traced);
  if (watched !== undefined) {
    await sleep(300); // past the resize
    await sampleFrames(watched.page, `idle at the open "${title}" panel`, () => sleep(SAMPLE_MS));
    panelSampled = true;
  }
  if (kind === 'signal') {
    await solveSignal(crew, title);
  } else if (kind === 'circuit') {
    await measureEveryWire(reader, title);
  } else {
    console.log(`consoles           "${title}" is a ${kind} panel: captured, left open`);
  }
}

/** The angle the meter's needle stands at on the page right now, transition and all, in °. */
function needleOnPage(page) {
  return page.evaluate(() => {
    const needle = document.querySelector('.station-modal .gauge-needle');
    const turn = needle === null ? 'none' : document.defaultView.getComputedStyle(needle).transform;
    // matrix(cos, sin, −sin, cos, x, y): the angle is atan2(sin, cos).
    const [a = 1, b = 0] = (turn.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    return Math.round((Math.atan2(b, a) * 180 * 10) / Math.PI) / 10;
  });
}

/** The needle's angle for a reading, as CircuitPanel's needleAngle: −90° at 0 V, +90° at 250 V. */
const needleFor = (volts) => -90 + (Math.min(250, Math.max(0, volts)) / 250) * 180;

/** Wire `i`'s reading on the meter's socket as soon as it comes in, every 5 ms; null by `end`. */
async function readingIn(meter, i, end) {
  const reading = () => meter.seen.view.puzzle?.readings?.[i] ?? null;
  while (reading() === null && Date.now() < end) {
    await sleep(5);
  }
  return reading();
}

/**
 * The needle's angle once it has come a third of its way from `from` to
 * `target`, or where it stands at `end` (epoch ms), whichever is first.
 */
async function swungAThird(page, from, target, end) {
  let at = await needleOnPage(page);
  while ((at - from) / (target - from) < 1 / 3 && Date.now() < end) {
    await sleep(8);
    at = await needleOnPage(page);
  }
  return at;
}

/** How soon after its probe meter-swing.png is shot, at the latest, in ms. */
const SWING_MS = 250;
/** How far a reading has to move the needle for meter-swing.png to show it, in °. */
const SWING_DEG = 35;
/** What the screenshot itself takes, kept free of SWING_MS, in ms. */
const SHOT_MS = 90;

/**
 * meter-swing.png: the wire just probed (`i`, its key pressed at `pressed`,
 * the needle standing at `from`) comes in, and where its reading swings the
 * needle SWING_DEG or more, the meter is shot as soon as the needle has come
 * a third of its way — within SWING_MS of the probe, the needle still on its
 * way to the reading or swinging past it. True once shot; false where the
 * reading moves the needle less, for the next probe to try.
 */
async function captureSwing(meter, i, pressed, from) {
  const volts = await readingIn(meter, i, pressed + 3000);
  const target = volts === null ? from : needleFor(volts);
  if (Math.abs(target - from) < SWING_DEG) {
    return false;
  }
  const at = await swungAThird(meter.page, from, target, pressed + SWING_MS - SHOT_MS);
  const ms = Date.now() - pressed;
  await capture(meter.page, 'meter-swing.png');
  const after = await needleOnPage(meter.page);
  const swinging = Math.abs(at - target) > 1 && Math.abs(at - from) > 1;
  console.log(
    `meter-swing.png    ${meter.name} probed wire ${i + 1}: ${volts} V; shot ${ms} ms after ` +
      `the probe, the needle at ${at}° on its way from ${from}° to ${target.toFixed(1)}° ` +
      `(${after}° once shot)` +
      (swinging ? '' : ' — !! not swinging'),
  );
  if (ms > SWING_MS || !swinging) {
    fail(`meter-swing.png: ${ms} ms after the probe, needle at ${at}° for ${target}°`);
  }
  return true;
}

/**
 * At a fuse box's meter: every probe key pressed once, its wire's reading
 * in the meter's view before the next key — the first reading that moves
 * the needle shot mid-swing (captureSwing). Nothing is cut. Throws at the
 * key whose reading stays empty.
 */
async function measureEveryWire(meter, title) {
  const count = meter.seen.view.puzzle?.count ?? 0;
  const keys = await meter.page.locator('.station-modal .circuit-probe[data-index]').count();
  if (count === 0 || keys !== count) {
    throw new Error(`"${title}": the meter shows ${keys} probe keys for ${count} wires`);
  }
  let swung = false;
  for (let i = 0; i < count; i++) {
    swung = (await probeWire(meter, title, i, swung)) || swung;
  }
  reportMeasured(meter, count, swung);
}

/** The meter's round in the log: every reading taken, and whether one was shot mid-swing. */
function reportMeasured(meter, count, swung) {
  const readings = meter.seen.view.puzzle?.readings ?? [];
  const volts = readings.map((reading) => `${reading} V`).join(', ');
  console.log(
    `circuit            ${meter.name} at ${seatOf(meter)} measured all ${count} wires: ` +
      `${volts}; nothing cut`,
  );
  if (!swung) {
    skip('meter-swing.png', 'no reading moved the needle far enough to see it swing');
  }
}

/**
 * Presses wire `i`'s probe key at the meter and waits for its reading; until
 * one has been shot mid-swing (`swung`), tries meter-swing.png on this one.
 * Returns whether this one was shot. Throws where the reading stays empty.
 */
async function probeWire(meter, title, i, swung) {
  const key = meter.page.locator(`.station-modal .circuit-probe[data-index="${i}"]`);
  const from = swung ? 0 : await needleOnPage(meter.page);
  const pressed = Date.now();
  await key.click({ timeout: 3000 });
  const shot = !swung && (await captureSwing(meter, i, pressed, from));
  if (!(await until(() => meter.seen.view.puzzle?.readings?.[i] != null, 3000))) {
    throw new Error(
      `${meter.name} measured wire ${i + 1} of "${title}", but its reading stayed empty`,
    );
  }
  await sleep(150);
  return shot;
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
    skip(
      'console-*.png',
      `nobody reaches console A of "${consoleA.title}", ` +
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
    // The run's one deliberate alarm: where the traced host sends, or at the last stage.
    if (!flinchShot && (sending.traced === true || stage === stages)) {
      await captureFlinch(sending, pressing);
    }
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

/** How soon after the wrong press figure-flinch.png has to be shot, ms: mid-flinch. */
const FLINCH_SHOT_MS = 150;
/** Whether figure-flinch.png was taken: a run meets one Signalkette at most for it. */
let flinchShot = false;

/** The token of a key on `presser`'s panel the sequence `sender` sends does not start with. */
async function wrongKey(sender, presser) {
  const first = sender.seen.view.puzzle?.sequence?.[0];
  const tokens = await presser.page
    .locator('.station-modal .signal-key[data-token]')
    .evaluateAll((keys) => keys.map((key) => key.getAttribute('data-token')));
  const wrong = tokens.find((token) => token !== first);
  if (wrong === undefined) {
    throw new Error(`${presser.name}'s Signalkette panel has no key but "${first}" to get wrong`);
  }
  return wrong;
}

/**
 * figure-flinch.png: a deliberate wrong sign at the Signalkette, the one
 * alarm the run spends on it. The sender closes its panel and its window
 * grows to 1440×1000, so that its world shows both figures; the presser
 * clicks a key the sequence does not start with, and the sender's page is
 * shot the moment the alarm comes in — within FLINCH_SHOT_MS of the press,
 * the crew mid-flinch. Then the window shrinks back and the sender opens its
 * panel again for the stage. Fails where no alarm comes in or the shot comes
 * too late; throws where the panel does not open again.
 */
async function captureFlinch(sender, presser) {
  flinchShot = true;
  const modal = sender.page.locator('.station-modal');
  await sender.page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden', timeout: 3000 });
  const size = sender.page.viewportSize();
  await sender.page.setViewportSize(COLD_OPEN);
  await sleep(700); // the layout settles, the panel past its fade-out
  const wrong = await wrongKey(sender, presser);
  const count = sender.seen.view.alarms.count;
  const pressed = Date.now();
  await presser.page.locator(`.station-modal .signal-key[data-token="${wrong}"]`).click();
  const clicked = Date.now() - pressed;
  while (sender.seen.view.alarms.count === count && Date.now() - pressed < 2000) {
    await sleep(5);
  }
  const came = sender.seen.view.alarms.count > count ? Date.now() - pressed : null;
  const shot = Date.now() - pressed;
  await capture(sender.page, 'figure-flinch.png');
  console.log(
    `figure-flinch.png  ${presser.name} pressed "${wrong}" (${clicked} ms), the alarm ` +
      (came === null ? '!! never came in' : `in ${came} ms`) +
      `; ${sender.name}'s world @ ${COLD_OPEN.width}x${COLD_OPEN.height} shot ${shot} ms ` +
      `after the press${shot > FLINCH_SHOT_MS ? ` — !! later than ${FLINCH_SHOT_MS} ms` : ''}`,
  );
  if (came === null || shot > FLINCH_SHOT_MS) {
    const alarm = came === null ? 'missing' : `in ${came} ms`;
    fail(`figure-flinch.png: the alarm ${alarm}, the shot ${shot} ms after the press`);
  }
  if (size !== null) {
    await sender.page.setViewportSize(size);
  }
  await sleep(300);
  if (!(await interactUntil(sender.page, modal))) {
    throw new Error(
      `${sender.name} closed the Signalkette for figure-flinch.png, but it did not open again`,
    );
  }
  await sleep(300); // past the panel's fade-in
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
  await capture(page, 'notepad.png');
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
  await capture(page, 'hint-waiting.png');
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
  await capture(page, 'hint-ready.png');
  console.log(`hint-ready.png     ${who}: "${label}"`);

  await ask.click();
  await overlay.locator('.margin-note').first().waitFor({ timeout: 5000 });
  await sleep(600);
  await capture(page, 'hint-revealed.png');
  const notes = await overlay.locator('.margin-note').count();
  const next = (await textOf(ask)) ?? 'none';
  console.log(`hint-revealed.png  ${who}: ${notes} note(s) in the margin, next button "${next}"`);
  await capture(other, 'radio-banner.png');
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
    skip('hint-*.png', 'no source on the open station in reach of either');
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
  await capture(page, 'sign.png');
  const chip = (await page.locator('.hud .edgework').count()) > 0;
  console.log(
    `sign.png           ${who}: note ${note ? 'up' : '!! missing'}, ` +
      `chip in the HUD ${chip ? 'shown' : '!! missing'}`,
  );
}

/**
 * Turns `player`'s page to `size` and back, and fails the run unless the
 * HUD's Info button lies whole inside the window there: once the sign is
 * read, the Laborkennung's chip may never push it off the screen. Logs
 * whether the chip was up on that page, so a check without it says so.
 */
async function infoInView(player, size, how) {
  const { page, name } = player;
  const before = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height });
  await sleep(700);
  const box = await page.locator('.hud button', { hasText: 'Info' }).boundingBox();
  const chip = (await page.locator('.hud .edgework').count()) > 0;
  const inside =
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= size.width + 0.5 &&
    box.y + box.height <= size.height + 0.5;
  const edge = box === null ? 'no Info button' : `right edge ${Math.round(box.x + box.width)}`;
  const where = `${name} @ ${size.width}x${size.height} ${how}, chip ${chip ? 'up' : 'not read'}`;
  console.log(
    `${inside ? 'ok  in view' : '!! cut off '} info button, ${where}: ${edge}/${size.width}`,
  );
  if (!inside) {
    fail(`the Info button is cut off @ ${size.width}x${size.height} for ${name} (${edge})`);
  }
  await page.setViewportSize(before);
  await sleep(400);
}

/**
 * After the sign step: the Info button on the guest's phone held sideways —
 * and where the host read the sign, in the host's window at the same size,
 * so that the chip is checked at that width in every mission.
 */
async function infoAfterSign(reader, guest) {
  const turned = SIZES[3];
  await infoInView(guest, turned, '(phone sideways)');
  if (reader !== undefined && reader.page !== guest.page) {
    await infoInView(reader, turned, '(window, no touch)');
  }
}

/**
 * lobby-landscape.png: the host's lobby on a phone held sideways, scrolled
 * to the mission panel's top, so that its strip of mission cards stands
 * clear of the start bar at the window's foot. The lobby may scroll down
 * there, but nothing may run out sideways: the strip scrolls in its own box.
 */
async function captureLobbySideways(page) {
  const { width, height } = SIZES[3];
  await page.setViewportSize({ width, height });
  await sleep(400);
  const shown = (await page.locator('.lobby-missions').count()) > 0;
  await page.locator('.lobby-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await capture(page, 'lobby-landscape.png');
  const over = await sideways(page, '.content');
  const cards = await page.locator('.lobby-mission').count();
  console.log(
    `lobby-landscape.png Anna's lobby @ ${width}x${height}: ` +
      (shown ? `${cards} mission cards, ` : '!! no mission strip, ') +
      (over > 0 ? `!! +${over}px sideways` : 'fits sideways'),
  );
}

/**
 * The crew figures a traced page paints in its lobby or on its title card
 * (client screens/CrewFigure.tsx, `window.__escapelab.figures`), each with
 * its last pose: colour, mood, how far off the ground (`rise`, tiles) and
 * how far a glance has turned its look (`glance`, radians); null without the
 * probe.
 */
function figuresOn(page) {
  return page.evaluate(() => globalThis.__escapelab?.figures ?? null);
}

/**
 * Polls the figures `page` paints every 20 ms until `pick` takes one, or
 * until `ms` have passed: that figure, or null.
 */
async function figureWhen(page, pick, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const found = ((await figuresOn(page)) ?? []).find(pick);
    if (found !== undefined || Date.now() >= end) {
      return found ?? null;
    }
    await sleep(20);
  }
}

/** A figure counts as mid look-around turned this far from its way, radians (it turns 1.1). */
const GLANCE_SHOWN = 0.9;
/** How long the lobby gets for one of its figures to look round: each does every 4 to 7 s. */
const GLANCE_WAIT_MS = 15_000;

/**
 * lobby-idle.png: the host's lobby at 1440×1000, shot while a figure of the
 * crew stands turned in a glance round the room — the figures' probe says
 * when. Fails where no figure looks round within GLANCE_WAIT_MS.
 */
async function captureLobbyIdle(page) {
  await page.setViewportSize(COLD_OPEN);
  await sleep(400);
  const glancing = (figure) => figure.mood === 'play' && Math.abs(figure.glance) >= GLANCE_SHOWN;
  const turned = await figureWhen(page, glancing, GLANCE_WAIT_MS);
  await capture(page, 'lobby-idle.png');
  const shot = (await figuresOn(page)) ?? [];
  console.log(
    `lobby-idle.png     Anna's lobby @ ${COLD_OPEN.width}x${COLD_OPEN.height}: ` +
      (turned === null
        ? `!! no figure looked round within ${seconds(GLANCE_WAIT_MS)}`
        : `${turned.color} turned ${turned.glance.toFixed(2)} rad in a glance`) +
      `; at the shot ${shot.length} figures, glances ` +
      (shot.map((figure) => figure.glance.toFixed(2)).join(', ') || 'none'),
  );
  if (turned === null) {
    fail(`lobby-idle.png: no lobby figure looked round within ${seconds(GLANCE_WAIT_MS)}`);
  }
  await page.setViewportSize(SIZES[0]);
  await sleep(300);
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
  if (locker === undefined) {
    const where = lockers.map((l) => `${l.x},${l.y}`).join(' · ');
    skip(
      'locker.png',
      lockers.length === 0
        ? 'no closed locker on this map'
        : `no locker in the guest's reach (${where})`,
    );
    return;
  }
  if (!(await walkNear(page, seen, locker))) {
    skip(
      'locker.png',
      `the guest's walk to the locker at ${locker.x},${locker.y} broke off (stuck, or a door shut)`,
    );
    return;
  }
  const here = await until(() => seen.view.sourcesHere.some((s) => s.id === locker.id), 3000);
  await sleep(400); // the prompt is drawn from the next frame on
  await capture(page, 'locker.png');
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
    skip('lit-room.png', 'litRooms is empty — no station solved in this run');
    return;
  }
  await page.keyboard.press('Escape');
  const label = map.labels.find((l) => l.text === room);
  const inside = label !== undefined && (await walkNear(page, seen, label));
  await sleep(1200); // past the lights coming up
  await capture(page, 'lit-room.png');
  console.log(
    `lit-room.png       guest: ${map.litRooms.join(', ')} lit, ` +
      (inside ? `guest inside ${room}` : `!! guest outside ${room}, no way in`),
  );
}

/** A page's voice as `?trace=1` shows it (window.__escapelab.voice); null without one. */
function voiceOf(page) {
  return page.evaluate(() => globalThis.__escapelab?.voice ?? null);
}

/** Every page's link states, for a log line: „Anna connected, Ben connecting". */
async function linkStates(pages) {
  const voices = await Promise.all(pages.map(({ page }) => voiceOf(page)));
  return pages
    .map(({ name }, i) => {
      const states = Object.values(voices[i]?.states ?? {});
      return `${name} ${states.length === 0 ? 'no link' : states.join('/')}`;
    })
    .join(', ');
}

/** Polls until every page has a voice link and all of them are connected; whether they came up. */
async function linksUp(pages) {
  const up = async ({ page }) => {
    const states = Object.values((await voiceOf(page))?.states ?? {});
    return states.length > 0 && states.every((state) => state === 'connected');
  };
  const end = Date.now() + LINK_MS;
  for (;;) {
    const all = (await Promise.all(pages.map(up))).every(Boolean);
    if (all || Date.now() > end) {
      return all;
    }
    await sleep(250);
  }
}

/** Seconds, one decimal, for a log line: „1.3 s". */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * In the lobby both players switch their microphone on as a player would:
 * the button, then „Mikro an". The launch flags make it a fake one, handed
 * out without a prompt; the contexts are allowed to use it. Each page's voice
 * has MIC_MS to say `on`. The log gives how long each took from the click,
 * and how much of that the browser spent handing the microphone out.
 */
async function micsOn(players) {
  const origin = new URL(BASE).origin;
  const asked = [];
  for (const { page } of players) {
    await page.context().grantPermissions(['microphone'], { origin });
    asked.push(Date.now());
    await clickText(page, 'Mikrofon aktivieren');
  }
  const settled = (voice) => voice !== null && voice.mic !== 'off' && voice.mic !== 'asking';
  const outcomes = await Promise.all(
    players.map(async ({ page }, i) => {
      let voice = await voiceOf(page);
      while (!settled(voice) && Date.now() - asked[i] < MIC_MS) {
        await sleep(100);
        voice = await voiceOf(page);
      }
      const shown = voice?.mic === 'on' && (await page.locator('.voice-on').count()) > 0;
      return { voice, ms: Date.now() - asked[i], shown };
    }),
  );
  const lines = players.map(({ name }, i) => {
    const { voice, ms, shown } = outcomes[i];
    const wait = voice?.micWaitMs;
    const browser = wait == null ? '' : `, ${seconds(wait)} of it in the browser`;
    if (voice?.mic !== 'on') {
      return `!! ${name} ${voice?.mic ?? 'has no voice probe'} after ${seconds(ms)}${browser}`;
    }
    return `${name} on after ${seconds(ms)}${browser}` + (shown ? '' : ', !! no „Mikro an" shown');
  });
  console.log(`voice              microphones in the lobby: ${lines.join('; ')}`);
  const off = players.filter((_, i) => !outcomes[i].shown);
  if (off.length > 0) {
    const who = off.map(({ name }) => name).join(' and ');
    fail(`no microphone in the lobby for ${who} within ${seconds(MIC_MS)}`);
  }
}

/**
 * The guest says it is ready, and the host starts once its own page has the
 * guest ready and its start button enabled; the run then has START_MS to
 * show on both pages. A start the server did not take is pressed once more,
 * logged with what the host's page said. Throws, with what both pages show,
 * when the run does not come up.
 */
async function startRun(host, guest) {
  const from = Date.now();
  const readyOnHost = () =>
    host.seen.view?.players?.some((p) => p.name === guest.name && p.ready && p.connected) === true;
  const started = () => host.seen.view?.phase === 'playing';
  for (let attempt = 1; attempt <= 2 && !started(); attempt++) {
    if (guest.seen.view?.you?.ready !== true) {
      await clickText(guest.page, 'Ich bin bereit');
    }
    if (!(await until(readyOnHost, 5000))) {
      console.log(`start              !! ${host.name}'s page has no ready ${guest.name} after 5 s`);
      continue;
    }
    // The start reads „Mission starten" only once nothing blocks it.
    const start = host.page.locator('button.lobby-start:enabled', { hasText: 'Mission starten' });
    await start.waitFor({ state: 'visible', timeout: 10_000 });
    await start.click();
    if (!(await until(started, 5000))) {
      const banner = await textOf(host.page.locator('.banner.error'));
      console.log(
        `start              !! press ${attempt} did not start the run` +
          (banner === null ? '' : `: "${banner}"`),
      );
    }
  }
  const up = await Promise.all(
    [host, guest].map(({ page }) =>
      page.locator('.stage').waitFor({ timeout: START_MS }).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (!up.every(Boolean)) {
    const shows = await Promise.all(
      [host, guest].map(async ({ name, page, seen }) => {
        const banner = await textOf(page.locator('.banner.error'));
        return `${name} ${seen.view?.phase ?? 'without a view'}` + (banner ? `, "${banner}"` : '');
      }),
    );
    throw new Error(`the run did not come up within ${seconds(START_MS)}: ${shows.join('; ')}`);
  }
  console.log(
    `start              ${guest.name} ready, the run up on both pages ` +
      `${seconds(Date.now() - from)} after the ready press`,
  );
}

/**
 * voice.png, voice-phone.png: in the run the link between the two comes up
 * on both ends, and while the host holds V for TALK_MS the speaking mark
 * shows beside the host's name — on its own page from its own level, on the
 * guest's from the sound that came over the link. Captured mid-hold.
 */
async function captureVoice(host, guest) {
  const crew = [host, guest];
  if (!(await linksUp(crew))) {
    const states = await linkStates(crew);
    console.log(`voice              !! no link after ${LINK_MS / 1000} s: ${states}`);
    fail('the voice link did not connect');
    return;
  }
  console.log(`voice              linked: ${await linkStates(crew)}`);
  const marked = async ({ page }) => {
    const row = page.locator('.hud-crew li', { hasText: host.name });
    return (await row.locator('.voice-speaking').count()) > 0;
  };
  const seen = crew.map(() => false);
  let shot = false;
  await host.page.keyboard.down('v');
  for (const end = Date.now() + TALK_MS; Date.now() < end; ) {
    const marks = await Promise.all(crew.map(marked));
    marks.forEach((mark, i) => {
      seen[i] ||= mark;
    });
    if (!shot && marks.every(Boolean)) {
      await capture(host.page, 'voice.png');
      await capture(guest.page, 'voice-phone.png');
      shot = true;
    }
    await sleep(100);
  }
  if (!shot) {
    await capture(host.page, 'voice.png');
    await capture(guest.page, 'voice-phone.png');
  }
  await host.page.keyboard.up('v');
  const deaf = crew.filter((_, i) => !seen[i]).map(({ name }) => name);
  console.log(
    `voice.png          ${host.name} held V for ${TALK_MS / 1000} s: ` +
      (deaf.length === 0
        ? 'the speaking mark showed on both pages'
        : `!! no speaking mark on ${deaf.join(' and ')}'s page`),
  );
  if (deaf.length > 0) {
    fail(`no speaking mark for ${host.name} on ${deaf.join(' and ')}'s page while V was held`);
  }
  await sleep(600); // the mark goes out before the next captures
}

/** After the guest's reload its link comes up again, and its microphone with it. */
async function voiceAfterReload(host, guest) {
  const crew = [host, guest];
  const up = await linksUp(crew);
  const mic = (await voiceOf(guest.page))?.mic ?? 'no voice';
  console.log(
    `voice              after ${guest.name}'s reload: ` +
      (up ? 'linked again' : `!! ${await linkStates(crew)}`) +
      `, ${guest.name}'s microphone ${mic === 'on' ? 'back on' : `!! ${mic}`}`,
  );
  if (!up) {
    fail(`the voice link did not come up again after ${guest.name}'s reload`);
  }
}

/** The audience listens in: a receive-only link to every player comes up. */
async function listenIn(watcher, players) {
  const audience = [{ name: 'audience', page: watcher }];
  await clickText(watcher, 'Crew mithören');
  const all = await linksUp(audience);
  const links = Object.keys((await voiceOf(watcher))?.states ?? {}).length;
  const heard = all && links === players.length;
  console.log(
    `voice              the audience listens in: ` +
      (heard ? `linked to all ${links} players` : `!! ${await linkStates(audience)}`),
  );
  if (!heard) {
    fail('the audience did not link up to every player');
  }
}

/** Where on the screen tile x,y of the editor's map is, measured afresh: the map refits. */
async function editorTile(page, x, y) {
  const canvas = page.locator('.editor-canvas');
  const box = await canvas.boundingBox();
  const px = Number(await canvas.getAttribute('data-tile-px'));
  if (box === null || !(px > 0)) {
    throw new Error('the editor shows no map (.editor-canvas with data-tile-px)');
  }
  return { x: box.x + (x + 0.5) * px, y: box.y + (y + 0.5) * px };
}

/** Picks an editor tool and presses its map at tile x,y. */
async function placeWith(page, tool, x, y) {
  await page.locator(`[data-tool="${tool}"]`).click();
  const at = await editorTile(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** The editor's error findings, as listed. */
async function editorErrors(page) {
  return page.locator('.editor-check-error .editor-finding').allInnerTexts();
}

/** The first line of what went wrong. */
const firstLine = (err) => String(err instanceof Error ? err.message : err).split('\n')[0];

/**
 * From the join screen into the editor: the new mission called „Probe", so
 * it is saved as custom-probe; a 7 × 5 room painted row by row with the
 * floor brush into its blank lab of wall, a start and the keypad's station.
 */
async function paintProbe(page) {
  await page.goto(paged(BASE));
  await page.locator('.mission').first().waitFor({ timeout: 10_000 });
  await clickText(page, 'Editor');
  await page.locator('.editor-canvas').waitFor({ timeout: 5000 });
  await page.locator('.editor-tab', { hasText: 'Mission' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Probe');
  await page.locator('[data-tool="floor"]').click();
  for (let y = 2; y <= 6; y++) {
    const from = await editorTile(page, 2, y);
    const to = await editorTile(page, 8, y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
  await placeWith(page, 'spawn', 3, 4);
  await placeWith(page, 'station', 7, 3);
}

/** editor.png with what the validator says now; it has to say something. */
async function captureValidator(page) {
  await sleep(700); // past the pause the validator waits for
  const errors = await editorErrors(page);
  await capture(page, 'editor.png');
  const said = errors.length === 0 ? '!! the validator says nothing' : errors.join(' | ');
  console.log(`editor.png         room, start, station: ${errors.length} error(s) — ${said}`);
  if (errors.length === 0) {
    fail('editor: the validator let a mission with one start pass');
  }
}

/** The editor has to fit a laptop and 1280×720, and a phone sideways. */
async function editorLayouts(page) {
  await overflow(page, 'editor @ 1440x820');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(page, 'editor @ 1280x720');
  await capture(page, 'editor-1280.png');
  await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
  await sleep(400);
  const over = await sideways(page, '.content');
  await capture(page, 'editor-phone.png');
  const fits = over > 0 ? `!! +${over}px sideways` : 'scrolls down, fits sideways';
  console.log(`editor-phone.png   the editor @ 420x760 ${fits}`);
  if (over > 0) {
    fail(`editor: +${over}px sideways on a phone`);
  }
  await page.setViewportSize(SIZES[0]);
  await sleep(400);
}

/** A second start and a book make the probe sound; saved, its card has to be on the join screen. */
async function saveProbe(page) {
  await placeWith(page, 'spawn', 4, 4);
  await placeWith(page, 'source', 7, 5);
  const save = page.locator('.editor-actions button.primary:not([disabled])');
  const sound = await save.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!sound) {
    throw new Error(`the probe stays unsound: ${(await editorErrors(page)).join(' | ')}`);
  }
  await save.click();
  await page.locator('.editor-status-ok').waitFor({ timeout: 5000 });
  await clickText(page, 'Zurück');
  await page.locator('.mission', { hasText: 'Probe' }).waitFor({ timeout: 5000 });
  console.log('editor             saved as custom-probe, and its card is on the join screen');
}

/** The mission the editor imports for its test run and its link: „Probe", custom-probe. */
const PROBE_FILE = fileURLToPath(new URL('fixtures/probe-mission.json', import.meta.url));

/**
 * The editor at its own address, the probe mission imported through
 * „Importieren"; a draft left unsaved there is discarded when the editor
 * asks.
 */
async function importProbe(page) {
  await page.goto(paged(new URL('/editor', BASE).href));
  await page.locator('.editor-canvas').waitFor({ timeout: 10_000 });
  await page.locator('.editor-actions input[type="file"]').setInputFiles(PROBE_FILE);
  const imported = page.locator('.editor-status', { hasText: 'importiert' });
  const asked = page.locator('.editor-confirm button', { hasText: 'Verwerfen' });
  await imported.or(asked).first().waitFor({ timeout: 5000 });
  if (await asked.isVisible()) {
    await asked.click();
    await imported.waitFor({ timeout: 5000 });
  }
  await page.locator('.editor-name strong', { hasText: 'Probe' }).waitFor({ timeout: 5000 });
}

/**
 * editor-play.png: „Probespiel" with a name saves the probe and opens a room
 * for it; the lobby has to show the probe, and its top bar the way back.
 */
async function playProbe(page) {
  const play = page.locator('.editor-actions button:not([disabled])', { hasText: 'Probespiel' });
  const sound = await play.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!sound) {
    throw new Error(`the imported probe stays unsound: ${(await editorErrors(page)).join(' | ')}`);
  }
  await play.click();
  await page.locator('.editor-play input').fill('Anna');
  await page.locator('.editor-play button[type="submit"]').click();
  await page.locator('.lobby', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
  const code = (await page.locator('.room-code strong').innerText()).trim();
  await sleep(500);
  await capture(page, 'editor-play.png');
  await overflow(page, 'editor-play @ 1440x820');
  const back = await page.locator('.topbar-editor').isVisible();
  console.log(
    `editor-play.png    Probespiel: room ${code}, the lobby shows „Probe"; ` +
      (back ? '„Zurück zum Editor" in the top bar' : '!! no way back to the editor'),
  );
  if (!back) {
    fail('editor: the test run’s lobby offers no „Zurück zum Editor"');
  }
}

/** „Zurück zum Editor": out of the room, the page reloads on the editor with the probe again. */
async function backToEditor(page) {
  await Promise.all([page.waitForEvent('load'), page.locator('.topbar-editor').click()]);
  await page.locator('.editor-name strong', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
  const path = new URL(page.url()).pathname;
  console.log(`editor             back from the lobby on ${path}, „Probe" open again`);
  if (path !== '/editor') {
    fail(`editor: back from the test run on ${path}, not on /editor`);
  }
}

/** „Teilen": the link off the clipboard, or out of the box the editor marks it in. */
async function sharedLink(page) {
  await clickText(page, 'Teilen');
  const copied = page.locator('.editor-status-ok', { hasText: 'Link kopiert' });
  const box = page.locator('.editor-share input');
  await copied.or(box).first().waitFor({ timeout: 5000 });
  if (await box.isVisible()) {
    return { link: await box.inputValue(), via: 'the marked box' };
  }
  const link = await page.evaluate(() => globalThis.navigator.clipboard.readText());
  return { link, via: 'the clipboard' };
}

/**
 * editor-shared.png: the link in a page of its own opens the editor on the
 * same mission — its title, and its card's line with the station count —
 * marked as shared and not saved.
 */
async function openShared(context, link, card) {
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log('[shared error]', e.message));
  try {
    await page.goto(paged(link));
    await page.locator('.editor-name strong', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
    await page.locator('.editor-shared').waitFor({ timeout: 5000 });
    const seen = await page.locator('.editor-card-meta').innerText();
    await sleep(500);
    await capture(page, 'editor-shared.png');
    console.log(`editor-shared.png  the link opens „Probe" (${seen}), marked GETEILT`);
    if (seen !== card) {
      fail(`editor: the shared probe reads "${seen}", the original "${card}"`);
    }
  } finally {
    await page.close();
  }
}

/**
 * editor.png: the editor, opened from the join screen, with a room, a start
 * and a station in its lab and the validator naming what is missing — a
 * second start, a source for the keypad's rules. Made sound, the probe is
 * saved as custom-probe and has to show on the join screen. Then the
 * imported probe mission is played from the editor and shared by link
 * (editor-play.png, editor-shared.png). It is deleted through the API in any
 * case, so the walkthrough after it meets the shipped missions only.
 */
async function captureEditor() {
  // The link „Teilen" makes is read off the clipboard where the page may write it.
  const permissions = ['clipboard-read', 'clipboard-write'];
  const context = await browser.newContext({ viewport: SIZES[0], permissions });
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log('[editor error]', e.message));
  try {
    await paintProbe(page);
    await captureValidator(page);
    await editorLayouts(page);
    await saveProbe(page);
  } catch (err) {
    console.log(`editor             !! ${firstLine(err)}`);
    fail(`editor: ${firstLine(err)}`);
  }
  try {
    await importProbe(page);
    await playProbe(page);
    await backToEditor(page);
    const card = await page.locator('.editor-card-meta').innerText();
    const { link, via } = await sharedLink(page);
    console.log(`editor             „Teilen": a link of ${link.length} characters, from ${via}`);
    await openShared(context, link, card);
  } catch (err) {
    console.log(`editor             !! ${firstLine(err)}`);
    fail(`editor: ${firstLine(err)}`);
  }
  const res = await page.request
    .delete(new URL('/missions/custom/custom-probe', BASE).href)
    .catch(() => null);
  // 404 is fine where the probe never got saved; anything else leaves it behind.
  const status = res?.status() ?? 'no answer';
  console.log(`editor             custom-probe deleted again: ${status}`);
  if (status !== 200 && status !== 404) {
    fail(`editor: custom-probe could not be deleted again (${status})`);
  }
  await context.close();
}

/**
 * The art tour's scratch copy of Blackout, by its id and title: saved as
 * custom-blackout, it keeps Blackout's dressing (the client seeds a custom
 * mission's looks by its id without „custom-").
 */
const ART_MISSION = { id: 'custom-blackout', title: 'Kunstprobe' };
/** The art tour's windows: as large as cold-open.png's. */
const ART_SIZE = COLD_OPEN;

/**
 * Blackout as the art tour plays it: ten seconds of power before the lights
 * fail, for two, starting in the Archiv and in the Maschinenraum — a copy
 * the server checks as it checks every mission.
 */
function artMission() {
  const blackout = JSON.parse(
    readFileSync(fileURLToPath(new URL('../missions/blackout.json', import.meta.url)), 'utf8'),
  );
  // Where a won run leads on to is the shipped mission's business.
  delete blackout.next;
  return {
    ...blackout,
    ...ART_MISSION,
    listOrder: 99,
    players: { min: 2, max: 2 },
    intro: { lightsSec: 10 },
    map: {
      ...blackout.map,
      spawns: [
        { x: 3, y: 2 },
        { x: 3, y: 9 },
      ],
    },
  };
}

/** A page for the art tour in a context of its own, its errors logged under `name`. */
async function artPage(name, size = ART_SIZE) {
  const context = await browser.newContext({ viewport: size });
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log(`[${name} error]`, e.message));
  return { name, page, seen: eavesdrop(page), context };
}

/** The art tour's crew in the lobby of the scratch mission, the audience watching. */
async function artLobby() {
  const host = await artPage('art host');
  await host.page.goto(traced(BASE));
  await host.page.getByPlaceholder('z. B. Anna').fill('Anna');
  await host.page.locator('.mission', { hasText: ART_MISSION.title }).first().click();
  await clickText(host.page, 'Runde eröffnen');
  await host.page.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.page.locator('.room-code strong').innerText()).trim();
  const guest = await artPage('art guest');
  await guest.page.goto(traced(BASE));
  await guest.page.getByPlaceholder('z. B. Anna').fill('Ben');
  await guest.page.getByLabel('Raumcode').fill(code);
  await clickText(guest.page, 'Beitreten');
  await guest.page.locator('.lobby').waitFor({ timeout: 10_000 });
  const watcher = await artPage('art audience');
  await watcher.page.goto(paged(BASE));
  await watcher.page.getByLabel('Raumcode').fill(code);
  await clickText(watcher.page, 'Mit Code zuschauen');
  await watcher.page.locator('.spectate').waitFor({ timeout: 10_000 });
  return { host, guest, watcher };
}

/** Who of `players` started on the tile (x, y). */
const startedAt = (players, x, y) =>
  players.find(({ seen }) => {
    const spawn = seen.view?.map?.yourSpawn;
    return spawn?.x === x && spawn?.y === y;
  });

/**
 * The art captures, while the scratch mission's power is on: the audience's
 * whole lab lit (art-overview.png), each player's room round it lit
 * (room-archive.png, room-machine.png); then, two seconds into the dark, the
 * Maschinenraum with only the flashlight and its standby glows
 * (art-dark.png), its player's light probe read first (`checkLight`: under
 * SHOTS_WEBGL on the light layer). Fails where the run does not open with
 * the power on, or a start is not where the copy put it.
 */
async function artCaptures({ host, guest, watcher }) {
  await sleep(1200); // past the stage's fade-in, the lights at full
  if (host.seen.view?.lights?.out !== false) {
    throw new Error('the art tour’s mission did not open with the power on');
  }
  const crew = [host, guest];
  const archive = startedAt(crew, 3, 2);
  const machine = startedAt(crew, 3, 9);
  if (archive === undefined || machine === undefined) {
    throw new Error('the art tour’s starts are not the Archiv’s and the Maschinenraum’s');
  }
  await capture(watcher.page, 'art-overview.png');
  await capture(archive.page, 'room-archive.png');
  await capture(machine.page, 'room-machine.png');
  const map = watcher.seen.view?.map;
  const kinds = (map?.labels ?? []).map((label) => `${label.text} ${label.kind ?? 'plain'}`);
  console.log(
    `art-overview.png   the audience, the power on: ${new Set(kinds).size} rooms by kind ` +
      `(${[...new Set(kinds)].join(', ')}), ${map?.decor?.length ?? 0} pieces of furniture; ` +
      `room-archive.png ${archive.name}, room-machine.png ${machine.name}`,
  );
  if (!(await until(() => machine.seen.view?.lights?.out === true, 12_000))) {
    throw new Error('the art tour’s lights never went out');
  }
  await sleep(2000);
  await checkLight(machine);
  await capture(machine.page, 'art-dark.png');
  console.log(`art-dark.png       ${machine.name} in the Maschinenraum, two seconds into the dark`);
}

/**
 * The art tour, for Blackout only: its scratch copy saved through the
 * editor's route, played by two and watched by one through the captures of
 * `artCaptures`, then deleted again whatever happened.
 */
async function captureArtTour() {
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('art-*.png', `the art tour plays Blackout's copy; this run plays ${MISSION}`);
    return;
  }
  const api = await request.newContext({ baseURL: BASE });
  const catalog = await (await api.get('/missions')).json();
  if (catalog.some((info) => info.id === ART_MISSION.id)) {
    skip('art-*.png', `this server has its own ${ART_MISSION.id}: the tour leaves it be`);
    await api.dispose();
    return;
  }
  const saved = await api.post('/missions/custom', { data: artMission() });
  if (saved.status() !== 201) {
    fail(`art tour: the scratch copy was not taken (${saved.status()}): ${await saved.text()}`);
    await api.dispose();
    return;
  }
  const pages = [];
  try {
    const lobby = await artLobby();
    pages.push(lobby.host, lobby.guest, lobby.watcher);
    await clickText(lobby.guest.page, 'Ich bin bereit');
    const start = lobby.host.page.locator('button.lobby-start:enabled', {
      hasText: 'Mission starten',
    });
    await start.waitFor({ state: 'visible', timeout: 10_000 });
    await start.click();
    await lobby.host.page.locator('.stage').waitFor({ timeout: START_MS });
    await lobby.guest.page.locator('.stage').waitFor({ timeout: START_MS });
    await artCaptures(lobby);
  } catch (err) {
    console.log(`art tour           !! ${firstLine(err)}`);
    fail(`art tour: ${firstLine(err)}`);
  } finally {
    for (const { context } of pages) {
      await context.close();
    }
    const gone = await api.delete(`/missions/custom/${ART_MISSION.id}`);
    console.log(`art tour           ${ART_MISSION.id} deleted again: ${gone.status()}`);
    await api.dispose();
  }
}

/** Holds the keys towards (tx, ty) as long as the avatar takes to walk there in a line. */
async function walkStraight(player, tx, ty) {
  const at = whereIs(player.seen);
  const dx = tx - at.x;
  const dy = ty - at.y;
  const keys = [
    ...(Math.abs(dx) >= STEP_TOLERANCE ? [dx > 0 ? 'd' : 'a'] : []),
    ...(Math.abs(dy) >= STEP_TOLERANCE ? [dy > 0 ? 's' : 'w'] : []),
  ];
  for (const key of keys) await player.page.keyboard.down(key);
  await sleep((Math.hypot(dx, dy) / SPEED) * 1000);
  for (const key of keys) await player.page.keyboard.up(key);
}

/** Walks `player` onto `tile` and stops in its middle; false where no open way leads there. */
async function standOn(player, tile) {
  return (
    (await walkNear(player.page, player.seen, tile)) &&
    (await stepTo(player.page, player.seen, tile.x + 0.5, tile.y + 0.5))
  );
}

/**
 * The Kabelprüfung as the pinned seed draws it: `holder` stands on the
 * Kontrolle's plate, beside the locker whose rules make it the backup, while
 * `cutter` walks through to the box, opens it and cuts the pinned wire.
 * Throws, naming the seed, where the box shows other wires than pinned.
 */
async function cutPinnedWire(cutter, holder, pinned) {
  const map = cutter.seen.view.map;
  const box = map.stations.find((s) => s.status === 'armed');
  const plate = map.plates.find((p) => !p.freezesDrone);
  if (box === undefined || plate === undefined) {
    throw new Error('the Kabelprüfung is not armed, or there is no plate to hold its door');
  }
  await holdPlate(holder, plate);
  const through = await until(() => stepsTo(cutter.seen, box) !== Infinity, 3000);
  if (!through || !(await walkNear(cutter.page, cutter.seen, box))) {
    throw new Error(`${holder.name} holds the plate, but ${cutter.name} found no way to "${box.title}"`);
  }
  const modal = cutter.page.locator('.station-modal');
  if (!(await interactUntil(cutter.page, modal))) {
    throw new Error(`${cutter.name} stands at "${box.title}", but no .station-modal after 3 tries`);
  }
  await until(() => cutter.seen.view.puzzle?.wires != null, 3000);
  const colors = (cutter.seen.view.puzzle?.wires ?? []).map((wire) => wire.color);
  if (colors.join(',') !== pinned.colors.join(',')) {
    throw new Error(
      `Systemcheck seed ${SEED} no longer draws the pinned wiring box: ` +
        `${colors.join(', ') || 'no wires'} instead of ${pinned.colors.join(', ')} — ` +
        'draw the box for the seed anew and update PINNED_WIRING',
    );
  }
  const backed = await until(() => cutter.seen.view.puzzle?.backup != null, 3000);
  const index = cutter.seen.view.currentPuzzleIndex;
  await modal.locator(`button[aria-label^="Kabel ${pinned.cut},"]`).click({ timeout: 3000 });
  if (!(await until(() => cutter.seen.view.currentPuzzleIndex > index, 5000))) {
    const alarms = cutter.seen.view.alarms.count;
    throw new Error(
      `${cutter.name} cut wire ${pinned.cut} of "${box.title}", but it did not solve ` +
        `(${backed ? 'backed up' : `no backup at ${holder.name}'s plate`}, ${alarms} alarm(s))`,
    );
  }
  console.log(
    `wiring             ${holder.name} holds the plate by the locker, ${cutter.name} cuts wire ` +
      `${pinned.cut} of ${colors.join(', ')} (seed ${SEED}): "${box.title}" solved`,
  );
}

/** The last station, a sync for the whole crew: all gather at it, open it and press together. */
async function pressLastSync(players) {
  const station = players[0].seen.view.map.stations.find((s) => s.status === 'armed');
  if (station === undefined) {
    throw new Error('no station is armed after the Kabelprüfung');
  }
  // In this order: whoever holds a plate door open steps off it last.
  await gatherAt(station, players);
  for (const player of players) {
    if (!(await interactUntil(player.page, player.page.locator('.station-modal')))) {
      throw new Error(`${player.name} stands at "${station.title}", but no .station-modal`);
    }
  }
  await sleep(400); // past the panel's fade-in
  const solved = await pressTogether(players, station);
  await checkRadioVoice(players[0], solved.listening, `"${station.title}"`);
}

/** What the host's page says of the escape: the goal, the checklist, the clock. */
async function escapeHud(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const mates = [...document.querySelectorAll('.escape-mate')].map(
      (li) => `${li.textContent.trim()}${li.classList.contains('escape-mate--out') ? ' ✓' : ' …'}`,
    );
    return {
      goal: text('.stage-goal--escape h1'),
      mates,
      clock: document.querySelector('.stage-clock .countdown')?.className ?? 'no clock',
    };
  });
}

/**
 * escape.png: the hatch open and the siren on — the light turned red, the
 * clock pulsing, the checklist under the goal. The host walks up beside the
 * hatch and its frames are sampled there (the escape's quiet window); the
 * guest steps onto it and is ticked off. The shot waits until the hatch has
 * ground open. Fails unless the goal, the checklist and the clock say so.
 */
async function captureEscape(host, guest) {
  const open = () => host.seen.view.map?.exit?.open === true;
  if (!(await until(open, 5000))) {
    throw new Error('every station is solved, but the hatch did not open');
  }
  const exit = host.seen.view.map.exit;
  const openedAt = Date.now();
  const beside = { x: exit.x + 1, y: exit.y + 1 };
  if (!(await standOn(host, beside))) {
    throw new Error(`${host.name} found no way to ${beside.x},${beside.y} beside the hatch`);
  }
  await sampleFrames(host.page, 'in the escape, the siren on', () => pace(host, SAMPLE_MS));
  await escapeMusic(host);
  const guestId = guest.seen.view.you.id;
  const ticked = () => host.seen.view.map?.exit?.atExit.includes(guestId) === true;
  if (!(await standOn(guest, exit)) || !(await until(ticked, 3000))) {
    throw new Error(`${guest.name} did not get onto the hatch, or the checklist never ticked`);
  }
  await partnerSide(host, guest, 'at the hatch');
  await sleep(Math.max(600, openedAt + 2400 - Date.now())); // the hatch ground open, the light red
  await capture(host.page, 'escape.png');
  const hud = await escapeHud(host.page);
  console.log(
    `escape.png         ${host.name}: "${hud.goal}", checklist ${hud.mates.join(', ')}, ` +
      `clock "${hud.clock}"`,
  );
  const tickedOff = hud.mates.some((mate) => mate.startsWith(guest.name) && mate.endsWith('✓'));
  // Amber with minutes left: red is the clock's last minute only.
  const amber = hud.clock.includes('countdown--escape') && !hud.clock.includes('critical');
  if (hud.goal !== 'ALLE ZUM NOTAUSGANG' || !tickedOff || !amber) {
    fail(`escape.png: goal "${hud.goal}", checklist ${hud.mates.join(', ')}, clock ${hud.clock}`);
  }
}

/** The end screen whole: the window as tall as the screen runs, then back. */
async function captureWholeEnd(page) {
  await page.locator('.standing, .standing-line').first().waitFor({ timeout: 5000 }).catch(() => {});
  const before = page.viewportSize();
  const height = await page.evaluate(() => {
    const content = document.querySelector('.content');
    return Math.ceil(content.getBoundingClientRect().top + content.scrollHeight + 4);
  });
  await page.setViewportSize({ width: before.width, height: Math.max(before.height, height) });
  await sleep(500);
  await capture(page, 'end.png');
  await page.setViewportSize(before);
  return height;
}

/**
 * won-phone.png: the guest's title card on a phone held upright; the card
 * may not run out sideways there. Then won-landscape.png: the phone turned
 * sideways (`captureLandscapeCard`).
 */
async function capturePhoneCard(guest) {
  const { page } = guest;
  await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
  if (!(await attached(page.locator('.end-title'), 6000))) {
    throw new Error(`${guest.name}'s page never showed the title card`);
  }
  await sleep(1700); // past the card's way out of the white
  await capture(page, 'won-phone.png');
  const over = await sideways(page, '.content');
  console.log(
    `won-phone.png      ${guest.name} @ 420x760: ` +
      (over > 0 ? `!! +${over}px sideways` : 'the card fits sideways'),
  );
  if (over > 0) {
    fail(`won-phone.png: the end screen runs out ${over}px sideways on a phone`);
  }
  await captureLandscapeCard(guest);
}

/**
 * won-landscape.png: the title card on a phone held sideways, 844×390, in two
 * columns — the crew's shot left; the word, the time and the rank right, all
 * of them in the window, and the top bar on one line. Fails where the scene
 * is not beside the words, or the facts lie below the window's foot.
 */
async function captureLandscapeCard(guest) {
  const { page } = guest;
  const turned = SIZES[3];
  await page.setViewportSize({ width: turned.width, height: turned.height });
  await sleep(500);
  await capture(page, 'won-landscape.png');
  const layout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const [scene, word, facts] = ['.end-scene', '.end-title-word', '.end-facts'].map((selector) =>
      box(`.end-title ${selector}`),
    );
    const bar = document.querySelector('.topbar');
    // One line: the bar no higher than twice its tallest item — a second row would be.
    const tallest = Math.max(0, ...[...(bar?.children ?? [])].map((c) => c.offsetHeight));
    const oneLine = bar !== null && bar.offsetHeight < 2 * tallest;
    return { scene, word, facts, oneLine, barHeight: bar?.offsetHeight ?? 0 };
  });
  const { scene, word, facts, oneLine, barHeight } = layout;
  const columns = scene !== null && word !== null && facts !== null &&
    scene.right <= word.left && scene.right <= facts.left;
  const inView = facts !== null && facts.bottom <= turned.height;
  console.log(
    `won-landscape.png  ${guest.name} @ ${turned.width}x${turned.height}: ` +
      `${columns ? 'two columns' : '!! not two columns'}, ` +
      `the facts ${inView ? 'in the window' : '!! below its foot'}, ` +
      `the top bar ${oneLine ? 'one line' : '!! wrapped'} (${barHeight}px)`,
  );
  if (!columns || !inView || !oneLine) {
    fail(`won-landscape.png: two columns ${columns}, facts in view ${inView}, bar ${oneLine}`);
  }
}

/** A won card's figure counts as mid-jump this far off the ground, tiles (it jumps 10/64). */
const JUMP_SHOWN = 0.12;
/** How long the card gets for one of its figures to be caught mid-jump: each jumps every 1.6 s. */
const JUMP_WAIT_MS = 5000;
/** Whether figure-celebrate.png was taken: only a run played to its end has a won card. */
let celebrateShot = false;

/**
 * figure-celebrate.png: the host's won card at 1440×1000, shot while a
 * figure of the crew is high in its jump — the figures' probe says when.
 * Fails where a figure on the card does not celebrate, or none is caught in
 * the air within JUMP_WAIT_MS.
 */
async function captureCelebrate(page) {
  celebrateShot = true;
  const before = page.viewportSize();
  await page.setViewportSize(COLD_OPEN);
  await sleep(500);
  const jumping = (figure) => figure.mood === 'celebrate' && figure.rise >= JUMP_SHOWN;
  const high = await figureWhen(page, jumping, JUMP_WAIT_MS);
  await capture(page, 'figure-celebrate.png');
  const shot = (await figuresOn(page)) ?? [];
  const cheering = shot.filter((figure) => figure.mood === 'celebrate').length;
  console.log(
    `figure-celebrate.png Anna's card @ ${COLD_OPEN.width}x${COLD_OPEN.height}: ` +
      (high === null
        ? '!! no figure caught in the air'
        : `${high.color} ${high.rise.toFixed(3)} tiles up`) +
      `; at the shot ${cheering} of ${shot.length} figures celebrating, off the ground ` +
      (shot.map((figure) => figure.rise.toFixed(3)).join(', ') || 'none'),
  );
  if (high === null || shot.length === 0 || cheering !== shot.length) {
    fail(`figure-celebrate.png: ${cheering} of ${shot.length} figures celebrate, none in the air`);
  }
  if (before !== null) {
    await page.setViewportSize(before);
  }
  await sleep(300);
}

/**
 * pullback.png, won.png, end.png: the host steps onto the hatch beside the
 * guest and the run is won. The world plays its end — pullback.png in the
 * middle of it — then the end screen opens on its title card (won.png),
 * its crew jumping (figure-celebrate.png), and end.png has all of it. The
 * audience's page has to show the same card, its crew jumping too
 * (won-audience.png).
 */
async function captureEnd(host, watcher) {
  const exit = host.seen.view.map.exit;
  // One straight walk: once the run is won the world takes no keys, so no step corrects it.
  const won = () => host.seen.view?.phase === 'won';
  const walk = walkStraight(host, exit.x + 0.5, exit.y + 0.5);
  if (!(await until(won, 5000))) {
    throw new Error('both stand on the hatch, but the run was not won');
  }
  const wonAt = Date.now();
  await walk;
  await sleep(700);
  await capture(host.page, 'pullback.png');
  const card = host.page.locator('.end-title');
  if (!(await attached(card, 6000))) {
    throw new Error('the run was won, but no title card came up');
  }
  const cardAt = Date.now() - wonAt;
  await sleep(1700); // past the card's way out of the white
  await capture(host.page, 'won.png');
  const says = await textOf(card.locator('.end-title-word'));
  const figures = await card.locator('.end-mate canvas').count();
  const facts = (await textOf(card.locator('.end-facts')))?.replace(/\s+/g, ' ') ?? 'none';
  await captureCelebrate(host.page);
  const tall = await captureWholeEnd(host.page);
  const watched = watcher.locator('.spectate .end-title-word');
  const audience = (await attached(watched, 6000)) ? await textOf(watched) : null;
  if (audience !== null) {
    await sleep(1700); // past the card's way out of the white there too
    await capture(watcher, 'won-audience.png');
  }
  const crowd = ((await figuresOn(watcher)) ?? []).filter((f) => f.mood === 'celebrate').length;
  console.log(
    `won.png            ${host.name}: the card after ${seconds(cardAt)}, "${says}", ` +
      `${figures} figures outside, "${facts}"; end.png ${tall}px tall; ` +
      `the audience's card "${audience ?? '!! none'}", ${crowd} figures celebrating on it`,
  );
  if (says !== 'GESCHAFFT' || figures !== 2 || audience !== 'GESCHAFFT' || crowd !== 2) {
    fail(`won.png: "${says}", ${figures} figures, the audience's card "${audience}" (${crowd})`);
  }
}

/**
 * next-mission.png: the end screen of a won run whose mission leads on to
 * another offers it as the main button, „Nochmal" beside it. The guest
 * clicks it, then the host, whose click names the mission; it has to open
 * on both pages, with the power on where it has an intro. Throws where the
 * button is missing, fails where the next run does not come up.
 */
async function captureNextMission(host, guest) {
  const onward = (page) =>
    page.locator('.end-screen .actions button.primary', { hasText: 'Weiter:' });
  if (!(await attached(onward(host.page), 5000))) {
    throw new Error('the won run leads on to another mission, but no „Weiter" on its end screen');
  }
  await host.page.locator('.end-screen .actions').scrollIntoViewIfNeeded();
  await sleep(400);
  await capture(host.page, 'next-mission.png');
  const label = await textOf(onward(host.page));
  const again = host.page.locator('.end-screen .actions button', { hasText: 'Nochmal' });
  const beside = await textOf(again);
  const next = host.seen.view.nextMissionId;
  const guestReady = () => host.seen.view.players.some((p) => p.name === guest.name && p.ready);
  await onward(guest.page).click();
  const confirmed = await until(guestReady, 3000);
  await onward(host.page).click();
  const there = ({ seen }) => seen.view?.phase === 'playing' && seen.view.missionId === next;
  const opened = await until(() => [host, guest].every(there), START_MS);
  const lit = opened && host.seen.view.lights.out === false;
  const yes = confirmed ? 'said yes' : '!! no yes from the guest';
  const outcome = opened
    ? `${next} opened on both pages, ${lit ? 'the power on' : '!! the lights out'}`
    : `!! ${next} never opened`;
  console.log(
    `next-mission.png   ${host.name}: "${label}", beside it "${beside}"; ` +
      `${guest.name} ${yes}, then ${host.name}: ${outcome}`,
  );
  if (!label?.startsWith('Weiter: ') || beside !== 'Nochmal' || !confirmed || !opened || !lit) {
    fail(`next-mission.png: "${label}" beside "${beside}", ${next} opened ${opened}, lit ${lit}`);
  }
}

/**
 * The Systemcheck on its pinned seed to the end: the Kabelprüfung, the
 * Synchronkalibrierung, the escape and the win (escape.png, pullback.png,
 * won.png, end.png, won-phone.png), then on into the mission it leads on to
 * (next-mission.png).
 */
async function playToTheEnd(host, guest, watcher, pinned) {
  await cutPinnedWire(host, guest, pinned);
  await pressLastSync([host, guest]);
  await captureEscape(host, guest);
  await captureEnd(host, watcher);
  await capturePhoneCard(guest);
  await captureNextMission(host, guest);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (CPU_SLOWDOWN > 1) {
    console.log(`cpu                every page slowed down ${CPU_SLOWDOWN}× (SHOTS_CPU_SLOWDOWN)`);
  }
  browser = await chromium.launch({
    headless: !HEADED,
    args: [...VOICE_FLAGS, ...(SOFTWARE_GL ? SOFTWARE_GL_FLAGS : [])],
  });
  await logRendering();
  await captureEditor();
  await captureArtTour();

  // --- host: create a room and grab the code ---------------------------
  const hostCtx = await browser.newContext({ viewport: SIZES[0] });
  const host = await openPage(hostCtx, 'host');
  const hostSeen = eavesdrop(host);
  host.on('console', (m) => {
    if (m.type() === 'error') console.log('[host console]', m.text());
  });
  host.on('pageerror', (e) => console.log('[host error]', e.message));
  // Only the host's page keeps a frame trace: every frame sample reads it.
  await host.goto(seeded(traced(BASE)));
  await host.getByPlaceholder('z. B. Anna').fill('Anna');
  await host.locator('.mission').first().waitFor({ timeout: 10_000 });
  // The join screen, every mission in view, has to fit a laptop window too.
  await capture(host, 'join.png');
  await overflow(host, 'join @ 1440x820');
  await host.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(host, 'join @ 1280x720');
  await capture(host, 'join-1280.png');
  await host.setViewportSize(SIZES[0]);
  await sleep(300);
  await captureHistory(host, 'history');
  const card = host.locator('.mission', { hasText: MISSION }).first();
  if ((await card.count()) === 0) {
    throw new Error(`no mission card reads "${MISSION}" — SHOTS_MISSION has to name one`);
  }
  await card.click();
  await clickText(host, 'Runde eröffnen');
  await host.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.locator('.room-code strong').innerText()).trim();
  console.log('room code:', code, `(${MISSION})`);
  if (SEED !== null) {
    // The lobby names the seed beside the code once the server has pinned the room to it.
    const label = host.locator('.room-seed');
    await label.waitFor({ timeout: 3000 }).catch(() => undefined);
    const shown = await textOf(label);
    console.log(
      `seed               ${SEED}: ` +
        (shown === `Seed ${SEED}`
          ? 'the room is pinned to it'
          : `!! the room is not pinned (${shown ?? 'no seed beside the code'}): ` +
            'the server takes one only with ALLOW_SEED=1, so the draw is chance'),
    );
  }
  await capture(host, 'lobby-host.png');

  // --- guest: join by code ---------------------------------------------
  // Touch-capable on purpose: the on-screen D-pad is hidden for `pointer:
  // fine`, so a default context would never show it.
  const guestCtx = await browser.newContext({ viewport: SIZES[2], hasTouch: true });
  const guest = await openPage(guestCtx, 'guest');
  const guestSeen = eavesdrop(guest);
  // Traced for its voice links; its frames are never sampled.
  await guest.goto(traced(BASE));
  await guest.getByPlaceholder('z. B. Anna').fill('Ben');
  // On a phone the join screen stacks and scrolls; this shows its top.
  await guest.locator('.mission').first().waitFor({ timeout: 10_000 });
  await capture(guest, 'join-phone.png');
  await captureHistory(guest, 'history-phone');
  await guest.getByLabel('Raumcode').fill(code);
  await clickText(guest, 'Beitreten');
  await guest.locator('.lobby').waitFor({ timeout: 10_000 });

  // crew, ready, start — nothing to pick: the start draws who begins where
  await host.locator('.seat .seat-name', { hasText: /^Ben$/ }).waitFor({ timeout: 10_000 });
  await sleep(300);
  await capture(host, 'lobby-filled.png');
  await captureLobbyIdle(host);
  await capture(guest, 'lobby-phone.png');
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
  await capture(host, 'lobby-1280.png');
  await captureLobbySideways(host);
  await host.setViewportSize(SIZES[0]);
  await sleep(300);
  await micsOn([
    { name: 'Anna', page: host },
    { name: 'Ben', page: guest },
  ]);
  await startRun(
    { name: 'Anna', page: host, seen: hostSeen },
    { name: 'Ben', page: guest, seen: guestSeen },
  );
  await sleep(500); // presence follows the start within a tick
  if (guestSeen.view?.map == null || hostSeen.view?.map == null) {
    throw new Error('no running view on the sockets — does the client still talk on /ws?');
  }
  const anna = { name: 'Anna', page: host, seen: hostSeen, traced: true };
  const ben = { name: 'Ben', page: guest, seen: guestSeen };
  const { operator, reader, atSign } = await firstMoments(anna, ben);
  if (atSign !== undefined) {
    await infoAfterSign(atSign, ben);
  }
  // Let the briefing countdown finish; server and browsers share this clock.
  await sleep(Math.max(0, guestSeen.view.startedAt + 4200 - Date.now()));
  if (anna.seen.view.lights.outAt === anna.seen.view.startedAt) {
    await bedDead(anna, 'with the lights out from the start');
  }
  await checkRadioBand(host);
  // The world's zoom follows the canvas height: nothing the run brings up in
  // the HUD — the sign's chip, a long radio line, the notes — may change it.
  const steady = [
    { name: 'Anna', page: host, start: await layoutOf(host) },
    { name: 'Ben', page: guest, start: await layoutOf(guest) },
  ];
  await captureVoice(anna, ben);

  for (const size of SIZES.filter((s) => !s.hasTouch)) {
    await host.setViewportSize({ width: size.width, height: size.height });
    await sleep(700);
    await capture(host, `game-${size.name}.png`);
    await overflow(host, `game @ ${size.width}x${size.height}`);
  }
  // The guest's window is phone-sized and touch-capable all along.
  await capture(guest, 'game-phone-touch.png');
  // Ben turns the phone sideways: the landscape layout, pad and all. Its zoom has to hold
  // there too, so the end of the run turns the phone once more and compares.
  const turned = SIZES[3];
  await guest.setViewportSize({ width: turned.width, height: turned.height });
  await sleep(700);
  await capture(guest, `game-${turned.name}.png`);
  await overflow(guest, `game @ ${turned.width}x${turned.height}, Ben's phone sideways`);
  steady.push({ name: 'Ben sideways', page: guest, start: await layoutOf(guest), turn: turned });
  await guest.setViewportSize(SIZES[2]);
  await sleep(400);

  // info panel and spectator view at laptop size
  await host.setViewportSize(SIZES[0]);
  await sleep(400);
  await checkLight(anna);
  await sampleFrames(host, 'pacing, after the game screenshots', () => pace(anna, SAMPLE_MS));
  await host.keyboard.press('i');
  await sleep(400);
  await capture(host, 'info-panel.png');
  await host.keyboard.press('Escape');

  const watcherCtx = await browser.newContext({ viewport: SIZES[0] });
  const watcher = await openPage(watcherCtx, 'audience');
  const watcherSeen = eavesdrop(watcher);
  // Traced for its voice links; its frames are never sampled.
  await watcher.goto(traced(BASE));
  await watcher.getByLabel('Raumcode').fill(code);
  await clickText(watcher, 'Mit Code zuschauen');
  await watcher.locator('.spectate').waitFor({ timeout: 10_000 });
  await sleep(1200);
  await capture(watcher, 'spectate.png');
  await overflow(watcher, 'spectate @ 1440x820');
  await listenIn(watcher, [anna, ben]);

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
      skip('reading.png', 'no manual object in reach of either player');
    }
  }

  const sign = reader.seen.view.map.edgeworkSign;
  if (atSign === undefined) {
    if (sign === null) {
      skip('sign.png', 'this map has no Laborkennung');
    } else if (await walkNear(reader.page, reader.seen, sign)) {
      await captureSign(reader.page, reader.name);
      await infoAfterSign(reader, ben);
    } else {
      skip(
        'sign.png',
        stepsTo(reader.seen, sign) === Infinity
          ? `the sign at ${sign.x},${sign.y} is out of ${reader.name}'s reach`
          : `${reader.name}'s walk to the sign at ${sign.x},${sign.y} broke off ` +
              '(stuck, or a door shut)',
      );
    }
  }
  await captureNotepad(guest, guestSeen);
  await voiceAfterReload(anna, ben);

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
    skip(
      'station',
      station === undefined
        ? 'no station is armed'
        : 'no open way from either start to the armed station',
    );
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
    await capture(operator.page, 'station.png');
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
      skip(
        'hint-*.png',
        'notes come for an open station only: the sync station is solved, ' +
          'and nobody has opened the next yet',
      );
      // Where the next station has two consoles, the crew captures both; a Signalkette it works.
      await captureConsoles(operator, reader);
    } else {
      await askForNotes(reader, operator);
    }
  }
  // The world on its own again: whatever the host still has open closes first.
  const onTop = host.locator('.station-modal, .reading-modal').first();
  if (await onTop.isVisible()) {
    await host.keyboard.press('Escape');
    await onTop.waitFor({ state: 'hidden', timeout: 3000 });
  }
  await sampleFrames(host, 'pacing, after the station step', () => pace(anna, SAMPLE_MS));
  if (!panelSampled) {
    skip('frames', 'no station panel was open on the host page, so none was sampled with one');
  }
  await captureLitRoom(guest, guestSeen);

  for (const { name, page, start, turn } of steady) {
    if (turn !== undefined) {
      await page.setViewportSize({ width: turn.width, height: turn.height });
      await sleep(700);
    }
    const end = await layoutOf(page);
    const banners = end.banners.length === 0 ? '' : `, ${end.banners.join(' ')} up`;
    console.log(
      `canvas             ${name}: ${start.size} after the briefing, ${end.size} at the end` +
        (end.size === start.size
          ? ', the world zoom held'
          : ` — !! the world zoom moved (HUD ${start.hud} → ${end.hud}px${banners})`),
    );
  }

  // The Systemcheck's seed pins its wiring box: there the walkthrough plays the run out.
  const pinned = MISSION.toLowerCase() === 'systemcheck' ? PINNED_WIRING.get(SEED) : undefined;
  if (pinned !== undefined) {
    await playToTheEnd(anna, ben, watcher, pinned);
  }
  if (!flinchShot) {
    skip('figure-flinch.png', 'the walkthrough works no Signalkette in this mission');
  }
  if (!celebrateShot) {
    skip('figure-celebrate.png', 'the walkthrough does not play this mission to a won card');
  }

  if (sides.checked === 0) {
    fail("the partner's side was never told apart: the crew never stood apart sideways");
  }
  if (!solvedShot.taken && solvedShot.late.length === 1) {
    skipLateShot(); // late, and no sync station came after it to shoot again
  }
  await browser.close();
  console.log('screenshots in', OUT);
}

/**
 * Runs the walkthrough, then prints the summary as the last line. A step that
 * throws ends the walkthrough there and counts as failed; the exit code is set
 * rather than forced, so a log piped through tee keeps its last lines.
 */
async function main() {
  try {
    await run();
  } catch (err) {
    console.error(err);
    // Playwright appends its call log to the message: the first line names the step.
    fail(String(err instanceof Error ? err.message : err).split('\n')[0]);
  }
  // A step that threw leaves the browser running, and the process with it.
  if (browser?.isConnected()) {
    await browser.close();
  }
  summarize();
  process.exitCode = tally.failures.length === 0 ? 0 : 1;
}

await main();
