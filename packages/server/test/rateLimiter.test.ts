import { describe, expect, it } from 'vitest';
import { clientAddress } from '../src/rateLimiter.js';

/** Who a request comes from, as the limits on writes count it. */

describe('the address a request comes from', () => {
  it('is the client a proxy put first: behind Render’s proxy its own address is everyone’s', () => {
    const proxied = {
      headers: { 'x-forwarded-for': '203.0.113.7, 172.71.195.123, 10.226.90.65' },
      socket: { remoteAddress: '10.226.90.65' },
    };
    expect(clientAddress(proxied)).toBe('203.0.113.7');
    const twice = {
      headers: { 'x-forwarded-for': ['198.51.100.4', '10.0.0.1'] },
      socket: { remoteAddress: undefined },
    };
    expect(clientAddress(twice)).toBe('198.51.100.4');
  });

  it('is the socket’s own where no proxy is in front, as on the LAN', () => {
    expect(clientAddress({ headers: {}, socket: { remoteAddress: '192.168.1.20' } })).toBe(
      '192.168.1.20',
    );
    const nobody = { headers: { 'x-forwarded-for': ' ' }, socket: { remoteAddress: undefined } };
    expect(clientAddress(nobody)).toBe('unknown');
  });
});
