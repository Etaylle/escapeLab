import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves the built client bundle so one process and one URL are enough in
 * production. Unknown paths fall back to index.html — the client is a single
 * page, and that keeps a stray reload from 404ing.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class StaticSite {
  readonly available: boolean;

  constructor(private readonly root: string) {
    this.available = existsSync(join(root, 'index.html'));
  }

  /** Returns true when the request was answered. */
  serve(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.available || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return false;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // A broken escape sequence is a bad request, not a reason to go down.
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Ungültiger Pfad');
      return true;
    }
    const file = this.resolve(decoded) ?? this.resolve('/index.html');
    if (file === null) {
      return false;
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Hashed asset names let us cache hard; index.html must stay fresh.
    const cache = file.includes(`${'assets'}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(file).pipe(res);
    return true;
  }

  /** Map a URL path to a file inside the root, or null if it escapes or is missing. */
  private resolve(path: string): string | null {
    const clean = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const file = join(this.root, clean === '/' ? 'index.html' : clean);
    if (!file.startsWith(this.root)) {
      return null;
    }
    return existsSync(file) && statSync(file).isFile() ? file : null;
  }
}
