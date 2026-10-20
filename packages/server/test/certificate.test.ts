import { spawnSync } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CERT_DAYS, makeCertificate, subjectAltNames } from '../src/certificate.js';
import type { CertFiles } from '../src/tls.js';

/** Whether this machine has openssl: the tests that make a certificate need it. */
const HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0;
if (!HAS_OPENSSL) {
  console.log('[certificate.test] no openssl on the PATH: the tests that make a certificate skip');
}

/** A pair's places in a fresh folder, inside a subfolder nobody has made yet. */
function freshFiles(): CertFiles {
  const dir = join(mkdtempSync(join(tmpdir(), 'escapelab-cert-')), 'cert');
  return { cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') };
}

/** The certificate at `files`, as a browser would read it. */
function certificateAt(files: CertFiles): X509Certificate {
  return new X509Certificate(readFileSync(files.cert));
}

describe('the names a certificate answers to', () => {
  it('are localhost, 127.0.0.1 and every LAN address, in that order', () => {
    expect(subjectAltNames(['10.0.0.184', '192.168.64.1'])).toEqual([
      'DNS:localhost',
      'IP:127.0.0.1',
      'IP:10.0.0.184',
      'IP:192.168.64.1',
    ]);
  });

  it('are localhost and 127.0.0.1 alone on a machine off every network', () => {
    expect(subjectAltNames([])).toEqual(['DNS:localhost', 'IP:127.0.0.1']);
  });

  it('name each address once', () => {
    expect(subjectAltNames(['10.0.0.184', '127.0.0.1', '10.0.0.184'])).toEqual([
      'DNS:localhost',
      'IP:127.0.0.1',
      'IP:10.0.0.184',
    ]);
  });
});

describe('making a certificate', () => {
  it('says what to do where openssl is not installed', () => {
    const files = freshFiles();
    expect(() =>
      makeCertificate({ files, addresses: [], force: false, openssl: 'escapelab-no-openssl' }),
    ).toThrow(/^escapelab-no-openssl nicht gefunden — macOS und Linux bringen openssl mit/);
  });

  it('leaves half a pair alone too, and says how to replace it', () => {
    const files = freshFiles();
    mkdirSync(join(files.key, '..'), { recursive: true });
    writeFileSync(files.key, 'KEY');
    expect(() => makeCertificate({ files, addresses: [], force: false })).toThrow(
      `${files.key}: gibt es schon — \`pnpm cert --force\` ersetzt das Paar`,
    );
    expect(readFileSync(files.key, 'utf8')).toBe('KEY');
  });

  describe.skipIf(!HAS_OPENSSL)('with openssl', () => {
    it('writes a pair for this machine: its names, 825 days, for servers, the key private', () => {
      const files = freshFiles();
      const names = makeCertificate({ files, addresses: ['10.0.0.184'], force: false });
      expect(names).toEqual(['DNS:localhost', 'IP:127.0.0.1', 'IP:10.0.0.184']);
      const cert = certificateAt(files);
      expect(cert.subject).toBe('CN=EscapeLab (lokal)');
      expect(cert.issuer).toBe(cert.subject);
      expect(cert.subjectAltName).toBe(
        'DNS:localhost, IP Address:127.0.0.1, IP Address:10.0.0.184',
      );
      const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000;
      expect(days).toBe(CERT_DAYS);
      // Extended key usage: TLS server authentication, which iOS asks for.
      expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
      expect(cert.checkPrivateKey(createPrivateKey(readFileSync(files.key)))).toBe(true);
      expect(statSync(files.key).mode & 0o777).toBe(0o600);
    });

    it('leaves a pair that is there alone, and replaces it with --force', () => {
      const files = freshFiles();
      makeCertificate({ files, addresses: [], force: false });
      const first = certificateAt(files).fingerprint256;
      expect(() => makeCertificate({ files, addresses: [], force: false })).toThrow(
        `${files.cert} und ${files.key}: gibt es schon — \`pnpm cert --force\` ersetzt das Paar`,
      );
      expect(certificateAt(files).fingerprint256).toBe(first);
      makeCertificate({ files, addresses: ['192.168.64.1'], force: true });
      const second = certificateAt(files);
      expect(second.fingerprint256).not.toBe(first);
      expect(second.subjectAltName).toContain('IP Address:192.168.64.1');
    });

    it("passes on openssl's own words where it fails", () => {
      expect(() =>
        makeCertificate({ files: freshFiles(), addresses: ['kein.ip'], force: false }),
      ).toThrow(/^openssl ist gescheitert \(Exit 1\): \S/);
    });
  });
});
