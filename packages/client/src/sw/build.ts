import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';

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
 * What the worker keeps at install: the page as "/", then every file of the
 * build and of public/ by its address. Not the worker itself (the browser
 * fetches it on its own), not index.html under its name, no dotfiles.
 *
 * @param built the bundle's file names, as "assets/index-3f9a.js"
 * @param published the files under public/, as "icon.svg"
 */
export function precacheFiles(built: readonly string[], published: readonly string[]): string[] {
  const kept = [...built, ...published].filter(
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
      const digest = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const file = bundle[name];
        if (name !== SW_FILE && file !== undefined) {
          digest.update(name).update(contentOf(file));
        }
      }
      for (const name of published) {
        digest.update(name).update(readFileSync(join(publicDir, name)));
      }
      const precache = { version: digest.digest('hex').slice(0, 12), files };
      worker.code = `"use strict";const PRECACHE=${JSON.stringify(precache)};\n${worker.code}`;
    },
  };
}
