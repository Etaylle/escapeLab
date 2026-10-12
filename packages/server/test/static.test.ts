import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { StaticSite } from '../src/static.js';

function siteWithIndex(): StaticSite {
  const root = mkdtempSync(join(tmpdir(), 'escapelab-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>');
  return new StaticSite(root);
}

/** A writable the file can be piped into, recording the status instead of sending it. */
function fakeResponse(): { res: ServerResponse; status: () => number | null } {
  let status: number | null = null;
  const res = Object.assign(new PassThrough(), {
    writeHead(code: number) {
      status = code;
      return res;
    },
  });
  return { res: res as unknown as ServerResponse, status: () => status };
}

function request(url: string): IncomingMessage {
  return { url, method: 'GET' } as IncomingMessage;
}

describe('StaticSite', () => {
  it('serves the index for the root and for unknown paths', () => {
    const site = siteWithIndex();
    for (const url of ['/', '/some/deep/link']) {
      const { res, status } = fakeResponse();
      expect(site.serve(request(url), res)).toBe(true);
      expect(status()).toBe(200);
    }
  });

  it('answers a malformed percent-encoding instead of throwing', () => {
    const site = siteWithIndex();
    const { res, status } = fakeResponse();
    expect(() => site.serve(request('/%E0%A4%A'), res)).not.toThrow();
    expect(status()).toBe(400);
  });
});
