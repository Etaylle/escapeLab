import type { ManualBlock, ManualSection } from '@escapelab/core';
import { Figure } from './Figure.js';

/**
 * A puzzle's printed rules as the module wrote them: headings, numbered rule
 * lists, tables, symbol columns, a drawing of the device and a worked
 * example. Narrow enough for a phone held sideways in one hand; wide tables
 * scroll inside their own box.
 */
export function Manual({ sections }: { sections: ManualSection[] }) {
  return (
    <section className="manual" aria-label="Handbuch">
      <span className="kicker">HANDBUCH</span>
      {sections.map((section, i) => (
        <article key={i} className="manual-section">
          <h3>{section.heading}</h3>
          {section.blocks.map((block, j) => (
            <Block key={j} block={block} />
          ))}
        </article>
      ))}
    </section>
  );
}

/** One printed block; a rules list continued from another page numbers on from `start`. */
export function Block({ block, start }: { block: ManualBlock; start?: number }) {
  switch (block.kind) {
    case 'p':
      return <p>{block.text}</p>;
    case 'rules':
      return (
        <ol className="manual-rules" start={start}>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    case 'table':
      return (
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
  }
}
