import type { ManualBlock, ManualSection } from '@escapelab/core';
import { notable, notedHead, notedText, type NotedStation } from '../noting.js';
import { blockText } from '../pages.js';
import { Figure } from './Figure.js';
import { Notable } from './NoteButton.js';

/**
 * A puzzle's printed rules as the module wrote them: headings, numbered rule
 * lists, tables, symbol columns, a drawing of the device and a worked
 * example. Narrow enough for a phone held sideways in one hand; wide tables
 * scroll inside their own box. Read at a source of `station`, every rules list
 * and table offers itself to the notepad (NoteButton.tsx).
 */
export function Manual({
  sections,
  station = null,
}: {
  sections: ManualSection[];
  /** the station these rules are read at a source for; null where nobody takes notes */
  station?: NotedStation | null;
}) {
  return (
    <section className="manual" aria-label="Handbuch">
      <span className="kicker">HANDBUCH</span>
      {sections.map((section, i) => (
        <article key={i} className="manual-section">
          <h3>{section.heading}</h3>
          {section.blocks.map((block, j) => (
            <Block
              key={j}
              block={block}
              noted={
                station === null || !notable(block)
                  ? null
                  : notedText(notedHead(station, section.heading), block)
              }
            />
          ))}
        </article>
      ))}
    </section>
  );
}

/**
 * One printed block; a rules list continued from another page numbers on from `start`. A rules
 * list or a table with its text for the notepad (`noted`) carries the „Notieren" control where
 * a notepad is within reach. A block of a kind this client does not know yet reads as a
 * paragraph of its words.
 */
export function Block({
  block,
  start,
  noted = null,
}: {
  block: ManualBlock;
  start?: number;
  noted?: string | null;
}) {
  switch (block.kind) {
    case 'p':
      return <p>{block.text}</p>;
    case 'rules':
      return (
        <Notable noted={noted}>
          <ol className="manual-rules" start={start}>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </Notable>
      );
    case 'table':
      return (
        <Notable noted={noted}>
          <div className="manual-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, i) => (
                    <th key={i} scope="col">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Notable>
      );
    case 'columns':
      return (
        <div className="manual-columns">
          {block.columns.map((column, i) => (
            <ol key={i} className="manual-column" aria-label={`Spalte ${i + 1}`}>
              {column.map((symbol, j) => (
                <li key={j}>{symbol}</li>
              ))}
            </ol>
          ))}
        </div>
      );
    // The lines run in order, so they stay a list; ui.css sets them without numbers.
    case 'example':
      return (
        <aside className="manual-example">
          <strong className="manual-example-title">{block.title}</strong>
          <ol className="manual-example-lines">
            {block.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </aside>
      );
    case 'figure':
      return (
        <figure className="manual-figure">
          <Figure of={block.of} />
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    default:
      return <p>{blockText(block)}</p>;
  }
}
