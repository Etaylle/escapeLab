import { describe, expect, it } from 'vitest';
import { CHAT_LOG_LINES, loggedLines, logLine, logRoom } from '../src/chatLog.js';
import { opensField, type WriteKeyLike } from '../src/screens/TypedChat.js';

/**
 * The typed chat on the page: the write key opens the field only plain and while nothing else
 * has the keys, and the log keeps the room's last lines, emptied in another room.
 */

const key = (name: string, more: Partial<WriteKeyLike> = {}): WriteKeyLike => ({
  key: name,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  defaultPrevented: false,
  ...more,
});

describe('the write key', () => {
  it('opens the field by the bound key, Shift or not, and by no other', () => {
    expect(opensField(key('t'), 't', false)).toBe(true);
    expect(opensField(key('T'), 't', false)).toBe(true);
    expect(opensField(key('c'), 't', false)).toBe(false);
    expect(opensField(key('g'), 'g', false)).toBe(true);
  });

  it('leaves a busy keyboard, a held key, a modifier and a key taken elsewhere alone', () => {
    expect(opensField(key('t'), 't', true)).toBe(false);
    for (const more of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(opensField(key('t', more), 't', false), JSON.stringify(more)).toBe(false);
    }
    expect(opensField(key('t', { defaultPrevented: true }), 't', false)).toBe(false);
  });
});

describe('the chat log', () => {
  it('keeps the last lines of the room, and starts empty in another one', () => {
    logRoom('ABCD');
    for (let i = 1; i <= CHAT_LOG_LINES + 2; i++) {
      logLine('p1', `Zeile ${i}`);
    }
    const kept = loggedLines();
    expect(kept.map((line) => line.text)).toEqual(
      Array.from({ length: CHAT_LOG_LINES }, (_, i) => `Zeile ${i + 3}`),
    );
    logRoom('ABCD');
    expect(loggedLines()).toBe(kept);
    logRoom(null);
    expect(loggedLines()).toEqual([]);
  });
});
