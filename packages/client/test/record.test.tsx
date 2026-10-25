import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMission, radioLines, type Mission } from '@escapelab/core';
import { voiceId } from '../scripts/voice.js';
import { busy, openDesk, step, type Desk, type DeskEvent, type Take } from '../src/record/desk.js';
import {
  MAX_UPLOAD_BYTES,
  recordingUrl,
  recordLines,
  sendRecording,
  UPLOAD_ACCEPT,
  uploadProblem,
  uploadType,
  voiceIds,
  type Dropped,
  type Recording,
  type RecordLine,
} from '../src/record/lines.js';
import { opensRecording } from '../src/record/path.js';
import { phaseText, RecordDesk, seconds, type DeskActions } from '../src/record/RecordDesk.js';
import type { VoiceManifest } from '../src/world/radioVoice.js';

const SHIPPED = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(SHIPPED)
  .filter((name) => name.endsWith('.json'))
  .map((name) => parseMission(JSON.parse(readFileSync(new URL(name, SHIPPED), 'utf8'))));
const byId = (id: string): Mission => {
  const mission = missions.find((m) => m.id === id);
  if (mission === undefined) throw new Error(`missions/${id}.json is missing`);
  return mission;
};
const blackout = byId('blackout');
const systemcheck = byId('systemcheck');

/** The ids of every line, as the voice script names its recordings. */
const ids = new Map(
  missions.flatMap((m) => radioLines(m)).map((line) => [line.text, voiceId(line.text)] as const),
);

const START = blackout.radio.start ?? '';
const NUDGE = blackout.puzzles[0]?.nudges[0] ?? '';
const SECOND = blackout.puzzles[0]?.nudges[1] ?? '';
const MANIFEST: VoiceManifest = {
  [voiceId(START)]: {
    text: START,
    ms: 9500,
    missions: ['blackout'],
    opens: true,
    file: `${voiceId(START)}.m4a`,
  },
  [voiceId(NUDGE)]: {
    text: NUDGE,
    ms: 4400,
    missions: ['blackout'],
    source: 'human',
    file: `${voiceId(NUDGE)}.m4a`,
  },
  [voiceId(SECOND)]: {
    text: SECOND,
    ms: 5100,
    missions: ['blackout'],
    source: 'upload',
    file: `${voiceId(SECOND)}.mp3`,
  },
};

describe('the lines the page offers', () => {
  it('are every line of the missions, in their order and each mission’s run order', () => {
    const lines = recordLines([systemcheck, blackout], MANIFEST, ids);
    const texts = [...radioLines(systemcheck), ...radioLines(blackout)].map((line) => line.text);
    expect(lines.map((line) => line.text)).toEqual(texts);
    expect(lines.map((line) => line.id)).toEqual(texts.map(voiceId));
    expect(lines[0]).toMatchObject({ when: 'start', station: null, missions: [systemcheck.title] });
  });

  it('say of each where it comes over the air and what recording it has, in which file', () => {
    const lines = recordLines([blackout], MANIFEST, ids);
    expect(lines[0]).toEqual({
      id: voiceId(START),
      text: START,
      missions: [blackout.title],
      when: 'start',
      station: null,
      recording: { ms: 9500, source: 'synthetic', file: `${voiceId(START)}.m4a` },
    });
    expect(lines[1]).toMatchObject({ text: NUDGE, when: 'nudge', station: 'Notlicht' });
    const human = { ms: 4400, source: 'human', file: `${voiceId(NUDGE)}.m4a` };
    expect(lines[1]?.recording).toEqual(human);
    expect(lines[2]?.recording).toMatchObject({ source: 'upload', file: `${voiceId(SECOND)}.mp3` });
    expect(lines[3]).toMatchObject({ when: 'solved', station: 'Notlicht', recording: null });
    expect(lines.at(-1)).toMatchObject({ when: 'escape', station: null });
  });

  it('list a line two missions say once, under both', () => {
    const copy = { ...blackout, id: 'blackout-copy', title: 'Blackout, noch einmal' };
    const lines = recordLines([blackout, copy], MANIFEST, ids);
    expect(lines).toHaveLength(radioLines(blackout).length);
    expect(lines[0]?.missions).toEqual([blackout.title, 'Blackout, noch einmal']);
  });

  it('are named as the voice script names their recordings, in the browser too', async () => {
    const texts = [START, NUDGE, 'abc'];
    const named = await voiceIds(texts);
    expect([...named.values()]).toEqual(texts.map(voiceId));
    expect(named.get('abc')).toBe('a9993e364706');
  });

  it('play from the file their entry names, past the browser’s copy', () => {
    const mp3: Recording = { ms: 1, source: 'upload', file: 'abc.mp3' };
    expect(recordingUrl(mp3, 42)).toBe('/voice/abc.mp3?t=42');
  });

  it('open at /record, and only there', () => {
    expect(opensRecording('/record')).toBe(true);
    expect(opensRecording('/record/')).toBe(true);
    expect(opensRecording('/')).toBe(false);
    expect(opensRecording('/editor')).toBe(false);
    expect(opensRecording('/recording')).toBe(false);
  });
});

describe('a file put on the page', () => {
  const file = (name: string, size = 4096, type = ''): Dropped => ({ name, type, size });

  it('goes on as mp3, m4a or wav, by its ending, whatever its case', () => {
    for (const name of ['helmut.mp3', 'Zeile 3.M4A', 'take.wav']) {
      expect(uploadProblem(file(name)), name).toBeNull();
    }
    expect(uploadType(file('a.mp3'))).toBe('audio/mpeg');
    expect(uploadType(file('a.M4A'))).toBe('audio/mp4');
    expect(uploadType(file('a.wav'))).toBe('audio/wav');
    expect(UPLOAD_ACCEPT).toBe('.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav');
  });

  it('is turned away as WebM, which afconvert cannot read, or as anything else', () => {
    const webm = 'WebM kann afconvert nicht lesen: Angenommen werden mp3, m4a oder wav.';
    expect(uploadProblem(file('take.webm'))).toBe(webm);
    expect(uploadProblem(file('take', 10, 'audio/webm;codecs=opus'))).toBe(webm);
    const other = '„notes.txt“ ist keine mp3-, m4a- oder wav-Datei.';
    expect(uploadProblem(file('notes.txt'))).toBe(other);
    expect(uploadProblem(file('ohne-endung'))).toMatch(/keine mp3-, m4a- oder wav-Datei/);
  });

  it('is turned away over 8 MB, or empty', () => {
    expect(uploadProblem(file('big.mp3', MAX_UPLOAD_BYTES))).toBeNull();
    const big = file('big.mp3', MAX_UPLOAD_BYTES + 1);
    expect(uploadProblem(big)).toBe('„big.mp3“ ist größer als 8 MB.');
    expect(uploadProblem(file('leer.wav', 0))).toBe('„leer.wav“ ist leer.');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes to the server as a file put there, a take as a person’s, each typed', async () => {
    const sent: { url: string; type: string | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        sent.push({ url, type: headers['content-type'] });
        const kept = url.includes('upload')
          ? { id: 'abc', ms: 5100, source: 'upload', file: 'abc.mp3' }
          : { id: 'abc', ms: 4000, source: 'human', file: 'abc.m4a' };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(kept) });
      }),
    );
    const mp3 = await sendRecording('abc', new Blob(['ID3']), 'audio/mpeg', 'upload');
    expect(mp3).toEqual({ ms: 5100, source: 'upload', file: 'abc.mp3' });
    const take = await sendRecording('abc', new Blob(['RIFF']), 'audio/wav', 'human');
    expect(take).toEqual({ ms: 4000, source: 'human', file: 'abc.m4a' });
    expect(sent).toEqual([
      { url: '/voice/abc?source=upload', type: 'audio/mpeg' },
      { url: '/voice/abc', type: 'audio/wav' },
    ]);
  });

  it('brings back the server’s own words where it refuses', async () => {
    const error = 'Aufnahmen nimmt der Server nur mit ALLOW_RECORD=1 an.';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error }) }),
      ),
    );
    await expect(sendRecording('abc', new Blob(['x']), 'audio/mpeg', 'upload')).rejects.toThrow(
      error,
    );
  });
});

const take = (ms = 4200): Take => ({ wav: new Blob(['wav']), url: 'blob:take', ms });

const lineOf = (id: string, text: string, said: Partial<RecordLine>): RecordLine => ({
  id,
  text,
  missions: ['Blackout im Labor'],
  when: 'solved',
  station: null,
  recording: null,
  ...said,
});

const recordingOf = (ms: number, source: Recording['source'], id: string): Recording => ({
  ms,
  source,
  file: `${id}.${source === 'upload' ? 'mp3' : 'm4a'}`,
});

/** Three lines: one synthetic, one without a recording, one a person spoke. */
const SYNTHETIC = lineOf('aaaaaaaaaaaa', 'Reaktor läuft.', {
  when: 'escape',
  recording: recordingOf(1400, 'synthetic', 'aaaaaaaaaaaa'),
});
const SYSTEMCHECK = { missions: ['Systemcheck'] };
const MISSING = lineOf('bbbbbbbbbbbb', 'Signal steht.', { ...SYSTEMCHECK, station: 'Signalprobe' });
const SPOKEN = lineOf('cccccccccccc', 'Leitstand hat Licht.', {
  ...SYSTEMCHECK,
  recording: recordingOf(2100, 'human', 'cccccccccccc'),
});
const LINES: RecordLine[] = [SYNTHETIC, MISSING, SPOKEN];

const run = (desk: Desk, ...events: DeskEvent[]): Desk => events.reduce(step, desk);
const fresh = (): Desk => ({ lines: LINES, index: 0, phase: { kind: 'idle' }, copy: 'idle' });
const ROLL: DeskEvent[] = [{ kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' }];
const reviewing = (made = take()): Desk => run(fresh(), ...ROLL, { kind: 'took', take: made });

describe('the desk', () => {
  it('opens on the first line no person has replaced', () => {
    expect(openDesk(LINES).index).toBe(0);
    expect(openDesk([SPOKEN, MISSING]).index).toBe(1);
    const uploaded = { ...SYNTHETIC, recording: recordingOf(1400, 'upload', 'aaaaaaaaaaaa') };
    expect(openDesk([SPOKEN, uploaded]).index).toBe(0);
    expect(openDesk([])).toMatchObject({ phase: { kind: 'idle' }, copy: 'idle' });
  });

  it('records, trims, plays back and saves a take, the line taking the server’s recording', () => {
    let desk = run(fresh(), { kind: 'record' });
    expect(desk.phase).toEqual({ kind: 'arming' });
    desk = run(desk, { kind: 'rolling', at: 1000 });
    expect(desk.phase).toEqual({ kind: 'recording', since: 1000 });
    desk = run(desk, { kind: 'stop' });
    expect(desk.phase).toEqual({ kind: 'processing' });
    const made = take();
    desk = run(desk, { kind: 'took', take: made });
    expect(desk.phase).toEqual({ kind: 'review', take: made });
    desk = run(desk, { kind: 'save' });
    expect(desk.phase).toEqual({ kind: 'saving', take: made });
    const kept = recordingOf(4150, 'human', 'aaaaaaaaaaaa');
    desk = run(desk, { kind: 'saved', recording: kept });
    expect(desk.phase).toEqual({ kind: 'saved' });
    expect(desk.lines[0]).toEqual({ ...LINES[0], recording: kept });
    expect(desk.lines.slice(1)).toEqual(LINES.slice(1));
  });

  it('sends a file on, busy until the server keeps it, and drops a take for it', () => {
    const desk = run(reviewing(), { kind: 'upload', name: 'zeile.mp3' });
    expect(desk.phase).toEqual({ kind: 'uploading', name: 'zeile.mp3' });
    expect(busy(desk.phase)).toBe(true);
    expect(step(desk, { kind: 'go', index: 2 })).toBe(desk);
    expect(step(desk, { kind: 'upload', name: 'andere.mp3' })).toBe(desk);
    const kept = recordingOf(5100, 'upload', 'aaaaaaaaaaaa');
    const saved = run(desk, { kind: 'saved', recording: kept });
    expect(saved.phase).toEqual({ kind: 'saved' });
    expect(saved.lines[0]?.recording).toEqual(kept);
    const refused = run(desk, { kind: 'fail', error: 'Keine Audiodatei.' });
    expect(refused.phase).toEqual({ kind: 'failed', take: null, error: 'Keine Audiodatei.' });
  });

  it('takes no file while a take is under way', () => {
    const rolling = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 });
    expect(step(rolling, { kind: 'upload', name: 'zeile.mp3' })).toBe(rolling);
  });

  it('remembers whether the text was copied, or waits in a field, until another line', () => {
    expect(run(fresh(), { kind: 'copied', done: true }).copy).toBe('done');
    const manual = run(fresh(), { kind: 'copied', done: false });
    expect(manual.copy).toBe('manual');
    expect(run(manual, { kind: 'go', index: 1 }).copy).toBe('idle');
  });

  it('changes nothing for an event out of its place', () => {
    const idle = fresh();
    const kept = recordingOf(10, 'human', 'aaaaaaaaaaaa');
    for (const event of [
      { kind: 'stop' },
      { kind: 'rolling', at: 5 },
      { kind: 'took', take: take() },
      { kind: 'save' },
      { kind: 'saved', recording: kept },
    ] as const) {
      expect(step(idle, event), event.kind).toBe(idle);
    }
    const rolling = run(idle, { kind: 'record' }, { kind: 'rolling', at: 0 });
    expect(step(rolling, { kind: 'record' })).toBe(rolling);
    expect(step(rolling, { kind: 'save' })).toBe(rolling);
    const saving = run(reviewing(), { kind: 'save' });
    expect(step(saving, { kind: 'save' })).toBe(saving);
  });

  it('moves only while nothing is under way, stays within the list, drops a take', () => {
    const processing = run(fresh(), ...ROLL);
    expect(busy(processing.phase)).toBe(true);
    expect(step(processing, { kind: 'go', index: 1 })).toBe(processing);
    const held = reviewing();
    const moved = run(held, { kind: 'go', index: 2 });
    expect(moved).toMatchObject({ index: 2, phase: { kind: 'idle' } });
    expect(run(held, { kind: 'go', index: 9 }).index).toBe(2);
    expect(run(held, { kind: 'go', index: -1 }).index).toBe(0);
    const empty: Desk = { lines: [], index: 0, phase: { kind: 'idle' }, copy: 'idle' };
    expect(step(empty, { kind: 'go', index: 1 })).toBe(empty);
  });

  it('keeps a take through a failure, so that it can be saved again', () => {
    const made = take();
    const failed = run(reviewing(made), { kind: 'save' }, { kind: 'fail', error: 'weg' });
    expect(failed.phase).toEqual({ kind: 'failed', take: made, error: 'weg' });
    expect(run(failed, { kind: 'save' }).phase).toEqual({ kind: 'saving', take: made });
    const mute = run(fresh(), { kind: 'record' }, { kind: 'fail', error: 'Kein Mikrofon.' });
    expect(mute.phase).toEqual({ kind: 'failed', take: null, error: 'Kein Mikrofon.' });
    expect(step(mute, { kind: 'save' })).toBe(mute);
    expect(run(mute, { kind: 'record' }).phase).toEqual({ kind: 'arming' });
  });
});

const NOBODY: DeskActions = {
  record: () => undefined,
  stop: () => undefined,
  save: () => undefined,
  go: () => undefined,
  playTake: () => undefined,
  playRecording: () => undefined,
  copy: () => undefined,
  upload: () => undefined,
};

/** The page's buttons as rendered: what each says, and whether it can be pressed. */
function buttons(html: string): { label: string; on: boolean }[] {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => ({
    label: (inner ?? '').replace(/<[^>]+>/g, ''),
    on: !/\sdisabled=""/.test(attrs ?? ''),
  }));
}

const render = (desk: Desk, now = 0): string =>
  renderToStaticMarkup(<RecordDesk desk={desk} now={now} on={NOBODY} />);

/** The desk's own buttons — copy, record, listen, save — and the way back and on, by label. */
const controls = (html: string): Record<string, boolean> =>
  Object.fromEntries(buttons(html).slice(0, 6).map(({ label, on }) => [label, on]));

describe('the page', () => {
  it('shows the line on screen big, where it comes over the air and what it has so far', () => {
    const html = render(fresh());
    expect(html).toContain('FUNKSPRUCH 1 VON 3');
    expect(html).toContain('<blockquote class="record-line">Reaktor läuft.</blockquote>');
    expect(html).toContain('Notausgang');
    expect(html).toContain('Bisher: synthetisch, 1,4 s · Kennung aaaaaaaaaaaa');
    expect(controls(html)).toEqual({
      'Text kopieren': true,
      'Neu aufnehmen': true,
      Anhören: true,
      Speichern: false,
      Zurück: false,
      Weiter: true,
    });
  });

  it('offers „Aufnehmen" for a line without a recording, and nothing to play', () => {
    const html = render({ ...fresh(), index: 1 });
    expect(html).toContain('Gelöst · Signalprobe');
    expect(html).toContain('Bisher keine Aufnahme');
    expect(controls(html)).toMatchObject({ Aufnehmen: true, Anhören: false, Speichern: false });
  });

  it('says the text was copied, or marks it in a field to copy by hand', () => {
    expect(render(run(fresh(), { kind: 'copied', done: true }))).toContain('Text kopiert.');
    const manual = render(run(fresh(), { kind: 'copied', done: false }));
    expect(manual).toContain('Kopieren ging nicht: Der Text ist markiert, ⌘C kopiert ihn.');
    const field = '<textarea readOnly="" autofocus="" rows="3">Reaktor läuft.</textarea>';
    expect(manual).toContain(field);
    expect(render(fresh())).not.toContain('<textarea');
  });

  it('takes a file in a zone that offers mp3, m4a and wav, and none while a take rolls', () => {
    const html = render(fresh());
    expect(html).toContain('Audiodatei ablegen');
    expect(html).toContain(`<input type="file" accept="${UPLOAD_ACCEPT}"/>`);
    expect(html).toContain('WebM kann afconvert nicht lesen');
    const rolling = render(run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }));
    expect(rolling).toContain('class="record-drop record-drop--off"');
    expect(rolling).toContain(`<input type="file" accept="${UPLOAD_ACCEPT}" disabled=""/>`);
  });

  it('lists every line under its mission, numbered, with its recording, one marked', () => {
    const uploaded = { ...SYNTHETIC, recording: recordingOf(1400, 'upload', 'aaaaaaaaaaaa') };
    const html = render({ ...fresh(), lines: [uploaded, MISSING, SPOKEN], index: 2 });
    const list = buttons(html).slice(6);
    expect(list.map((item) => item.label)).toEqual([
      '1DateiReaktor läuft.',
      '2fehltSignal steht.',
      '3MenschLeitstand hat Licht.',
    ]);
    expect(list.every((item) => item.on)).toBe(true);
    const groups = [...html.matchAll(/<h2 class="record-group">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(groups).toEqual(['Blackout im Labor', 'Systemcheck']);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('2 von 3 ersetzt');
  });

  it('while rolling, offers nothing but „Stopp" and counts the seconds', () => {
    const desk = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 1000 });
    const html = render(desk, 3500);
    expect(html).toContain('Aufnahme läuft · 2,5 s');
    expect(controls(html)).toEqual({
      'Text kopieren': true,
      Stopp: true,
      Anhören: false,
      Speichern: false,
      Zurück: false,
      Weiter: false,
    });
    expect(buttons(html).slice(6).some((item) => item.on)).toBe(false);
  });

  it('with a take, offers to hear it, to take it again and to save it', () => {
    const html = render(reviewing(take(4200)));
    expect(html).toContain('Neue Aufnahme · 4,2 s, Stille an beiden Enden geschnitten.');
    expect(controls(html)).toMatchObject({ 'Neu aufnehmen': true, Anhören: true, Speichern: true });
  });

  it('while a file goes or a take is saved, waits; once kept, says who made the recording', () => {
    const going = render(run(fresh(), { kind: 'upload', name: 'zeile.mp3' }));
    expect(going).toContain('„zeile.mp3“ wird übertragen …');
    const saving = run(reviewing(), { kind: 'save' });
    expect(render(saving)).toContain('Wird gespeichert …');
    const waiting = Object.values(controls(render(saving))).slice(1);
    expect(waiting).toEqual([false, false, false, false, false]);
    const kept = recordingOf(4100, 'upload', 'aaaaaaaaaaaa');
    const html = render(run(saving, { kind: 'saved', recording: kept }));
    expect(html).toContain('Gespeichert: Das Spiel spielt ab jetzt diese Aufnahme.');
    expect(html).toContain('Bisher: Datei, 4,1 s');
    expect(html).toContain('2 von 3 ersetzt');
  });

  it('says what went wrong, where a screen reader hears it', () => {
    const failed = run(fresh(), { kind: 'record' }, { kind: 'fail', error: 'Kein Mikrofon.' });
    expect(render(failed)).toContain('role="status">Kein Mikrofon.</p>');
    expect(phaseText({ kind: 'processing' }, 0)).toBe('Stille an den Enden wird geschnitten …');
    expect(phaseText({ kind: 'arming' }, 0)).toBe('Mikrofon wird geöffnet …');
  });

  it('says so where there are no lines, and writes seconds the German way', () => {
    const empty: Desk = { lines: [], index: 0, phase: { kind: 'idle' }, copy: 'idle' };
    expect(render(empty)).toContain('Keine Funksprüche gefunden.');
    expect(seconds(4250)).toBe('4,3 s');
    expect(seconds(-20)).toBe('0,0 s');
  });
});
