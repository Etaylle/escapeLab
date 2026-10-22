import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTE_LABEL, PinnedNote } from '../src/screens/PinnedNote.js';

const noop = (): void => undefined;
const TEXT = 'Drei Tickets wegen der Lüfter, keins bearbeitet. – Admin';

describe('a note of the last crew, read where it hangs', () => {
  const html = renderToStaticMarkup(
    <PinnedNote note={{ index: 1, text: TEXT }} edgework={null} onClose={noop} />,
  );

  it('opens a slip over the world, named for what it is, with the way out', () => {
    expect(html).toContain('class="puzzle-modal note-modal"');
    expect(html).toContain(`aria-label="${NOTE_LABEL}"`);
    expect(html).toContain(`<div class="panel-label">// ${NOTE_LABEL}</div>`);
    expect(html).toContain('aria-label="Schließen"');
  });

  it('carries the words in the last crew’s hand, on a slip with its pin', () => {
    expect(html).toContain('<aside class="note-slip pinned-note"');
    expect(html).toContain('<span class="pinned-note-pin" aria-hidden="true"></span>');
    expect(html).toContain(`<p class="margin-note pinned-note-text">${TEXT}</p>`);
  });

  it('asks for nothing: no price, no note to ask for, nothing to wait on', () => {
    expect(html).not.toContain('note-ask');
    expect(html).not.toMatch(/−\d+ s/);
  });
});
