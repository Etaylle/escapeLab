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
  sayersOf as coreSayersOf,
  sayersOfLine as coreSayersOfLine,
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
  sayersOf,
  sayersOfLine,
  type Person,
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
  freshBeside,
  freshOf,
  keeps,
  keptForOldRuns,
  lineId,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  MAX_FOLDER_BYTES,
  MISSIONS_DIR,
  modelFor,
  modelOf,
  modelUrl,
  MOOD_TAGS,
  OLD_RUN_LINES,
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
  waitingFor,
  type Entry,
  type Fresh,
  type Line,
  type Manifest,
  type MissionLines,
  type Plan,
  type Planned,
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
 * last word on the end card, the Funkprobe and a line of the opening silent, the words shown all
 * the same. To be emptied as the render (docs/sound.md) makes them, for every person who says
 * them. Any other line without a recording fails, and so does a line here that every one of them
 * has now. Today the 22 lines Blackout's new chain says (B-blackout2): the hand-overs after the
 * Notlicht, the Anlaufsteuerung, the Paketfilter, the Serverraum, the Signalkette and the
 * Notstromkasten, two texts each, and the nudges of the Anlaufsteuerung (four), the
 * Paketfilter (three) and the Notstromkasten at its new place (three) — each by the three of
 * the Leitstelle.
 */
const AWAITING_RENDER: readonly string[] = [
  'Notlicht steht, danke. Jetzt das Notstromaggregat: Das Betriebsbuch liegt im Archiv, ein ' +
    'Pult der Anlaufsteuerung steht im Flur, eins im Maschinenraum.',
  'Notlicht brennt, ich sehe euch wieder auf meiner Tafel. Weiter mit der Anlaufsteuerung: ' +
    'Betriebsbuch im Archiv, Pulte im Flur und im Maschinenraum.',
  'Aggregat läuft, die Maschinenraumtür bleibt offen. Als Nächstes der Paketfilter am ' +
    'Serverschott: Pulte östlich davon, die Richtlinie hängt westlich an der Südwand.',
  'Die Maschinen laufen an, im Maschinenraum ist Licht. Der Paketfilter vor dem Serverraum ' +
    'braucht beide Pulte, die Richtlinie hängt westlich vom Schott.',
  'Das Betriebsbuch zur Anlaufsteuerung liegt im Archiv, auf der Ostseite.',
  'Ohne das Betriebsbuch aus dem Archiv sagen die Leuchten am Schaltfeld nichts, es liegt ' +
    'dort auf der Ostseite.',
  'Ein Pult der Anlaufsteuerung steht am Westende vom Flur, eins im Maschinenraum hinter ' +
    'der Plattentür.',
  'Die Tür zum Maschinenraum geht nur auf, solange jemand auf der Platte davor steht, ' +
    'dahinter wartet das zweite Pult.',
  'Die Richtlinie zum Paketfilter hängt im Flur an der Südwand, westlich vom Schott.',
  'Welche Pakete der Filter sperrt, steht in der Richtlinie, sie hängt im Flur an der ' +
    'Südwand.',
  'Das Analysepult steht im Flur gleich östlich vom Schott zum Serverraum, das Sperrpult ' +
    'ein Stück weiter Richtung Ostende.',
  'Schott zum Serverraum ist offen, drinnen Terminal und Rack. Die Unterlagen dazu liegen im ' +
    'Spind zwischen den beiden.',
  'Das Schott zum Serverraum ist auf. Terminal und Rack stehen drinnen, die Unterlagen ' +
    'liegen im Spind darin.',
  'Server laufen, Labortür offen, beide Drohnen sind wach. Ich schalte euch die Anlage auf, ' +
    'die heute Dienst hat, sie öffnet den Reaktor.',
  'Server oben, zwei Drohnen fliegen, die Kameraplatte am Schott hält die im Flur an. Die ' +
    'Anlage, die Dienst hat, öffnet den Reaktor.',
  'Signalkette steht, die Türen zum Reaktor sind offen. Ohne Ersatzsicherung bleibt er aber ' +
    'tot.',
  'Die Signalkette hält, der Reaktor ist offen. Die Ersatzsicherung dafür liegt im Archiv, ' +
    'bringt sie rüber.',
  'Der Notstromkasten hält, die Türen zum Reaktor sind offen. Ohne Ersatzsicherung bleibt ' +
    'er aber tot.',
  'Der Notstromkasten ist sicher, der Reaktor ist offen. Die Ersatzsicherung dafür liegt im ' +
    'Archiv, bringt sie rüber.',
  'Das Wartungsbuch zum Notstromkasten liegt im Maschinenraum.',
  'Ohne das Wartungsbuch aus dem Maschinenraum ratet ihr am Kasten nur herum.',
  'Der Notstromkasten hängt im Maschinenraum gleich hinter der Tür, das Prüfpult steht im ' +
    'Labor an der Südwand.',
];

const manifest = readManifest();
const recordings = readdirSync(VOICE_DIR).filter((name) => /\.(m4a|mp3)$/.test(name));
const roster = readRoster();

/** A person of the roster without a voice kept. */
const unvoiced = ({ id, name, character }: Person): Person => ({ id, name, character });

/**
 * The roster as it stood before the cast's render, for the tests whose point is a cast part of
 * which has no voice: Helmut's kept alone.
 */
const HELMUT_ALONE: Roster = {
  pa: roster.pa.map(unvoiced),
  operator: roster.operator.map((p) => (p.id === 'helmut' ? p : unvoiced(p))),
  lead: roster.lead.map(unvoiced),
};

/** That roster with Laura's voice kept besides Helmut's, Ben and Mila without one yet. */
const LAURA_KEPT: Roster = {
  ...HELMUT_ALONE,
  operator: HELMUT_ALONE.operator.map((p) =>
    p.id === 'laura' ? { ...p, voiceId: 'lauraVoice0000000000', model: 'eleven_v3' } : p,
  ),
};

/** Every recording a shipped line needs: the line as each person who says it says it. */
const needed = [...shippedLines()].flatMap(([text, line]) =>
  sayersOfLine(roster, line).map(({ id: person }) => ({
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
      const persons = line === undefined ? [] : sayersOfLine(roster, line);
      const all = persons.every(({ id }) => manifest.lines[lineId(id, text)] !== undefined);
      expect(all, `„${text}" has its recordings now: take it off AWAITING_RENDER`).toBe(false);
    }
  });

  it('keeps no recording that no shipped line needs any more, but an old run’s', () => {
    const ids = new Set([
      ...needed.map(({ id }) => id),
      ...keptForOldRuns(manifest).map(([id]) => id),
    ]);
    expect(Object.keys(manifest.lines).filter((id) => !ids.has(id)), REMEDY).toEqual([]);
    const named = new Set(Object.values(manifest.lines).map((entry) => entry.file));
    expect(recordings.filter((name) => !named.has(name)), REMEDY).toEqual([]);
  });

  it('keeps the old chain’s twelve lines, said by no shipped mission, by all three', () => {
    // A room taken up again from a snapshot of Blackout's chain before the Wechselplatz plays
    // that mission on, and its radio says these: a render must not drop their takes.
    const kept = keptForOldRuns(manifest);
    expect(OLD_RUN_LINES).toHaveLength(12);
    for (const text of OLD_RUN_LINES) {
      const sayers = kept.filter(([, entry]) => entry.text === text).map(([id]) => id);
      expect(sayers.sort(), text).toEqual(
        ['ben', 'helmut', 'laura'].map((person) => lineId(person, text)),
      );
      // Once a shipped line says it again it is no old run's alone: off the list with it.
      expect(shippedLines().has(text), text).toBe(false);
    }
    for (const [, entry] of kept) {
      expect(recordings, entry.file).toContain(entry.file);
    }
    // Nothing else is kept: a take of a line off the list goes with the next render.
    const other = { ...kept[0]?.[1], text: 'Irgendeine Zeile.' } as Manifest['lines'][string];
    expect(keptForOldRuns({ lines: { x: other } })).toEqual([]);
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
    const sayers = (line: ShippedLine): number => (line.by === null ? roster[line.role].length : 1);
    const all = lines.reduce((sum, [text, line]) => sum + text.length * sayers(line), 0);
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
    const operators = sayersOf(roster, 'operator').map(({ id }) => id);
    expect(operators).toEqual(['helmut', 'laura', 'ben']);
    for (const start of starts) {
      expect(start).toMatch(/^Leitstelle an Nachtschicht\./);
      // Each operator's own take, by their id and the words.
      for (const person of operators) {
        expect(ids.get(lineKey({ text: start, person }))).toBe(lineId(person, start));
      }
      // A voice that says none of the Leitstelle's lines finds nothing of theirs.
      expect(ids.get(lineKey({ text: start, person: 'anlage' }))).toBeUndefined();
    }
  });

  it('marks the lines that open a run, and only those: the radio opens the channel for them', () => {
    const starts = shippedMissions().flatMap((mission) => textsOf(mission.radio?.start));
    expect(starts.length).toBeGreaterThanOrEqual(4);
    const recorded = starts.filter((text) => !AWAITING_RENDER.includes(text));
    const operators = sayersOf(roster, 'operator');
    expect([...openersOf(manifest)].sort()).toEqual(
      recorded.flatMap((text) => operators.map(({ id }) => lineId(id, text))).sort(),
    );
    for (const [text, { opens }] of shippedLines()) {
      expect(opens, text).toBe(starts.includes(text));
    }
  });
});

describe('the cast the script reads', () => {
  it('is core’s roster, read as a file: the same persons, the same in service, as core', () => {
    expect(roster).toEqual(JSON.parse(JSON.stringify(ROSTER)));
    const ids = (persons: readonly { id: string }[]) => persons.map(({ id }) => id).join(' ');
    for (const cast of [roster, HELMUT_ALONE, LAURA_KEPT]) {
      for (const role of ROLES) {
        expect(ids(inService(cast, role)), role).toBe(ids(coreInService(role, cast)));
        expect(ids(sayersOf(cast, role)), role).toBe(ids(coreSayersOf(role, cast)));
        for (const by of [null, 'helmut', 'mila', 'nobody']) {
          const line = { role, by };
          expect(ids(sayersOfLine(cast, line)), `${role} ${by}`).toBe(
            ids(coreSayersOfLine(line, cast)),
          );
        }
      }
    }
    // The shipped roster: every voice kept, Mila says the Schichtleitung's lines.
    expect(ids(inService(roster, 'operator'))).toBe('helmut laura ben');
    expect([ids(inService(roster, 'lead')), ids(sayersOf(roster, 'lead'))]).toEqual(['mila', 'mila']);
    // Without a Schichtleitung's voice, the desk says its lines.
    const desk = [ids(inService(LAURA_KEPT, 'lead')), ids(sayersOf(LAURA_KEPT, 'lead'))];
    expect(desk).toEqual(['', 'helmut laura']);
    // A line that names its speaker is theirs alone, whatever role they hold, voice or none.
    expect(ids(sayersOfLine(HELMUT_ALONE, { role: 'pa', by: 'mila' }))).toBe('mila');
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
      const core = radioLines(mission).map(({ text, role, by, mood, when }) => ({
        text,
        role,
        by,
        moment: when,
        mood,
        opens: when === 'start',
      }));
      const script = (read ? catalogOf(read) : []).map((line) => ({
        text: line.text,
        role: line.role,
        by: line.by,
        moment: line.moment,
        mood: line.mood,
        opens: line.opens,
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
    const opening = (blackout === undefined ? [] : catalogOf(blackout)).slice(0, 5);
    expect(opening.map(({ moment }) => moment)).toEqual(['pa', 'pa', 'pa', 'pa', 'pa']);
    expect(blackout?.intro?.pa).toHaveLength(5);
    // Over the loudspeakers each line by its speaker: Helmut and Mila by name, the plant by none.
    const speakers = ['helmut', null, 'mila', 'helmut', null];
    for (const [i, { text }] of opening.entries()) {
      expect(shippedLines().get(text), text).toEqual({
        missions: ['blackout'],
        role: 'pa',
        by: speakers[i],
        moment: 'pa',
        mood: null,
        opens: false,
        said: text,
      });
    }
    const nudges = (blackout?.puzzles ?? []).flatMap((p) => p.nudges ?? []);
    expect(nudges).toHaveLength(16);
    // Half of them in a second text that says something of its own, every text a line to record
    // — the nudges of the three stations that take turns at the Wechselplatz among them.
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

  it('names a recording by its person and the first 12 hex of the SHA-1 of its words', () => {
    expect(voiceId('abc')).toBe('a9993e364706');
    expect(voiceId('Beide hin.')).toMatch(/^[0-9a-f]{12}$/);
    expect(lineId('laura', 'abc')).toBe('laura-a9993e364706');
  });
});

describe('a line’s role, as the script reads it', () => {
  it('is the plant’s, the Schichtleitung’s or the Leitstelle’s, by its moment', () => {
    const mission = {
      id: 'probe',
      intro: { pa: ['Durchsage.', { text: 'Hier Mila.', by: 'mila' }, { text: 'Hier Anlage.' }] },
      radio: { start: 'Los.', escape: 'Raus.', clock: { lastMinute: 'Eine.' } },
      puzzles: [{ nudges: ['Hier.'], onSolved: 'Eins.' }, {}],
      map: { sabotage: { announce: 'Störung.' } },
    };
    const said = (text: string, role: string, moment: string, opens = false, by = null) => ({
      text,
      said: text,
      role,
      by,
      moment,
      mood: moment === 'clock' ? 'pressing' : null,
      opens,
    });
    expect(catalogOf(mission)).toEqual([
      said('Durchsage.', 'pa', 'pa'),
      { ...said('Hier Mila.', 'pa', 'pa'), by: 'mila' },
      said('Hier Anlage.', 'pa', 'pa'),
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
      by: null,
      moment: 'start',
      mood: null,
      opens: true,
      said: 'Los.',
    });
    expect(shippedLines([mission]).get('Störung.')?.role).toBe('pa');
    // One line, one recording a person: two roles may not say the same words.
    const twice = { ...mission, map: { sabotage: { announce: 'Los.' } } };
    expect(() => shippedLines([twice])).toThrow(/„Los\." is said by the operator and the pa/);
    // Nor two persons: a line that names its speaker is theirs alone.
    const helmut = { ...mission, intro: { pa: [{ text: 'Hier Mila.', by: 'helmut' }] } };
    expect(() => shippedLines([mission, helmut])).toThrow(
      /„Hier Mila\." is said by the pa by mila and the pa by helmut/,
    );
  });
});

describe('the announcement over Blackout’s loudspeakers, as recorded', () => {
  const blackout = shippedMissions().find((mission) => mission.id === 'blackout');
  const lightsSec = (blackout?.intro as { lightsSec?: number } | undefined)?.lightsSec;
  const lines = (blackout === undefined ? [] : catalogOf(blackout)).filter(
    (line) => line.moment === 'pa',
  );
  const plant = inService(roster, 'pa')[0]?.id ?? '';
  /** Each line's recording by its speaker, null while it awaits its render; NaN for none else. */
  const recorded = lines.map(({ text, by }) => {
    const ms = manifest.lines[lineId(by ?? plant, text)]?.ms;
    if (ms !== undefined) return ms;
    return AWAITING_RENDER.includes(text) ? null : Number.NaN;
  });
  // As the opening plays it: a line awaiting its render at the pace of its words.
  const schedule = paSchedule(lines.map(({ text }, i) => ({ text, ms: recorded[i] ?? null })));
  const ms = schedule.map((line) => line.ms);

  it('is a scene in three voices: Helmut opens it, the plant reads, Mila asks him', () => {
    expect(plant).toBe('anlage');
    expect(lines.map(({ by }) => by ?? plant)).toEqual([
      'helmut',
      'anlage',
      'mila',
      'helmut',
      'anlage',
    ]);
    // Helmut's opening line keeps his take of 2026-10-25, now filed under his name.
    const opening = manifest.lines[lineId('helmut', lines[0]?.text ?? '')];
    expect(opening).toMatchObject({ role: 'pa', person: 'helmut', moment: 'pa', ms: 7471 });
    expect(manifest.lines[lineId(plant, lines[0]?.text ?? '')]).toBeUndefined();
  });

  it('speaks half a minute at most', () => {
    expect(ms.every(Number.isFinite), REMEDY).toBe(true);
    expect(ms.reduce((sum, each) => sum + each, 0)).toBeLessThanOrEqual(30_000);
  });

  it('lets the lights fail by themselves 4 s past its end, cutting its last line off', () => {
    const due = lightsSecFor(ms);
    expect(lightsSec, `missions/blackout.json: intro.lightsSec ${due}`).toBe(due);
    const last = schedule.at(-1);
    const into = due * 1000 - (last?.at ?? 0);
    // Well into the last line, and well before its end.
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

describe('what a run keeps, and what it makes anew', () => {
  const TEXT = 'Reaktor läuft.';
  const said: Said = { text: TEXT, said: TEXT, person: 'helmut', mood: null };
  const line: ShippedLine = {
    missions: ['blackout'],
    role: 'operator',
    by: null,
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
    const laura = voiceOf('lauraVoice0000000000', 'eleven_v3');
    const both = eleven('eleven_v4', HELMUT, 'free', { laura });
    const hers = { ...said, person: 'laura' };
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

  it('makes nothing of a take anew for the cast: each keeps its person’s render and model', () => {
    const paid = plannedVoice(roster);
    const free: Voice = { ...paid, plan: 'free' };
    const entries = Object.values(manifest.lines);
    expect(entries.length).toBeGreaterThan(200);
    // Every take is its person's on Eleven v4: the cast's render on the paid plan, and Helmut's
    // of 2026-10-25 on the free one — his opening line among them, filed under his name.
    const before: string[] = [];
    for (const entry of entries) {
      const said = shippedLines().get(entry.text)?.said ?? entry.text;
      const take = { text: entry.text, said, person: entry.person, mood: entry.mood ?? null };
      const renders = [renderOf(paid, take), renderOf(free, take)];
      expect(renders, `${entry.person} „${entry.text}"`).toContain(entry.render);
      if (entry.render === renders[1]) before.push(entry.person);
      expect(entry.model, entry.text).toBe('eleven_v4');
      expect(modelOf(paid, take)).toBe('eleven_v4');
    }
    expect(before).toHaveLength(48);
    expect(new Set(before)).toEqual(new Set(['helmut']));
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
      'laura',
      upload,
    );
    expect(opening).toEqual({
      text: 'Los.',
      ms: 900,
      missions: ['a', 'b'],
      role: 'operator',
      person: 'laura',
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
    // Helmut's takes of 2026-10-25 name no plan: the free plan keeps them under --fresh, the paid
    // one makes them anew and keeps them without it; the cast's render, the other way round.
    const his = eleven('eleven_v4', HELMUT, 'free');
    const before = Object.values(manifest.lines).filter((entry) => {
      const mood = entry.mood ?? null;
      const take = { text: entry.text, said: entry.text, person: 'helmut', mood };
      return entry.person === 'helmut' && entry.render === renderOf(his, take);
    });
    expect(before).toHaveLength(48);
    const cast = plannedVoice(roster);
    for (const entry of Object.values(manifest.lines)) {
      const said = shippedLines().get(entry.text)?.said ?? entry.text;
      const take = { text: entry.text, said, person: entry.person, mood: entry.mood ?? null };
      const under = (plan: Plan, fresh: Fresh) =>
        keeps(entry, entry.text, true, fresh, renderOf({ ...cast, plan }, take));
      const made = [under('free', 'synthetic'), under('paid', 'synthetic'), under('paid', 'none')];
      const old = before.includes(entry);
      expect(made, entry.text).toEqual([old, !old, true]);
    }
    // Piper and the Mac know no plan.
    expect(renderOf(piper, said)).toBe(render);
  });

  it('asks the account for its plan before anything, and for the voices of the cast', async () => {
    /** An account on `tier` with Helmut and Laura's kept voice, or one that will not say. */
    const account = (tier: string | Error): SpeechClient & SoundClient => ({
      ...NO_CLIENT,
      voices: {
        getAll: () =>
          Promise.resolve({
            voices: [
              { voiceId: HELMUT, name: 'Helmut - German Epic Trailer Voice' },
              { voiceId: 'lauraVoice0000000000', name: 'EscapeLab Laura' },
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
    const paid = await elevenVoiceOf(LAURA_KEPT, account('creator'));
    expect(paid.engine === 'elevenlabs' && paid.plan).toBe('paid');
    const persons = paid.engine === 'elevenlabs' ? paid.persons : {};
    expect(Object.keys(persons)).toEqual(['helmut', 'laura']);
    expect([persons['helmut']?.model, persons['laura']?.model]).toEqual(['eleven_v4', 'eleven_v3']);
    expect(persons['laura']?.held).toEqual(ROLE_HELD.operator);
    expect(paid.engine === 'elevenlabs' && paid.name).toMatch(/helmut eleven_v4, laura.*paid plan/);
    // ELEVENLABS_MODEL names the model every voice reads with.
    const over = await elevenVoiceOf(LAURA_KEPT, account('free'), 'eleven_multilingual_v2');
    const models = over.engine === 'elevenlabs' ? Object.values(over.persons) : [];
    expect(models.map((voice) => voice.model)).toEqual([
      'eleven_multilingual_v2',
      'eleven_multilingual_v2',
    ]);
    // A voice the roster keeps and the account has not: refused, naming the account's voices.
    const lead = [{ ...roster.lead[0]!, voiceId: 'goneVoice00000000' }];
    const gone: Roster = { ...LAURA_KEPT, lead };
    await expect(elevenVoiceOf(gone, account('free'))).rejects.toThrow(/no voice "goneVoice/);
    const silent = elevenVoiceOf(LAURA_KEPT, account(new Error('offline')));
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
  const kept = LAURA_KEPT;
  const laura = voiceOf('lauraVoice0000000000', 'eleven_v3');
  const both = eleven('eleven_v4', HELMUT, 'paid', { laura });

  /** Who says which role's line in `planned`, as „helmut:lead", in order. */
  const sayers = (planned: readonly Planned[]): string =>
    planned.map(({ person, line }) => `${person.id}:${line.role}`).sort().join(' ');

  it('makes each line for each person who says it: the lead’s by the desk without a voice', () => {
    const planned = plan({ lines: {} }, 'none', both, kept, lines);
    // Both operators in service say the start, and the clock's call while the lead has no voice.
    expect(sayers(planned)).toBe('helmut:lead helmut:operator laura:lead laura:operator');
    expect(toMake(both, planned)).toHaveLength(4);
    // A Schichtleitung with a voice says its call alone; ElevenLabs reads it once it has the voice.
    const voice = { voiceId: 'leadVoice000', model: 'eleven_v3' };
    const led: Roster = { ...kept, lead: kept.lead.map((p) => ({ ...p, ...voice })) };
    const withLead = plan({ lines: {} }, 'none', both, led, lines);
    const lead = led.lead[0]?.id ?? '';
    expect(sayers(withLead)).toBe(`helmut:operator laura:operator ${lead}:lead`);
    expect(toMake(both, withLead).map(({ person }) => person.id).sort()).toEqual([
      'helmut',
      'laura',
    ]);
    expect([canRead(both, lead), canRead({ engine: 'say' }, lead)]).toEqual([false, true]);
    // Piper or the Mac read everybody's in their one voice.
    expect(toMake({ engine: 'say' }, withLead)).toHaveLength(3);
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
    const free = eleven('eleven_v4', HELMUT, 'free', { laura });
    expect(toMake(free, plan(done, 'none', free, kept, lines))).toEqual([]);
    expect(toMake(free, plan(done, 'synthetic', free, kept, lines))).toHaveLength(4);
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
    // Helmut on v4 and Laura on v3 read the start as it is written, the clock's call pressing.
    const call = '[insistent] Noch eine Probeminute.';
    expect(charactersOf(both, todo)).toBe(('Probe läuft an.'.length + call.length) * 2);
    const all = toMake({ engine: 'say' }, planned);
    const words = ('Probe läuft an.'.length + 'Noch eine Probeminute.'.length) * 2;
    expect(charactersOf({ engine: 'say' }, all)).toBe(words);
    expect(charactersOf(both, [])).toBe(0);
  });
});

describe('the plan of a run (--plan)', () => {
  /** A start, a nudge in a mood's moment, and a clock call: three lines no mission says. */
  const clock = { lastMinute: 'Probeminute.' };
  const probe: MissionLines = {
    id: 'probe',
    radio: { start: 'Probe läuft an.', alarm: 'Probealarm.', clock },
    puzzles: [],
  };
  const lines = shippedLines([probe]);
  const kept = LAURA_KEPT;

  it('counts for each person the lines made now and their credits, or design and lines', () => {
    const costs = costsOf(kept, { lines: {} }, 'synthetic', undefined, lines);
    const of = (slot: string) => costs.find((cost) => cost.slot === slot);
    // Helmut on v4 and Laura on v3 read the start as written and the alarm with its mood's tag,
    // and the Schichtleitung's call, pressing, as long as it has no voice of its own.
    const theirs = 'Probe läuft an.'.length + '[tense] Probealarm.'.length;
    const call = { lines: 1, characters: '[insistent] Probeminute.'.length };
    const desk = { make: 3, characters: theirs + call.characters, skip: 0, standIn: call };
    expect(of('operator:helmut')).toMatchObject({ model: 'eleven_v4', ...desk });
    expect(of('operator:laura')).toMatchObject({ model: 'eleven_v3', ...desk });
    // Ben has no voice yet: his design, then the Leitstelle's two lines on Eleven v3.
    expect(of('operator:ben')).toEqual({
      slot: 'operator:ben',
      name: 'Ben',
      model: null,
      make: 0,
      characters: 0,
      skip: 0,
      standIn: { lines: 0, characters: 0 },
      design: DESIGN_TEXT.operator.length,
      later: { lines: 2, characters: theirs },
    });
    // The Schichtleitung's call, once its voice is kept, its own.
    expect(of('lead')?.later).toEqual(call);
    const slots = costs.map((cost) => cost.slot).join(' ');
    expect(slots).toBe('pa operator:helmut operator:laura operator:ben lead');
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
    expect(helmut).toMatchObject({ slot: 'operator:helmut', make: 0, characters: 0, skip: 3 });
    // The shipped manifest: 42 of Helmut's takes of shipped lines were made before the paid plan
    // named itself, which --fresh makes anew; his others the cast's render made as it would
    // make them.
    const shipped = costsOf(roster, manifest, 'synthetic')[1];
    const unasked = costsOf(roster, manifest, 'none')[1];
    expect((shipped?.make ?? 0) - (unasked?.make ?? 0)).toBe(42);
    expect((unasked?.skip ?? 0) - (shipped?.skip ?? 0)).toBe(42);
  });

  it('prints each person’s line, the kept cast now, the whole cast with every voice kept', () => {
    const costs = costsOf(kept, { lines: {} }, 'synthetic', undefined, lines);
    const report = planReport(costs, 'synthetic');
    expect(CREDITS_PER_CHARACTER).toBe(1);
    expect(report[0]).toMatch(/plan of `voice --fresh` .*paid plan.*nothing is asked/);
    expect(report).toHaveLength(costs.length + 3);
    // Each operator: the start, the alarm and, standing in, the Schichtleitung's call.
    expect(report[2]).toBe(
      'voice:   operator:helmut  Helmut     eleven_v4  3 lines, 58 credits (1 of them, 24 ' +
        'credits, the Schichtleitung’s until it has a voice); 0 made as they are, kept',
    );
    expect(report[4]).toBe(
      'voice:   operator:ben     Ben        no voice yet — a library voice free, or a design ' +
        '228 credits — then 2 lines, 34 credits',
    );
    expect(report.at(-2)).toBe('voice: now, the kept cast: 6 lines, 116 credits');
    // Every voice kept: three operators' two lines each, the call once, by the Schichtleitung;
    // a design only for whoever no library voice is kept for.
    const designs = DESIGN_TEXT.pa.length + DESIGN_TEXT.operator.length + DESIGN_TEXT.lead.length;
    expect(report.at(-1)).toBe(
      `voice: every voice kept: 7 lines, ${34 * 3 + 24} credits; designs where no library ` +
        `voice is kept: up to 3, ${designs} credits`,
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

describe('the lines that wait for a voice', () => {
  it('name the commands that give one, with --replace where takes of the person are there', () => {
    // The roster before the cast's render, Helmut's voice alone kept, and the recordings before
    // the opening's: Mila's line in the opening, hers by name, waits for her voice; the takes
    // of hers there make it a --replace.
    const voice = eleven('eleven_v4');
    const hers = lineId(
      'mila',
      'Schichtleitung an Leitstelle. Die Netzlast gefällt mir nicht, Helmut. Wer ist heute ' +
        'Nacht im Trakt?',
    );
    const lines = Object.fromEntries(Object.entries(manifest.lines).filter(([id]) => id !== hers));
    expect(Object.keys(lines)).toHaveLength(Object.keys(manifest.lines).length - 1);
    const before = { ...manifest, lines };
    const planned = plan(before, 'none', voice, HELMUT_ALONE);
    const said = waitingFor(voice, planned, HELMUT_ALONE, before);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('voice: Mila (lead) has no voice yet');
    expect(said[0]).toContain('voice --keep lead=<voice id> --replace');
    expect(said[0]).toMatch(/\(1 line wait\)$/);
    // Without takes of theirs there, the keep it names needs nothing more.
    expect(waitingFor(voice, planned, HELMUT_ALONE, { lines: {} })[0]).not.toContain('--replace');
    // The shipped roster keeps every voice: nothing waits for one.
    const cast = plannedVoice(roster);
    expect(waitingFor(cast, plan(manifest, 'none', cast, roster), roster, manifest)).toEqual([]);
  });
});

describe('a plain run, and what --fresh would make beside it', () => {
  it('keeps Helmut’s takes of before, and names what --fresh would make anew, with credits', () => {
    const plain = costsOf(roster, manifest, 'none');
    const fresh = costsOf(roster, manifest, 'synthetic');
    expect(plain.find((cost) => cost.slot === 'operator:helmut')?.skip).toBe(70);
    const beside = freshBeside(plain, fresh);
    expect(beside).toEqual({ lines: 42, characters: 3393 });
    expect(planReport(plain, 'none', beside).at(-1)).toBe(
      'voice: --fresh would make 42 takes anew besides, made before the paid plan named ' +
        'itself: 3,393 credits, which licence them as the rest (docs/sound.md, „Lizenz")',
    );
    // Every voice kept, no design is said; under --fresh, or where it would make nothing more,
    // nothing is said of it.
    const voiced = (persons: readonly Person[]) =>
      persons.map((p) => ({ ...p, voiceId: `${p.id}Voice00000000`, model: 'eleven_v4' }));
    const everyone: Roster = {
      pa: voiced(roster.pa),
      operator: voiced(roster.operator),
      lead: voiced(roster.lead),
    };
    const kept = planReport(costsOf(everyone, manifest, 'none'), 'none');
    expect(kept.at(-1)).toMatch(/^voice: every voice kept: [\d,]+ lines, [\d,]+ credits$/);
    const nothing = freshBeside(fresh, fresh);
    expect(nothing).toEqual({ lines: 0, characters: 0 });
    for (const report of [planReport(fresh, 'synthetic'), planReport(plain, 'none', nothing)]) {
      expect(report.at(-1)).toMatch(/^voice: every voice kept/);
    }
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
        by: null,
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
