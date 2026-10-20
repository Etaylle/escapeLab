/**
 * `pnpm cert`: a self-signed certificate, so phones on the LAN reach the game
 * on a secure origin — the microphone and the wake lock need one. Writes
 * packages/server/cert/cert.pem and key.pem for localhost, 127.0.0.1 and every
 * LAN IPv4 of this machine; the server speaks https from its next start.
 * `--force` replaces a pair that is there, as after a move to another network.
 * Run with: pnpm cert [--force]
 */
import { CERT_DAYS, makeCertificate } from '../src/certificate.js';
import { DEFAULT_CERT_FILES, lanAddresses, lanUrls } from '../src/tls.js';

function fail(message: string): never {
  console.error(`[cert] ${message}`);
  process.exit(1);
}

// pnpm passes on a `--` typed before the options.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const unknown = args.filter((arg) => arg !== '--force');
if (unknown.length > 0) {
  fail(`${unknown.join(' ')}: unbekannt — pnpm cert [--force]`);
}

const addresses = lanAddresses();
let names: string[];
try {
  names = makeCertificate({
    files: DEFAULT_CERT_FILES,
    addresses,
    force: args.includes('--force'),
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const port = Number(process.env['PORT'] || 3001);
const where = lanUrls(port, true, addresses).join(' oder ') || `https://<LAN-IP>:${port}`;
console.log(`[cert] Zertifikat: ${DEFAULT_CERT_FILES.cert}`);
console.log(`[cert] Schlüssel:  ${DEFAULT_CERT_FILES.key}`);
console.log(
  `[cert] gilt ${CERT_DAYS} Tage für ${names.map((name) => name.replace(/^\w+:/, '')).join(', ')}`,
);
console.log(
  `[cert] Handys: ${where} öffnen, die Warnung einmal bestätigen — Chrome: ` +
    '„Erweitert“, „Weiter zu … (unsicher)“; Safari: „Details einblenden“, ' +
    '„diese Website besuchen“',
);
console.log('[cert] Der Server spricht https ab dem nächsten Start (pnpm start).');
