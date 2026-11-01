import { readdirSync, readFileSync } from 'node:fs';

/**
 * A small cascade over the client's stylesheets, for tests that ask what a rendered element
 * is sized at on a screen, without a browser: the sheets in the order the bundle puts them,
 * their rules under the media that hold there, matched by tag and class against static
 * markup (descendants only), the winner by specificity and then by order; a value read
 * through its custom properties, calc(), min(), max() and clamp() into px. What it does not
 * read — states such as :hover, attributes, siblings, pseudo-elements — it leaves out.
 */

const SRC = new URL('../src/', import.meta.url);

/** A screen the sheets are read for. */
export interface Screen {
  width: number;
  height: number;
  /** a finger rather than a mouse: `(pointer: coarse)`, `(hover: none)` */
  coarse: boolean;
}

/** An element of rendered markup, as the cascade reads it. */
export interface Styled {
  tag: string;
  classes: string[];
  parent: Styled | null;
  /** its own text, its children's left out */
  text: string;
}

interface Compound {
  tag: string | null;
  classes: string[];
}

interface Selector {
  chain: Compound[];
  specificity: number;
}

interface Rule {
  /** its place in the bundle: the later wins a tie */
  order: number;
  media: string[];
  selectors: Selector[];
  declarations: Map<string, string>;
}

/** `text` split at `separator` where no bracket or quote is open. */
export function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quote !== '') {
      quote = ch === quote ? '' : quote;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === ')') {
      depth += ch === '(' ? 1 : -1;
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** The blocks at the top of `css`: each prelude with its body, the body's own blocks kept. */
function blocks(css: string): { prelude: string; body: string }[] {
  const found: { prelude: string; body: string }[] = [];
  let depth = 0;
  let from = 0;
  let open = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css.charAt(i);
    if (ch === '{') {
      open = depth === 0 ? i : open;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push({ prelude: css.slice(from, open).trim(), body: css.slice(open + 1, i) });
        from = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      from = i + 1;
    }
  }
  return found;
}

/** `selector` as compounds of tag and classes, or null where it asks what is not read here. */
function compiled(selector: string): Selector | null {
  if (selector === ':root') {
    return { chain: [{ tag: 'html', classes: [] }], specificity: 1000 };
  }
  if (/[:[#*+~]/.test(selector)) {
    return null;
  }
  const chain = selector
    .replace(/>/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => {
      const [tag = '', ...classes] = part.split('.');
      return { tag: tag === '' ? null : tag, classes };
    });
  const specificity = chain.reduce((sum, c) => sum + c.classes.length * 1000 + (c.tag ? 1 : 0), 0);
  return { chain, specificity };
}

function declarationsOf(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of splitTop(body, ';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      const name = declaration.slice(0, colon).trim();
      declarations.set(name, declaration.slice(colon + 1).trim().replace(/\s+/g, ' '));
    }
  }
  return declarations;
}

/** The style rules of `css` into `rules`, under `media`, nested ones under `prefix`. */
function collect(css: string, media: string[], prefix: string, rules: Rule[]): void {
  for (const { prelude, body } of blocks(css)) {
    const head = prelude.replace(/\s+/g, ' ');
    if (head.startsWith('@media')) {
      collect(body, [...media, head.slice('@media'.length).trim()], prefix, rules);
    } else if (head.startsWith('@')) {
      continue;
    } else if (body.includes('{')) {
      collect(body, media, `${prefix}${head} `, rules);
    } else {
      const selectors = splitTop(head, ',').flatMap((s) => compiled(`${prefix}${s}`) ?? []);
      rules.push({ order: rules.length, media, selectors, declarations: declarationsOf(body) });
    }
  }
}

/**
 * The sheets in the bundle's order: the panels' own, which come in with the panels that
 * App.tsx brings in before main.tsx's own imports, then ui.css and the sheets main.tsx
 * imports, in its order.
 */
export function bundleOrder(): string[] {
  const own = readdirSync(new URL('puzzles/', SRC))
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => `puzzles/${name}`);
  const main = readFileSync(new URL('main.tsx', SRC), 'utf8');
  const imported = [...main.matchAll(/^import '\.\/(.+\.css)';$/gm)].map(([, path]) => path);
  return [...own, ...imported.flatMap((path) => path ?? [])];
}

const RANGE = /^\((?:(\d+)px <)? ?(width|height) (?:< (\d+)px)?\)$/;

/** Whether a media query's feature holds: `(pointer: coarse)`, `(820px < width < 1180px)`. */
function feature(part: string, screen: Screen): boolean {
  const range = RANGE.exec(part);
  if (range !== null) {
    const size = range[2] === 'width' ? screen.width : screen.height;
    return size > Number(range[1] ?? -Infinity) && size < Number(range[3] ?? Infinity);
  }
  const [, name = '', value = ''] = /^\(([a-z-]+): ?([^)]+)\)$/.exec(part) ?? [];
  const finger = screen.coarse;
  const facts: Record<string, () => boolean> = {
    pointer: () => value === (finger ? 'coarse' : 'fine'),
    hover: () => value === (finger ? 'none' : 'hover'),
    orientation: () => value === (screen.width >= screen.height ? 'landscape' : 'portrait'),
    'max-width': () => screen.width <= parseFloat(value),
    'min-width': () => screen.width >= parseFloat(value),
    'max-height': () => screen.height <= parseFloat(value),
    'min-height': () => screen.height >= parseFloat(value),
  };
  const fact = facts[name];
  if (part === 'print' || name === 'prefers-reduced-motion' || name === 'display-mode') {
    return false;
  }
  if (fact === undefined) {
    throw new Error(`no reading of the media feature ${part}`);
  }
  return fact();
}

/** Whether a media query holds on `screen`: any of its comma's alternatives, all of an and. */
export function holds(query: string, screen: Screen): boolean {
  return splitTop(query, ',').some((alternative) =>
    alternative.split(' and ').every((part) => feature(part.trim(), screen)),
  );
}

function matchesCompound(compound: Compound, node: Styled): boolean {
  return (
    (compound.tag === null || compound.tag === node.tag) &&
    compound.classes.every((name) => node.classes.includes(name))
  );
}

/** Whether `selector` matches `node`, every compound before the last on an ancestor. */
function matches({ chain }: Selector, node: Styled): boolean {
  const last = chain[chain.length - 1];
  if (last === undefined || !matchesCompound(last, node)) {
    return false;
  }
  let at = node.parent;
  for (const compound of chain.slice(0, -1).reverse()) {
    while (at !== null && !matchesCompound(compound, at)) {
      at = at.parent;
    }
    if (at === null) {
      return false;
    }
    at = at.parent;
  }
  return true;
}

/** Every stylesheet of the client, read once; what it is asked, worked out once a screen. */
export class Sheets {
  /** the rules that declare a property, by the property */
  private readonly byProperty = new Map<string, Rule[]>();
  private readonly memo = new WeakMap<Styled, Map<string, Won | undefined>>();
  private readonly queries = new Map<string, boolean>();

  constructor(order: readonly string[] = bundleOrder()) {
    const rules: Rule[] = [];
    for (const sheet of order) {
      const css = readFileSync(new URL(sheet, SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      collect(css, [], '', rules);
    }
    for (const rule of rules) {
      for (const property of rule.declarations.keys()) {
        this.byProperty.set(property, [...(this.byProperty.get(property) ?? []), rule]);
      }
    }
  }

  /** What wins on `node` on `screen` of `property` and `also`'s; undefined where none is set. */
  declared(node: Styled, property: string, screen: Screen, also: string[] = []): Won | undefined {
    const key = `${screen.width}x${screen.height}${screen.coarse ? 'c' : 'f'} ${property} ${also}`;
    const known = this.memo.get(node) ?? new Map<string, Won | undefined>();
    this.memo.set(node, known);
    if (!known.has(key)) {
      known.set(key, this.winner(node, [property, ...also], screen));
    }
    return known.get(key);
  }

  private winner(node: Styled, properties: string[], screen: Screen): Won | undefined {
    let best: Won | undefined;
    for (const property of properties) {
      for (const rule of this.byProperty.get(property) ?? []) {
        if (!rule.media.every((query) => this.holds(query, screen))) {
          continue;
        }
        for (const selector of rule.selectors.filter((s) => matches(s, node))) {
          const rank = selector.specificity * 100_000 + rule.order;
          if (best === undefined || rank > best.rank) {
            best = { property, value: rule.declarations.get(property) ?? '', rank };
          }
        }
      }
    }
    return best;
  }

  private holds(query: string, screen: Screen): boolean {
    const key = `${screen.width}x${screen.height}${screen.coarse ? 'c' : 'f'} ${query}`;
    const known = this.queries.get(key) ?? holds(query, screen);
    this.queries.set(key, known);
    return known;
  }

  /** The custom property `name` as `node` has it: its own, else its nearest ancestor's. */
  custom(node: Styled, name: string, screen: Screen): string | undefined {
    for (let at: Styled | null = node; at !== null; at = at.parent) {
      const won = this.declared(at, name, screen);
      if (won !== undefined) {
        return won.value;
      }
    }
    return undefined;
  }

  /** The px `property` declares on `node`, NaN where nothing or nothing readable is declared. */
  length(node: Styled, property: string, screen: Screen): number {
    const won = this.declared(node, property, screen);
    if (won === undefined) {
      return NaN;
    }
    return lengthOf(won.value, this.reading(node, screen, this.fontSize(node, screen)));
  }

  /** `node`'s font size in px: its own, `font: inherit` or none taking its parent's. */
  fontSize(node: Styled, screen: Screen): number {
    const parent = node.parent === null ? 16 : this.fontSize(node.parent, screen);
    const won = this.declared(node, 'font-size', screen, ['font']);
    if (won === undefined || won.value === 'inherit') {
      return parent;
    }
    const size = won.property === 'font' ? fontShorthandSize(won.value) : won.value;
    return lengthOf(size, this.reading(node, screen, parent));
  }

  /** Whether `node` or an element round it is taken out of the layout on `screen`. */
  hidden(node: Styled, screen: Screen): boolean {
    for (let at: Styled | null = node; at !== null; at = at.parent) {
      if (this.declared(at, 'display', screen)?.value === 'none') {
        return true;
      }
    }
    return false;
  }

  private reading(node: Styled, screen: Screen, em: number): Reading {
    return { screen, em, custom: (name) => this.custom(node, name, screen) };
  }
}

/** A declaration that won the cascade: which property it set, its value, its rank. */
export interface Won {
  property: string;
  value: string;
  rank: number;
}

/** The size in a `font` shorthand: the word before its `/ line-height`, or its last but one. */
function fontShorthandSize(value: string): string {
  const [size = ''] = splitTop(value, '/');
  const words = splitTop(size, ' ');
  return words[words.length - 1] ?? '';
}

/** What a value is read against: the screen, the em, the element's custom properties. */
export interface Reading {
  screen: Screen;
  em: number;
  custom: (name: string) => string | undefined;
}

/** A number and whether it is a length (px) or a plain number. */
interface Quantity {
  n: number;
  px: boolean;
}

const NUMBER = String.raw`(-?\d*\.?\d+)(px|vh|vw|em|rem|%)?`;
const FUNCTION = String.raw`(calc|min|max|clamp|var)\(`;
const TOKEN = new RegExp(String.raw`\s*(?:${NUMBER}|${FUNCTION}|(--[\w-]+)|([-+*/(),]))`, 'y');

function tokens(value: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < value.trim().length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(value.trim());
    if (match === null) {
      throw new Error(`no reading of "${value}" at ${at}`);
    }
    out.push(match[0].trim());
  }
  return out;
}

/** `value` read into px against `reading`; NaN for what it cannot read (%, auto, a keyword). */
export function lengthOf(value: string, reading: Reading): number {
  try {
    const quantity = new Parser(tokens(value), reading).whole();
    return quantity.px || quantity.n === 0 ? quantity.n : NaN;
  } catch {
    return NaN;
  }
}

/** A recursive descent through calc()'s arithmetic, min(), max(), clamp() and var(). */
class Parser {
  private at = 0;

  constructor(
    private readonly list: string[],
    private readonly reading: Reading,
  ) {}

  whole(): Quantity {
    const quantity = this.sum();
    if (this.at !== this.list.length) {
      throw new Error(`left over: ${this.list.slice(this.at).join(' ')}`);
    }
    return quantity;
  }

  private sum(): Quantity {
    let left = this.product();
    while (this.peek() === '+' || this.peek() === '-') {
      const sign = this.next() === '+' ? 1 : -1;
      const right = this.product();
      left = { n: left.n + sign * right.n, px: left.px || right.px };
    }
    return left;
  }

  private product(): Quantity {
    let left = this.factor();
    while (this.peek() === '*' || this.peek() === '/') {
      const times = this.next() === '*';
      const right = this.factor();
      left = { n: times ? left.n * right.n : left.n / right.n, px: left.px || right.px };
    }
    return left;
  }

  private factor(): Quantity {
    const token = this.next();
    if (token === '(' || token === 'calc(') {
      return this.closed(this.sum());
    }
    if (token === 'min(' || token === 'max(' || token === 'clamp(') {
      return this.compare(token);
    }
    if (token === 'var(') {
      return this.variable();
    }
    return this.literal(token);
  }

  private compare(token: string): Quantity {
    const args = [this.sum()];
    while (this.peek() === ',') {
      this.next();
      args.push(this.sum());
    }
    this.closed(args[0] ?? { n: NaN, px: false });
    const ns = args.map((a) => a.n);
    const px = args.some((a) => a.px);
    if (token === 'clamp(') {
      const [low = NaN, mid = NaN, high = NaN] = ns;
      return { n: Math.max(low, Math.min(mid, high)), px };
    }
    return { n: token === 'min(' ? Math.min(...ns) : Math.max(...ns), px };
  }

  private variable(): Quantity {
    const name = this.next();
    const set = this.reading.custom(name);
    if (this.peek() === ',') {
      this.next();
      const fallback = this.sum();
      return this.closed(set === undefined ? fallback : this.nested(set));
    }
    if (set === undefined) {
      throw new Error(`${name} is set nowhere`);
    }
    return this.closed(this.nested(set));
  }

  private nested(value: string): Quantity {
    return new Parser(tokens(value), this.reading).whole();
  }

  private literal(token: string): Quantity {
    const [, number = '', unit = ''] = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(token) ?? [];
    if (number === '') {
      throw new Error(`no reading of ${token}`);
    }
    const n = Number(number);
    const { screen, em } = this.reading;
    const per: Record<string, Quantity> = {
      '': { n, px: false },
      px: { n, px: true },
      vh: { n: (n * screen.height) / 100, px: true },
      vw: { n: (n * screen.width) / 100, px: true },
      em: { n: n * em, px: true },
      rem: { n: n * 16, px: true },
    };
    const quantity = per[unit];
    if (quantity === undefined) {
      throw new Error(`no reading of the unit ${unit}`);
    }
    return quantity;
  }

  private closed(quantity: Quantity): Quantity {
    if (this.next() !== ')') {
      throw new Error('a bracket left open');
    }
    return quantity;
  }

  private peek(): string | undefined {
    return this.list[this.at];
  }

  private next(): string {
    const token = this.list[this.at];
    this.at += 1;
    if (token === undefined) {
      throw new Error('the value ends early');
    }
    return token;
  }
}

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'col', 'source', 'wbr']);
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;

/**
 * Every element of `html` (React's static markup) under the page's html and body, in
 * document order, each with its parent and its own text.
 */
export function elementsOf(html: string): Styled[] {
  const root: Styled = { tag: 'html', classes: [], parent: null, text: '' };
  const stack: Styled[] = [{ tag: 'body', classes: [], parent: root, text: '' }];
  const all: Styled[] = [];
  for (const [, close, tag = '', attributes = '', text] of html
    .replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(TAG)) {
    const top = stack[stack.length - 1] ?? root;
    if (text !== undefined) {
      top.text += text;
    } else if (close === '/') {
      const open = stack.map((node) => node.tag).lastIndexOf(tag.toLowerCase());
      stack.length = Math.max(1, open);
    } else {
      const classes = /\sclass="([^"]*)"/.exec(attributes)?.[1]?.split(/\s+/) ?? [];
      const node: Styled = { tag: tag.toLowerCase(), classes, parent: top, text: '' };
      all.push(node);
      if (!VOID.has(node.tag) && !attributes.trimEnd().endsWith('/')) {
        stack.push(node);
      }
    }
  }
  return all;
}
