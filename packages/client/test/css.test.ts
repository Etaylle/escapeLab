import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Nothing parses ui.css before the browser does, and a browser swallows every
 * rule after an unclosed one without a word. Sections merged at the file's
 * end have lost a closing brace before; this keeps the braces balanced.
 */
const css = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');

/** Opening lines of the blocks still open at the end, comments skipped. */
function unclosedBlocks(source: string): string[] {
  const open: string[] = [];
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const skipped = end === -1 ? source.length : end + 2;
      line += (source.slice(i, skipped).match(/\n/g) ?? []).length;
      i = skipped - 1;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === '\n') {
      line += 1;
    } else if (ch === '{') {
      open.push(`line ${line}`);
    } else if (ch === '}') {
      open.pop();
    }
  }
  return open;
}

describe('ui.css', () => {
  it('closes every block it opens', () => {
    expect(unclosedBlocks(css)).toEqual([]);
  });

  it('would notice a block left open', () => {
    expect(unclosedBlocks('.a {\n  color: red;\n/* } */\n.b {\n}\n')).toEqual(['line 1']);
  });
});
