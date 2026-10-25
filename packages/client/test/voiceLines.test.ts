import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  engineOf,
  entryOf,
  freshOf,
  keeps,
  MANIFEST_FILE,
  modelUrl,
  PAUSE_MS,
  PIPER_MODEL,
  piperText,
  radioTexts,
  sayText,
  shippedLines,
  shippedMissions,
  SPOKEN_AS,
  VOICE_DIR,
  VOICES_URL,
  voiceId,
  type Entry,
} from '../scripts/voice.js';
import { idsOf, openersOf } from '../src/world/radioVoice.js';

/** What to do when a shipped line has no recording. */
const REMEDY = 'record it on a Mac: pnpm --filter @escapelab/client voice';
const MAX_FILE_BYTES = 150 * 1024;
const MAX_FOLDER_BYTES = 3 * 1024 * 1024;
/** How long a recorded word takes, ms: no faster than a 20-word line in 4 s, none drawn out. */
const MS_PER_WORD = { min: 200, max: 700 } as const;

const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, Entry>;
const recordings = readdirSync(VOICE_DIR).filter((name) => name.endsWith('.m4a'));

const wordsIn = (line: string): number =>
  line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

describe('mission control’s recorded lines', () => {
  it('has a recording for every line a shipped mission can put on the air', () => {
    const lines = shippedLines();
    expect(lines.size).toBeGreaterThan(40);
    for (const [text, { missions }] of lines) {
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

  it('knows how long each line speaks, at a pace a person speaks, and finds it by its words', () => {
    for (const entry of Object.values(manifest)) {
      const perWord = entry.ms / wordsIn(entry.text);
      expect(perWord, `„${entry.text}" in ${entry.ms} ms`).toBeGreaterThanOrEqual(MS_PER_WORD.min);
      expect(perWord, `„${entry.text}" in ${entry.ms} ms`).toBeLessThanOrEqual(MS_PER_WORD.max);
    }
    const ids = idsOf(manifest);
    const blackout = shippedMissions().find((mission) => mission.id === 'blackout');
    const start = blackout?.radio?.start ?? '';
    expect(start).toMatch(/^Leitstelle an Nachtschicht\./);
    expect(ids.get(start)).toBe(voiceId(start));
  });

  it('marks the lines that open a run, and only those: the radio opens the channel for them', () => {
    const starts = shippedMissions().flatMap((mission) => mission.radio?.start ?? []);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    expect([...openersOf(manifest)].sort()).toEqual(starts.map(voiceId).sort());
    for (const [text, { opens }] of shippedLines()) {
      expect(opens, text).toBe(starts.includes(text));
    }
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
    expect(shippedLines([mission]).get('Los.')).toEqual({ missions: ['probe'], opens: true });
    expect(shippedLines([mission]).get('Raus.')).toEqual({ missions: ['probe'], opens: false });
  });

  it('takes every line a nudge sends, the station’s own, before the line of its solve', () => {
    // The reducer's other source of mission control's lines: `nudge` logs a station's nudges.
    const actions = readFileSync(new URL('../../core/src/actions.ts', import.meta.url), 'utf8');
    expect(actions).toMatch(/\.nudges\[state\.nudgesGiven\]/);
    expect(actions).toMatch(/logEvent\(spoken, 'nudge', line, at\)/);
    const mission = {
      id: 'probe',
      puzzles: [{ nudges: ['Hier.', 'Dort.'], onSolved: 'Eins.' }, { nudges: ['Weiter.'] }],
    };
    expect(radioTexts(mission)).toEqual(['Hier.', 'Dort.', 'Eins.', 'Weiter.']);
    const blackout = shippedMissions().find((m) => m.id === 'blackout');
    const nudges = (blackout?.puzzles ?? []).flatMap((p) => p.nudges ?? []);
    expect(nudges).toHaveLength(12);
    for (const line of nudges) {
      expect(shippedLines().get(line)?.missions, line).toEqual(['blackout']);
    }
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
});

describe('the voice that reads them', () => {
  it('is Piper unless VOICE_ENGINE asks for the Mac’s own, and refuses any other', () => {
    expect(engineOf(undefined)).toBe('piper');
    expect(engineOf('')).toBe('piper');
    expect(engineOf('piper')).toBe('piper');
    expect(engineOf('say')).toBe('say');
    expect(() => engineOf('espeak')).toThrow(/VOICE_ENGINE="espeak".*"piper".*"say"/);
  });

  it('fetches a Piper voice from where the Piper voices keep it, and refuses a stray name', () => {
    expect(PIPER_MODEL).toBe('de_DE-thorsten-high');
    expect(modelUrl(PIPER_MODEL, '.onnx')).toBe(
      `${VOICES_URL}/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx`,
    );
    expect(modelUrl('de_DE-eva_k-x_low', '.onnx.json')).toBe(
      `${VOICES_URL}/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx.json`,
    );
    expect(VOICES_URL).toMatch(/^https:\/\/huggingface\.co\/rhasspy\/piper-voices\/resolve\//);
    expect(() => modelUrl('thorsten', '.onnx')).toThrow(/VOICE_MODEL="thorsten"/);
    expect(() => modelUrl('de_DE-../../etc-high', '.onnx')).toThrow(/VOICE_MODEL/);
  });
});

describe('a line as Piper reads it', () => {
  it('pauses at a dash or a middle dot as at a semicolon, and leaves colons and commas be', () => {
    expect(piperText('Vorsicht, die Drohne ist wach – die Platte hält sie.')).toBe(
      'Vorsicht, die Drohne ist wach; die Platte hält sie.',
    );
    expect(piperText('Pult A — Pult B · Flur')).toBe('Pult A; Pult B; Flur');
    expect(piperText('Zuerst das Licht: Der Hebel hängt im Flur.')).toBe(
      'Zuerst das Licht: Der Hebel hängt im Flur.',
    );
  });

  it('says a time as one, „Uhr" once, and leaves other numbers to be read as numbers', () => {
    expect(piperText('Um 23:47 kam der Knall.')).toBe('Um 23 Uhr 47 kam der Knall.');
    expect(piperText('Seit 23:05 Uhr ist es dunkel.')).toBe('Seit 23 Uhr 5 ist es dunkel.');
    expect(piperText('Ab 07:00 Uhr.')).toBe('Ab 7 Uhr.');
    expect(piperText('Noch 20 Sekunden, dann 3 Versuche.')).toBe('Noch 20 Sekunden, dann 3 Versuche.');
  });

  it('reads single letters as letters: „Pult A" stays as written', () => {
    expect(piperText('Pult A steht im Flur, Pult B im Archiv.')).toBe(
      'Pult A steht im Flur, Pult B im Archiv.',
    );
  });

  it('gives the words espeak-ng misreads as Piper reads them right', () => {
    expect(piperText('Der Notstrom läuft, das Notlicht brennt.')).toBe(
      'Der Not-Strom läuft, das Not-Licht brennt.',
    );
    expect(piperText('Die Labortür ist offen, der Aktenschrank steht im Labor.')).toBe(
      'Die [[labˈoːɾ]]tür ist offen, der Aktenschrank steht [[ɪm labˈoːɾ]].',
    );
    expect(piperText('Im Schulungslabor liegen die Unterlagen.')).toBe(
      'Im Schulungs[[labˈoːɾ]] liegen die [[ˈʊntɜlˌɑːɡən]].',
    );
    expect(piperText('Die Kabelprüfung im Maschinenraum.')).toBe(
      'Die Kahbelprüfung im Maschinen-Raum.',
    );
  });

  it('keeps a respelling only while a shipped line still says the word', () => {
    const said = [...shippedLines().keys()];
    for (const [word] of SPOKEN_AS) {
      expect(
        said.some((line) => new RegExp(word.source).test(line)),
        String(word),
      ).toBe(true);
    }
  });

  it('opens and closes every phoneme block it writes, for every shipped line', () => {
    for (const line of shippedLines().keys()) {
      const spoken = piperText(line);
      expect(spoken.split('[[').length, spoken).toBe(spoken.split(']]').length);
      expect(spoken, line).not.toMatch(/\[\[[^\]]*\[\[/);
    }
  });

  it('ends no sentence on a phoneme block: Piper would run on into the next sentence', () => {
    expect(piperText('Leitstelle an Schulungslabor. Nur eine Übung.')).toMatch(/\]\]\. Nur/);
    const runOn = [...shippedLines().keys()].filter((line) => /\]\][.!?]\s/.test(piperText(line)));
    expect(runOn).toEqual([]);
  });
});

describe('a person’s recordings, as the script meets them', () => {
  const line = { missions: ['blackout'], opens: false };
  const synthetic: Entry = { text: 'Reaktor läuft.', ms: 1400, missions: ['blackout'] };
  const human: Entry = { ...synthetic, source: 'human' };

  it('keeps every recording that says its line without --fresh, a synthetic one too', () => {
    expect(keeps(synthetic, 'Reaktor läuft.', true, 'none')).toBe(true);
    expect(keeps(human, 'Reaktor läuft.', true, 'none')).toBe(true);
  });

  it('makes the synthetic ones anew under --fresh and leaves a person’s be', () => {
    expect(keeps(synthetic, 'Reaktor läuft.', true, 'synthetic')).toBe(false);
    expect(keeps(human, 'Reaktor läuft.', true, 'synthetic')).toBe(true);
  });

  it('makes a person’s anew only under --fresh=all', () => {
    expect(keeps(human, 'Reaktor läuft.', true, 'all')).toBe(false);
    expect(keeps(synthetic, 'Reaktor läuft.', true, 'all')).toBe(false);
  });

  it('keeps nothing whose file is gone or whose line now says something else', () => {
    expect(keeps(human, 'Reaktor läuft.', false, 'none')).toBe(false);
    expect(keeps(human, 'Reaktor steht.', true, 'synthetic')).toBe(false);
    expect(keeps(undefined, 'Reaktor läuft.', true, 'none')).toBe(false);
  });

  it('marks a kept recording of a person as one in the list it writes, and no other', () => {
    expect(entryOf('Reaktor läuft.', 1400, line, true)).toEqual(human);
    expect(entryOf('Reaktor läuft.', 1400, line, false)).toEqual(synthetic);
    const opening = entryOf('Los.', 900, { missions: ['b', 'a'], opens: true }, true);
    expect(opening).toEqual({
      text: 'Los.',
      ms: 900,
      missions: ['a', 'b'],
      opens: true,
      source: 'human',
    });
    expect(Object.keys(opening)).toEqual(['text', 'ms', 'missions', 'opens', 'source']);
  });

  it('reads --fresh and --fresh=all from the command line, and refuses another --fresh', () => {
    expect(freshOf([])).toBe('none');
    expect(freshOf(['--fresh'])).toBe('synthetic');
    expect(freshOf(['--fresh=all'])).toBe('all');
    expect(freshOf(['--fresh=all', '--fresh'])).toBe('all');
    expect(() => freshOf(['--fresh=human'])).toThrow(/--fresh=human.*--fresh=all/);
  });
});

describe('a line as the Mac’s own voice reads it (VOICE_ENGINE=say)', () => {
  it('pauses at a dash, a middle dot or a colon, and reads the rest as it is written', () => {
    const pause = `[[slnc ${PAUSE_MS}]]`;
    expect(sayText('Strom weg. Notlicht: Hebel im Flur, zu zweit.')).toBe(
      `Strom weg. Notlicht ${pause} Hebel im Flur, zu zweit.`,
    );
    expect(sayText('Schott offen. Drohne wach – Kameraplatte vor dem Serverraum.')).toBe(
      `Schott offen. Drohne wach ${pause} Kameraplatte vor dem Serverraum.`,
    );
    expect(sayText('Pult A — Pult B · Flur')).toBe(`Pult A ${pause} Pult B ${pause} Flur`);
    expect(sayText('Zwei Pulte: eins zeigt.')).toBe(`Zwei Pulte ${pause} eins zeigt.`);
    expect(sayText('Um 2:30 sind es 20 Sekunden, Not-Aus.')).toBe(
      'Um 2:30 sind es 20 Sekunden, Not-Aus.',
    );
  });
});
