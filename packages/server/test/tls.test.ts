import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, RequestListener, Server } from 'node:http';
import { tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { duplexPair, type Duplex } from 'node:stream';
import { connect, type TLSSocket } from 'node:tls';
import { beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { makeCertificate } from '../src/certificate.js';
import {
  createWebServer,
  DEFAULT_CERT_FILES,
  lanAddresses,
  lanUrls,
  tlsLogLine,
  tlsSetup,
  type CertFiles,
  type Tls,
} from '../src/tls.js';

/** Whether this machine has openssl: the tests with a real certificate need it. */
const HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0;
if (!HAS_OPENSSL) {
  console.log('[tls.test] no openssl on the PATH: the tests with a real certificate skip');
}

/** A pair's places in a folder of their own, with the files of `contents` written. */
function pairIn(contents: { cert?: string; key?: string } = {}): CertFiles {
  const dir = mkdtempSync(join(tmpdir(), 'escapelab-tls-'));
  const files = { cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') };
  for (const part of ['cert', 'key'] as const) {
    const content = contents[part];
    if (content !== undefined) {
      writeFileSync(files[part], content);
    }
  }
  return files;
}

describe('whether the server speaks TLS', () => {
  it('speaks http while there is no certificate, and says how to make one', () => {
    const tls = tlsSetup({}, pairIn());
    expect(tls).toEqual({ on: false, why: 'no-certificate' });
    expect(tlsLogLine(tls)).toBe('TLS: aus — `pnpm cert` erzeugt ein Zertifikat');
  });

  it('stays on http with TLS=off, the pair there or not', () => {
    const tls = tlsSetup({ TLS: 'off' }, pairIn({ cert: 'CERT', key: 'KEY' }));
    expect(tls).toEqual({ on: false, why: 'switched-off' });
    expect(tlsLogLine(tls)).toBe('TLS: aus (TLS=off)');
  });

  it('counts an empty variable as unset', () => {
    const tls = tlsSetup({ TLS: '', TLS_CERT: '', TLS_KEY: '' }, pairIn());
    expect(tls).toEqual({ on: false, why: 'no-certificate' });
  });

  it('refuses half a pair, naming the missing file and the fix', () => {
    const files = pairIn({ cert: 'CERT' });
    expect(() => tlsSetup({}, files)).toThrow(
      `TLS: ${files.key} fehlt — \`pnpm cert --force\` erzeugt ein neues Paar, ` +
        'TLS=off startet mit http',
    );
  });

  it('refuses a TLS_CERT that names no file, the default pair there or not', () => {
    const env = { TLS_CERT: '/nirgends/cert.pem' };
    expect(() => tlsSetup(env, pairIn({ cert: 'CERT', key: 'KEY' }))).toThrow(
      'TLS: TLS_CERT nennt /nirgends/cert.pem, die Datei gibt es nicht — ' +
        'TLS_CERT und TLS_KEY müssen auf ein brauchbares Paar zeigen, TLS=off startet mit http',
    );
  });

  it('refuses files that make no certificate and key, naming both and the fix', () => {
    const files = pairIn({ cert: 'CERT', key: 'KEY' });
    const load = (env: NodeJS.ProcessEnv) => () => tlsSetup(env, files);
    expect(load({})).toThrow(`TLS: ${files.cert} und ${files.key} ergeben kein brauchbares Paar (`);
    expect(load({})).toThrow(
      ') — `pnpm cert --force` erzeugt ein neues Paar, TLS=off startet mit http',
    );
    expect(load({ TLS_CERT: files.cert, TLS_KEY: files.key })).toThrow(
      ') — TLS_CERT und TLS_KEY müssen auf ein brauchbares Paar zeigen, TLS=off startet mit http',
    );
  });

  it('understands no TLS but off', () => {
    expect(() => tlsSetup({ TLS: 'on' }, pairIn())).toThrow(/^TLS=on versteht der Server nicht/);
  });
});

describe('the start-up log', () => {
  /** TLS on with the pair at `files`; what was read does not matter for the log. */
  const on = (files: CertFiles): Tls => ({
    on: true,
    files,
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  });

  it('names the certificate in its own place from the server package', () => {
    expect(tlsLogLine(on(DEFAULT_CERT_FILES))).toBe('TLS: an (cert/cert.pem)');
  });

  it('names a certificate elsewhere by its whole path', () => {
    const files = pairIn();
    expect(tlsLogLine(on(files))).toBe(`TLS: an (${files.cert})`);
  });
});

/** A network interface as os.networkInterfaces() lists one. */
function nic(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  const mac = '00:00:00:00:00:00';
  return family === 'IPv4'
    ? { address, family, internal, mac, netmask: '255.255.255.0', cidr: `${address}/24` }
    : { address, family, internal, mac, netmask: 'ffff:ffff:ffff:ffff::', cidr: null, scopeid: 0 };
}

describe('the addresses phones are given', () => {
  it('are the LAN IPv4 addresses, none internal', () => {
    const interfaces = {
      lo0: [nic('127.0.0.1', 'IPv4', true), nic('::1', 'IPv6', true)],
      en0: [nic('fe80::1', 'IPv6'), nic('10.0.0.184', 'IPv4')],
      bridge100: [nic('192.168.64.1', 'IPv4')],
      utun0: undefined,
    };
    expect(lanAddresses(interfaces)).toEqual(['10.0.0.184', '192.168.64.1']);
  });

  it('start with https where the server speaks TLS, with http where not', () => {
    expect(lanUrls(3001, true, ['10.0.0.184', '192.168.64.1'])).toEqual([
      'https://10.0.0.184:3001',
      'https://192.168.64.1:3001',
    ]);
    expect(lanUrls(8080, false, ['10.0.0.184'])).toEqual(['http://10.0.0.184:8080']);
  });
});

/** The site's stand-in: /health answers as the server's does, anything else is 404. */
const site: RequestListener = (req, res) => {
  const found = req.url === '/health';
  res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
  res.end(found ? '{"ok":true}' : '{}');
};

/**
 * A connection to `server` with no port bound: one end of an in-memory pipe
 * goes to the server as its connection, the other comes back.
 */
function pipeTo(server: Server): Duplex {
  const [inbound, outbound] = duplexPair();
  server.emit('connection', inbound);
  return outbound;
}

/** The same with TLS on top, the certificate taken as it comes — as a phone past its warning. */
function tlsPipeTo(server: Server): TLSSocket {
  return connect({ socket: pipeTo(server), servername: 'localhost', rejectUnauthorized: false });
}

/** One GET of `path` over `socket`: the raw answer, head and body, once the server closed. */
async function get(socket: Duplex, path: string): Promise<string> {
  socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  let answer = '';
  for await (const chunk of socket) {
    answer += String(chunk);
  }
  return answer;
}

describe('the server without a certificate', () => {
  it('speaks plain http', async () => {
    const server = createWebServer({ on: false, why: 'no-certificate' }, site);
    const answer = await get(pipeTo(server), '/health');
    expect(answer).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(answer).toContain('\r\n{"ok":true}\r\n');
  });
});

describe.skipIf(!HAS_OPENSSL)('the server with a certificate from pnpm cert', () => {
  const files = pairIn();
  const other = pairIn();
  beforeAll(() => {
    makeCertificate({ files, addresses: ['10.0.0.184'], force: false });
    makeCertificate({ files: other, addresses: [], force: false });
  });

  it('speaks TLS once the pair is there, with both files as they are', () => {
    expect(tlsSetup({}, files)).toEqual({
      on: true,
      files,
      cert: readFileSync(files.cert),
      key: readFileSync(files.key),
    });
  });

  it('takes the pair from TLS_CERT and TLS_KEY before its own place', () => {
    const tls = tlsSetup({ TLS_CERT: files.cert, TLS_KEY: files.key }, pairIn());
    expect(tls).toMatchObject({ on: true, files });
    expect(tlsLogLine(tls)).toBe(`TLS: an (${files.cert})`);
  });

  it("refuses a key that is not the certificate's", () => {
    const mixed = { TLS_CERT: files.cert, TLS_KEY: other.key };
    expect(() => tlsSetup(mixed, pairIn())).toThrow(
      `TLS: ${files.cert} und ${other.key} ergeben kein brauchbares Paar (`,
    );
  });

  it('answers over TLS, showing that certificate — /health and all', async () => {
    const server = createWebServer(tlsSetup({}, files), site);
    const socket = tlsPipeTo(server);
    await once(socket, 'secureConnect');
    const shown = socket.getPeerCertificate();
    expect(shown.subject.CN).toBe('EscapeLab (lokal)');
    expect(shown.subjectaltname).toBe('DNS:localhost, IP Address:127.0.0.1, IP Address:10.0.0.184');
    const answer = await get(socket, '/health');
    expect(answer).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(answer).toContain('\r\n{"ok":true}\r\n');
  });

  it("carries the game's socket as wss on /ws", async () => {
    const server = createWebServer(tlsSetup({}, files), site);
    const wss = new WebSocketServer({ server, path: '/ws' });
    const accepted = once(wss, 'connection');
    const client = new WebSocket('wss://localhost/ws', {
      createConnection: () => tlsPipeTo(server),
    });
    await once(client, 'open');
    const [, request] = (await accepted) as [WebSocket, IncomingMessage];
    expect(request.url).toBe('/ws');
    expect((request.socket as TLSSocket).encrypted).toBe(true);
    client.close();
    wss.close();
  });
});
