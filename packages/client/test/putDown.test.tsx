import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualHere, ManualKind, PuzzleView } from '@escapelab/core';
import { NotepadContext, type NotepadHand } from '../src/noting.js';
import { Device } from '../src/puzzles/Device.js';
import { StationModal } from '../src/screens/Game.js';
import {
  PUT_DOWN_KEYS,
  PUT_DOWN_MS,
  PutDown,
  putDownKeys,
  putDownStep,
  type PutDownState,
} from '../src/screens/PutDown.js';
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';
import { lookOf, ReadingOverlay, verbOf } from '../src/screens/Reading.js';
import { BrokenContext, fakeAudio, freshAudio, midBand, started, startedAt } from './fakeAudio.js';
import { deviceRun, mapWith } from './fixtures.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** A source of `kind` covering one station: a rules list and a paragraph. */
function source(kind: ManualKind): ManualHere {
  return {
    id: 'quelle',
    label: 'QUELLE',
    kind,
    sections: [
      {
        puzzleId: 'kabel',
        index: 0,
        title: 'Kabel',
        manual: [
          {
            heading: 'Kabel',
            blocks: [
              { kind: 'p', text: 'Drei Kabel.' },
              { kind: 'rules', items: ['Rot zuerst.', 'Dann blau.'] },
            ],
          },
        ],
        notes: [],
        noteReadyAt: null,
        notesLeft: 0,
        costSec: 20,
      },
    ],
  };
}

const lab = mapWith({ tiles: ['#####', '#...#', '#####'] });

/** The overlay a source of `kind` opens in, put down by `onPutDown`. */
function reading(kind: ManualKind, extra: { leaving?: boolean } = {}, onPutDown = noop) {
  return (
    <ReadingOverlay
      manual={source(kind)}
      puzzle={null}
      current={0}
      mission="Blackout im Labor"
      map={lab}
      edgework={null}
      onAskNote={noop}
      onPutDown={onPutDown}
      {...extra}
    />
  );
}

/** A notepad's hand that only counts. */
function hand(): NotepadHand & { noted: string[]; toggled: number } {
  const counted = {
    noted: [] as string[],
    toggled: 0,
    noteDown: (text: string) => counted.noted.push(text),
    toggle: () => {
      counted.toggled += 1;
    },
  };
  return counted;
}

const KINDS: ManualKind[] = ['book', 'locker', 'cabinet', 'clipboard', 'terminal', 'chart'];

describe('putting down what was read', () => {
  it('puts down what was read with E or a step; at a device only Esc steps back', () => {
    expect(PUT_DOWN_KEYS).toEqual(['e', 'w', 'a', 's', 'd']);
    expect(putDownKeys('reading')).toEqual(PUT_DOWN_KEYS);
    expect(putDownKeys('note')).toEqual(PUT_DOWN_KEYS);
    // E works a lever, and a step is no step at a device.
    expect(putDownKeys('station')).toEqual([]);
    expect(putDownKeys(null)).toEqual([]);
  });

  it('holds a sheet put down on its way out of view, and nothing under reduced motion', () => {
    const none: PutDownState<string> = { last: null, held: null };
    const open = putDownStep(none, 'buch', false);
    expect(open).toEqual({ last: 'buch', held: null });
    expect(putDownStep(open, null, false)).toEqual({ last: null, held: 'buch' });
    expect(putDownStep(open, null, true)).toEqual({ last: null, held: null });
    const gone = putDownStep(open, null, false);
    expect(putDownStep(gone, null, false)).toBe(gone);
    // Picked up again on its way down: open, nothing held.
    expect(putDownStep(gone, 'buch', false)).toEqual({ last: 'buch', held: null });
    expect(PUT_DOWN_MS).toBe(220);
  });

  it('says at the foot of every source how it is put down: a book shut, the rest laid down', () => {
    for (const kind of KINDS) {
      const html = renderToStaticMarkup(reading(kind));
      const verb = ['book', 'locker', 'cabinet'].includes(kind) ? 'Zuklappen' : 'Weglegen';
      expect(verbOf(lookOf(kind)), kind).toBe(verb);
      expect(html, kind).toContain(
        `<button type="button" class="put-down-caption">[E] ${verb}</button>`,
      );
      expect(html, kind).toContain(`<button type="button" class="put-down-tab">${verb}</button>`);
      // No window's way out anywhere on the frame.
      expect(html, kind).not.toContain('✕');
      expect(html, kind).not.toContain('modal-close');
      expect(html, kind).not.toContain('Schließen');
    }
  });

  it('puts it down by its caption or its tab, and shows the notepad by a tab of its own', () => {
    let downs = 0;
    const notepad = hand();
    const elements = elementsOf(
      () => <PutDown verb="Weglegen" onPutDown={() => (downs += 1)} />,
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    press(buttonsOf(elements, 'put-down-caption')[0]);
    press(buttonsOf(elements, 'put-down-tab').find((b) => b.props['children'] === 'Weglegen'));
    expect(downs).toBe(2);
    press(buttonsOf(elements, 'put-down-tab--notes')[0]);
    expect(notepad.toggled).toBe(1);
    expect(downs).toBe(2);
  });

  it('offers the notepad’s tab only where a notepad is within reach', () => {
    const inGame = renderToStaticMarkup(
      <NotepadContext value={hand()}>{reading('clipboard')}</NotepadContext>,
    );
    expect(inGame).toContain(
      '<button type="button" class="put-down-tab put-down-tab--notes">Notizen</button>',
    );
    expect(renderToStaticMarkup(reading('clipboard'))).not.toContain('Notizen');
  });

  it('slides away once put down, taking nothing more', () => {
    const html = renderToStaticMarkup(reading('book', { leaving: true }));
    expect(html).toContain('class="puzzle-modal reading-modal reading-book puzzle-modal--leaving"');
    expect(html).toMatch(/role="dialog"[^>]*inert=""/);
    expect(renderToStaticMarkup(reading('book'))).not.toContain('leaving');
  });
});

/** The maze at its station, as its operator sees it. */
const maze: PuzzleView = {
  kind: 'maze',
  size: 4,
  pos: { x: 0, y: 0 },
  goal: { x: 3, y: 3 },
  cells: null,
  lastResult: null,
  index: 2,
  total: 3,
  title: 'Leitungsnetz',
  manual: null,
  console: 'a',
  backup: null,
};

describe('stepping back from a device', () => {
  const single = mapWith({
    stations: [{ puzzleId: 'netz', x: 4, y: 1, title: 'Leitungsnetz', status: 'armed' }],
  });

  it('says on its chassis how to step back, a tab under it on a touch screen, and no ✕', () => {
    const html = renderToStaticMarkup(
      <StationModal
        puzzle={maze}
        run={deviceRun()}
        map={single}
        edgework={null}
        deadlineAt={null}
        send={noop}
        onStepBack={noop}
      />,
    );
    expect(html).toContain(
      '<div class="device-foot"><button type="button" class="device-step-back">' +
        '[Esc] Zurücktreten</button>',
    );
    expect(html).toContain('<button type="button" class="device-tab">Zurücktreten</button>');
    expect(html).not.toContain('✕');
    expect(html).not.toContain('Schließen');
    // In the chassis, after the status strip along its foot.
    expect(html.indexOf('device-strip')).toBeLessThan(html.indexOf('device-foot'));
  });

  it('steps back by the engraving or the tab, and shows the notepad by the other tab', () => {
    let backs = 0;
    const notepad = hand();
    const elements = elementsOf(
      () => (
        <Device
          kind="maze"
          paragraph="§3"
          title="Leitungsnetz"
          tag={null}
          leds={[]}
          alarms={0}
          solved={false}
          press={null}
          onStepBack={() => (backs += 1)}
        >
          <p>Gesicht</p>
        </Device>
      ),
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    press(buttonsOf(elements, 'device-step-back')[0]);
    press(buttonsOf(elements, 'device-tab').find((b) => b.props['children'] === 'Zurücktreten'));
    expect(backs).toBe(2);
    press(buttonsOf(elements, 'device-tab--notes')[0]);
    expect(notepad.toggled).toBe(1);
  });

  it('gives the audience no way back: it stands at no console', () => {
    const watched = renderToStaticMarkup(
      <PuzzlePanel
        puzzle={{ ...maze, console: null }}
        run={deviceRun()}
        send={noop}
        deadlineAt={null}
      />,
    );
    expect(watched).not.toContain('device-foot');
    expect(watched).not.toContain('Zurücktreten');
  });
});

describe('the sounds of putting down', () => {
  beforeEach(() => {
    fakeAudio();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lay a sheet down: a swish, then the soft clack of the board, with a mid band', async () => {
    const audio = await freshAudio();
    audio.sheetDown();
    expect(startedAt('noise', 10.01)).toBe(true);
    expect(startedAt('noise', 10.17)).toBe(true);
    expect(midBand(audio.MID_BAND)).toBe(true);
    expect(started.filter((s) => s.kind === 'tone')).toEqual([]);
  });

  it('shut a book: the rush of the cover, then its clap on the pages', async () => {
    const audio = await freshAudio();
    audio.coverShut();
    expect(startedAt('noise', 10.01)).toBe(true);
    expect(startedAt('tone', 10.19)).toBe(true);
    expect(midBand(audio.MID_BAND)).toBe(true);
  });

  it('take a block down with three strokes of a pencil, no tone in them', async () => {
    const audio = await freshAudio();
    audio.pencilScratch();
    for (const at of [10.01, 10.1, 10.2]) {
      expect(startedAt('noise', at), String(at)).toBe(true);
    }
    expect(started.filter((s) => s.kind === 'tone')).toEqual([]);
  });

  it('never throw, with no audio at all or with one that breaks', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const none = await freshAudio();
    expect(() => {
      none.sheetDown();
      none.coverShut();
      none.pencilScratch();
    }).not.toThrow();
    vi.stubGlobal('AudioContext', BrokenContext);
    const broken = await freshAudio();
    expect(() => {
      broken.sheetDown();
      broken.coverShut();
      broken.pencilScratch();
    }).not.toThrow();
  });
});

/** What the block opened by `header` in `source` holds, to its closing brace; '' for none. */
function blockAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) {
    return '';
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    depth += source.charAt(i) === '{' ? 1 : source.charAt(i) === '}' ? -1 : 0;
    if (depth === 0) {
      return source.slice(source.indexOf('{', start) + 1, i);
    }
  }
  return '';
}

describe('the stylesheet of putting down', () => {
  const css = readFileSync(new URL('../src/styles/putdown.css', import.meta.url), 'utf8');

  it('slides a sheet out of view and shuts a book in PUT_DOWN_MS', () => {
    for (const header of [
      '.puzzle-modal.puzzle-modal--leaving {',
      '.puzzle-modal--leaving .panel {',
      '.reading-book.puzzle-modal--leaving .book-leaves {',
    ]) {
      expect(blockAfter(css, header), header).toContain(`${PUT_DOWN_MS}ms`);
    }
  });

  it('moves nothing under reduced motion', () => {
    const calm = blockAfter(css, '@media (prefers-reduced-motion: reduce)');
    const still = blockAfter(calm, '.reading-book.puzzle-modal--leaving .book-leaves {');
    expect(still).toMatch(/animation: none;/);
    expect(calm).toMatch(/\.puzzle-modal\.puzzle-modal--leaving,\s*\.puzzle-modal--leaving \.panel,/);
  });

  it('shows the captions where there are keys and the tabs under a finger', () => {
    expect(blockAfter(css, '.put-down-tabs {')).toMatch(/display: none;/);
    expect(blockAfter(css, '.device-tabs {')).toMatch(/display: none;/);
    const touch = blockAfter(css, '@media (pointer: coarse)');
    expect(blockAfter(touch, '.put-down-caption,')).toMatch(/display: none;/);
    expect(touch).toMatch(/\.put-down-tabs,\s*\.device-tabs \{\s*display: flex;/);
  });
});
