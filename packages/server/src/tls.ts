import { existsSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { createSecureContext } from 'node:tls';
import { fileURLToPath } from 'node:url';

/**
 * HTTPS on the LAN without hosting. Phones grant the microphone and the wake
 * lock only to a secure origin, and http://<lan-ip>:3001 is none; a
 * self-signed certificate (`pnpm cert`, its warning accepted once per phone)
 * makes it one. The server speaks TLS where the pair is there and plain http
 * where it is not; TLS=off keeps it on http regardless, as `pnpm dev` (behind
 * Vite's proxy) and the smoke test do.
 */

/** The server package's folder: the default pair lies in it, and the log names paths from it. */
const SERVER_DIR = fileURLToPath(new URL('../', import.meta.url));

/** A certificate and its private key, PEM files by path. */
export interface CertFiles {
  cert: string;
  key: string;
}

/** Where `pnpm cert` puts the pair and the server looks for it: packages/server/cert/. */
export const DEFAULT_CERT_FILES: CertFiles = {
  cert: join(SERVER_DIR, 'cert', 'cert.pem'),
  key: join(SERVER_DIR, 'cert', 'key.pem'),
};

/** How the server speaks: TLS with the pair as read from disk, or plain http and why. */
export type Tls =
  | { on: true; files: CertFiles; cert: Buffer; key: Buffer }
  | { on: false; why: 'switched-off' | 'no-certificate' };

const PARTS = ['cert', 'key'] as const;

/** The variables that name the pair's files, by part. */
const VARIABLES: Record<keyof CertFiles, string> = { cert: 'TLS_CERT', key: 'TLS_KEY' };

/** What TLS_CERT and TLS_KEY name, by part; undefined where unset. */
type NamedFiles = Record<keyof CertFiles, string | undefined>;

/** What TLS_CERT and TLS_KEY name; an empty variable counts as unset, like an empty RUNS_LOG. */
function namedFiles(env: NodeJS.ProcessEnv): NamedFiles {
  return { cert: env['TLS_CERT'] || undefined, key: env['TLS_KEY'] || undefined };
}

/** A path for the log: from the server package where it lies inside it, else as it is. */
function shown(path: string): string {
  const inside = relative(SERVER_DIR, path);
  return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) ? path : inside;
}

/** What to do about a pair that will not do: make a new one, or set the variables right. */
function fixFor(named: NamedFiles): string {
  const fix =
    named.cert === undefined && named.key === undefined
      ? '`pnpm cert --force` erzeugt ein neues Paar'
      : 'TLS_CERT und TLS_KEY müssen auf ein brauchbares Paar zeigen';
  return `${fix}, TLS=off startet mit http`;
}

/**
 * The pair at `files`, read and checked: both there, and a certificate with
 * its key. Throws, naming what is wrong and the fix, where a file is missing
 * or the two make no usable pair.
 */
function loadPair(files: CertFiles, named: NamedFiles): Tls {
  const missing = PARTS.filter((part) => !existsSync(files[part]));
  if (missing.length > 0) {
    const what = missing.map((part) =>
      named[part] === undefined
        ? `${shown(files[part])} fehlt`
        : `${VARIABLES[part]} nennt ${files[part]}, die Datei gibt es nicht`,
    );
    throw new Error(`TLS: ${what.join(', ')} — ${fixFor(named)}`);
  }
  const pair = { cert: readFileSync(files.cert), key: readFileSync(files.key) };
  try {
    createSecureContext(pair);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `TLS: ${shown(files.cert)} und ${shown(files.key)} ergeben kein brauchbares Paar ` +
        `(${why}) — ${fixFor(named)}`,
      { cause: err },
    );
  }
  return { on: true, files, ...pair };
}

/**
 * Whether the server speaks TLS, from the environment and the files: TLS=off
 * never does; otherwise the pair at TLS_CERT and TLS_KEY, each defaulting to
 * packages/server/cert/, decides, and with neither variable set and neither
 * default file there it is http. Throws, naming the file and the fix, where a
 * pair is meant but will not do — half the default pair, a file named in
 * TLS_CERT or TLS_KEY that is not there, files that make no certificate and
 * key — and where TLS holds anything but `off`.
 */
export function tlsSetup(env: NodeJS.ProcessEnv, defaults: CertFiles = DEFAULT_CERT_FILES): Tls {
  const mode = env['TLS'] ?? '';
  if (mode === 'off') {
    return { on: false, why: 'switched-off' };
  }
  if (mode !== '') {
    throw new Error(
      `TLS=${mode} versteht der Server nicht — TLS=off erzwingt http, ` +
        'ohne TLS entscheidet das Zertifikat',
    );
  }
  const named = namedFiles(env);
  const unset = named.cert === undefined && named.key === undefined;
  if (unset && !PARTS.some((part) => existsSync(defaults[part]))) {
    return { on: false, why: 'no-certificate' };
  }
  return loadPair({ cert: named.cert ?? defaults.cert, key: named.key ?? defaults.key }, named);
}

/** The start-up log's line on TLS: on with the certificate's path, or off and how to turn it on. */
export function tlsLogLine(tls: Tls): string {
  if (tls.on) {
    return `TLS: an (${shown(tls.files.cert)})`;
  }
  return tls.why === 'switched-off'
    ? 'TLS: aus (TLS=off)'
    : 'TLS: aus — `pnpm cert` erzeugt ein Zertifikat';
}

/** The server for the site, the API and the game's socket: https with the pair, else http. */
export function createWebServer(tls: Tls, handler: RequestListener): Server {
  return tls.on
    ? createHttpsServer({ cert: tls.cert, key: tls.key }, handler)
    : createHttpServer(handler);
}

/** Every LAN IPv4 address of this machine: where phones on the same network find the game. */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  return Object.values(interfaces)
    .flat()
    .filter(
      (net): net is NetworkInterfaceInfo =>
        net !== undefined && net.family === 'IPv4' && !net.internal,
    )
    .map((net) => net.address);
}

/** The game's address on each of `addresses`, https where the server speaks TLS. */
export function lanUrls(
  port: number,
  secure: boolean,
  addresses: readonly string[] = lanAddresses(),
): string[] {
  const scheme = secure ? 'https' : 'http';
  return addresses.map((address) => `${scheme}://${address}:${port}`);
}
