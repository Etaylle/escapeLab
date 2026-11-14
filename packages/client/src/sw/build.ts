import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { DEFAULT_PACK } from '../world/packFile.js';

/**
 * Build time only, for vite.config.ts; the app never imports this.
 *
 * Builds worker.ts into dist/sw.js beside the page, so the worker's scope is
 * the whole site. A service worker is a classic script: it may import
 * nothing, which this checks. In front of it goes PRECACHE, the build's
 * files and a version hashed from their contents, so every release that
 * changes a file brings a new worker with a cache of its own.
 */

/** The worker's file in the build. */
const SW_FILE = 'sw.js';

/**
 * What public/ holds that the worker leaves out of its install, each fetched as the game needs it:
 * the radio's recordings (voice/), some 20 MB once the whole cast speaks, which the game fetches
 * line by line as each is queued — from the browser's own cache where it has them, and offline a
 * line missing stands in with the radio's chirp — and the music packs a player may pick besides
 * the game's own score (world/packFile.ts DEFAULT_PACK), some 7 to 9 MB each, fetched as they play:
 * a phone that installs the page fetches the music it plays, not every pack the game has. Nor does
 * the worker keep a pack's pieces as they play — a streamed piece is asked for in ranges, which a
 * cache refuses — and none of it is hashed into the worker's version: a new take of the radio or a
 * pack built anew brings no new worker.
 */
const FETCHED_AS_NEEDED: readonly RegExp[] = [
  /^voice\//,
  new RegExp(`^music/packs/(?!${DEFAULT_PACK}/)`),
];

/** Whether the file `name` of public/ goes into the install: all but FETCHED_AS_NEEDED's. */
export function precached(name: string): boolean {
  return !FETCHED_AS_NEEDED.some((fetched) => fetched.test(name));
}

/**
 * What the worker keeps at install: the page as "/", then every file of the
 * build and of public/ by its address — but what the game fetches as it
 * needs it (FETCHED_AS_NEEDED). Not the worker itself (the browser fetches
 * it on its own), not index.html under its name, no dotfiles.
 *
 * @param built the bundle's file names, as "assets/index-3f9a.js"
 * @param published the files under public/, as "icon.svg"
 */
export function precacheFiles(built: readonly string[], published: readonly string[]): string[] {
  const kept = [...built, ...published.filter(precached)].filter(
    (name) =>
      name !== SW_FILE &&
      name !== 'index.html' &&
      !name.split('/').some((part) => part.startsWith('.')),
  );
  return ['/', ...kept.sort().map((name) => `/${name}`)];
}

/** Every file under `dir`, relative to it with forward slashes; none when it does not exist. */
function filesUnder(dir: string): string[] {
  if (dir === '' || !existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort();
}

function contentOf(file: Rollup.OutputChunk | Rollup.OutputAsset): string | Uint8Array {
  return file.type === 'chunk' ? file.code : file.source;
}

/**
 * The worker's version: a hash of the build's files but the worker itself, and of the files of
 * public/ it keeps at install (`precached`), each by name and content — so that a release that
 * changes one brings a new worker, and a new take of the radio or a pack built anew, which no
 * install keeps, does not.
 *
 * @param built the bundle's files by name, as "assets/index-3f9a.js", with their content
 * @param published the files under public/, as "icon.svg"
 * @param read the content of a file under public/, by its name there
 */
export function versionOf(
  built: Readonly<Record<string, string | Uint8Array>>,
  published: readonly string[],
  read: (name: string) => string | Uint8Array,
): string {
  const digest = createHash('sha256');
  for (const [name, content] of Object.entries(built).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (name !== SW_FILE) digest.update(name).update(content);
  }
  for (const name of published.filter(precached)) {
    digest.update(name).update(read(name));
  }
  return digest.digest('hex').slice(0, 12);
}

/** The Vite plugin: emits sw.js as an entry of its own and puts PRECACHE in front of it. */
export function serviceWorker(): Plugin {
  let config: ResolvedConfig | null = null;
  return {
    name: 'escapelab:service-worker',
    apply: 'build',
    // After the HTML plugin: index.html has to be in the bundle to go into the version.
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      if (config === null) {
        this.error('the config was never resolved');
      }
      this.emitFile({
        type: 'chunk',
        id: join(config.root, 'src/sw/worker.ts'),
        fileName: SW_FILE,
      });
    },
    generateBundle(_options, bundle) {
      const worker = bundle[SW_FILE];
      if (config === null || worker?.type !== 'chunk') {
        this.error(`${SW_FILE} is missing from the bundle`);
      }
      const imported = [...worker.imports, ...worker.dynamicImports];
      if (imported.length > 0) {
        this.error(
          `${SW_FILE} imports ${imported.join(', ')}, which a service worker cannot: ` +
            'keep the modules it uses out of the app (types only, see src/sw/news.ts)',
        );
      }
      if (bundle['index.html'] === undefined) {
        this.error('index.html is not in the bundle yet: this plugin has to run after the HTML');
      }
      const publicDir = config.publicDir;
      const published = filesUnder(publicDir);
      const files = precacheFiles(Object.keys(bundle), published);
      const built = Object.fromEntries(
        Object.entries(bundle).map(([name, file]) => [name, contentOf(file)]),
      );
      const read = (name: string): Uint8Array => readFileSync(join(publicDir, name));
      const precache = { version: versionOf(built, published, read), files };
      worker.code = `"use strict";const PRECACHE=${JSON.stringify(precache)};\n${worker.code}`;
    },
  };
}
