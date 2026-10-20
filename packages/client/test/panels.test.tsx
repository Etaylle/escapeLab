import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  generateEdgework,
  moduleFor,
  puzzleDefSchema,
  tokenLabel,
  type ConsoleId,
  type PuzzleView,
} from '@escapelab/core';
import { needleAngle, SCALE_MAX } from '../src/puzzles/CircuitPanel.js';
import { deviceCoach, firstSight } from '../src/puzzles/coach.js';
import { partnerLed } from '../src/puzzles/Device.js';
import { PANELS } from '../src/puzzles/index.js';
import {
  FLEETING_PAUSE_MS,
  FLEETING_SIGN_MS,
  fleetingAt,
} from '../src/puzzles/SignalPanel.js';
import { PuzzlePanel, ReaderPanel } from '../src/screens/PuzzlePanel.js';

/** A small deterministic generator, enough to set an instance up. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/**
 * The open puzzle of `type` as player `who` sees it, at its station — at
 * console `seat` where it has two — or away from it; with `who` null, as the
 * audience sees it.
 */
function seen(
  type: string,
  operating = true,
  fields: Record<string, unknown> = {},
  seat: ConsoleId | null = operating ? 'a' : null,
  who: string | null = 'p1',
): PuzzleView {
  const def = puzzleDefSchema.parse({ type, id: type, title: 'Station', ...fields });
  const station = moduleFor(def.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const setup = {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at: 0,
    crew,
    console: null,
    atConsoles: { a: [], b: [] },
    readers: [],
  };
  const state = station.init(def, rng, setup);
  const viewer = { playerId: who, operating, reading: false, console: seat };
  const view = station.view(def, state, viewer, { edgework, alarms: 0, crew });
  const common = { index: 0, total: 1, title: def.title, manual: null, console: seat };
  return { ...view, ...common, backup: null };
}

function panel(puzzle: PuzzleView): string {
  return renderToStaticMarkup(
    <PuzzlePanel puzzle={puzzle} send={() => undefined} deadlineAt={null} />,
  );
}

/** Every station module: the relay emergency has no station. */
const STATIONS = Object.keys(PANELS).filter((type) => type !== 'relay');

/** The words a panel shows: its markup taken out, its entities read. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every instruction the panels used to carry; a device says none of them. */
const COACHING = [
  'Erst bei Ansage trennen',
  'Antippen trennt sofort',
  'Erst bei Ansage drücken',
  'die Zeile zur Farbe nennt die Legende',
  'Ansage von links, bis alle Lampen brennen',
  'Jeden Schalter ansagen',
  'Bei Ansage umlegen',
  'gefahrlos, erst PRÜFEN zählt',
  'Farben von oben ansagen',
  'Zeichen beschreiben, erst bei Ansage drücken',
  'Jede Blinkfarbe ansagen',
  'Feld ansagen, erst bei Ansage gehen',
  'Display und Tasten von links ansagen',
  'Nach jedem Druck notieren',
  'Zeichen ansagen: „kurz", „lang", Pause',
  'Erst bei Ansage senden',
  'Streifen ansagen',
  'Farbe und Aufschrift ansagen',
  'nochmal, diesmal gleichzeitig',
  'WARTE AUFS TEAM',
  'Allein — jemand muss zu den Regeln oder ans andere Pult',
];

/**
 * What the operator sees at every station: each console where there are
 * two, and the variants the defs and the play bring — the legend and the
 * fleeting strip, the star, a held button, a missed window.
 */
function operatorViews(): [string, PuzzleView][] {
  const views: [string, PuzzleView][] = STATIONS.map((type) => [type, seen(type)]);
  for (const type of ['circuit', 'signal']) {
    views.push([`${type} at Pult B`, seen(type, true, {}, 'b')]);
  }
  views.push(
    ['signal with the legend', seen('signal', true, { legend: true }, 'b')],
    ['signal fleeting', seen('signal', true, { fleetingFrom: 1 })],
    ['switches with stars', seen('switches', true, { features: 3 })],
  );
  const button = seen('button');
  if (button.kind === 'button') {
    views.push(['button held', { ...button, holding: true }]);
  }
  const sync = seen('button-sync');
  if (sync.kind === 'button-sync') {
    views.push(['button-sync missed', { ...sync, lastResult: 'missed-window', attempts: 2 }]);
    views.push(['button-sync pressed', { ...sync, youPressed: true }]);
  }
  return views;
}

describe('station panels', () => {
  it.each(STATIONS)('%s speaks to the operator, not to someone who cannot see it', (type) => {
    // Only the operator gets a panel now; a view without the machine says nothing to anyone.
    for (const html of [panel(seen(type)), panel(seen(type, false))]) {
      expect(html).not.toMatch(/lass (dir|sie dir)|frag |anderen Station|siehst du nicht/i);
      expect(html).not.toMatch(/sieht nur|dein Team|hör mit|aus der Crew/i);
    }
  });

  it.each(operatorViews())('%s carries no instruction: not one coaching line', (_, view) => {
    const text = textOf(panel(view));
    for (const line of COACHING) {
      expect(text).not.toContain(line);
    }
    expect(text).not.toMatch(/ansag|erst bei/i);
  });
});

describe('the device frame', () => {
  it.each(STATIONS)('%s sits in a device: bezel, four screws, plate and face', (type) => {
    const html = panel(seen(type));
    expect(html.startsWith(`<div class="device device--${type}">`)).toBe(true);
    expect(html.match(/<span class="device-screw device-screw--(tl|tr|bl|br)"/g)).toHaveLength(4);
    expect(html).toContain(
      '<div class="device-plate"><span class="device-plate-paragraph">§1</span>' +
        '<span class="device-plate-title">Station</span>',
    );
    expect(html).toContain('<div class="device-face">');
  });

  it('wraps the module’s own panel in its face, the way a console nobody stands at says so', () => {
    expect(panel(seen('circuit', false))).toContain(
      '<div class="device-face"><p class="muted">Dieses Pult ist nicht angeschlossen.</p></div>',
    );
  });

  it('tags the plate with the console where the station has two, and only there', () => {
    expect(panel(seen('circuit'))).toContain('<span class="device-plate-tag">PULT A</span>');
    expect(panel(seen('signal', true, {}, 'b'))).toContain(
      '<span class="device-plate-tag">PULT B</span>',
    );
    // The view names console a at a station with one as well; the plate leaves it out.
    expect(seen('wiring').console).toBe('a');
    expect(panel(seen('wiring'))).not.toContain('device-plate-tag');
    // The audience stands at no console.
    expect(panel(seen('circuit', true, {}, null, null))).not.toContain('device-plate-tag');
  });
});

describe('the partner LED', () => {
  it('burns green with who backs this player up, and where', () => {
    const backed = { ...seen('maze'), backup: { name: 'Ben', where: 'SPIND' } };
    expect(partnerLed(backed)).toEqual({ tone: 'green', label: 'PARTNER', detail: 'Ben · SPIND' });
    expect(panel(backed)).toContain(
      '<li class="device-led device-led--green">' +
        '<span class="device-lamp device-lamp--green" aria-hidden="true"></span>' +
        '<span class="device-led-label">PARTNER</span>' +
        '<span class="device-led-detail">Ben · SPIND</span></li>',
    );
    const atA = { ...seen('circuit'), backup: { name: 'Ben', where: 'Pult B' } };
    expect(partnerLed(atA)?.detail).toBe('Ben · Pult B');
  });

  it('burns red with where somebody has to stand while nobody does', () => {
    expect(partnerLed(seen('maze'))).toEqual({
      tone: 'red',
      label: 'KEIN PARTNER',
      detail: 'jemand zu den Regeln',
    });
    expect(partnerLed(seen('circuit'))?.detail).toBe('jemand an Pult B oder zu den Regeln');
    expect(partnerLed(seen('signal', true, {}, 'b'))?.detail).toBe(
      'jemand an Pult A oder zu den Regeln',
    );
    expect(panel(seen('maze'))).toContain('<li class="device-led device-led--red">');
  });

  it('is not there where the whole crew presses, nor for the audience', () => {
    expect(partnerLed(seen('button-sync'))).toBeNull();
    expect(panel(seen('button-sync'))).not.toContain('device-led');
    expect(partnerLed(seen('circuit', true, {}, null, null))).toBeNull();
  });
});

describe('coach marks', () => {
  /** Every device a station can show: each module, and both consoles where there are two. */
  const devices = (): PuzzleView[] => [
    ...STATIONS.map((type) => seen(type)),
    seen('circuit', true, {}, 'b'),
    seen('signal', true, {}, 'b'),
  ];

  it('give every device one line of its own', () => {
    const marks = devices().map(deviceCoach);
    for (const mark of marks) {
      expect(mark?.text).toMatch(/^[^\n]{12,64}\.$/);
    }
    expect(new Set(marks.map((mark) => mark?.id)).size).toBe(marks.length);
    expect(new Set(marks.map((mark) => mark?.text)).size).toBe(marks.length);
    expect(deviceCoach(seen('circuit'))?.text).toBe('Antippen trennt das Kabel sofort.');
    expect(deviceCoach(seen('circuit', true, {}, 'b'))?.text).toBe('Nummer wählen, Wert ablesen.');
    expect(deviceCoach(seen('signal', true, {}, 'b'))?.text).toBe(
      'Tasten in der angesagten Folge drücken.',
    );
  });

  it('fire once per device type in a session, and never again after', () => {
    const shown = new Set<string>();
    /** Opens a station's panel: the line it gets, if any. */
    const open = (view: PuzzleView): string | null => {
      const mark = firstSight(deviceCoach(view), shown);
      if (mark !== null) {
        shown.add(mark.id);
      }
      return mark?.text ?? null;
    };
    const box = seen('circuit');
    expect(open(box)).toBe('Antippen trennt das Kabel sofort.');
    expect(open(box)).toBeNull();
    // Another station of the same type, later in the run, is no news either.
    expect(open({ ...box, index: 3, title: 'Zweiter Kasten' })).toBeNull();
    // The other console is a device of its own.
    expect(open(seen('circuit', true, {}, 'b'))).toBe('Nummer wählen, Wert ablesen.');
    expect(open(seen('wiring'))).toBe('Ein Tipp auf ein Kabel trennt es sofort.');
    expect(open(seen('wiring'))).toBeNull();
    expect([...shown]).toEqual(['device:circuit-box', 'device:circuit-meter', 'device:wiring']);
  });

  it('have nothing to say to the audience', () => {
    expect(deviceCoach(seen('circuit', true, {}, null, null))).toBeNull();
    expect(deviceCoach(seen('signal', true, {}, null, null))).toBeNull();
    expect(firstSight(null, new Set())).toBeNull();
  });
});

describe('the switch bank', () => {
  it('shows LED and Markierung only on a bank of two features', () => {
    const html = panel(seen('switches', true, { features: 2 }));
    expect(html.match(/class="switches-item/g)).toHaveLength(6);
    expect(html.match(/<span>LED (an|aus)<\/span>/g)).toHaveLength(6);
    expect(html).not.toContain('switches-star');
    expect(html).not.toContain('Stern');
  });

  it('keeps the star’s row and word on a bank of three', () => {
    const html = panel(seen('switches', true, { features: 3 }));
    expect(html.match(/class="switches-star"/g)).toHaveLength(6);
    expect(html.match(/<span>(kein )?Stern<\/span>/g)).toHaveLength(6);
  });
});

describe('the maze', () => {
  type Label = { at: number; name: string };

  /** The grid's labels as drawn: column letters by x, row numbers by y. */
  function labelsOf(html: string): { columns: Label[]; rows: Label[] } {
    const column = /<text x="([\d.]+)" y="[\d.]+" text-anchor="middle">([A-H])<\/text>/g;
    const row = /<text x="[\d.]+" y="([\d.]+)" text-anchor="end">(\d)<\/text>/g;
    const read = (m: RegExpMatchArray): Label => ({ at: Number(m[1]), name: m[2] ?? '' });
    return {
      columns: [...html.matchAll(column)].map(read),
      rows: [...html.matchAll(row)].map(read),
    };
  }

  const inOrder = (labels: Label[]): string =>
    [...labels].sort((p, q) => p.at - q.at).map((label) => label.name).join('');

  /** The name of the label lying closest to `at`. */
  function nearest(labels: Label[], at: number): string {
    const away = (label: Label): number => Math.abs(label.at - at);
    return labels.reduce((best, label) => (away(label) < away(best) ? label : best)).name;
  }

  it('letters columns from the left and numbers rows from the top, as its rules say', () => {
    const view = seen('maze');
    if (view.kind !== 'maze' || view.pos === null) {
      throw new Error('expected the navigation console');
    }
    const html = panel(view);
    const { columns, rows } = labelsOf(html);
    expect(inOrder(columns)).toBe('ABCDEF');
    expect(inOrder(rows)).toBe('123456');
    // The marker stands in the column and the row the display names it by, the goal beside it.
    const here = `${'ABCDEF'.charAt(view.pos.x)}${view.pos.y + 1}`;
    const goal = `${'ABCDEF'.charAt(view.goal.x)}${view.goal.y + 1}`;
    expect(html).toContain(
      `<p class="maze-readout"><span class="device-engraving">POSITION</span>` +
        `<span class="maze-lcd">${here}</span><span class="device-engraving">ZIEL</span>` +
        `<span class="maze-lcd">${goal}</span></p>`,
    );
    const marker = /<circle class="maze-marker[^"]*" cx="([\d.]+)" cy="([\d.]+)"/.exec(html);
    const [cx, cy] = [Number(marker?.[1]), Number(marker?.[2])];
    expect(`${nearest(columns, cx)}${nearest(rows, cy)}`).toBe(here);
    // The plan at a manual object counts the same way.
    const plan = labelsOf(
      renderToStaticMarkup(
        <ReaderPanel puzzle={{ ...view, pos: null, cells: new Array<number>(36).fill(15) }} />,
      ),
    );
    expect(inOrder(plan.columns)).toBe('ABCDEF');
    expect(inOrder(plan.rows)).toBe('123456');
  });
});

describe('the signal chain', () => {
  type SignalSeen = Extract<PuzzleView, { kind: 'signal' }>;

  /**
   * Stage 1 of a Signalkette with the def's `fields` — console a sends it —
   * at console `seat`, or as the audience sees it with `seat` null.
   */
  function signalAt(seat: ConsoleId | null, fields: Record<string, unknown> = {}): SignalSeen {
    const view = seen('signal', true, fields, seat, seat === null ? null : 'p1');
    if (view.kind !== 'signal') {
      throw new Error(`expected the signal chain, got ${view.kind}`);
    }
    return view;
  }

  /** Stage 1 at console `seat` — console a sends it — with what `change` says happened since. */
  const at = (seat: ConsoleId, change: Partial<SignalSeen> = {}): SignalSeen => ({
    ...signalAt(seat),
    ...change,
  });

  /** What the panel prints under each sign, in the order it shows them. */
  const words = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-word">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');

  const lit = (html: string): number => html.match(/signal-lamp--lit/g)?.length ?? 0;

  /** What the stage LEDs say, by their name. */
  const stageOf = (html: string): string | undefined =>
    /<div class="signal-stages" role="img" aria-label="([^"]*)">/.exec(html)?.[1];

  /** The stage LEDs as they burn, left to right. */
  const stageLamps = (html: string): string[] => {
    const row = /<span class="signal-stage-lamps">(.*?)<\/span><span class="device-engraving">STUFE/;
    const lamps = row.exec(html)?.[1] ?? '';
    return [...lamps.matchAll(/device-lamp--([a-z]+)/g)].map((m) => m[1] ?? '');
  };

  /** The backlit legends that burn. */
  const litLegends = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-legend signal-legend--lit">([^<]*)<\/span>/g)].map(
      (m) => m[1] ?? '',
    );

  /** The keys of shapes as drawn — buttons, or the audience's spans — by row and form. */
  function rowKeys(html: string, tag: 'button' | 'span') {
    const key = new RegExp(
      `<${tag} class="signal-key signal-key--shape" data-row="(\\d)" data-shape="([a-z]+)"`,
      'g',
    );
    return [...html.matchAll(key)].map((m) => ({ row: Number(m[1]), shape: m[2] }));
  }

  const rowNumbers = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-row-number">(\d)<\/span>/g)].map((m) => m[1] ?? '');

  /** The names under the keys of shapes, row by row. */
  const FORMS_BY_ROW = Array.from({ length: 4 }, () => ['Kreis', 'Dreieck', 'Quadrat']).flat();

  /** A colour anywhere: drawn, or named. */
  const COLOURED = /fill="#|\b(rot|blau|grün|gruen|gelb)/i;

  it('shows the sending console the sequence in words, a lamp under each sign, no key', () => {
    const sending = at('a');
    const sequence = sending.sequence ?? [];
    expect(sequence).toHaveLength(4);
    const html = panel(sending);
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['SENDEN']);
    expect(words(html)).toEqual(sequence.map(tokenLabel));
    expect(html.match(/class="signal-lamp/g)).toHaveLength(4);
    expect(lit(html)).toBe(0);
    expect(html).not.toContain('<button');
    // Side by side, every sign at once: nothing fleeting about it.
    expect(html).not.toMatch(/fleeting|signal-sign--shown|signal-glyph--dark/);
  });

  it('shows a fleeting stage one sign at a time in its own place, every lamp kept', () => {
    const sending = { ...signalAt('a', { fleetingFrom: 1 }), done: 1 };
    expect(sending.fleeting).toBe(true);
    const [first, ...rest] = sending.sequence ?? [];
    expect(rest).toHaveLength(3);
    const html = panel(sending);
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['SENDEN']);
    expect(html).toContain('<ol class="signal-strip signal-strip--fleeting"');
    // As the strip appears, its first sign shows; the other places are dark.
    const places = [...html.matchAll(/<li class="(signal-sign[^"]*)">/g)].map((m) => m[1]);
    expect(places).toEqual([
      'signal-sign signal-sign--shown',
      'signal-sign',
      'signal-sign',
      'signal-sign',
    ]);
    expect(words(html)).toEqual([tokenLabel(first ?? 'rot-kreis')]);
    expect(html.match(/signal-glyph--dark/g)).toHaveLength(3);
    expect(html.match(/class="signal-lamp/g)).toHaveLength(4);
    expect(lit(html)).toBe(1);
    expect(html).not.toContain('<button');
  });

  it('keeps the strip side by side in the stages before the fleeting one', () => {
    const sending = signalAt('a', { fleetingFrom: 2 });
    expect(sending.fleeting).toBe(false);
    const html = panel(sending);
    expect(words(html)).toEqual((sending.sequence ?? []).map(tokenLabel));
    expect(html).not.toContain('signal-strip--fleeting');
  });

  it('gives the receiving console its twelve signs as keys, and no sequence', () => {
    const receiving = at('b');
    const html = panel(receiving);
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['EINGABE']);
    const key = /<button class="signal-key" data-token="([a-z]+-[a-z]+)">/g;
    expect([...html.matchAll(key)].map((m) => m[1])).toEqual(receiving.grid);
    expect(words(html)).toEqual((receiving.grid ?? []).map(tokenLabel));
    expect(html).not.toContain('signal-strip');
    expect(html).not.toMatch(/signal-key--shape|signal-row-number|Legende/);
  });

  it('gives the receiving console with the legend 12 grey keys in numbered rows, no colour', () => {
    const receiving = signalAt('b', { legend: true });
    const html = panel(receiving);
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['EINGABE']);
    expect(rowKeys(html, 'button')).toEqual(receiving.keys);
    expect(rowKeys(html, 'button')).toHaveLength(12);
    expect(rowNumbers(html)).toEqual(['1', '2', '3', '4']);
    expect(words(html)).toEqual(FORMS_BY_ROW);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(12);
    expect(html).not.toMatch(COLOURED);
    expect(html).not.toContain('data-token');
    expect(html).not.toContain('signal-strip');
    expect(html.match(/class="signal-lamp( signal-lamp--lit)?"/g)).toHaveLength(4);
  });

  it('lights a stage LED for every stage done and the one under way, at both consoles', () => {
    expect(stageLamps(panel(at('a')))).toEqual(['amber', 'off', 'off', 'off']);
    const third = { stage: 3, role: 'receiver' as const, sends: 'a' as const };
    const html = panel(at('b', third));
    expect(stageOf(html)).toBe('Stufe 3 von 4');
    expect(stageLamps(html)).toEqual(['green', 'green', 'amber', 'off']);
  });

  /**
   * Every element `node` renders to, its function components called through:
   * enough to reach a panel's keys and press them without a DOM. Only for
   * parts that use no hooks, as the receiving console's do.
   */
  function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
      return node.flatMap((child: ReactNode) => elementsOf(child));
    }
    if (!isValidElement<Record<string, unknown>>(node)) {
      return [];
    }
    if (typeof node.type === 'function') {
      return elementsOf((node.type as (props: unknown) => ReactNode)(node.props));
    }
    return [node, ...elementsOf(node.props['children'] as ReactNode)];
  }

  /** What the receiving console sends for each of its keys, pressed in turn. */
  function pressEvery(puzzle: SignalSeen): unknown[] {
    const sent: unknown[] = [];
    const Panel = PANELS.signal;
    const tree = <Panel puzzle={puzzle} send={(input) => sent.push(input)} deadlineAt={null} />;
    const keys = elementsOf(tree).filter((element) => element.type === 'button');
    expect(keys).toHaveLength(12);
    for (const key of keys) {
      (key.props['onClick'] as () => void)();
    }
    return sent;
  }

  it('sends a sign’s key as the sign, and a key of shapes as its row and its form', () => {
    const plain = at('b');
    expect(pressEvery(plain)).toEqual((plain.grid ?? []).map((token) => ({ press: token })));
    const legend = signalAt('b', { legend: true });
    expect(pressEvery(legend)).toEqual(
      (legend.keys ?? []).map(({ row, shape }) => ({ key: { row, shape } })),
    );
  });

  it('lights a lamp for every sign pressed, at both consoles', () => {
    expect(lit(panel(at('a', { done: 2 })))).toBe(2);
    expect(lit(panel(at('b', { done: 3 })))).toBe(3);
  });

  it('says a wrong sign starts the stage again, and shakes the keys', () => {
    const message = '⚠ Falsches Zeichen — Stufe von vorn.';
    const wrong = panel(at('b', { lastResult: 'wrong' }));
    expect(wrong).toContain(`<p class="warn" role="status">${message}</p>`);
    expect(wrong).toContain('class="signal-grid signal-grid--wrong"');
    expect(panel(at('a', { lastResult: 'wrong' }))).toContain(message);
    const right = panel(at('b'));
    expect(right).not.toContain('Falsches Zeichen');
    expect(right).not.toContain('signal-grid--wrong');
    const rows = panel({ ...signalAt('b', { legend: true }), lastResult: 'wrong' });
    expect(rows).toContain(`<p class="warn" role="status">${message}</p>`);
    expect(rows).toContain('class="signal-grid signal-grid--rows signal-grid--wrong"');
  });

  it('tells a console nobody stands at that it is not connected', () => {
    expect(panel(seen('signal', false))).toContain('Dieses Pult ist nicht angeschlossen.');
  });

  it('shows the audience the strip and both consoles’ keys by name, none to press', () => {
    const watched = seen('signal', true, {}, null, null);
    if (watched.kind !== 'signal' || watched.sequence === null || watched.grids === null) {
      throw new Error('expected the audience to see the sequence and both consoles');
    }
    const { sequence, grids } = watched;
    const html = panel({ ...watched, done: 1 });
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['PULT A']);
    const names = [...html.matchAll(/<h4 class="signal-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A', 'Pult B']);
    const key = /<span class="signal-key" data-token="([a-z]+-[a-z]+)">/g;
    expect([...html.matchAll(key)].map((m) => m[1])).toEqual([...grids.a, ...grids.b]);
    expect(words(html)).toEqual([...sequence, ...grids.a, ...grids.b].map(tokenLabel));
    expect(lit(html)).toBe(1);
    expect(html).not.toContain('<button');
  });

  it('shows the audience with the legend the strip and the rows both consoles share', () => {
    const watched = signalAt(null, { legend: true, fleetingFrom: 1 });
    const sequence = watched.sequence ?? [];
    expect(sequence).toHaveLength(4);
    const html = panel(watched);
    expect(stageOf(html)).toBe('Stufe 1 von 4');
    expect(litLegends(html)).toEqual(['PULT A']);
    // The audience follows the whole sequence, fleeting or not.
    expect(html).toContain('<ol class="signal-strip"');
    const names = [...html.matchAll(/<h4 class="signal-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A und Pult B']);
    expect(rowKeys(html, 'span')).toEqual(watched.keys);
    expect(rowNumbers(html)).toEqual(['1', '2', '3', '4']);
    expect(words(html)).toEqual([...sequence.map(tokenLabel), ...FORMS_BY_ROW]);
    expect(html).not.toContain('<button');
  });
});

describe('a fleeting strip', () => {
  it('shows each sign for 1.2 s in turn, then stays dark for 2 s and starts over', () => {
    expect([FLEETING_SIGN_MS, FLEETING_PAUSE_MS]).toEqual([1200, 2000]);
    const shownAt = (ms: number) => fleetingAt(ms, 4).shown;
    expect([0, 1199, 1200, 2399, 2400, 3600, 4799].map(shownAt)).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect([4800, 6799].map(shownAt)).toEqual([null, null]);
    expect([6800, 8000, 3 * 6800 + 4799, 3 * 6800 + 4800].map(shownAt)).toEqual([0, 1, 3, null]);
  });

  it('counts a time before its start as the start', () => {
    expect(fleetingAt(-500, 4)).toEqual(fleetingAt(0, 4));
  });

  it('says how long until it changes, so that one timer per change keeps it going', () => {
    expect(fleetingAt(0, 3)).toEqual({ shown: 0, untilNext: 1200 });
    expect(fleetingAt(1000, 3)).toEqual({ shown: 0, untilNext: 200 });
    expect(fleetingAt(3600, 3)).toEqual({ shown: null, untilNext: 2000 });
    expect(fleetingAt(5000, 3)).toEqual({ shown: null, untilNext: 600 });
    // From change to change: every sign, the pause, and round again.
    let ms = 0;
    const steps: (number | null)[] = [];
    for (let step = 0; step < 8; step++) {
      const { shown, untilNext } = fleetingAt(ms, 3);
      steps.push(shown);
      ms += untilNext;
    }
    expect(steps).toEqual([0, 1, 2, null, 0, 1, 2, null]);
    expect(ms).toBe(2 * (3 * 1200 + 2000));
  });

  it.each([3, 4, 5, 6])('gives each of %i signs the same time over a cycle', (count) => {
    const time = new Map<number | null, number>();
    for (let ms = 0; ms < count * 1200 + 2000; ms += 100) {
      const { shown } = fleetingAt(ms, count);
      time.set(shown, (time.get(shown) ?? 0) + 100);
    }
    expect([...time]).toEqual([
      ...Array.from({ length: count }, (_, i): [number, number] => [i, 1200]),
      [null, 2000],
    ]);
  });
});

describe('the fuse box and the meter', () => {
  type CircuitSeen = Extract<PuzzleView, { kind: 'circuit' }>;

  /** The box of five at console `seat`, with what `change` says happened since. */
  function at(seat: ConsoleId, change: Partial<CircuitSeen> = {}): CircuitSeen {
    const view = seen('circuit', true, { wires: { min: 5, max: 5 } }, seat);
    if (view.kind !== 'circuit') {
      throw new Error(`expected the fuse box, got ${view.kind}`);
    }
    return { ...view, ...change };
  }

  /** A wire colour named anywhere: in words, an attribute or a class — `rotate` is no colour. */
  const COLOUR_NAMED = /(?<!\p{L})(rot|blau|gelb|weiß|schwarz)(?!\p{L})/iu;
  /** A voltage anywhere in the markup. */
  const VOLTS = /\d+ V\b/;
  /** This round's readings as the meter's paper strip lists them, wire by wire. */
  const listed = (html: string): string[] =>
    [...html.matchAll(/<span class="circuit-reading">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');
  /** What the meter's display says, in the words it gives a screen reader. */
  const readout = (html: string): string | undefined =>
    /<output class="circuit-readout" aria-live="polite"><span class="device-sr">([^<]*)<\/span>/.exec(
      html,
    )?.[1];

  /** Characters by the segments they light, a to g. */
  const CHARACTERS: Record<string, string> = {
    abcdef: '0',
    bc: '1',
    abdeg: '2',
    abcdg: '3',
    bcfg: '4',
    acdfg: '5',
    acdefg: '6',
    abc: '7',
    abcdefg: '8',
    abcdfg: '9',
    g: '-',
    '': ' ',
  };

  /** What every seven-segment display in `html` shows, read off its lit segments. */
  function displays(html: string): string[] {
    const display = /<span class="device-display" aria-hidden="true"><svg[^>]*>(.*?)<\/svg>/g;
    return [...html.matchAll(display)].map((m) =>
      (m[1] ?? '')
        .split('<g ')
        .slice(1)
        .map((cell) => {
          const segments = [...cell.matchAll(/<rect class="seg( seg--on)?"/g)];
          const lit = segments.map((s, i) => (s[1] === undefined ? '' : 'abcdefg'.charAt(i)));
          return CHARACTERS[lit.join('')] ?? '?';
        })
        .join(''),
    );
  }

  /** The angle the dial's needle stands at, from its style. */
  const needle = (html: string): number =>
    Number(/<g class="gauge-needle" style="transform:rotate\((-?[\d.]+)deg\)">/.exec(html)?.[1]);

  it('gives the box a button per wire behind its door, numbered from the top, and no voltage', () => {
    const box = at('a');
    const wires = box.wires ?? [];
    expect(wires).toHaveLength(5);
    const html = panel(box);
    expect(html).toContain('<div class="circuit-door"><ol class="wiring-box"');
    const buttons = [...html.matchAll(/<button class="circuit-wire [^"]*" data-index="(\d)"/g)];
    expect(buttons.map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4]);
    const names = [...html.matchAll(/<span class="wiring-name">([^<]*)<\/span>/g)];
    expect(names.map((m) => m[1])).toEqual(wires.map((wire) => wire.colour));
    expect(html.match(/<span class="wiring-pos">\d<\/span>/g)).toHaveLength(5);
    // The counter of live wires: a dead one among the five.
    expect(displays(html)).toEqual(['4']);
    expect(html).toContain('<span class="device-sr">Noch unter Spannung: 4</span>');
    expect(html).not.toMatch(VOLTS);
    expect(html).not.toMatch(/circuit-(probe|readout|reading|gauge)/);
  });

  it('shows a cut wire cut, and lets nobody cut it again', () => {
    const box = at('a');
    const wires = (box.wires ?? []).map((wire, i) => ({ ...wire, cut: i === 2 }));
    const html = panel({ ...box, wires, liveLeft: 3 });
    const cut = /<button class="circuit-wire [^"]*wiring-cut" data-index="(\d)" disabled=""/g;
    expect([...html.matchAll(cut)].map((m) => m[1])).toEqual(['2']);
    expect(displays(html)).toEqual(['3']);
  });

  it('lights the KURZSCHLUSS lamp after a wrong cut, until the next right one', () => {
    const lamp = (tone: string): string =>
      `<span class="device-lamp device-lamp--${tone}" aria-hidden="true"></span>` +
      '<span class="device-engraving">KURZSCHLUSS</span>';
    expect(panel(at('a'))).toContain(lamp('off'));
    expect(panel(at('a', { lastResult: 'short', shorts: 1 }))).toContain(lamp('red'));
    expect(panel(at('a', { lastResult: 'burnout', shorts: 3 }))).toContain(lamp('red'));
  });

  it('gives the meter a key per wire, the dial, the display and the strip, and no colour', () => {
    const meter = at('b');
    const html = panel(meter);
    const keys = [...html.matchAll(/<button class="circuit-probe" data-index="(\d)"[^>]*>(\d)</g)];
    expect(keys.map((m) => [Number(m[1]), Number(m[2])])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(html).toContain('<span class="device-engraving">MESSEN</span>');
    expect(html).toContain('<svg class="circuit-gauge"');
    expect(readout(html)).toBe('—');
    // Nothing measured yet: dashes on the display, the needle at rest, the counter beside.
    expect(displays(html)).toEqual(['-', '---', '4']);
    expect(needle(html)).toBe(-90);
    expect(html).toContain('<figcaption class="circuit-log-head">MESSPROTOKOLL</figcaption>');
    expect(listed(html)).toEqual(['—', '—', '—', '—', '—']);
    expect(html).not.toMatch(VOLTS);
    expect(html).not.toMatch(/circuit-wire|wiring-/);
    expect(html).not.toMatch(COLOUR_NAMED);
  });

  it('shows the wire measured last on dial and display, and lists the round on the strip', () => {
    const html = panel(at('b', { readings: [24, 0, 110, null, null], probed: 2 }));
    expect(readout(html)).toBe('Kabel 3: 110 V');
    expect(displays(html)).toEqual(['3', '110', '4']);
    expect(needle(html)).toBe(needleAngle(110));
    expect(html).toContain('<button class="circuit-probe circuit-probe--last" data-index="2"');
    expect(listed(html)).toEqual(['24 V', '0 V', '110 V', '—', '—']);
    // A new round clears the readings: the display keeps the wire, the needle drops to 0.
    const next = panel(at('b', { probed: 2 }));
    expect(readout(next)).toBe('Kabel 3: —');
    expect(displays(next)).toEqual(['3', '---', '4']);
    expect(needle(next)).toBe(-90);
  });

  it('scales the dial from 0 to 250 V over a half circle', () => {
    expect(SCALE_MAX).toBe(250);
    expect([0, 125, 250].map(needleAngle)).toEqual([-90, 0, 90]);
    expect(needleAngle(110)).toBe(-10.8);
    expect(needleAngle(230)).toBe(75.6);
    // Nothing read yet rests the needle at 0; nothing runs it past either end.
    expect([null, -5, 400].map(needleAngle)).toEqual([-90, -90, 90]);
    const html = panel(at('b'));
    const numbers = [...html.matchAll(/<text class="gauge-number"[^>]*>(\d+)<\/text>/g)];
    expect(numbers.map((m) => m[1])).toEqual(['0', '50', '100', '150', '200', '250']);
    expect(html.match(/<line class="gauge-tick( gauge-tick--major)?"/g)).toHaveLength(26);
    expect(html.match(/<line class="gauge-tick gauge-tick--major"/g)).toHaveLength(6);
  });

  it('says a short rewired the box and shakes it, and what a burnout costs', () => {
    const shorted = panel(at('a', { lastResult: 'short', shorts: 1 }));
    expect(shorted).toContain('<div class="circuit circuit--short">');
    expect(shorted).toContain('<p class="warn" role="status">Kurzschluss — neu verdrahtet.</p>');
    const burnt = panel(at('b', { lastResult: 'burnout', shorts: 3, burnoutSec: 75 }));
    expect(burnt).toContain('<div class="circuit circuit--short">');
    expect(burnt).toContain('<p class="warn" role="status">Kasten durchgebrannt — −75 s.</p>');
    for (const calm of [panel(at('a')), panel(at('b'))]) {
      expect(calm).toContain('<div class="circuit">');
      expect(calm).not.toMatch(/Kurzschluss —|durchgebrannt/);
    }
  });

  it('tells a console nobody stands at that it is not connected', () => {
    expect(panel(seen('circuit', false))).toContain(
      '<p class="muted">Dieses Pult ist nicht angeschlossen.</p>',
    );
  });

  it('shows the audience both consoles, every voltage and the dead wire, none to press', () => {
    const watched = seen('circuit', true, { wires: { min: 5, max: 5 } }, null, null);
    if (watched.kind !== 'circuit' || watched.voltages === null || watched.dead === null) {
      throw new Error('expected the audience to see every voltage');
    }
    const { voltages, dead } = watched;
    const html = panel(watched);
    const names = [...html.matchAll(/<h4 class="circuit-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A', 'Pult B']);
    const shown = [...html.matchAll(/<span class="circuit-volts">([^<]*)<\/span>/g)];
    expect(shown.map((m) => m[1])).toEqual(voltages.map((v, i) => (dead[i] ? 'tot' : `${v} V`)));
    expect(dead.filter(Boolean)).toHaveLength(1);
    const rows = /<span class="circuit-wire [^"]*circuit-wire--watched" data-index/g;
    expect(html.match(rows)).toHaveLength(5);
    expect(readout(html)).toBe('—');
    expect(html).not.toContain('<button');
  });
});
