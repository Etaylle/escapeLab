import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  engineOf,
  entryOf,
  fileOf,
  freshOf,
  keeps,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  MAX_FOLDER_BYTES,
  modelUrl,
  PAUSE_MS,
  PIPER_MODEL,
  piperText,
  radioTexts,
  renderOf,
  sayText,
  shippedLines,
  shippedMissions,
  SPOKEN_AS,
  VOICE_DIR,
  VOICES_URL,
  voiceId,
  type Entry,
  type Fresh,
  type Voice,
} from '../scripts/voice.js';
import { lightsSecFor, paSchedule } from '../src/world/intro/sequence.js';
import { idsOf, openersOf } from '../src/world/radioVoice.js';

/** What to do when a shipped line has no recording. */
const REMEDY = 'record it on a Mac: pnpm --filter @escapelab/client voice';
/**
 * How long a recorded word takes, ms: no faster than a 20-word line in 4 s, and no slower
 * than a deliberate operator with a pause at each full stop (a 7-word, two-sentence line
 * runs about 750 ms a word in the ElevenLabs recording).
 */
const MS_PER_WORD = { min: 200, max: 900 } as const;

const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, Entry>;
const recordings = readdirSync(VOICE_DIR).filter((name) => /\.(m4a|mp3)$/.test(name));

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
      expect([fileOf('piper', id), fileOf('elevenlabs', id)]).toContain(entry?.file);
      const file = join(VOICE_DIR, entry?.file ?? '');
      expect(existsSync(file), `${entry?.file} is missing for „${text}" — ${REMEDY}`).toBe(true);
    }
  });

  it('keeps no recording that no shipped line needs any more', () => {
    const needed = new Set([...shippedLines().keys()].map(voiceId));
    expect(Object.keys(manifest).filter((id) => !needed.has(id)), REMEDY).toEqual([]);
    const named = new Set(Object.values(manifest).map((entry) => entry.file));
    expect(recordings.filter((name) => !named.has(name)), REMEDY).toEqual([]);
  });

  it('keeps every file under 150 kB and the folder under 6 MB, room for MP3', () => {
    expect([MAX_FILE_BYTES, MAX_FOLDER_BYTES]).toEqual([150 * 1024, 6 * 1024 * 1024]);
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

  it('takes the intro’s announcement over the loudspeakers first, as a run hears it', () => {
    const mission = {
      id: 'probe',
      intro: { pa: ['Durchsage.', 'Zweite Durchsage.'] },
      radio: { start: 'Los.' },
      puzzles: [{ onSolved: 'Eins.' }],
    };
    expect(radioTexts(mission)).toEqual(['Durchsage.', 'Zweite Durchsage.', 'Los.', 'Eins.']);
    const said = shippedLines([mission]).get('Durchsage.');
    expect(said).toEqual({ missions: ['probe'], opens: false });
    const blackout = shippedMissions().find((m) => m.id === 'blackout');
    expect(blackout?.intro?.pa).toHaveLength(5);
    for (const line of blackout?.intro?.pa ?? []) {
      expect(shippedLines().get(line), line).toEqual({ missions: ['blackout'], opens: false });
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

describe('the announcement over Blackout’s loudspeakers, as recorded', () => {
  const blackout = shippedMissions().find((mission) => mission.id === 'blackout') as
    | { intro?: { lightsSec?: number; pa?: string[] } }
    | undefined;
  const lines = blackout?.intro?.pa ?? [];
  const ms = lines.map((text) => manifest[voiceId(text)]?.ms ?? Number.NaN);

  it('speaks half a minute at most', () => {
    expect(ms.every(Number.isFinite), REMEDY).toBe(true);
    expect(ms.reduce((sum, each) => sum + each, 0)).toBeLessThanOrEqual(30_000);
  });

  it('lets the lights fail by themselves 4 s past its end, cutting its last line off', () => {
    const due = lightsSecFor(ms);
    expect(blackout?.intro?.lightsSec, `missions/blackout.json: intro.lightsSec ${due}`).toBe(due);
    const last = paSchedule(lines.map((text, i) => ({ text, ms: ms[i] ?? null }))).at(-1);
    const into = due * 1000 - (last?.at ?? 0);
    // Well into the last line, the page said once, and well before its end.
    expect(into).toBeGreaterThanOrEqual(1000);
    expect(into).toBeLessThanOrEqual((last?.ms ?? 0) - 1000);
  });
});

describe('the voice that reads them', () => {
  it('is Piper unless VOICE_ENGINE asks for the Mac or ElevenLabs, and refuses any other', () => {
    expect(engineOf(undefined)).toBe('piper');
    expect(engineOf('')).toBe('piper');
    expect(engineOf('piper')).toBe('piper');
    expect(engineOf('say')).toBe('say');
    expect(engineOf('elevenlabs')).toBe('elevenlabs');
    expect(() => engineOf('espeak')).toThrow(/"espeak".*"piper".*"say".*"elevenlabs"/);
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

describe('what a run keeps, and what it makes anew', () => {
  const TEXT = 'Reaktor läuft.';
  const line = { missions: ['blackout'], opens: false };
  /** A client that must never be called: renderOf only reads the voice. */
  const NO_CLIENT = {
    voices: { getAll: () => Promise.reject(new Error('no call')) },
    textToSpeech: { convert: () => Promise.reject(new Error('no call')) },
  };
  const piper: Voice = { engine: 'piper', name: PIPER_MODEL, model: '/cache/thorsten.onnx' };
  const eleven = (model: string, voiceId = 'g1jpii0iyvtRs8fqXsd1'): Voice => ({
    engine: 'elevenlabs',
    name: 'Helmut',
    voice: { client: NO_CLIENT, voiceId, model },
  });
  const render = renderOf(piper, TEXT);
  const base = { text: TEXT, ms: 1400, missions: ['blackout'], file: 'aaaaaaaaaaaa.m4a' };
  const made: Entry = { ...base, render };
  const other: Entry = { ...base, render: 'ffffffffffff' };
  const unmarked: Entry = { ...base };
  const human: Entry = { ...base, source: 'human' };
  const upload: Entry = { ...base, source: 'upload', file: 'aaaaaaaaaaaa.mp3' };
  const kept = (entry: Entry | undefined, fresh: Fresh, text = TEXT, filed = true): boolean =>
    keeps(entry, text, filed, fresh, render);

  it('keeps every recording that says its line where nothing is asked anew', () => {
    for (const entry of [made, other, unmarked, human, upload]) {
      expect(kept(entry, 'none'), JSON.stringify(entry)).toBe(true);
    }
  });

  it('under --fresh makes anew what another voice made, keeps this voice’s and a person’s', () => {
    expect(kept(other, 'synthetic')).toBe(false);
    expect(kept(unmarked, 'synthetic')).toBe(false);
    // A render cut short goes on where it stopped: nothing is spent twice.
    expect(kept(made, 'synthetic')).toBe(true);
    expect(kept(human, 'synthetic')).toBe(true);
    expect(kept(upload, 'synthetic')).toBe(true);
  });

  it('under --fresh=all makes a person’s anew too, and still keeps this voice’s', () => {
    expect(kept(human, 'all')).toBe(false);
    expect(kept(upload, 'all')).toBe(false);
    expect(kept(other, 'all')).toBe(false);
    expect(kept(made, 'all')).toBe(true);
  });

  it('keeps nothing whose file is gone or whose line now says something else', () => {
    expect(kept(made, 'none', TEXT, false)).toBe(false);
    expect(kept(human, 'synthetic', 'Reaktor steht.')).toBe(false);
    expect(kept(undefined, 'none')).toBe(false);
  });

  it('tells renders apart by engine, voice, model and the words as the engine gets them', () => {
    const renders = [
      render,
      renderOf({ ...piper, name: 'de_DE-thorsten-medium' }, TEXT),
      renderOf({ engine: 'say' }, TEXT),
      renderOf(eleven('eleven_v4'), TEXT),
      renderOf(eleven('eleven_multilingual_v2'), TEXT),
      renderOf(eleven('eleven_v4', 'JBFqnCBsd6RMkjVDRZzb'), TEXT),
      renderOf(piper, 'Reaktor steht.'),
    ];
    expect(new Set(renders).size).toBe(renders.length);
    expect(render).toMatch(/^[0-9a-f]{12}$/);
    expect(renderOf(piper, TEXT)).toBe(render);
    // Where the model file lies does not count: the same voice from another cache.
    expect(renderOf({ ...piper, model: '/elsewhere/thorsten.onnx' }, TEXT)).toBe(render);
  });

  it('writes an entry with its file and a person or a render, in a fixed order', () => {
    expect(entryOf(TEXT, 1400, line, { file: base.file, render })).toEqual(made);
    expect(entryOf(TEXT, 1400, line, { file: base.file, source: 'human' })).toEqual(human);
    const opening = entryOf('Los.', 900, { missions: ['b', 'a'], opens: true }, upload);
    expect(opening).toEqual({
      text: 'Los.',
      ms: 900,
      missions: ['a', 'b'],
      opens: true,
      source: 'upload',
      file: 'aaaaaaaaaaaa.mp3',
    });
    expect(Object.keys(opening)).toEqual(['text', 'ms', 'missions', 'opens', 'source', 'file']);
    const synthetic = entryOf(TEXT, 1400, line, { file: base.file, render });
    expect(Object.keys(synthetic)).toEqual(['text', 'ms', 'missions', 'render', 'file']);
  });

  it('names an ElevenLabs recording .mp3 and every other .m4a', () => {
    expect(fileOf('elevenlabs', 'abc')).toBe('abc.mp3');
    expect(fileOf('piper', 'abc')).toBe('abc.m4a');
    expect(fileOf('say', 'abc')).toBe('abc.m4a');
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
