import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseMission, radioLines, type Mission } from '@escapelab/core';
import { voiceId } from '../scripts/voice.js';
import { busy, openDesk, step, type Desk, type DeskEvent, type Take } from '../src/record/desk.js';
import { recordLines, voiceIds, type RecordLine } from '../src/record/lines.js';
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
const MANIFEST: VoiceManifest = {
  [voiceId(START)]: { text: START, ms: 9500, missions: ['blackout'], opens: true },
  [voiceId(NUDGE)]: { text: NUDGE, ms: 4400, missions: ['blackout'], source: 'human' },
};

describe('the lines the page offers', () => {
  it('are every line of the missions, in their order and each mission’s run order', () => {
    const lines = recordLines([systemcheck, blackout], MANIFEST, ids);
    const texts = [...radioLines(systemcheck), ...radioLines(blackout)].map((line) => line.text);
    expect(lines.map((line) => line.text)).toEqual(texts);
    expect(lines.map((line) => line.id)).toEqual(texts.map(voiceId));
    expect(lines[0]).toMatchObject({ when: 'start', station: null, missions: [systemcheck.title] });
  });

  it('say of each where it comes over the air and what recording it has', () => {
    const lines = recordLines([blackout], MANIFEST, ids);
    expect(lines[0]).toEqual({
      id: voiceId(START),
      text: START,
      missions: [blackout.title],
      when: 'start',
      station: null,
      ms: 9500,
      human: false,
    });
    expect(lines[1]).toMatchObject({ text: NUDGE, when: 'nudge', station: 'Notlicht' });
    expect(lines[1]).toMatchObject({ ms: 4400, human: true });
    expect(lines[3]).toMatchObject({ when: 'solved', station: 'Notlicht', ms: null, human: false });
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

  it('open at /record, and only there', () => {
    expect(opensRecording('/record')).toBe(true);
    expect(opensRecording('/record/')).toBe(true);
    expect(opensRecording('/')).toBe(false);
    expect(opensRecording('/editor')).toBe(false);
    expect(opensRecording('/recording')).toBe(false);
  });
});

const take = (ms = 4200): Take => ({ wav: new Blob(['wav']), url: 'blob:take', ms });

const lineOf = (id: string, text: string, said: Partial<RecordLine>): RecordLine => ({
  id,
  text,
  missions: ['Blackout im Labor'],
  when: 'solved',
  station: null,
  ms: null,
  human: false,
  ...said,
});

/** Three lines: one synthetic, one without a recording, one a person spoke. */
const SYNTHETIC = lineOf('aaaaaaaaaaaa', 'Reaktor läuft.', { when: 'escape', ms: 1400 });
const SYSTEMCHECK = { missions: ['Systemcheck'] };
const MISSING = lineOf('bbbbbbbbbbbb', 'Signal steht.', { ...SYSTEMCHECK, station: 'Signalprobe' });
const SPOKEN = lineOf('cccccccccccc', 'Leitstand hat Licht.', {
  ...SYSTEMCHECK,
  ms: 2100,
  human: true,
});
const LINES: RecordLine[] = [SYNTHETIC, MISSING, SPOKEN];

const run = (desk: Desk, ...events: DeskEvent[]): Desk => events.reduce(step, desk);
const fresh = (): Desk => ({ lines: LINES, index: 0, phase: { kind: 'idle' } });

describe('the desk', () => {
  it('opens on the first line no person has spoken', () => {
    expect(openDesk(LINES).index).toBe(0);
    expect(openDesk([SPOKEN, MISSING]).index).toBe(1);
    expect(openDesk([SPOKEN, { ...SYNTHETIC, human: true }]).index).toBe(0);
    expect(openDesk([]).phase).toEqual({ kind: 'idle' });
  });

  it('records, trims, plays back and saves a take, and marks the line a person’s', () => {
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
    desk = run(desk, { kind: 'saved', ms: 4150 });
    expect(desk.phase).toEqual({ kind: 'saved' });
    expect(desk.lines[0]).toEqual({ ...LINES[0], ms: 4150, human: true });
    expect(desk.lines.slice(1)).toEqual(LINES.slice(1));
  });

  it('takes a take again, dropping the one before', () => {
    const desk = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' });
    const reviewed = run(desk, { kind: 'took', take: take() });
    expect(run(reviewed, { kind: 'record' }).phase).toEqual({ kind: 'arming' });
  });

  it('changes nothing for an event out of its place', () => {
    const idle = fresh();
    for (const event of [
      { kind: 'stop' },
      { kind: 'rolling', at: 5 },
      { kind: 'took', take: take() },
      { kind: 'save' },
      { kind: 'saved', ms: 10 },
    ] as const) {
      expect(step(idle, event), event.kind).toBe(idle);
    }
    const rolling = run(idle, { kind: 'record' }, { kind: 'rolling', at: 0 });
    expect(step(rolling, { kind: 'record' })).toBe(rolling);
    expect(step(rolling, { kind: 'save' })).toBe(rolling);
    const saving = run(rolling, { kind: 'stop' }, { kind: 'took', take: take() }, { kind: 'save' });
    expect(step(saving, { kind: 'save' })).toBe(saving);
  });

  it('moves only while nothing is under way, stays within the list, drops a take', () => {
    const reviewed = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' });
    expect(busy(reviewed.phase)).toBe(true);
    expect(step(reviewed, { kind: 'go', index: 1 })).toBe(reviewed);
    const held = run(reviewed, { kind: 'took', take: take() });
    const moved = run(held, { kind: 'go', index: 2 });
    expect(moved).toMatchObject({ index: 2, phase: { kind: 'idle' } });
    expect(run(held, { kind: 'go', index: 9 }).index).toBe(2);
    expect(run(held, { kind: 'go', index: -1 }).index).toBe(0);
    const empty: Desk = { lines: [], index: 0, phase: { kind: 'idle' } };
    expect(step(empty, { kind: 'go', index: 1 })).toBe(empty);
  });

  it('keeps a take through a failure, so that it can be saved again', () => {
    const made = take();
    const saving = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' });
    const sent = run(saving, { kind: 'took', take: made }, { kind: 'save' });
    const failed = run(sent, { kind: 'fail', error: 'weg' });
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

/** The desk's own three buttons and the way back and on, by label. */
const controls = (html: string): Record<string, boolean> =>
  Object.fromEntries(buttons(html).slice(0, 5).map(({ label, on }) => [label, on]));

describe('the page', () => {
  it('shows the line on screen big, where it comes over the air and what it has so far', () => {
    const html = render(fresh());
    expect(html).toContain('FUNKSPRUCH 1 VON 3');
    expect(html).toContain('<blockquote class="record-line">Reaktor läuft.</blockquote>');
    expect(html).toContain('Notausgang');
    expect(html).toContain('Bisher: synthetisch, 1,4 s · Kennung aaaaaaaaaaaa');
    expect(controls(html)).toEqual({
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
    expect(controls(html)).toEqual({
      Aufnehmen: true,
      Anhören: false,
      Speichern: false,
      Zurück: true,
      Weiter: true,
    });
  });

  it('lists every line under its mission, with its recording, the one on screen marked', () => {
    const html = render({ ...fresh(), index: 2 });
    const list = buttons(html).slice(5);
    expect(list.map((item) => item.label)).toEqual([
      'synthetischReaktor läuft.',
      'fehltSignal steht.',
      'MenschLeitstand hat Licht.',
    ]);
    expect(list.every((item) => item.on)).toBe(true);
    const groups = [...html.matchAll(/<h2 class="record-group">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(groups).toEqual(['Blackout im Labor', 'Systemcheck']);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('1 von 3 von Menschen gesprochen');
  });

  it('while rolling, offers nothing but „Stopp" and counts the seconds', () => {
    const desk = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 1000 });
    const html = render(desk, 3500);
    expect(html).toContain('Aufnahme läuft · 2,5 s');
    expect(controls(html)).toEqual({
      Stopp: true,
      Anhören: false,
      Speichern: false,
      Zurück: false,
      Weiter: false,
    });
    expect(buttons(html).slice(5).some((item) => item.on)).toBe(false);
  });

  it('with a take, offers to hear it, to take it again and to save it', () => {
    const desk = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' });
    const html = render(run(desk, { kind: 'took', take: take(4200) }));
    expect(html).toContain('Neue Aufnahme · 4,2 s, Stille an beiden Enden geschnitten.');
    expect(controls(html)).toEqual({
      'Neu aufnehmen': true,
      Anhören: true,
      Speichern: true,
      Zurück: false,
      Weiter: true,
    });
  });

  it('while saving, waits; once saved, names the person and counts the line', () => {
    const desk = run(fresh(), { kind: 'record' }, { kind: 'rolling', at: 0 }, { kind: 'stop' });
    const saving = run(desk, { kind: 'took', take: take() }, { kind: 'save' });
    expect(render(saving)).toContain('Wird gespeichert …');
    expect(Object.values(controls(render(saving)))).toEqual([false, false, false, false, false]);
    const html = render(run(saving, { kind: 'saved', ms: 4100 }));
    expect(html).toContain('Gespeichert: Das Spiel spielt ab jetzt diese Aufnahme.');
    expect(html).toContain('Bisher: Mensch, 4,1 s');
    expect(html).toContain('2 von 3 von Menschen gesprochen');
  });

  it('says what went wrong, where a screen reader hears it', () => {
    const failed = run(fresh(), { kind: 'record' }, { kind: 'fail', error: 'Kein Mikrofon.' });
    expect(render(failed)).toContain('role="status">Kein Mikrofon.</p>');
    expect(phaseText({ kind: 'processing' }, 0)).toBe('Stille an den Enden wird geschnitten …');
    expect(phaseText({ kind: 'arming' }, 0)).toBe('Mikrofon wird geöffnet …');
  });

  it('says so where there are no lines, and writes seconds the German way', () => {
    expect(render({ lines: [], index: 0, phase: { kind: 'idle' } })).toContain(
      'Keine Funksprüche gefunden.',
    );
    expect(seconds(4250)).toBe('4,3 s');
    expect(seconds(-20)).toBe('0,0 s');
  });
});
