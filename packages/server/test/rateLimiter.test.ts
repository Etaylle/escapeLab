import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientAddress,
  frontOf,
  MAX_KEY_LENGTH,
  RateLimiter,
  type Sender,
} from '../src/rateLimiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('the limiter’s memory', () => {
  it('lets go of every address whose window has passed, at the next check', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    for (let i = 0; i < 10_000; i += 1) {
      limiter.take(`2001:db8::${i.toString(16)}`);
    }
    now = 59_999;
    limiter.take('198.51.100.4');
    expect(limiter.size).toBe(10_001);
    // A window since the last sweep: the ten thousand are gone, the one written since stays.
    now = 60_000;
    expect(limiter.take('198.51.100.4')).toBe(true);
    expect(limiter.size).toBe(1);
    expect(limiter.take('198.51.100.4')).toBe(false);
  });

  it('lets go of them on its timer, though nobody writes any more', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(2, 60_000);
    const stop = limiter.sweepEveryWindow();
    limiter.take('203.0.113.7');
    vi.advanceTimersByTime(59_999);
    expect(limiter.size).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(limiter.size).toBe(0);
    stop();
  });

  it('keeps no key longer than its cap: a longer one counts by its beginning', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    const long = 'a'.repeat(MAX_KEY_LENGTH);
    expect(limiter.take(`${long}x`)).toBe(true);
    expect(limiter.take(`${long}${'y'.repeat(10_000)}`)).toBe(false);
    expect(limiter.size).toBe(1);
  });
});

/** Who a request comes from, as the limits on writes count it. */

/** A request with `headers`, its socket from `remote`: Render's balancer unless said otherwise. */
const sent = (headers: IncomingHttpHeaders, remote = '10.226.90.65'): Sender => ({
  headers,
  socket: { remoteAddress: remote },
});

describe('the address a request comes from, behind Render', () => {
  it('is Cloudflare’s connecting address, else its true client address', () => {
    const both = { 'cf-connecting-ip': '203.0.113.7', 'true-client-ip': '198.51.100.4' };
    expect(clientAddress(sent(both), 'render')).toBe('203.0.113.7');
    expect(clientAddress(sent({ 'true-client-ip': '198.51.100.4' }), 'render')).toBe(
      '198.51.100.4',
    );
  });

  it('is the last X-Forwarded-For, the one the proxy appended, never the client’s first', () => {
    // The client claimed a classmate's address; Cloudflare appended the one it came from.
    const spoofed = { 'x-forwarded-for': '192.0.2.10, 203.0.113.7' };
    expect(clientAddress(sent(spoofed), 'render')).toBe('203.0.113.7');
    const twice = { 'x-forwarded-for': ['192.0.2.10', '203.0.113.8'] };
    expect(clientAddress(sent(twice), 'render')).toBe('203.0.113.8');
  });

  it('counts only a valid IP address: anything else falls through to the next source', () => {
    const forged = { 'cf-connecting-ip': 'nobody', 'x-forwarded-for': '2001:DB8::1' };
    expect(clientAddress(sent(forged), 'render')).toBe('2001:db8::1');
    const junk = { 'cf-connecting-ip': '203.0.113.7, 198.51.100.4', 'x-forwarded-for': 'x' };
    expect(clientAddress(sent(junk), 'render')).toBe('10.226.90.65');
    expect(clientAddress(sent(junk, 'nowhere'), 'render')).toBe('unknown');
  });
});

describe('the address a request comes from, with nobody in front', () => {
  it('is the socket’s own: on the LAN every header is the client’s to write', () => {
    const claims = {
      'cf-connecting-ip': '192.0.2.10',
      'true-client-ip': '192.0.2.11',
      'x-forwarded-for': '192.0.2.12, 192.0.2.13',
    };
    expect(clientAddress(sent(claims, '192.168.1.20'), 'none')).toBe('192.168.1.20');
    expect(clientAddress(sent({}, '::ffff:192.168.1.20'), 'none')).toBe('::ffff:192.168.1.20');
    expect(clientAddress(sent(claims, ''), 'none')).toBe('unknown');
  });

  it('is behind Render only where Render says so, by RENDER', () => {
    expect([frontOf({ RENDER: 'true' }), frontOf({}), frontOf({ RENDER: '' })]).toEqual([
      'render',
      'none',
      'none',
    ]);
  });
});
