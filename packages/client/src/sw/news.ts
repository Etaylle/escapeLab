/**
 * What a service worker that has just taken over tells every open page
 * (worker.ts → pwa.ts): the files of its build. A page whose own build
 * files are not all among them is an older version and offers the reload.
 *
 * Both sides import this as a type only. The worker is a script of its own
 * and may share no code with the app, or the build would split the shared
 * code into a chunk it has to import.
 */
export interface WorkerNews {
  kind: 'escapelab-sw';
  /** the worker's precache list: addresses such as "/assets/index-3f9a.js" */
  files: string[];
}
