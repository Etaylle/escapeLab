import type { ManualBlock, ManualSection } from '@escapelab/core';

/**
 * A puzzle's printed rules as the module wrote them: headings, numbered rule
 * lists, tables and symbol columns. Narrow enough for a phone held sideways
 * in one hand; wide tables scroll inside their own box.
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

function Block({ block }: { block: ManualBlock }) {
  switch (block.kind) {
    case 'p':
      return <p>{block.text}</p>;
    case 'rules':
      return (
        <ol className="manual-rules">
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
  }
}
