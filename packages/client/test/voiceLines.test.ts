import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE,
  PAUSE_MS,
  radioTexts,
  shippedLines,
  shippedMissions,
  speechText,
  VOICE_DIR,
  voiceId,
  type Entry,
} from '../scripts/voice.js';
import { idsOf } from '../src/world/radioVoice.js';

/** What to do when a shipped line has no recording. */
const REMEDY = 'record it on a Mac: pnpm --filter @escapelab/client voice';
const MAX_FILE_BYTES = 150 * 1024;
const MAX_FOLDER_BYTES = 3 * 1024 * 1024;

const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, Entry>;
const recordings = readdirSync(VOICE_DIR).filter((name) => name.endsWith('.m4a'));

describe('mission control’s recorded lines', () => {
  it('has a recording for every line a shipped mission can put on the air', () => {
    const lines = shippedLines();
    expect(lines.size).toBeGreaterThan(20);
    for (const [text, missions] of lines) {
      const id = voiceId(text);
      const entry = manifest[id];
      const said = `„${text}" (${missions.join(', ')})`;
      expect(entry, `${said} has no recording — ${REMEDY}`).toBeDefined();
      expect(entry?.text, `the recording ${id} says something else — ${REMEDY}`).toBe(text);
      expect(entry?.missions).toEqual([...missions].sort());
      const file = join(VOICE_DIR, `${id}.m4a`);
      expect(existsSync(file), `${id}.m4a is missing for „${text}" — ${REMEDY}`).toBe(true);
    }
  });

  it('keeps no recording that no shipped line needs any more', () => {
    const needed = new Set([...shippedLines().keys()].map(voiceId));
    expect(Object.keys(manifest).filter((id) => !needed.has(id)), REMEDY).toEqual([]);
    expect(recordings.filter((name) => !needed.has(name.slice(0, -4))), REMEDY).toEqual([]);
  });

  it('keeps every file under 150 kB and the folder under 3 MB', () => {
    const sizes = recordings.map((name) => statSync(join(VOICE_DIR, name)).size);
    for (const [i, size] of sizes.entries()) {
      expect(size, `${recordings[i]} is ${size} bytes`).toBeLessThanOrEqual(MAX_FILE_BYTES);
    }
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(MAX_FOLDER_BYTES);
  });

  it('knows how long each line speaks, and finds a line on the air by what it says', () => {
    for (const entry of Object.values(manifest)) {
      expect(entry.ms).toBeGreaterThan(500);
      expect(entry.ms).toBeLessThan(10_000);
    }
    const ids = idsOf(manifest);
    const start = 'Strom weg. Notlicht: Hebel im Flur, zu zweit.';
    expect(ids.get(start)).toBe(voiceId(start));
  });
});

describe('the lines the script reads', () => {
  it('takes every line core’s logRadio is handed: the start, every solve, the escape', () => {
    // A new source of radio lines in the reducer has to be read by the script as well.
    const actions = readFileSync(new URL('../../core/src/actions.ts', import.meta.url), 'utf8');
    const calls = [...actions.matchAll(/logRadio\(\w+, ([^,]+), \w+\)/g)].map((m) => m[1]);
    expect(calls).toEqual([
      'state.mission.radio.start',
      'solved?.onSolved',
      'state.mission.radio.escape',
    ]);
    const mission = {
      id: 'probe',
      radio: { start: 'Los.', escape: 'Raus.' },
      puzzles: [{ onSolved: 'Eins.' }, {}, { onSolved: 'Drei.' }],
    };
    expect(radioTexts(mission)).toEqual(['Los.', 'Eins.', 'Drei.', 'Raus.']);
    expect(radioTexts({ id: 'quiet', puzzles: [{}] })).toEqual([]);
  });

  it('reads every shipped mission', () => {
    const ids = shippedMissions().map((mission) => mission.id);
    expect(ids).toEqual(
      expect.arrayContaining(['blackout', 'systemcheck', 'doppelschicht', 'kettenreaktion']),
    );
  });

  it('names a recording by the first 12 hex digits of the SHA-1 of its line', () => {
    expect(voiceId('abc')).toBe('a9993e364706');
    expect(voiceId('Beide hin.')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('pauses at a dash, a middle dot or a colon, and reads the rest as it is written', () => {
    const pause = `[[slnc ${PAUSE_MS}]]`;
    expect(speechText('Strom weg. Notlicht: Hebel im Flur, zu zweit.')).toBe(
      `Strom weg. Notlicht ${pause} Hebel im Flur, zu zweit.`,
    );
    expect(speechText('Schott offen. Drohne wach – Kameraplatte vor dem Serverraum.')).toBe(
      `Schott offen. Drohne wach ${pause} Kameraplatte vor dem Serverraum.`,
    );
    expect(speechText('Pult A — Pult B · Flur')).toBe(`Pult A ${pause} Pult B ${pause} Flur`);
    expect(speechText('Zwei Pulte: eins zeigt.')).toBe(`Zwei Pulte ${pause} eins zeigt.`);
    expect(speechText('Um 2:30 sind es 20 Sekunden, Not-Aus.')).toBe(
      'Um 2:30 sind es 20 Sekunden, Not-Aus.',
    );
  });
});
