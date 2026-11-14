import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { parseMission, radioLines } from '@escapelab/core';
import { ELEVEN_FORMAT, ELEVEN_VOICE, type DesignClient } from '../scripts/elevenlabs.js';
import {
  catalogOf,
  designPa,
  engineOf,
  entryOf,
  fileOf,
  freshOf,
  keepPa,
  keeps,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  MAX_FOLDER_BYTES,
  MISSIONS_DIR,
  modelUrl,
  PA_VOICE,
  PAUSE_MS,
  PIPER_MODEL,
  piperText,
  readManifest,
  renderOf,
  sayText,
  SPEAKER_HELD,
  shippedLines,
  shippedMissions,
  SPOKEN_AS,
  VOICE_DIR,
  VOICES_URL,
  voiceId,
  writeManifest,
  type Entry,
  type Fresh,
  type Line,
  type Manifest,
  type ShippedLine,
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

/**
 * The shipped lines written before the user could record them — the agents that write them may
 * not spend the account's credits — which play silent meanwhile, the objective bar showing them:
 * to be emptied as the render (docs/sound.md) makes them. Any other line without a recording
 * fails, and so does a line here that has one now.
 */
const AWAITING_RENDER: readonly string[] = [
  'Leitstelle an Nachtschicht. Der Trakt ist dunkel, auf meiner Tafel brennen nur die ' +
    'Notzellen. Zuerst das Notlicht, den Hauptschalter im Flur legt ihr gemeinsam um.',
  'Leitstelle an Nachtschicht. Im ganzen Trakt ist das Netz weg, die Notzellen halten noch. ' +
    'Als Erstes das Notlicht, der Hauptschalter im Flur geht nur gemeinsam.',
  'Das Notlicht schaltet ihr im Flur, der Hauptschalter hängt in der Mitte unter der roten Lampe.',
  'Aus dem Archiv geht es durch die Südtür in den Flur, der Hauptschalter liegt dann ein Stück ' +
    'östlich.',
  'Notlicht brennt, ich sehe euch wieder auf meiner Tafel. Weiter mit dem Notstrom: Anleitung ' +
    'im Archiv, Kasten im Maschinenraum, Prüfpult im Flur.',
  'Für den Notstrom hängt die Anleitung an der Ostseite vom Archiv.',
  'Der Kasten steht im Maschinenraum hinter der Plattentür, das Prüfpult am Westende vom Flur, ' +
    'und einer hält die Platte.',
  'Der Notstrom hält, die Tür zum Maschinenraum bleibt offen. Dann die Signalkette, ein Pult ' +
    'im Flur und eins im Maschinenraum.',
  'Für die Signalkette liegt ein Klemmbrett im Flur, an der Südwand.',
  'Die Signalkette hat zwei Pulte, Pult A am Ostende vom Flur und Pult B im Maschinenraum, ' +
    'Südostecke.',
  'Das Schott zum Serverraum geht auf, drinnen warten Terminal und Rack. Vorsicht, die Drohne ' +
    'ist wach, die Kameraplatte davor hält sie an.',
  'Zwischen Terminal und Rack steht ein Spind, darin liegt, was ihr für beide braucht.',
  'Im Serverraum braucht es zwei, einen am Terminal an der Westwand und einen am Rack an der ' +
    'Ostwand.',
  'Die Server sind oben, und die Labortür ist offen, aber drinnen kreist eine Drohne. Den ' +
    'Aktenschrank dort öffnet nur der Schlüssel.',
  'Den Schlüssel für den Aktenschrank findet ihr im Serverraum, oben in der Nordostecke beim Rack.',
  'Funkpult und Aktenschrank stehen beide im Labor, das Pult in der Südwestecke.',
  'Ich hab euch klar auf der Frequenz. Der Reaktorraum ist offen, aber ohne Ersatzsicherung ' +
    'springt da nichts an.',
  'Eine Ersatzsicherung liegt im Archiv, ganz hinten in der Südostecke.',
  'Die Sicherung gehört in den Reaktorraum an die Ostwand, gleich neben den Schalter.',
  'Reaktor ist am Netz, der Notausgang ist auf, Nordwestecke beim Archiv. Raus da, alle zusammen!',
  'Störung im Kühlkreislauf. Relaissteuerung auf Handbetrieb.',
  'Achtung, Kühlkreislauf gestört. Relais nur noch von Hand.',
  'Kühlkreislauf außer Betrieb. Relais im Handbetrieb schalten.',
  'Ich habe die Relais verloren, das müsst ihr von Hand machen. Lest euch jede Anweisung laut vor.',
  'Die Kühlung kippt, und ich komme von hier nicht an die Relais. Sagt euch jede Anweisung ' +
    'laut an und bestätigt sie.',
  'Notfall in der Kühlung, die Relais müssen von Hand geschaltet werden. Jeder sagt laut, was ' +
    'auf seinem Pult steht.',
  'Kühlung steht wieder, die Relais halten. Weiter, wo ihr aufgehört habt.',
  'Die Relais greifen wieder, die Kühlung ist stabil. Zurück an eure Station.',
  'Die Kühlung ist abgesackt, das hat uns Zeit gekostet. Zurück an die Arbeit, beim nächsten ' +
    'Mal schneller.',
  'Zu spät, die Notversorgung musste die Kühlung abfangen. Das kostet Zeit, weiter.',
  'Bei mir ist ein Alarm aufgelaufen, das kostet uns Zeit. Ruhig bleiben, genau arbeiten.',
  'Alarm auf meiner Tafel, das hat uns gerade Zeit gekostet. Lieber einmal mehr nachfragen.',
  'Da ging ein Alarm raus, ich sehe ihn hier. Nicht hetzen, sonst kommen mehr davon.',
  'Noch fünf Minuten auf den Notzellen. Bleibt dran, aber hetzt nicht.',
  'Die Notzellen machen noch fünf Minuten. Das reicht, wenn ihr euch aufteilt.',
  'Zwei Minuten noch, dann sind die Zellen leer. Jetzt zählt jeder Handgriff.',
  'Noch zwei Minuten auf der Notversorgung. Keine Umwege mehr.',
  'Noch eine Minute auf den Zellen. Ich bleibe dran, bis zum letzten Licht.',
  'Letzte Minute, die Zellen sind fast leer. Jetzt oder gar nicht, Nachtschicht.',
  'Der Trakt hat wieder Strom, die Zentrifugen laufen an, und ihr seid alle draußen. Mit Zeit ' +
    'übrig. So schreibe ich das ins Schichtbuch.',
  'Alle draußen, und die Notzellen hätten noch eine Weile gehalten. Ihr habt den Reaktor ' +
    'zurückgeholt, ohne lange zu suchen. Gute Nacht, Nachtschicht.',
  'Licht im ganzen Trakt, und alle sind draußen. Knapp war das, aber die Zellen haben ' +
    'gereicht. Ich trage es ins Schichtbuch ein.',
  'Reaktor läuft, Notausgang zu, alle vollzählig draußen. Das ging bis in die letzten Minuten. ' +
    'Geht euch aufwärmen, die Frühschicht übernimmt.',
  'Das war die letzte Minute, und ihr seid raus. Die Zellen waren fast leer, als der Reaktor ' +
    'kam. Durchatmen, Nachtschicht.',
  'Ihr seid draußen, mit Sekunden übrig. Der Trakt hat Strom, die Proben sind gerettet, und ' +
    'ich atme hier auch erst mal durch.',
  'Die Notzellen sind leer, im Trakt ist es jetzt ganz dunkel. Bleibt, wo ihr seid, die ' +
    'Frühschicht holt euch raus.',
  'Das war\'s, die Notversorgung ist aus. Rührt nichts mehr an, die Frühschicht kommt mit Licht.',
  'Die Sicherheitsschaltung hat zugemacht, zu viele Alarme auf einmal. Der Trakt bleibt ' +
    'dunkel, bis die Frühschicht kommt.',
  'Zu viele Alarme, die Anlage hat die Notversorgung abgeworfen. Für heute bleibt der Trakt ' +
    'dunkel.',
  'Mit halber Schicht geht da drinnen nichts. Ich breche ab, der Trakt bleibt bis morgen dunkel.',
  'Ohne die ganze Schicht kommt ihr da nicht durch. Ich hole euch raus, wir versuchen es ' +
    'morgen neu.',
];

const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Manifest;
const recordings = readdirSync(VOICE_DIR).filter((name) => /\.(m4a|mp3)$/.test(name));

/** Every text of a line as a mission writes it: one, or its two or three. */
const textsOf = (line: Line | undefined): readonly string[] =>
  typeof line === 'string' ? [line] : (line ?? []);

const wordsIn = (line: string): number =>
  line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

describe('the recorded lines', () => {
  it('has a recording for every line a shipped mission can put on the air', () => {
    const lines = shippedLines();
    expect(lines.size).toBeGreaterThan(40);
    for (const [text, { missions, speaker }] of lines) {
      if (AWAITING_RENDER.includes(text)) continue;
      const id = voiceId(text);
      const entry = manifest.lines[id];
      const said = `„${text}" (${missions.join(', ')})`;
      expect(entry, `${said} has no recording — ${REMEDY}`).toBeDefined();
      expect(entry?.text, `the recording ${id} says something else — ${REMEDY}`).toBe(text);
      expect(entry?.missions).toEqual([...missions].sort());
      expect(entry?.speaker, said).toBe(speaker);
      expect([fileOf('piper', id), fileOf('elevenlabs', id)]).toContain(entry?.file);
      const file = join(VOICE_DIR, entry?.file ?? '');
      expect(existsSync(file), `${entry?.file} is missing for „${text}" — ${REMEDY}`).toBe(true);
    }
  });

  it('lists the lines awaiting their render, each a shipped line with no recording yet', () => {
    const shipped = shippedLines();
    for (const text of AWAITING_RENDER) {
      expect(shipped.has(text), `„${text}" is no shipped line: take it off AWAITING_RENDER`).toBe(
        true,
      );
      const recorded = manifest.lines[voiceId(text)] !== undefined;
      expect(recorded, `„${text}" has its recording now: take it off AWAITING_RENDER`).toBe(false);
    }
  });

  it('keeps no recording that no shipped line needs any more', () => {
    const needed = new Set([...shippedLines().keys()].map(voiceId));
    expect(Object.keys(manifest.lines).filter((id) => !needed.has(id)), REMEDY).toEqual([]);
    const named = new Set(Object.values(manifest.lines).map((entry) => entry.file));
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
    for (const entry of Object.values(manifest.lines)) {
      const perWord = entry.ms / wordsIn(entry.text);
      expect(perWord, `„${entry.text}" in ${entry.ms} ms`).toBeGreaterThanOrEqual(MS_PER_WORD.min);
      expect(perWord, `„${entry.text}" in ${entry.ms} ms`).toBeLessThanOrEqual(MS_PER_WORD.max);
    }
    const ids = idsOf(manifest);
    const blackout = shippedMissions().find((mission) => mission.id === 'blackout');
    const starts = textsOf(blackout?.radio?.start);
    expect(starts).toHaveLength(3);
    for (const start of starts) {
      expect(start).toMatch(/^Leitstelle an Nachtschicht\./);
      const recorded = !AWAITING_RENDER.includes(start);
      expect(ids.get(start)).toBe(recorded ? voiceId(start) : undefined);
    }
  });

  it('marks the lines that open a run, and only those: the radio opens the channel for them', () => {
    const starts = shippedMissions().flatMap((mission) => textsOf(mission.radio?.start));
    expect(starts.length).toBeGreaterThanOrEqual(4);
    const recorded = starts.filter((text) => !AWAITING_RENDER.includes(text));
    expect([...openersOf(manifest)].sort()).toEqual(recorded.map(voiceId).sort());
    for (const [text, { opens }] of shippedLines()) {
      expect(opens, text).toBe(starts.includes(text));
    }
  });

  it('keeps the operator’s voice, Helmut, and the plant’s once one is made', () => {
    expect(manifest.voices.operator).toEqual({
      voiceId: ELEVEN_VOICE,
      name: 'Helmut - German Epic Trailer Voice',
    });
    for (const voice of Object.values(manifest.voices)) {
      expect(voice.voiceId).toMatch(/^[A-Za-z0-9]{8,64}$/);
    }
  });
});

describe('the lines the script reads', () => {
  const missions = readdirSync(MISSIONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseMission(JSON.parse(readFileSync(join(MISSIONS_DIR, name), 'utf8'))));

  it('are every line core can put on the air, in its order, each by its speaker', () => {
    expect(missions.length).toBe(shippedMissions().length);
    for (const mission of missions) {
      const read = shippedMissions().find((each) => each.id === mission.id);
      const core = radioLines(mission).map(({ text, speaker, when }) => ({
        text,
        speaker,
        opens: when === 'start',
      }));
      expect(read && catalogOf(read), mission.id).toEqual(core);
    }
  });

  it('take every line core hands logRadio, each with its moment, and every nudge', () => {
    // A new source of lines in the reducer has to be read by core's radioLines, and by the script.
    const actions = readFileSync(new URL('../../core/src/actions.ts', import.meta.url), 'utf8');
    const calls = [...actions.matchAll(/logRadio\(\w+, '(\w+)', ([^,]+), /g)];
    expect(calls.map(([, moment, line]) => [moment, line])).toEqual([
      ['start', 'state.mission.radio.start'],
      ['solved', 'solved?.onSolved'],
      ['escape', 'state.mission.radio.escape'],
      ['alarm', 'state.mission.radio.alarm'],
      ['won', 'state.mission.radio.won?.[band]'],
      ['lost', 'state.mission.radio.lost?.[cause]'],
      ['announce', 'sabotage.announce'],
      ['emergency', 'line'],
      ['cleared', 'line'],
      ['missed', 'line'],
      ['clock', 'state.mission.radio.clock?.[call.key]'],
    ]);
    // Every call is one of those: none hides from the pattern, the function's own name aside.
    expect(actions.match(/logRadio\(/g)).toHaveLength(calls.length + 1);
    expect(actions).toMatch(/\.nudges\[state\.nudgesGiven\]/);
    expect(actions).toMatch(/pickLine\(line, state\.seed \?\? 0, `nudge:/);
    expect(actions).toMatch(/logEvent\(spoken, 'nudge', text, at, null, 'nudge'\)/);
  });

  it('give each line its speaker: the loudspeakers the intro’s and the emergency’s, else the operator', () => {
    const mission = {
      id: 'probe',
      intro: { pa: ['Durchsage.'] },
      radio: { start: 'Los.', escape: 'Raus.' },
      puzzles: [{ nudges: ['Hier.'], onSolved: 'Eins.' }, {}],
      map: { sabotage: { announce: 'Störung.' } },
    };
    expect(catalogOf(mission)).toEqual([
      { text: 'Durchsage.', speaker: 'pa', opens: false },
      { text: 'Los.', speaker: 'operator', opens: true },
      { text: 'Hier.', speaker: 'operator', opens: false },
      { text: 'Eins.', speaker: 'operator', opens: false },
      { text: 'Raus.', speaker: 'operator', opens: false },
      { text: 'Störung.', speaker: 'pa', opens: false },
    ]);
    expect(catalogOf({ id: 'quiet', puzzles: [{}] })).toEqual([]);
    expect(shippedLines([mission]).get('Los.')).toEqual({
      missions: ['probe'],
      speaker: 'operator',
      opens: true,
    });
    expect(shippedLines([mission]).get('Störung.')?.speaker).toBe('pa');
    // One line, one recording: two speakers may not say the same words.
    const twice = { ...mission, map: { sabotage: { announce: 'Los.' } } };
    expect(() => shippedLines([twice])).toThrow(/„Los\." is said by the operator and the pa/);
  });

  it('take the intro’s announcement first, as a run hears it, by the loudspeakers', () => {
    const blackout = shippedMissions().find((m) => m.id === 'blackout');
    expect(blackout?.intro?.pa).toHaveLength(5);
    for (const line of blackout?.intro?.pa ?? []) {
      expect(shippedLines().get(line), line).toEqual({
        missions: ['blackout'],
        speaker: 'pa',
        opens: false,
      });
    }
    const nudges = (blackout?.puzzles ?? []).flatMap((p) => p.nudges ?? []);
    expect(nudges).toHaveLength(12);
    // Each of them in two texts, every text a line of its own to record.
    expect(nudges.flatMap(textsOf)).toHaveLength(24);
    for (const text of nudges.flatMap(textsOf)) {
      expect(shippedLines().get(text)?.missions, text).toEqual(['blackout']);
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
  const ms = lines.map((text) => manifest.lines[voiceId(text)]?.ms ?? Number.NaN);

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

/** A client that must never be called: renders only read the voices. */
const NO_CLIENT = {
  voices: { getAll: () => Promise.reject(new Error('no call')) },
  textToSpeech: { convert: () => Promise.reject(new Error('no call')) },
};

/** ElevenLabs reading by `model`, the operator Helmut — or `voiceId` — and the plant `pa`. */
const eleven = (model: string, voiceId = ELEVEN_VOICE, pa?: string): Voice => ({
  engine: 'elevenlabs',
  name: 'Helmut',
  speakers: {
    operator: { client: NO_CLIENT, voiceId, model, held: SPEAKER_HELD.operator },
    ...(pa === undefined
      ? {}
      : { pa: { client: NO_CLIENT, voiceId: pa, model, held: SPEAKER_HELD.pa } }),
  },
});

describe('what a run keeps, and what it makes anew', () => {
  const TEXT = 'Reaktor läuft.';
  const said = { text: TEXT, speaker: 'operator' } as const;
  const line: ShippedLine = { missions: ['blackout'], speaker: 'operator', opens: false };
  const piper: Voice = { engine: 'piper', name: PIPER_MODEL, model: '/cache/thorsten.onnx' };
  const render = renderOf(piper, said);
  const base: Entry = {
    text: TEXT,
    ms: 1400,
    missions: ['blackout'],
    speaker: 'operator',
    file: 'aaaaaaaaaaaa.m4a',
  };
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
      renderOf({ ...piper, name: 'de_DE-thorsten-medium' }, said),
      renderOf({ engine: 'say' }, said),
      renderOf(eleven('eleven_v4'), said),
      renderOf(eleven('eleven_multilingual_v2'), said),
      renderOf(eleven('eleven_v4', 'JBFqnCBsd6RMkjVDRZzb'), said),
      renderOf(piper, { ...said, text: 'Reaktor steht.' }),
    ];
    expect(new Set(renders).size).toBe(renders.length);
    expect(render).toMatch(/^[0-9a-f]{12}$/);
    expect(renderOf(piper, said)).toBe(render);
    // Where the model file lies does not count: the same voice from another cache.
    expect(renderOf({ ...piper, model: '/elsewhere/thorsten.onnx' }, said)).toBe(render);
  });

  it('tells the speakers apart under ElevenLabs alone: their voices, and how each holds', () => {
    const pa = { text: TEXT, speaker: 'pa' } as const;
    const both = eleven('eleven_v4', ELEVEN_VOICE, 'paVoice0000000000000');
    expect(renderOf(both, said)).toBe(renderOf(eleven('eleven_v4'), said));
    expect(renderOf(both, pa)).not.toBe(renderOf(both, said));
    // The plant's voice held as the operator's would be another take, too.
    const asOperator = { model: 'eleven_v4', held: SPEAKER_HELD.operator, client: NO_CLIENT };
    const loose: Voice = {
      engine: 'elevenlabs',
      name: 'Helmut',
      speakers: {
        operator: { ...asOperator, voiceId: ELEVEN_VOICE },
        pa: { ...asOperator, voiceId: 'paVoice0000000000000' },
      },
    };
    expect(renderOf(loose, pa)).not.toBe(renderOf(both, pa));
    expect(SPEAKER_HELD.pa.stability).toBeGreaterThan(SPEAKER_HELD.operator.stability);
    // Without a voice for the plant yet, its lines are made by nobody: never one kept.
    const none = renderOf(eleven('eleven_v4'), pa);
    expect(none).not.toBe(renderOf(both, pa));
    expect(Object.values(manifest.lines).some((entry) => entry.render === none)).toBe(false);
    // Piper and the Mac read both speakers in their one voice.
    expect(renderOf(piper, pa)).toBe(render);
  });

  it('makes nothing of the operator’s anew for the split: every one keeps its render', () => {
    const voice = eleven('eleven_v4');
    const operators = Object.values(manifest.lines).filter((e) => e.speaker === 'operator');
    expect(operators.length).toBeGreaterThan(40);
    for (const entry of operators) {
      expect(renderOf(voice, entry), entry.text).toBe(entry.render);
    }
  });

  it('writes an entry with its speaker, its file and a person or a render, in a fixed order', () => {
    expect(entryOf(TEXT, 1400, line, { file: base.file, render })).toEqual(made);
    expect(entryOf(TEXT, 1400, line, { file: base.file, source: 'human' })).toEqual(human);
    const opening = entryOf(
      'Los.',
      900,
      { missions: ['b', 'a'], speaker: 'operator', opens: true },
      upload,
    );
    expect(opening).toEqual({
      text: 'Los.',
      ms: 900,
      missions: ['a', 'b'],
      speaker: 'operator',
      opens: true,
      source: 'upload',
      file: 'aaaaaaaaaaaa.mp3',
    });
    expect(Object.keys(opening)).toEqual([
      'text',
      'ms',
      'missions',
      'speaker',
      'opens',
      'source',
      'file',
    ]);
    const synthetic = entryOf(TEXT, 1400, line, { file: base.file, render });
    expect(Object.keys(synthetic)).toEqual(['text', 'ms', 'missions', 'speaker', 'render', 'file']);
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

describe('the plant’s voice, made from a description (Voice Design)', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-design-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A client of the test's own: three previews, a voice made of one; what it was asked. */
  function designer() {
    const asked: unknown[] = [];
    const previews = [1, 2, 3].map((n) => ({
      audioBase64: Buffer.from(`mp3 ${n}`).toString('base64'),
      generatedVoiceId: `preview${n}000000000000`,
      mediaType: 'audio/mpeg',
      durationSecs: 9 + n / 10,
    }));
    const client: DesignClient = {
      textToVoice: {
        design: (request: ElevenLabs.VoiceDesignRequestModel) => {
          asked.push(request);
          return Promise.resolve({ previews, text: PA_VOICE.text });
        },
        create: (request: ElevenLabs.BodyCreateANewVoiceFromVoicePreviewV1TextToVoicePost) => {
          asked.push(request);
          return Promise.resolve({ voiceId: 'madeVoice00000000000', name: request.voiceName });
        },
      },
    };
    return { client, asked };
  }

  it('asks once for three previews, from the description and a text of 100 to 1,000 characters', async () => {
    const { client, asked } = designer();
    const made = await designPa(client, dir);
    expect(asked).toEqual([
      {
        voiceDescription: PA_VOICE.description,
        modelId: 'eleven_ttv_v3',
        text: PA_VOICE.text,
        outputFormat: ELEVEN_FORMAT,
      },
    ]);
    expect(PA_VOICE.text.length).toBeGreaterThanOrEqual(100);
    expect(PA_VOICE.text.length).toBeLessThanOrEqual(1000);
    expect(PA_VOICE.description).toMatch(/calm, neutral German/i);
    expect(made.map(({ n, generatedVoiceId }) => [n, generatedVoiceId])).toEqual([
      [1, 'preview1000000000000'],
      [2, 'preview2000000000000'],
      [3, 'preview3000000000000'],
    ]);
    expect(made.map(({ file }) => file)).toEqual([1, 2, 3].map((n) => join(dir, `pa-${n}.mp3`)));
    expect(readFileSync(join(dir, 'pa-2.mp3'), 'utf8')).toBe('mp3 2');
  });

  it('keeps a preview as the plant’s voice, in the manifest beside the operator’s', async () => {
    const { client, asked } = designer();
    const file = join(dir, 'manifest.json');
    const before: Manifest = {
      voices: { operator: { voiceId: ELEVEN_VOICE, name: 'Helmut' } },
      lines: {},
    };
    writeManifest(before, file);
    const kept = await keepPa(client, 'preview2000000000000', file);
    expect(asked).toEqual([
      {
        voiceName: PA_VOICE.name,
        voiceDescription: PA_VOICE.description,
        generatedVoiceId: 'preview2000000000000',
      },
    ]);
    expect(kept).toEqual({ voiceId: 'madeVoice00000000000', name: 'EscapeLab Durchsage' });
    expect(readManifest(file)).toEqual({ ...before, voices: { ...before.voices, pa: kept } });
    // The operator stays first in the file, the plant after it.
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).voices)).toEqual(['operator', 'pa']);
  });

  it('refuses an id no preview could have, before anything is asked', async () => {
    const { client, asked } = designer();
    const file = join(dir, 'manifest.json');
    writeFileSync(file, '{"voices":{},"lines":{}}\n');
    await expect(keepPa(client, '../2', file)).rejects.toThrow(/--keep-pa takes the id/);
    await expect(keepPa(client, '2', file)).rejects.toThrow(/not "2"/);
    expect(asked).toEqual([]);
    expect(readManifest(file)).toEqual({ voices: {}, lines: {} });
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
