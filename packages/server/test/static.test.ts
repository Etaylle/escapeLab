import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { StaticSite } from '../src/static.js';

/** A built client in a temporary folder: index.html and `files`, by path and content. */
function siteWith(files: Record<string, string> = {}): StaticSite {
  const root = mkdtempSync(join(tmpdir(), 'escapelab-static-'));
  for (const [path, content] of Object.entries({
    'index.html': '<!doctype html><title>t</title>',
    ...files,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return new StaticSite(root);
}

/** A writable the file can be piped into, recording status and headers instead of sending them. */
function fakeResponse(): {
  res: ServerResponse;
  status: () => number | null;
  headers: () => Record<string, string>;
} {
  let status: number | null = null;
  let headers: Record<string, string> = {};
  const res = Object.assign(new PassThrough(), {
    writeHead(code: number, sent: Record<string, string> = {}) {
      status = code;
      headers = sent;
      return res;
    },
  });
  return { res: res as unknown as ServerResponse, status: () => status, headers: () => headers };
}

function request(url: string): IncomingMessage {
  return { url, method: 'GET' } as IncomingMessage;
}

describe('StaticSite', () => {
  it('serves the index for the root and for unknown paths', () => {
    const site = siteWith();
    for (const url of ['/', '/some/deep/link']) {
      const { res, status } = fakeResponse();
      expect(site.serve(request(url), res)).toBe(true);
      expect(status()).toBe(200);
    }
  });

  it('serves the page itself for the editor’s address, which a shared link opens', async () => {
    const site = siteWith();
    const { res, status, headers } = fakeResponse();
    expect(site.serve(request('/editor'), res)).toBe(true);
    expect(status()).toBe(200);
    expect(headers()['content-type']).toBe('text/html; charset=utf-8');
    const chunks: Buffer[] = [];
    for await (const chunk of res as unknown as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('<!doctype html><title>t</title>');
  });

  it('answers a malformed percent-encoding instead of throwing', () => {
    const site = siteWith();
    const { res, status } = fakeResponse();
    expect(() => site.serve(request('/%E0%A4%A'), res)).not.toThrow();
    expect(status()).toBe(400);
  });

  it('serves the app files with the types a browser installs and runs them by', () => {
    const site = siteWith({
      'sw.js': 'self.addEventListener("fetch", () => {});',
      'manifest.webmanifest': '{"name":"EscapeLab"}',
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'assets/index-1.js': 'export {};',
    });
    const served = (url: string): Record<string, string> => {
      const { res, headers } = fakeResponse();
      site.serve(request(url), res);
      return headers();
    };
    expect(served('/manifest.webmanifest')).toEqual({
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'no-cache',
    });
    // A worker cached for long would hide every new version behind the old one.
    expect(served('/sw.js')).toEqual({
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
    expect(served('/icon.svg')['content-type']).toBe('image/svg+xml');
    expect(served('/assets/index-1.js')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});
