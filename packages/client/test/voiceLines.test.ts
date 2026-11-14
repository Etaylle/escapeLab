import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import {
  inService as coreInService,
  MOODS,
  parseMission,
  radioLines,
  ROLES,
  ROSTER,
  shownText as coreShownText,
} from '@escapelab/core';
import {
  OPERATOR_HELD,
  type ElevenVoice,
  type SoundClient,
  type SpeechClient,
} from '../scripts/elevenlabs.js';
import {
  DESIGN_TEXT,
  inService,
  readRoster,
  ROLE_HELD,
  type Roster,
} from '../scripts/cast.js';
import {
  canRead,
  catalogOf,
  charactersOf,
  costsOf,
  CREDITS_PER_CHARACTER,
  elevenTake,
  elevenVoiceOf,
  engineOf,
  entryOf,
  fileOf,
  freshOf,
  keeps,
  lineId,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  MAX_FOLDER_BYTES,
  MISSIONS_DIR,
  modelFor,
  modelOf,
  modelUrl,
  MOOD_TAGS,
  PAUSE_MS,
  PIPER_MODEL,
  piperText,
  plan,
  plannedVoice,
  planOf,
  planReport,
  readManifest,
  renderOf,
  sayText,
  shippedLines,
  shippedMissions,
  shownText,
  SPOKEN_AS,
  spokenText,
  TAG_MODEL,
  tagged,
  takesTags,
  toMake,
  VOICE_DIR,
  VOICES_URL,
  voiceId,
  type Entry,
  type Fresh,
  type Line,
  type Manifest,
  type MissionLines,
  type Plan,
  type Said,
  type ShippedLine,
  type Voice,
} from '../scripts/voice.js';
import { lightsSecFor, paSchedule } from '../src/world/intro/sequence.js';
import { idsOf, lineKey, openersOf } from '../src/world/radioVoice.js';

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
 * not spend the account's credits — which are heard meanwhile as any line without a recording
 * is: the radio's on the objective bar keyed with the radio's chirp, the plant's message, the
 * last word on the end card and the Funkprobe silent, the words shown all the same. To be emptied
 * as the render (docs/sound.md) makes them, for every person in service who says them. Any other
 * line without a recording fails, and so does a line here that every one of them has now.
 */
const AWAITING_RENDER: readonly string[] = [
  'Leitstelle an Nachtschicht. Der Trakt ist dunkel, auf meiner Tafel brennen nur die ' +
    'Notzellen. Zuerst das Notlicht, den Hauptschalter im Flur legt ihr gemeinsam um.',
  'Leitstelle an Nachtschicht. Im ganzen Trakt ist das Netz weg, die Notzellen halten noch. ' +
    'Als Erstes das Notlicht, der Hauptschalter im Flur geht nur gemeinsam.',
  'Den Hauptschalter im Flur legt keiner allein um, ihr müsst gemeinsam ziehen.',
  'Wer am Ostende vom Flur steht: Richtung Westen bis zur Mitte, dort hängt der Hauptschalter.',
  'Notlicht brennt, ich sehe euch wieder auf meiner Tafel. Weiter mit dem Notstrom: Anleitung ' +
    'im Archiv, Kasten im Maschinenraum, Prüfpult im Flur.',
  'Ohne die Anleitung aus dem Archiv ratet ihr am Kasten nur herum, sie steht dort auf der ' +
    'Ostseite.',
  'Die Tür zum Maschinenraum geht nur auf, solange jemand auf der Platte davor steht, dahinter ' +
    'wartet der Kasten.',
  'Der Notstrom hält, die Maschinenraumtür bleibt jetzt offen. Für die Signalkette liegt ein ' +
    'Klemmbrett im Flur, gearbeitet wird an zwei Pulten.',
  'Auf dem Klemmbrett im Flur steht, wie die Signalkette zu lesen ist, es liegt an der Südwand.',
  'Das Schott zum Serverraum ist auf, die Unterlagen liegen im Spind darin. Die Kameraplatte ' +
    'davor hält die Drohne an.',
  'Macht zuerst den Spind in der Mitte vom Serverraum auf, ohne seine Unterlagen kommt ihr an ' +
    'Terminal und Rack nicht weiter.',
  'Server oben, Labortür offen, im Labor patrouilliert eine Drohne. Den Schlüssel zum ' +
    'Aktenschrank holt ihr noch aus dem Serverraum.',
  'Ich hab euch klar auf der Frequenz. Die Ersatzsicherung für den Reaktor liegt im Archiv, ' +
    'bringt sie rüber.',
  'Reaktor ist am Netz, der Notausgang ist auf, Nordwestecke beim Archiv. Raus da, alle zusammen!',
  'Störung im Kühlkreislauf. Relaissteuerung auf Handbetrieb.',
  'Kühlkreislauf gestört, Temperatur im Trakt steigt. Relaissteuerung auf Handbetrieb.',
  'Kühlkreislauf außer Betrieb. Automatische Relaissteuerung ausgefallen, Handbetrieb aktiv.',
  'Ich habe die Relais verloren, das müsst ihr von Hand machen. Lest euch jede Anweisung laut vor.',
  'Die Kühlung kippt, und ich komme von hier nicht an die Relais. Sagt euch jede Anweisung ' +
    'laut an und bestätigt sie.',
  'Notfall in der Kühlung, die Relais müssen von Hand geschaltet werden. Jeder sagt laut, was ' +
    'auf seinem Pult steht.',
  'Kühlung steht wieder, die Relais halten. Weiter, wo ihr aufgehört habt.',
  'Die Relais greifen wieder, ich habe die Kühlung zurück. Rechtzeitig, danke euch.',
  'Die Kühlung ist abgesackt, das hat uns Zeit gekostet. Zurück an die Arbeit, beim nächsten ' +
    'Mal schneller.',
  'Zu spät, die Notversorgung musste die Kühlung abfangen. Das kostet Zeit, weiter.',
  'Bei mir ist ein Alarm aufgelaufen, das hat uns Zeit gekostet. Einer ist kein Beinbruch, ' +
    'aber die Anlage zählt jeden mit.',
  'Alarm auf meiner Tafel, die Uhr ist gerade gesprungen. Kurz sammeln, dann weiter, Nachtschicht.',
  'Da ging ein Alarm raus, ich sehe ihn hier. Das war der erste heute Nacht, bei mehr wird es eng.',
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
  'Die Sicherheitsschaltung hat zugemacht, zu viele Alarme in einer Schicht. Der Trakt bleibt ' +
    'dunkel, bis die Frühschicht kommt.',
  'Die Anlage hat jeden Alarm mitgezählt, beim letzten hat sie den Trakt abgeschaltet. Lasst ' +
    'alles, wie es ist, die Frühschicht sieht sich das an.',
  'Mit halber Schicht geht da drinnen nichts. Ich breche ab, der Trakt bleibt bis morgen dunkel.',
  'Ohne die ganze Schicht kommt ihr da nicht durch. Ich hole euch raus, wir versuchen es ' +
    'morgen neu.',
  'Funkprobe, Nachtschicht. Ich höre euch laut und klar. Bisher eine ruhige Nacht im Trakt, ' +
    'von mir aus kann es losgehen.',
  'Kurze Funkprobe. Alle haben sich gemeldet, ihr kommt sauber bei mir an. Ich bleibe die ' +
    'ganze Nacht auf dieser Frequenz.',
  'Nachtschicht, Funkprobe. Ich höre jeden von euch klar. Dann hoffen wir mal auf eine lange, ' +
    'langweilige Nacht.',
];

const manifest = readManifest();
const recordings = readdirSync(VOICE_DIR).filter((name) => /\.(m4a|mp3)$/.test(name));
const roster = readRoster();

/** Every recording a shipped line needs: the line as each person of its role in service says it. */
const needed = [...shippedLines()].flatMap(([text, line]) =>
  inService(roster, line.role).map(({ id: person }) => ({
    text,
    line,
    person,
    id: lineId(person, text),
  })),
);

/** Every text of a line as a mission writes it: one, or its two or three. */
const textsOf = (line: Line | undefined): readonly string[] =>
  typeof line === 'string' ? [line] : (line ?? []);

const wordsIn = (line: string): number =>
  line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

describe('the recorded lines', () => {
  it('has a recording for every line a shipped mission can put on the air, by who says it', () => {
    expect(needed.length).toBeGreaterThan(40);
    for (const { text, line, person, id } of needed) {
      if (AWAITING_RENDER.includes(text)) continue;
      const entry = manifest.lines[id];
      const said = `„${text}" by ${person} (${line.missions.join(', ')})`;
      expect(entry, `${said} has no recording — ${REMEDY}`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.text, `the recording ${id} says something else — ${REMEDY}`).toBe(text);
      expect(entry.missions).toEqual([...line.missions].sort());
      const by = [entry.role, entry.person, entry.moment];
      expect(by, said).toEqual([line.role, person, line.moment]);
      expect([fileOf('piper', id), fileOf('elevenlabs', id)]).toContain(entry.file);
      const file = join(VOICE_DIR, entry.file);
      expect(existsSync(file), `${entry.file} is missing for ${said} — ${REMEDY}`).toBe(true);
    }
  });

  it('lists the lines awaiting their render, each one a person in service has not got', () => {
    const shipped = shippedLines();
    for (const text of AWAITING_RENDER) {
      const line = shipped.get(text);
      expect(line, `„${text}" is no shipped line: take it off AWAITING_RENDER`).toBeDefined();
      const persons = line === undefined ? [] : inService(roster, line.role);
      const all = persons.every(({ id }) => manifest.lines[lineId(id, text)] !== undefined);
      expect(all, `„${text}" has its recordings now: take it off AWAITING_RENDER`).toBe(false);
    }
  });

  it('keeps no recording that no shipped line needs any more', () => {
    const ids = new Set(needed.map(({ id }) => id));
    expect(Object.keys(manifest.lines).filter((id) => !ids.has(id)), REMEDY).toEqual([]);
    const named = new Set(Object.values(manifest.lines).map((entry) => entry.file));
    expect(recordings.filter((name) => !named.has(name)), REMEDY).toEqual([]);
  });

  it('keeps every file under 200 kB and the folder under 24 MB, room for MP3', () => {
    expect([MAX_FILE_BYTES, MAX_FOLDER_BYTES]).toEqual([200 * 1024, 24 * 1024 * 1024]);
    const sizes = recordings.map((name) => statSync(join(VOICE_DIR, name)).size);
    for (const [i, size] of sizes.entries()) {
      expect(size, `${recordings[i]} is ${size} bytes`).toBeLessThanOrEqual(MAX_FILE_BYTES);
    }
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(MAX_FOLDER_BYTES);
  });

  it('has room for every recording of the whole cast at the bytes a character', () => {
    // The lines awaiting their render, and every person of the roster's, still fit the caps.
    const entries = Object.values(manifest.lines);
    const bytes = entries.reduce((sum, e) => sum + statSync(join(VOICE_DIR, e.file)).size, 0);
    const perCharacter = bytes / entries.reduce((sum, e) => sum + e.text.length, 0);
    const lines = [...shippedLines()];
    const longest = Math.max(...lines.map(([text]) => text.length));
    const all = lines.reduce((sum, [text, { role }]) => sum + text.length * roster[role].length, 0);
    expect(longest * perCharacter, 'the longest line').toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(all * perCharacter, 'every recording of the cast').toBeLessThanOrEqual(MAX_FOLDER_BYTES);
    // Over the cap that held one voice's lines: the cast needs its room.
    expect(all * perCharacter).toBeGreaterThan(12 * 1024 * 1024);
  });

  it('knows how long each line speaks, and finds it by who says it and its words', () => {
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
      const helmut = lineKey({ text: start, person: 'helmut' });
      expect(ids.get(helmut)).toBe(recorded ? lineId('helmut', start) : undefined);
      // Another person's voice finds nothing of his.
      expect(ids.get(lineKey({ text: start, person: 'marta' }))).toBeUndefined();
    }
  });

  it('marks the lines that open a run, and only those: the radio opens the channel for them', () => {
    const starts = shippedMissions().flatMap((mission) => textsOf(mission.radio?.start));
    expect(starts.length).toBeGreaterThanOrEqual(4);
    const recorded = starts.filter((text) => !AWAITING_RENDER.includes(text));
    expect([...openersOf(manifest)].sort()).toEqual(
      recorded.map((text) => lineId('helmut', text)).sort(),
    );
    for (const [text, { opens }] of shippedLines()) {
      expect(opens, text).toBe(starts.includes(text));
    }
  });
});

describe('the cast the script reads', () => {
  it('is core’s roster, read as a file: the same persons, the same in service', () => {
    expect(roster).toEqual(JSON.parse(JSON.stringify(ROSTER)));
    for (const role of ROLES) {
      const ids = (persons: readonly { id: string }[]) => persons.map(({ id }) => id);
      expect(ids(inService(roster, role)), role).toEqual(ids(coreInService(role)));
    }
    const voiced: Roster = {
      ...roster,
      operator: roster.operator.map((p) => ({ ...p, voiceId: `${p.id}Voice00000` })),
    };
    expect(inService(voiced, 'operator').map(({ id }) => id)).toEqual(['helmut', 'marta', 'jonas']);
    expect(coreInService('operator', voiced).map(({ id }) => id)).toEqual(
      inService(voiced, 'operator').map(({ id }) => id),
    );
  });

  it('is the roster’s alone: the list names the model of every take, and no voice', () => {
    const synthetic = Object.values(manifest.lines).filter((entry) => entry.render !== undefined);
    expect(synthetic.length).toBeGreaterThan(40);
    for (const entry of synthetic) {
      expect(entry.model, entry.text).toMatch(/^(eleven_|de_DE-)/);
    }
    // The voices are the roster's now: the list names none.
    const file = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(['lines']);
  });
});

describe('the lines the script reads', () => {
  const missions = readdirSync(MISSIONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseMission(JSON.parse(readFileSync(join(MISSIONS_DIR, name), 'utf8'))));

  it('are every line core can put on the air, in its order, by its role in its mood', () => {
    expect(missions.length).toBe(shippedMissions().length);
    for (const mission of missions) {
      const read = shippedMissions().find((each) => each.id === mission.id);
      const core = radioLines(mission).map(({ text, role, mood, when }) => ({
        text,
        role,
        moment: when,
        mood,
        opens: when === 'start',
      }));
      const script = (read ? catalogOf(read) : []).map(({ text, role, moment, mood, opens }) => ({
        text,
        role,
        moment,
        mood,
        opens,
      }));
      expect(script, mission.id).toEqual(core);
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

  it('give the answers and the Funkprobe their moods, one line one mood', () => {
    const radio = {
      emergency: { start: 'Notfall.', cleared: 'Steht.', missed: 'Zu spät.' },
      alarm: ['Alarm.', 'Alarm bei mir.'],
      clock: { fiveMinutes: 'Fünf.', twoMinutes: 'Zwei.', lastMinute: 'Eine.' },
      won: { plenty: 'Gut.', tight: 'Knapp.', lastMinute: 'Gerade so.' },
      lost: { time: 'Dunkel.', alarms: 'Abgeworfen.', abandoned: 'Abbruch.' },
      lobby: ['Funkprobe.', 'Kurze Funkprobe.'],
    };
    const moods = catalogOf({ id: 'moods', radio, puzzles: [] }).map(({ text, mood }) => [
      text,
      mood,
    ]);
    expect(moods).toEqual([
      ['Notfall.', 'urgent'],
      ['Steht.', 'relieved'],
      ['Zu spät.', 'tense'],
      ['Alarm.', 'tense'],
      ['Alarm bei mir.', 'tense'],
      ['Fünf.', 'pressing'],
      ['Zwei.', 'pressing'],
      ['Eine.', 'pressing'],
      ['Gut.', 'warm'],
      ['Knapp.', 'warm'],
      ['Gerade so.', 'warm'],
      ['Dunkel.', 'quiet'],
      ['Abgeworfen.', 'quiet'],
      ['Abbruch.', 'quiet'],
      ['Funkprobe.', 'calm'],
      ['Kurze Funkprobe.', 'calm'],
    ]);
    // The same words tense as an alarm and pressing as the clock would need two takes.
    const torn = { id: 'torn', radio: { alarm: 'Achtung.', clock: { lastMinute: 'Achtung.' } } };
    expect(() => shippedLines([{ ...torn, puzzles: [] }])).toThrow(
      /„Achtung\." is said by the operator in a tense mood and the lead in a pressing mood/,
    );
  });

  it('take the intro’s announcement first, as a run hears it, by the loudspeakers', () => {
    const blackout = shippedMissions().find((m) => m.id === 'blackout');
    expect(blackout?.intro?.pa).toHaveLength(5);
    for (const line of blackout?.intro?.pa ?? []) {
      expect(shippedLines().get(line), line).toEqual({
        missions: ['blackout'],
        role: 'pa',
        moment: 'pa',
        mood: null,
        opens: false,
        said: line,
      });
    }
    const nudges = (blackout?.puzzles ?? []).flatMap((p) => p.nudges ?? []);
    expect(nudges).toHaveLength(12);
    // Half of them in a second text that says something of its own, every text a line to record.
    expect(nudges.flatMap(textsOf)).toHaveLength(18);
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

  it('names a recording by its person and the first 12 hex of the SHA-1 of its words', () => {
    expect(voiceId('abc')).toBe('a9993e364706');
    expect(voiceId('Beide hin.')).toMatch(/^[0-9a-f]{12}$/);
    expect(lineId('marta', 'abc')).toBe('marta-a9993e364706');
  });
});

describe('a line’s role, as the script reads it', () => {
  it('is the plant’s, the Schichtleitung’s or the Leitstelle’s, by its moment', () => {
    const mission = {
      id: 'probe',
      intro: { pa: ['Durchsage.'] },
      radio: { start: 'Los.', escape: 'Raus.', clock: { lastMinute: 'Eine.' } },
      puzzles: [{ nudges: ['Hier.'], onSolved: 'Eins.' }, {}],
      map: { sabotage: { announce: 'Störung.' } },
    };
    const said = (text: string, role: string, moment: string, opens = false) => ({
      text,
      said: text,
      role,
      moment,
      mood: moment === 'clock' ? 'pressing' : null,
      opens,
    });
    expect(catalogOf(mission)).toEqual([
      said('Durchsage.', 'pa', 'pa'),
      said('Los.', 'operator', 'start', true),
      said('Hier.', 'operator', 'nudge'),
      said('Eins.', 'operator', 'solved'),
      said('Raus.', 'operator', 'escape'),
      said('Störung.', 'pa', 'announce'),
      said('Eine.', 'lead', 'clock'),
    ]);
    expect(catalogOf({ id: 'quiet', puzzles: [{}] })).toEqual([]);
    expect(shippedLines([mission]).get('Los.')).toEqual({
      missions: ['probe'],
      role: 'operator',
      moment: 'start',
      mood: null,
      opens: true,
      said: 'Los.',
    });
    expect(shippedLines([mission]).get('Störung.')?.role).toBe('pa');
    // One line, one recording a person: two roles may not say the same words.
    const twice = { ...mission, map: { sabotage: { announce: 'Los.' } } };
    expect(() => shippedLines([twice])).toThrow(/„Los\." is said by the operator and the pa/);
  });
});

describe('the announcement over Blackout’s loudspeakers, as recorded', () => {
  const blackout = shippedMissions().find((mission) => mission.id === 'blackout') as
    | { intro?: { lightsSec?: number; pa?: string[] } }
    | undefined;
  const lines = blackout?.intro?.pa ?? [];
  const plant = inService(roster, 'pa')[0]?.id ?? '';
  const ms = lines.map((text) => manifest.lines[lineId(plant, text)]?.ms ?? Number.NaN);

  it('speaks half a minute at most', () => {
    expect(plant).toBe('anlage');
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

/** Helmut's library voice, which every recorded line was made with (core cast.json). */
const HELMUT = 'g1jpii0iyvtRs8fqXsd1';

/** A client that must never be called: renders only read the voices. */
const NO_CLIENT = {
  voices: { getAll: () => Promise.reject(new Error('no call')) },
  textToSpeech: { convert: () => Promise.reject(new Error('no call')) },
};

/** A person's ElevenLabs voice on no client, reading by `model`, held as `role` asks. */
const voiceOf = (
  voiceId: string,
  model: string,
  role: keyof typeof ROLE_HELD = 'operator',
): ElevenVoice => ({ client: NO_CLIENT, voiceId, model, held: ROLE_HELD[role] });

/**
 * ElevenLabs reading by `model` — Helmut's voice, or `voiceId`, for helmut — on the account's
 * `plan`, with the voices of `others` besides, by their ids.
 */
const eleven = (
  model: string,
  voiceId = HELMUT,
  plan: Plan = 'free',
  others: Readonly<Record<string, ElevenVoice>> = {},
): Voice => ({
  engine: 'elevenlabs',
  name: 'Helmut',
  plan,
  persons: { helmut: voiceOf(voiceId, model), ...others },
});

/** The roster with Marta's voice kept besides Helmut's, Jonas and Kessler without one yet. */
const MARTA_KEPT: Roster = {
  ...roster,
  operator: roster.operator.map((p) =>
    p.id === 'marta' ? { ...p, voiceId: 'martaVoice0000000000', model: 'eleven_v3' } : p,
  ),
};

describe('what a run keeps, and what it makes anew', () => {
  const TEXT = 'Reaktor läuft.';
  const said: Said = { text: TEXT, said: TEXT, person: 'helmut', mood: null };
  const line: ShippedLine = {
    missions: ['blackout'],
    role: 'operator',
    moment: 'solved',
    mood: null,
    opens: false,
    said: TEXT,
  };
  const piper: Voice = { engine: 'piper', name: PIPER_MODEL, model: '/cache/thorsten.onnx' };
  const render = renderOf(piper, said);
  const base: Entry = {
    text: TEXT,
    ms: 1400,
    missions: ['blackout'],
    role: 'operator',
    person: 'helmut',
    moment: 'solved',
    file: 'helmut-aaaaaaaaaaaa.m4a',
  };
  const made: Entry = { ...base, render };
  const other: Entry = { ...base, render: 'ffffffffffff' };
  const unmarked: Entry = { ...base };
  const human: Entry = { ...base, source: 'human' };
  const upload: Entry = { ...base, source: 'upload', file: 'helmut-aaaaaaaaaaaa.mp3' };
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

  it('tells the persons apart under ElevenLabs alone: their voices, and how each holds', () => {
    const marta = voiceOf('martaVoice0000000000', 'eleven_v3');
    const both = eleven('eleven_v4', HELMUT, 'free', { marta });
    const hers = { ...said, person: 'marta' };
    expect(renderOf(both, said)).toBe(renderOf(eleven('eleven_v4'), said));
    expect(renderOf(both, hers)).not.toBe(renderOf(both, said));
    // The plant's voice held as the operator's would be another take, too.
    const plant = { ...said, person: 'anlage' };
    const steady = eleven('eleven_v4', HELMUT, 'free', {
      anlage: voiceOf('paVoice0000000000000', 'eleven_v4', 'pa'),
    });
    const loose = eleven('eleven_v4', HELMUT, 'free', {
      anlage: voiceOf('paVoice0000000000000', 'eleven_v4', 'operator'),
    });
    expect(renderOf(loose, plant)).not.toBe(renderOf(steady, plant));
    expect(ROLE_HELD.pa.stability).toBeGreaterThan(ROLE_HELD.operator.stability);
    // Without a voice for a person yet, their lines are made by nobody: never one kept.
    const none = renderOf(eleven('eleven_v4'), hers);
    expect(none).not.toBe(renderOf(both, hers));
    expect(Object.values(manifest.lines).some((entry) => entry.render === none)).toBe(false);
    // Piper and the Mac read every person in their one voice.
    expect(renderOf(piper, hers)).toBe(render);
  });

  it('makes nothing of Helmut’s anew for the cast: each take keeps its render and model', () => {
    const voice = eleven('eleven_v4');
    const entries = Object.values(manifest.lines);
    expect(entries.length).toBeGreaterThan(40);
    // Every take of the list was his on Eleven v4, the plant's five among them: its render is his.
    for (const entry of entries) {
      const mood = entry.mood ?? null;
      const his = { text: entry.text, said: entry.text, person: 'helmut', mood };
      expect(renderOf(voice, his), entry.text).toBe(entry.render);
      expect(entry.model, entry.text).toBe('eleven_v4');
      expect(modelOf(voice, his)).toBe('eleven_v4');
    }
  });

  it('writes an entry with its role, person and moment, its file and a person or a render', () => {
    const take = { file: base.file, render, model: PIPER_MODEL };
    expect(entryOf(TEXT, 1400, line, 'helmut', take)).toEqual({ ...made, model: PIPER_MODEL });
    expect(entryOf(TEXT, 1400, line, 'helmut', { file: base.file, source: 'human' })).toEqual(
      human,
    );
    const opening = entryOf(
      'Los.',
      900,
      { ...line, missions: ['b', 'a'], moment: 'start', opens: true },
      'marta',
      upload,
    );
    expect(opening).toEqual({
      text: 'Los.',
      ms: 900,
      missions: ['a', 'b'],
      role: 'operator',
      person: 'marta',
      moment: 'start',
      opens: true,
      source: 'upload',
      file: 'helmut-aaaaaaaaaaaa.mp3',
    });
    const keys = (entry: Entry): string => Object.keys(entry).join(' ');
    expect(keys(opening)).toBe('text ms missions role person moment opens source file');
    // A line said in a mood keeps it beside its moment, a render the model that read it.
    const tense = entryOf(TEXT, 1400, { ...line, mood: 'tense' }, 'helmut', take);
    expect(keys(tense)).toBe('text ms missions role person moment mood render model file');
  });

  it('names the paid plan in a render, so that --fresh there makes older takes anew', () => {
    expect([planOf('free'), planOf(undefined), planOf('creator'), planOf('pro')]).toEqual([
      'free',
      'free',
      'paid',
      'paid',
    ]);
    const free = eleven('eleven_v4');
    const paid = eleven('eleven_v4', HELMUT, 'paid');
    expect(renderOf(paid, said)).not.toBe(renderOf(free, said));
    // The takes of before name no plan: the free plan keeps them under --fresh, the paid one
    // makes them anew — those of 2026-10-25 among them — and keeps them without it.
    for (const entry of Object.values(manifest.lines)) {
      const mood = entry.mood ?? null;
      const take = { text: entry.text, said: entry.text, person: 'helmut', mood };
      const under = (voice: Voice, fresh: Fresh) =>
        keeps(entry, entry.text, true, fresh, renderOf(voice, take));
      expect([under(free, 'synthetic'), under(paid, 'synthetic'), under(paid, 'none')]).toEqual([
        true,
        false,
        true,
      ]);
    }
    // Piper and the Mac know no plan.
    expect(renderOf(piper, said)).toBe(render);
  });

  it('asks the account for its plan before anything, and for the voices of the cast', async () => {
    /** An account on `tier` with Helmut and Marta's kept voice, or one that will not say. */
    const account = (tier: string | Error): SpeechClient & SoundClient => ({
      ...NO_CLIENT,
      voices: {
        getAll: () =>
          Promise.resolve({
            voices: [
              { voiceId: HELMUT, name: 'Helmut - German Epic Trailer Voice' },
              { voiceId: 'martaVoice0000000000', name: 'EscapeLab Marta' },
            ],
          }),
      },
      user: {
        subscription: {
          get: () =>
            tier instanceof Error
              ? Promise.reject(tier)
              : Promise.resolve({ characterCount: 0, characterLimit: 100_000, tier }),
        },
      },
      textToSoundEffects: { convert: () => Promise.reject(new Error('no call')) },
      music: { compose: () => Promise.reject(new Error('no call')) },
    });
    const paid = await elevenVoiceOf(MARTA_KEPT, account('creator'));
    expect(paid.engine === 'elevenlabs' && paid.plan).toBe('paid');
    const persons = paid.engine === 'elevenlabs' ? paid.persons : {};
    expect(Object.keys(persons)).toEqual(['helmut', 'marta']);
    expect([persons['helmut']?.model, persons['marta']?.model]).toEqual(['eleven_v4', 'eleven_v3']);
    expect(persons['marta']?.held).toEqual(ROLE_HELD.operator);
    expect(paid.engine === 'elevenlabs' && paid.name).toMatch(/helmut eleven_v4, marta.*paid plan/);
    // ELEVENLABS_MODEL names the model every voice reads with.
    const over = await elevenVoiceOf(MARTA_KEPT, account('free'), 'eleven_multilingual_v2');
    const models = over.engine === 'elevenlabs' ? Object.values(over.persons) : [];
    expect(models.map((voice) => voice.model)).toEqual([
      'eleven_multilingual_v2',
      'eleven_multilingual_v2',
    ]);
    // A voice the roster keeps and the account has not: refused, naming the account's voices.
    const lead = [{ ...roster.lead[0]!, voiceId: 'goneVoice00000000' }];
    const gone: Roster = { ...MARTA_KEPT, lead };
    await expect(elevenVoiceOf(gone, account('free'))).rejects.toThrow(/no voice "goneVoice/);
    const silent = elevenVoiceOf(MARTA_KEPT, account(new Error('offline')));
    await expect(silent).rejects.toThrow(/did not tell the account's plan/);
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

describe('a run over the cast', () => {
  /** Two lines no shipped mission says: nothing of them is recorded. */
  const probe: MissionLines = {
    id: 'probe',
    radio: { start: 'Probe läuft an.', clock: { lastMinute: 'Noch eine Probeminute.' } },
    puzzles: [],
  };
  const lines = shippedLines([probe]);
  const kept = MARTA_KEPT;
  const marta = voiceOf('martaVoice0000000000', 'eleven_v3');
  const both = eleven('eleven_v4', HELMUT, 'paid', { marta });

  it('makes each line for each person in service: both operators, else the role’s first', () => {
    const planned = plan({ lines: {} }, 'none', both, kept, lines);
    expect(planned.map(({ id, person }) => [id.split('-')[0], person.id])).toEqual(
      expect.arrayContaining([
        ['helmut', 'helmut'],
        ['marta', 'marta'],
        ['kessler', 'kessler'],
      ]),
    );
    expect(planned).toHaveLength(3);
    // ElevenLabs makes the kept cast's lines; the Schichtleitung has no voice yet: hers wait.
    expect(toMake(both, planned).map(({ person }) => person.id).sort()).toEqual([
      'helmut',
      'marta',
    ]);
    expect([canRead(both, 'kessler'), canRead({ engine: 'say' }, 'kessler')]).toEqual([
      false,
      true,
    ]);
    // Piper or the Mac read everybody's in their one voice.
    expect(toMake({ engine: 'say' }, planned)).toHaveLength(3);
  });

  it('makes only what is missing or stale by its render, and never a line twice', () => {
    const planned = plan({ lines: {} }, 'synthetic', both, kept, lines);
    // As a render leaves them: every line made, the render it would get, its file there.
    const file = readdirSync(VOICE_DIR).find((name) => name.endsWith('.mp3')) ?? '';
    const done: Manifest = {
      lines: Object.fromEntries(
        planned.map(({ id, text, line, person, render }) => [
          id,
          entryOf(text, 1000, line, person.id, { file, render }),
        ]),
      ),
    };
    for (const fresh of ['none', 'synthetic'] as const) {
      expect(toMake(both, plan(done, fresh, both, kept, lines)), fresh).toEqual([]);
    }
    // A voice that would read them otherwise — the free plan — makes them anew under --fresh.
    const free = eleven('eleven_v4', HELMUT, 'free', { marta });
    expect(toMake(free, plan(done, 'none', free, kept, lines))).toEqual([]);
    expect(toMake(free, plan(done, 'synthetic', free, kept, lines))).toHaveLength(2);
    // Helmut's takes of the shipped lines, made on the free plan's terms: --fresh on the paid
    // plan makes them anew, a run without it keeps them.
    const shipped = plan(manifest, 'synthetic', eleven('eleven_v4', HELMUT, 'paid'), roster);
    const paid = eleven('eleven_v4', HELMUT, 'paid');
    expect(toMake(paid, shipped).filter(({ was }) => was !== null).length).toBeGreaterThan(40);
    const unasked = toMake(paid, plan(manifest, 'none', paid, roster));
    expect(unasked.every(({ was }) => was === null)).toBe(true);
  });

  it('counts the characters each person’s model is given, tags and moods included', () => {
    const planned = plan({ lines: {} }, 'none', both, kept, lines);
    const todo = toMake(both, planned);
    // Helmut on v4 and Marta on v3 read the start as it is written, no mood.
    expect(charactersOf(both, todo)).toBe('Probe läuft an.'.length * 2);
    const all = toMake({ engine: 'say' }, planned);
    const words = 'Probe läuft an.'.length * 2 + 'Noch eine Probeminute.'.length;
    expect(charactersOf({ engine: 'say' }, all)).toBe(words);
    expect(charactersOf(both, [])).toBe(0);
  });
});

describe('the plan of a run (--plan)', () => {
  /** A start, a nudge in a mood's moment, and a clock call: three lines no mission says. */
  const probe: MissionLines = {
    id: 'probe',
    radio: {
      start: 'Probe läuft an.',
      alarm: 'Probealarm.',
      clock: { lastMinute: 'Probeminute.' },
    },
    puzzles: [],
  };
  const lines = shippedLines([probe]);
  const kept = MARTA_KEPT;

  it('counts for each person the lines made now and their credits, or design and lines', () => {
    const costs = costsOf(kept, { lines: {} }, 'synthetic', undefined, lines);
    const of = (slot: string) => costs.find((cost) => cost.slot === slot);
    // Helmut on v4 and Marta on v3 read the start as written and the alarm with its mood's tag.
    const theirs = 'Probe läuft an.'.length + '[tense] Probealarm.'.length;
    expect(of('operator:helmut')).toMatchObject({ model: 'eleven_v4', make: 2, skip: 0 });
    expect(of('operator:helmut')?.characters).toBe(theirs);
    expect(of('operator:marta')).toMatchObject({ model: 'eleven_v3', make: 2, characters: theirs });
    // Jonas has no voice yet: his design, then the Leitstelle's two lines on Eleven v3.
    expect(of('operator:jonas')).toEqual({
      slot: 'operator:jonas',
      name: 'Jonas',
      model: null,
      make: 0,
      characters: 0,
      skip: 0,
      design: DESIGN_TEXT.operator.length,
      later: { lines: 2, characters: theirs },
    });
    // The Schichtleitung's call, pressing, once her voice is kept.
    expect(of('lead')?.later).toEqual({ lines: 1, characters: '[insistent] Probeminute.'.length });
    const slots = costs.map((cost) => cost.slot).join(' ');
    expect(slots).toBe('pa operator:helmut operator:marta operator:jonas lead');
  });

  it('skips what is made as the run would make it, and tells what --fresh would make', () => {
    const voice = plannedVoice(kept);
    const planned = plan({ lines: {} }, 'synthetic', voice, kept, lines);
    const file = readdirSync(VOICE_DIR).find((name) => name.endsWith('.mp3')) ?? '';
    const done: Manifest = {
      lines: Object.fromEntries(
        planned.map(({ id, text, line, person, render }) => [
          id,
          entryOf(text, 1000, line, person.id, { file, render }),
        ]),
      ),
    };
    const helmut = costsOf(kept, done, 'synthetic', undefined, lines)[1];
    expect(helmut).toMatchObject({ slot: 'operator:helmut', make: 0, characters: 0, skip: 2 });
    // The shipped manifest: Helmut's takes were made before the paid plan named itself.
    const shipped = costsOf(roster, manifest, 'synthetic')[1];
    const unasked = costsOf(roster, manifest, 'none')[1];
    expect(shipped?.skip).toBe(0);
    expect((unasked?.skip ?? 0) + (unasked?.make ?? 0)).toBe(shipped?.make);
  });

  it('prints each person’s line, the kept cast now, the whole cast with every voice kept', () => {
    const costs = costsOf(kept, { lines: {} }, 'synthetic', undefined, lines);
    const report = planReport(costs, 'synthetic');
    expect(CREDITS_PER_CHARACTER).toBe(1);
    expect(report[0]).toMatch(/plan of `voice --fresh` .*paid plan.*nothing is asked/);
    expect(report).toHaveLength(costs.length + 3);
    expect(report[2]).toMatch(/operator:helmut +Helmut +eleven_v4 +2 lines, 34 credits; 0 made/);
    expect(report[4]).toMatch(/operator:jonas +Jonas +no voice yet: its design 228 credits/);
    const now = 34 * 2;
    expect(report.at(-2)).toBe(`voice: now, the kept cast: 4 lines, ${now} credits`);
    const designs = DESIGN_TEXT.pa.length + DESIGN_TEXT.operator.length + DESIGN_TEXT.lead.length;
    const said = ['Probe läuft an.', '[tense] Probealarm.', '[insistent] Probeminute.'];
    const later = said.reduce((sum, text) => sum + text.length, 0);
    expect(report.at(-1)).toBe(
      `voice: every voice kept: 3 designs (${designs} credits) and 7 lines ` +
        `(${now + later} credits), ${designs + now + later} credits in all`,
    );
    expect(planReport(costs, 'none')[0]).toMatch(/plan of `voice` /);
    expect(planReport(costs, 'all')[0]).toMatch(/plan of `voice --fresh=all` /);
  });

  it('asks ElevenLabs for nothing: its voices have no client to call', async () => {
    const voice = plannedVoice(kept, 'eleven_multilingual_v2');
    expect(voice.plan).toBe('paid');
    expect(Object.values(voice.persons).map((each) => each.model)).toEqual([
      'eleven_multilingual_v2',
      'eleven_multilingual_v2',
    ]);
    const client = voice.persons['helmut']?.client;
    await expect(client?.voices.getAll()).rejects.toThrow(/--plan asks ElevenLabs for nothing/);
  });
});

/** A line the operator says warm, plain, and with a breath of its own: moods and tags. */
const ALL_OUT = 'Alle draußen.';
const warm: Said = { text: ALL_OUT, said: ALL_OUT, person: 'helmut', mood: 'warm' };
const plain: Said = { ...warm, mood: null };
const TAGGED = 'Alle draußen. [exhales] Durchatmen.';
const sigh: Said = {
  text: 'Alle draußen. Durchatmen.',
  said: TAGGED,
  person: 'helmut',
  mood: 'warm',
};

/** ElevenLabs reading by `model` for Helmut, every request it gets kept, each answered. */
function listening(model: string) {
  const requests: [string, ElevenLabs.BodyTextToSpeechFull][] = [];
  const client: SpeechClient = {
    voices: NO_CLIENT.voices,
    textToSpeech: {
      convert: (voiceId, request) => {
        requests.push([voiceId, request]);
        return Promise.resolve(new Blob([Uint8Array.from([0xff, 0xfb])]).stream());
      },
    },
  };
  const persons = {
    helmut: { client, voiceId: HELMUT, model, held: ROLE_HELD.operator },
    anlage: { client, voiceId: 'paVoice0000000000000', model, held: ROLE_HELD.pa },
  };
  return { persons, requests };
}

describe('a line said in a mood', () => {
  it('asks Eleven v3 and v4 for a mood by an audio tag before the words, no other model', () => {
    expect(spokenText(ALL_OUT, 'pressing', 'eleven_v4')).toBe('[insistent] Alle draußen.');
    expect(spokenText(ALL_OUT, 'quiet', 'eleven_v3')).toBe('[subdued] Alle draußen.');
    // An older model would say the tag aloud.
    expect(spokenText(ALL_OUT, 'warm', 'eleven_multilingual_v2')).toBe(ALL_OUT);
    expect(spokenText(ALL_OUT, 'warm', 'eleven_flash_v2_5')).toBe(ALL_OUT);
    expect(spokenText(ALL_OUT, null, 'eleven_v4')).toBe(ALL_OUT);
    expect(['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2'].map(takesTags)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('has a tag for every mood core gives a moment, one word or two in brackets', () => {
    expect(Object.keys(MOOD_TAGS).sort()).toEqual([...new Set(Object.values(MOODS))].sort());
    for (const tag of Object.values(MOOD_TAGS)) {
      expect(tag).toMatch(/^\[[a-z]+( [a-z]+)?\]$/);
    }
  });

  it('makes another take of a line in another mood or with other tags, only where heard', () => {
    const v4 = eleven('eleven_v4');
    const takes = [plain, warm, { ...warm, mood: 'quiet' } as const, sigh].map((each) =>
      renderOf(v4, each),
    );
    expect(new Set(takes).size).toBe(4);
    const v2 = eleven('eleven_multilingual_v2');
    expect(renderOf(v2, warm)).toBe(renderOf(v2, plain));
    const piper: Voice = { engine: 'piper', name: PIPER_MODEL, model: '/cache/thorsten.onnx' };
    expect(renderOf(piper, warm)).toBe(renderOf(piper, plain));
  });

  it('holds its lines to the operator’s voice as before: Helmut’s hold', () => {
    expect(ROLE_HELD.operator).toEqual(OPERATOR_HELD);
    expect(ROLE_HELD.lead).toEqual(OPERATOR_HELD);
  });
});

describe('a line’s own audio tags', () => {
  it('go to the render after its mood’s, and only the words are shown', () => {
    expect(spokenText(TAGGED, 'warm', 'eleven_v3')).toBe(`[warm] ${TAGGED}`);
    expect(spokenText(TAGGED, null, 'eleven_v4')).toBe(TAGGED);
    // A model that reads no tags gets the words alone: never a tag said aloud.
    expect(spokenText(TAGGED, 'warm', 'eleven_multilingual_v2')).toBe('Alle draußen. Durchatmen.');
    const mission = { id: 'tags', radio: { won: { plenty: TAGGED } }, puzzles: [] };
    expect(catalogOf(mission)).toEqual([
      {
        text: 'Alle draußen. Durchatmen.',
        said: TAGGED,
        role: 'operator',
        moment: 'won',
        mood: 'warm',
        opens: false,
      },
    ]);
    expect(shippedLines([mission]).get('Alle draußen. Durchatmen.')?.said).toBe(TAGGED);
    // The same words tagged two ways would be two takes of one recording: refused.
    const won = { plenty: TAGGED, tight: 'Alle draußen. [sighs] Durchatmen.' };
    const twice = { id: 'twice', radio: { won }, puzzles: [] };
    expect(() => shippedLines([twice])).toThrow(/is said by the operator in a warm mood as/);
  });

  it('are read by Eleven v3 where the voice’s own model reads none', () => {
    expect(TAG_MODEL).toBe('eleven_v3');
    expect([tagged(TAGGED), tagged(ALL_OUT)]).toEqual([true, false]);
    expect(modelFor('eleven_multilingual_v2', TAGGED)).toBe('eleven_v3');
    expect(modelFor('eleven_multilingual_v2', ALL_OUT)).toBe('eleven_multilingual_v2');
    expect(modelFor('eleven_v4', TAGGED)).toBe('eleven_v4');
    const v2 = eleven('eleven_multilingual_v2');
    expect(modelOf(v2, sigh)).toBe('eleven_v3');
    expect(modelOf(v2, warm)).toBe('eleven_multilingual_v2');
    expect(modelOf({ engine: 'say' }, sigh)).toBeUndefined();
  });

  it('come out of the words as core takes them out, for every shipped line', () => {
    const cases = [
      TAGGED,
      '[sighs] Das war’s.',
      'Gerade noch [laughs], raus da.',
      'Ruhig bleiben. [long pause]',
      '[calm] [clears throat] Funkprobe.',
      'Kein Tag hier.',
    ];
    for (const text of [...cases, ...[...shippedLines().values()].map((line) => line.said)]) {
      expect(shownText(text), text).toBe(coreShownText(text));
    }
    // What a mission shows, the manifest keeps: the words without a tag.
    for (const text of shippedLines().keys()) {
      expect(text).not.toMatch(/\[[^[\]]+\]/);
    }
  });

  it('go with the words to the person’s voice, never to the subtitle', async () => {
    const v4 = listening('eleven_v4');
    await elevenTake(v4.persons, warm);
    await elevenTake(v4.persons, { ...plain, person: 'anlage' });
    await elevenTake(v4.persons, sigh);
    expect(v4.requests.map(([voiceId, request]) => [voiceId, request.text])).toEqual([
      [HELMUT, '[warm] Alle draußen.'],
      ['paVoice0000000000000', ALL_OUT],
      [HELMUT, `[warm] ${TAGGED}`],
    ]);
    // An older model: the words alone, but a tagged line by Eleven v3, its tags with it.
    const v2 = listening('eleven_multilingual_v2');
    await elevenTake(v2.persons, warm);
    await elevenTake(v2.persons, sigh);
    expect(v2.requests.map(([, request]) => [request.modelId, request.text])).toEqual([
      ['eleven_multilingual_v2', ALL_OUT],
      ['eleven_v3', `[warm] ${TAGGED}`],
    ]);
    await expect(elevenTake({}, warm)).rejects.toThrow(/helmut has no voice yet/);
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
