import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTE_LABEL, PinnedNote } from '../src/screens/PinnedNote.js';

const noop = (): void => undefined;
const TEXT = 'Drei Tickets wegen der Lüfter, keins bearbeitet. – Admin';

describe('a note of the last shift, read where it hangs', () => {
  const html = renderToStaticMarkup(
    <PinnedNote note={{ index: 1, text: TEXT }} edgework={null} onPutDown={noop} />,
  );

  it('opens a slip over the world, named for what it is, put down like a sheet', () => {
    expect(html).toContain('class="puzzle-modal note-modal"');
    expect(html).toContain(`aria-label="${NOTE_LABEL}"`);
    expect(html).toContain(`<div class="panel-label">// ${NOTE_LABEL}</div>`);
    expect(html).toContain('<button type="button" class="put-down-caption">[E] Weglegen</button>');
    expect(html).toContain('<button type="button" class="put-down-tab">Weglegen</button>');
    expect(html).not.toContain('✕');
    expect(html).not.toContain('Schließen');
  });

  it('slides away once put down, taking nothing more', () => {
    const leaving = renderToStaticMarkup(
      <PinnedNote note={{ index: 1, text: TEXT }} edgework={null} onPutDown={noop} leaving />,
    );
    expect(leaving).toContain('class="puzzle-modal note-modal puzzle-modal--leaving"');
    expect(leaving).toMatch(/role="dialog"[^>]*inert=""/);
  });

  it('carries the words in the last shift’s hand, on a slip with its pin', () => {
    expect(html).toContain('<aside class="note-slip pinned-note"');
    expect(html).toContain('<span class="pinned-note-pin" aria-hidden="true"></span>');
    expect(html).toContain(`<p class="margin-note pinned-note-text">${TEXT}</p>`);
  });

  it('asks for nothing: no price, no note to ask for, nothing to wait on', () => {
    expect(html).not.toContain('note-ask');
    expect(html).not.toMatch(/−\d+ s/);
  });
});
