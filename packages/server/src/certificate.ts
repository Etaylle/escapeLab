import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CertFiles } from './tls.js';

/**
 * `pnpm cert`'s work (scripts/cert.ts): a self-signed certificate for this
 * machine on the LAN, made by the openssl command line, which macOS and Linux
 * bring along. The server needs none of it: without the pair it speaks http.
 */

/** Days a certificate made here holds: iOS refuses a server certificate valid for longer. */
export const CERT_DAYS = 825;

/** The certificate's subject, as a browser's warning names it. */
export const CERT_SUBJECT = 'EscapeLab (lokal)';

/**
 * The names a certificate for `addresses` answers to, as openssl's
 * subjectAltName takes them: localhost, 127.0.0.1 and every LAN address, each
 * once, in that order.
 */
export function subjectAltNames(addresses: readonly string[]): string[] {
  const ips = addresses.map((address) => `IP:${address}`);
  return [...new Set(['DNS:localhost', 'IP:127.0.0.1', ...ips])];
}

/** The openssl command line that writes the pair for `altNames`, the key without a passphrase. */
function opensslArgs(files: CertFiles, altNames: readonly string[]): string[] {
  return [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    String(CERT_DAYS),
    '-keyout',
    files.key,
    '-out',
    files.cert,
    '-subj',
    `/CN=${CERT_SUBJECT}`,
    '-addext',
    `subjectAltName=${altNames.join(',')}`,
    // iOS takes a server certificate only where it names this purpose.
    '-addext',
    'extendedKeyUsage=serverAuth',
  ];
}

/** What openssl said about a failure, its progress dots left out. */
function complaint(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^[.+*-]+$/.test(line));
  return lines.slice(0, 4).join(' / ') || 'ohne Meldung';
}

/** A certificate to make. */
export interface CertRequest {
  files: CertFiles;
  /** the LAN addresses it is for, besides localhost and 127.0.0.1 */
  addresses: readonly string[];
  /** replace a pair that is there already */
  force: boolean;
  /** the openssl to run: the one on the PATH unless a test names another */
  openssl?: string;
}

/**
 * Writes a fresh pair to `request.files` — folders made as needed, the key
 * readable by its owner only — and returns the names it answers to. Throws
 * with what to do where a file of the pair is there already and `force` is
 * not set, where openssl is not installed, and where it fails.
 */
export function makeCertificate(request: CertRequest): string[] {
  const { files, force, openssl = 'openssl' } = request;
  const present = [files.cert, files.key].filter((file) => existsSync(file));
  if (present.length > 0 && !force) {
    throw new Error(
      `${present.join(' und ')}: gibt es schon — \`pnpm cert --force\` ersetzt das Paar`,
    );
  }
  const altNames = subjectAltNames(request.addresses);
  for (const file of [files.cert, files.key]) {
    mkdirSync(dirname(file), { recursive: true });
  }
  const run = spawnSync(openssl, opensslArgs(files, altNames), { encoding: 'utf8' });
  if (run.error !== undefined) {
    const missing = (run.error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new Error(
      missing
        ? `${openssl} nicht gefunden — macOS und Linux bringen openssl mit, sonst ` +
            'nachinstallieren (z. B. apt install openssl); ohne Zertifikat spricht der Server http'
        : `${openssl} ließ sich nicht starten: ${run.error.message}`,
    );
  }
  if (run.status !== 0) {
    const exit = run.status ?? run.signal;
    throw new Error(`${openssl} ist gescheitert (Exit ${exit}): ${complaint(run.stderr)}`);
  }
  chmodSync(files.key, 0o600);
  return altNames;
}
