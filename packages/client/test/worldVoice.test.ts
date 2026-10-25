import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ADDRESS, offVoice, WORLD, type VoiceRule } from '../../core/test/voice.js';

/**
 * Everything the code says, in the lab's voice. Every string, every template's text — „…"
 * where a value goes in — and every JSX text in the sources of client, core and server is
 * read with the TypeScript parser, so a comment or a name in the code never counts, and held
 * to the world's rules (core/test/voice.ts): no text the lab or its machines show addresses,
 * names, stages or orders a player.
 *
 * The interface — menus, buttons, settings, the editor — is exempt from them and only
 * addresses nobody: whole files in INTERFACE, each with its reason, and single strings by a
 * `voice: interface` comment on the string's line or the line above it. Every exemption has
 * to be needed — a file or a marker that holds nothing the world's rules would refuse fails
 * as stale, so the list only ever names what it must. A world text where it belongs, default
 * for every file: a new file is held to the world's rules until it says otherwise.
 */

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** The sources read, under packages/. */
const ROOTS = ['client/src', 'core/src', 'server/src'];

/** Files of interface voice, under packages/ (a folder ends on „/"), each with its reason. */
const INTERFACE: Record<string, string> = {
  'client/src/editor/': 'the mission editor: a tool, not the world',
  'client/src/screens/Crew.tsx': 'the crew as the lobby and the HUD list it, and the credits',
  'client/src/screens/CrewRoom.tsx': 'the lobby’s seats and colours',
  'client/src/screens/History.tsx': 'the Bestenliste',
  'client/src/screens/Join.tsx': 'the start screen: the name, the rounds, the codes',
  'client/src/screens/Lobby.tsx': 'the lobby’s mission panel and its start',
  'client/src/screens/Spectate.tsx': 'the audience’s screen',
  'client/src/screens/Voice.tsx': 'the microphone’s switches',
  'core/src/chat.ts': 'the quick chat: the crew’s own words, not the lab’s',
};

/** A string the world's rules would refuse that this package leaves where it is, and why. */
interface Known {
  file: string;
  text: string;
  why: string;
}

const KNOWN: readonly Known[] = [
  {
    file: 'client/src/world/render/actors.ts',
    text: 'DU',
    why:
      'the name a figure falls back on where the view has no player for it, which a run ' +
      'never shows; the rendering package owns the file',
  },
];

/** The comment that marks a string of interface voice in a file of the world's. */
const MARKER = 'voice: interface';

/** A text in a source: where it starts, and whether a marker says it is the interface's. */
export interface Said {
  line: number;
  text: string;
  marked: boolean;
}

/** What a source says, and the lines its markers stand on. */
export interface Source {
  texts: Said[];
  markers: number[];
}

/** The text of a string, a template — „…" where a value goes in — or JSX; null for none. */
function textOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const parent = node.parent;
    const specifier = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
    return specifier ? null : node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `…${span.literal.text}`).join('');
  }
  if (ts.isJsxText(node)) {
    return node.text.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** Every text in `code` (a .ts or .tsx file at `path`), with the lines its markers stand on. */
export function readSource(path: string, code: string): Source {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, kind);
  const lineAt = (pos: number): number => file.getLineAndCharacterOfPosition(pos).line + 1;
  const markers = new Set<number>();
  const texts: Said[] = [];
  const noteMarkers = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (code.slice(range.pos, range.end).includes(MARKER)) {
        markers.add(lineAt(range.end));
      }
    }
  };
  const visit = (node: ts.Node): void => {
    noteMarkers(ts.getLeadingCommentRanges(code, node.getFullStart()));
    noteMarkers(ts.getTrailingCommentRanges(code, node.getEnd()));
    const text = textOf(node);
    if (text !== null && text !== '') {
      const start = node.getStart(file);
      const lead = code.slice(start).search(/\S/);
      texts.push({ line: lineAt(start + Math.max(0, lead)), text, marked: false });
    }
    // A template's own pieces are read with it; the values it takes in are read on their own.
    const children = ts.isTemplateExpression(node)
      ? node.templateSpans.map((span) => span.expression)
      : node.getChildren(file);
    children.forEach(visit);
  };
  visit(file);
  const marked = (line: number): boolean => markers.has(line) || markers.has(line - 1);
  return {
    texts: texts.map((said) => ({ ...said, marked: marked(said.line) })),
    markers: [...markers].sort((a, b) => a - b),
  };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return filesUnder(path);
    }
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Every source read, by its path under packages/. */
const SOURCES = new Map(
  ROOTS.flatMap((root) => filesUnder(join(PACKAGES, root))).map((path) => {
    const name = relative(PACKAGES, path).split('\\').join('/');
    return [name, readSource(name, readFileSync(path, 'utf8'))] as const;
  }),
);

/** The interface entry `name` falls under; null for a file of the world's voice. */
function interfaceOf(name: string): string | null {
  return (
    Object.keys(INTERFACE).find((entry) =>
      entry.endsWith('/') ? name.startsWith(entry) : name === entry,
    ) ?? null
  );
}

const known = (name: string, said: Said): boolean =>
  KNOWN.some((entry) => entry.file === name && entry.text === said.text);

/** Whether the world's rules would refuse a text. */
const refused = (said: Said): boolean => offVoice([said.text], WORLD).length > 0;

/** Every way a text of the source `name` breaks `rules`, each with where it stands. */
const breaches = (name: string, said: Said, rules: readonly VoiceRule[]): string[] =>
  offVoice([said.text], rules).map((what) => `${name}:${said.line}: ${what}`);

describe('the source scan', () => {
  it('reads strings, templates and JSX text, and the markers beside them', () => {
    const code = [
      "const a = 'Du startest im Archiv.';",
      '// voice: interface',
      "const b = `Noch ${n} Spieler`;",
      "const c = 'Crew'; // voice: interface",
      "import { x } from './Spieler.js';",
      'const d = <p title="Deine Farbe">',
      '  {/* voice: interface */}',
      '  Warten auf die Crew',
      '</p>;',
    ].join('\n');
    expect(readSource('probe.tsx', code)).toEqual({
      texts: [
        { line: 1, text: 'Du startest im Archiv.', marked: false },
        { line: 3, text: 'Noch … Spieler', marked: true },
        { line: 4, text: 'Crew', marked: true },
        { line: 6, text: 'Deine Farbe', marked: false },
        { line: 8, text: 'Warten auf die Crew', marked: true },
      ],
      markers: [2, 4, 7],
    });
  });

  it('reads every root', () => {
    for (const root of ROOTS) {
      expect([...SOURCES.keys()].some((name) => name.startsWith(`${root}/`)), root).toBe(true);
    }
  });
});

describe('the world voice in the code', () => {
  it('speaks for the lab and its machines, never to a player', () => {
    const off = [...SOURCES].flatMap(([name, source]) =>
      interfaceOf(name) !== null
        ? []
        : source.texts
            .filter((said) => !said.marked && !known(name, said))
            .flatMap((said) => breaches(name, said, WORLD)),
    );
    expect(off).toEqual([]);
  });

  it('keeps the interface plain: nobody addressed', () => {
    const off = [...SOURCES].flatMap(([name, source]) =>
      source.texts
        .filter((said) => (interfaceOf(name) !== null || said.marked) && !known(name, said))
        .flatMap((said) => breaches(name, said, ADDRESS)),
    );
    expect(off).toEqual([]);
  });

  it('names only files of interface voice that need it', () => {
    const stale = Object.keys(INTERFACE).filter((entry) => {
      const names = [...SOURCES.keys()].filter((name) => interfaceOf(name) === entry);
      return !names.some((name) => SOURCES.get(name)?.texts.some(refused));
    });
    expect(stale).toEqual([]);
  });

  it('marks only strings that need it', () => {
    const stale = [...SOURCES].flatMap(([name, source]) =>
      source.markers
        .filter((line) => {
          const covered = source.texts.filter((s) => s.line === line || s.line === line + 1);
          return interfaceOf(name) !== null || !covered.some(refused);
        })
        .map((line) => `${name}:${line}`),
    );
    expect(stale).toEqual([]);
  });

  it('knows only strings that are still there', () => {
    const there = (entry: Known): boolean =>
      SOURCES.get(entry.file)?.texts.some((said) => said.text === entry.text) ?? false;
    expect(KNOWN.filter((entry) => !there(entry))).toEqual([]);
  });
});
