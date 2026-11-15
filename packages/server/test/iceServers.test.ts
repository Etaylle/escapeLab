import { describe, expect, it } from 'vitest';
import { DEFAULT_ICE_SERVERS, iceLogLine, iceServers } from '../src/iceServers.js';

/**
 * The voice's ICE servers from the environment: public STUN while ICE_SERVERS is unset, the
 * list it holds otherwise — an empty one for a LAN —, and a wrong list refused at the start,
 * saying what is wrong.
 */

describe('iceServers', () => {
  it('goes by public STUN while ICE_SERVERS is unset or blank', () => {
    for (const env of [{}, { ICE_SERVERS: '' }, { ICE_SERVERS: '  ' }]) {
      expect(iceServers(env)).toEqual({ servers: DEFAULT_ICE_SERVERS, from: 'default' });
    }
    expect(DEFAULT_ICE_SERVERS.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
  });

  it('takes an empty list for a LAN, and says in the log that no STUN is there', () => {
    const setup = iceServers({ ICE_SERVERS: '[]' });
    expect(setup).toEqual({ servers: [], from: 'env' });
    expect(iceLogLine(setup)).toContain('one network only');
  });

  it('takes STUN and TURN with its credentials, and logs the addresses without them', () => {
    const turn = {
      urls: ['turn:turn.example.org:3478', 'turns:turn.example.org:5349'],
      username: 'crew',
      credential: 'geheim',
    };
    const list = [{ urls: 'stun:stun.example.org:3478' }, turn];
    const setup = iceServers({ ICE_SERVERS: JSON.stringify(list) });
    expect(setup.servers).toEqual(list);
    const line = iceLogLine(setup);
    expect(line).toContain('turns:turn.example.org:5349');
    expect(line).toContain('with TURN');
    expect(line).not.toContain('geheim');
  });

  it('refuses what is no JSON, no list, a wrong address or TURN without credentials', () => {
    const wrong: [string, RegExp][] = [
      ['stun:stun.l.google.com:19302', /kein JSON/],
      ['{"urls":"stun:a.example:3478"}', /stimmt nicht/],
      ['[{"urls":"http://a.example"}]', /stun:, stuns:, turn: or turns: \(0\.urls\)/],
      ['[{"urls":"turn:a.example:3478"}]', /needs a username and a credential/],
      ['[{"urls":"stun:a.example","user":"x"}]', /stimmt nicht/],
    ];
    for (const [text, why] of wrong) {
      expect(() => iceServers({ ICE_SERVERS: text }), text).toThrow(why);
    }
  });
});
