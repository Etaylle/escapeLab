import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailySalt } from '../src/dailySalt.js';

describe('the Tagesschicht’s salt', () => {
  let dir = '';
  let file = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-salt-'));
    file = join(dir, 'data', 'daily-salt');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is DAILY_SALT where it is set, and then nothing is written', () => {
    expect(dailySalt({ DAILY_SALT: 'kaltenbrunn-c' }, file)).toEqual({
      salt: 'kaltenbrunn-c',
      from: 'env',
    });
    expect(existsSync(file)).toBe(false);
  });

  it('is made at random once, readable by the server alone, and kept across restarts', () => {
    const first = dailySalt({ DAILY_SALT: '' }, file);
    expect(first.from).toBe('made');
    expect(first.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, 'utf8').trim()).toBe(first.salt);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(dailySalt({}, file)).toEqual({ salt: first.salt, from: 'file' });
    const elsewhere = join(dir, 'other', 'daily-salt');
    expect(dailySalt({}, elsewhere).salt).not.toBe(first.salt);
  });

  it('refuses a kept file that holds no salt, saying what to do', () => {
    dailySalt({}, file);
    writeFileSync(file, '\n');
    expect(() => dailySalt({}, file)).toThrow(/kein Salz.*löschen.*DAILY_SALT/);
  });
});
