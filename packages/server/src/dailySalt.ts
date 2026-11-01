import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the server keeps the Tagesschicht's salt while DAILY_SALT is unset: made here, kept. */
export const DAILY_SALT_FILE = fileURLToPath(new URL('../data/daily-salt', import.meta.url));

/** The Tagesschicht's salt, and where it came from: DAILY_SALT, the kept file, or made anew. */
export interface DailySalt {
  salt: string;
  from: 'env' | 'file' | 'made';
}

/** Whether a failed file call failed with `code`. */
function failedWith(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** The salt kept in `file`; null where there is no file yet. Throws for a file without one. */
function keptSalt(file: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (failedWith(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
  const salt = text.trim();
  if (salt === '') {
    throw new Error(
      `${file} hält kein Salz für die Tagesschicht — die Datei löschen, dann macht der Server ` +
        'ein neues, oder DAILY_SALT setzen',
    );
  }
  return salt;
}

/**
 * The salt the Tagesschicht's seeds are made with (core daily.ts `dailySeed`), held by the
 * server alone, so that nobody works a day's instance out from its date: DAILY_SALT where it is
 * set; else the one kept in `file`; else a new one, made at random and written there once, so
 * that the day's instance stays the same across a restart. Where another server wrote the file
 * first, its salt counts.
 */
export function dailySalt(env: NodeJS.ProcessEnv, file = DAILY_SALT_FILE): DailySalt {
  const given = env['DAILY_SALT'] ?? '';
  if (given !== '') {
    return { salt: given, from: 'env' };
  }
  const kept = keptSalt(file);
  if (kept !== null) {
    return { salt: kept, from: 'file' };
  }
  const made = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${made}\n`, { flag: 'wx', mode: 0o600 });
    return { salt: made, from: 'made' };
  } catch (error) {
    const first = failedWith(error, 'EEXIST') ? keptSalt(file) : null;
    if (first === null) {
      throw error;
    }
    return { salt: first, from: 'file' };
  }
}
