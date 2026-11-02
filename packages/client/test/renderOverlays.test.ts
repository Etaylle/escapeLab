import { describe, expect, it } from 'vitest';
import { CHAT_PHRASE_IDS, chatText } from '@escapelab/core';
import { PHOSPHOR, rgba, type Rgb } from '../src/world/palette.js';
import { FALLBACK_COLOR, type Frame } from '../src/world/render/frame.js';
import { draw, NAME_INK, NAME_PLATE } from '../src/world/render/overlays.js';
import { callEntries, callsOf, fakeCanvas, setsOf } from './fakeCanvas.js';
import { frameWith, player, TILES } from './frames.js';
import { mapWith, type Item } from './fixtures.js';

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** A colour at its opacity, as the pass sets it. */
const rgbaOf = (paint: { rgb: Rgb; alpha: number }): string => rgba(paint.rgb, paint.alpha);

/** `paint` laid over `under` at its opacity. */
function over(paint: { rgb: Rgb; alpha: number }, under: Rgb): Rgb {
  const [r, g, b] = paint.rgb.map((c, i) => c * paint.alpha + (under[i] ?? 0) * (1 - paint.alpha));
  return [r ?? 0, g ?? 0, b ?? 0];
}

/** The relative luminance of a colour (WCAG 2.2). */
function luminance(rgb: Rgb): number {
  const linear = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/** The contrast ratio of two colours (WCAG 2.2): 1 to 21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** What the pass drew for `frame`. */
function drawn(frame: Frame) {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

/** The texts filled in `log`, in order. */
const texts = (log: ReturnType<typeof drawn>): unknown[] =>
  callsOf(log, 'fillText').map(([text]) => text);

const lab = (parts: Parameters<typeof mapWith>[0]) =>
  mapWith({ width: 10, height: 6, tiles: TILES, ...parts });

/** The station on the tile (3, 2), as interact.ts names it. */
const STATION = { of: 'station' as const, x: 3, y: 2 };
/** E works that station. */
const OPERATE = {
  kind: 'operate' as const,
  label: 'Bedienen',
  x: 3.5,
  y: 1.5,
  subject: STATION,
};

describe('overlays — what lies over the world and its light', () => {
  it('rings a ping where it lies, fading with age, and points at one off the screen', () => {
    const pings = [
      { playerId: 'p1', x: 3, y: 3, at: 0 },
      { playerId: 'p9', x: 20, y: 3, at: 400 },
    ];
    const players = [player('p1', 'Anna', '#ff6600')];
    const log = drawn(frameWith({ pings, perf: 800, players }));
    // 800 ms of 3200: a quarter gone. (3, 3) lies at (200, 300) on the canvas.
    const age = 800 / 3200;
    const rings = [0, 0.33, 0.66].map((phase) => {
      const t = (age * 2.2 + phase) % 1;
      return [200, 300, (0.25 + t * 1.3) * 100, 0, Math.PI * 2];
    });
    const arcs = callEntries(log, 'arc');
    expect(arcs.slice(0, 3).map((arc) => arc.args)).toEqual(rings);
    expect(arcs[0]?.alpha).toBe(1 - age);
    // Somebody the view does not list pings in the crew's fallback colour.
    expect(setsOf(log, 'strokeStyle').slice(0, 2)).toEqual(['#ff6600', FALLBACK_COLOR]);
    // (20, 3) lies far right: the arrow sits 26 px in from the edge, pointing right.
    expect(callsOf(log, 'translate')).toEqual([[774, 300]]);
    expect(callsOf(log, 'rotate')).toEqual([[0]]);
    expect(setsOf(log, 'globalAlpha').at(-1)).toBe(1);
  });

  it('keeps only the room names while the run ends on screen', () => {
    const map = lab({ labels: [{ text: 'LABOR', x: 6, y: 2 }] });
    const log = drawn(
      frameWith({
        map,
        ending: { lit: 0.5, pull: 0.5, dark: 0 },
        markers: [{ x: 9.5, y: 1.5, color: '#2dd4bf', label: 'STATION' }],
        action: OPERATE,
        captions: [{ x: 3, y: 3, text: 'Spind entdeckt', at: 0 }],
      }),
    );
    expect(callsOf(log, 'fillText')).toEqual([['LABOR', 550, 250]]);
    expect(callsOf(log, 'strokeText')).toEqual([['LABOR', 550, 250]]);
  });

  it('signs the open hatch over it, and a shut one not at all', () => {
    const open = lab({ exit: { x: 8, y: 4, open: true, openedAt: 1, atExit: [] } });
    const log = drawn(frameWith({ map: open }));
    expect(callsOf(log, 'fillText')).toContainEqual(['NOTAUSGANG', 750, 350]);
    const shut = lab({ exit: { x: 8, y: 4, open: false, openedAt: null, atExit: [] } });
    expect(texts(drawn(frameWith({ map: shut })))).not.toContain('NOTAUSGANG');
  });

  it('names what E does over what it works on — with its key on a keyboard, not on touch', () => {
    const action = OPERATE;
    const keyboard = drawn(frameWith({ action }));
    // (3.5, 1.5) lies at (250, 150): the tag's box 20 px high from 11 above it, its text 15 down.
    expect(callsOf(keyboard, 'fillText')).toContainEqual(['[E] Bedienen', 250, 150 - 11 + 15]);
    expect(setsOf(keyboard, 'strokeStyle')).toContain('#2dd4bf');
    expect(texts(drawn(frameWith({ action, touch: true })))).toContain('Bedienen');
    const locked = {
      kind: 'locked' as const,
      label: '🔒 Schlüssel fehlt',
      x: 3.5,
      y: 1.5,
      subject: { of: 'manual' as const, id: 'schrank' },
    };
    const missing = drawn(frameWith({ action: locked }));
    expect(texts(missing)).toContain('🔒 Schlüssel fehlt');
    expect(setsOf(missing, 'strokeStyle')).toContain('#fbbf24');
  });

  /** Whether a style is the phosphor's, at any strength. */
  const isPhosphor = (style: unknown): boolean =>
    String(style).startsWith(`rgba(${PHOSPHOR.join(', ')},`);

  it('puts no box round what the prompt names: the one rounded box it draws is the tag', () => {
    for (const parts of [{ pulse: 1 }, { pulse: 0, reduced: true }]) {
      const log = drawn(frameWith({ action: OPERATE, ...parts }));
      // '[E] Bedienen' is 84 px wide here: the tag 100 px round it, 20 high, over (250, 150).
      expect(callsOf(log, 'roundRect')).toEqual([[200, 139, 100, 20, 5]]);
      expect(callsOf(log, 'rect')).toEqual([]);
      expect(callsOf(log, 'strokeRect')).toEqual([]);
      // Nothing in the glow's phosphor either: what glows lies under the light, in its shape.
      const styles = [...setsOf(log, 'strokeStyle'), ...setsOf(log, 'fillStyle')];
      expect(styles.filter(isPhosphor)).toEqual([]);
    }
    expect(callsOf(drawn(frameWith({ action: null })), 'roundRect')).toEqual([]);
  });

  it('lets a caption rise over a source just come across, fading in and out', () => {
    const captions = [{ x: 6.5, y: 4, text: 'Spind entdeckt', at: 0 }];
    const alphaOf = (time: number): number | undefined =>
      callEntries(drawn(frameWith({ captions, time })), 'fillText').find(
        (call) => call.args[0] === 'Spind entdeckt',
      )?.alpha;
    expect(alphaOf(0.5)).toBe(1);
    const late = 1.8 / 2;
    expect(alphaOf(1.8)).toBe(Math.min(1, late * 10, (1 - late) * 4));
    expect(alphaOf(0.02)).toBe(Math.min(1, 0.01 * 10, 0.99 * 4));
  });

  it('bubbles the newest chat line of each speaker over their head, fading at its end', () => {
    const [first, second, third] = CHAT_PHRASE_IDS;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('the chat needs three phrases for this test');
    }
    const chats = [
      { playerId: 'p1', phrase: first, at: 0 },
      { playerId: 'p1', phrase: second, at: 100 },
      { playerId: 'p2', phrase: third, at: 50 },
      { playerId: 'p9', phrase: first, at: 150 },
    ];
    const ben = { x: 7, y: 3, facing: 0, moving: false, rx: 7, ry: 3, phase: 0 };
    const others = new Map([['p2', ben]]);
    const fresh = drawn(frameWith({ chats, others, perf: 200 }));
    expect(texts(fresh)).toEqual([chatText(second), chatText(third)]);
    expect(callEntries(fresh, 'fillText').map((call) => call.alpha)).toEqual([1, 1]);
    const fading = callEntries(drawn(frameWith({ chats, others, perf: 3900 })), 'fillText');
    const age = (3900 - 100) / 4200;
    expect(fading[0]?.alpha).toBe((1 - age) / 0.2);
  });

  it('reminds of Q while hands are full — on a keyboard, not on a touch screen', () => {
    const crate: Item = {
      seen: true,
      found: true,
      known: true,
      id: 'crate',
      kind: 'crate',
      label: 'KISTE',
      x: 0,
      y: 0,
      carriedBy: 'p1',
      delivered: false,
      deliverTo: null,
      requiredFor: null,
    };
    const map = lab({ items: [crate] });
    expect(callsOf(drawn(frameWith({ map })), 'fillText')).toContainEqual([
      '📦 KISTE — [Q] ablegen',
      400,
      600 - 16,
    ]);
    expect(texts(drawn(frameWith({ map, touch: true })))).toEqual([]);
  });

  it('points an arrow at what to walk to while it is off the screen, its distance under it', () => {
    const off = [{ x: 9.5, y: 1.5, color: '#2dd4bf', label: 'STATION' }];
    const log = drawn(frameWith({ markers: off }));
    // From (2.5, 2.5) to (9.5, 1.5): 7.07 tiles.
    expect(texts(log)).toContain('STATION 7m');
    expect(callsOf(log, 'translate')).toHaveLength(1);
    const near = [{ x: 3, y: 3, color: '#2dd4bf', label: 'STATION' }];
    expect(texts(drawn(frameWith({ markers: near })))).toEqual([]);
  });

  it('fades the marks of play in with the HUD after the run’s opening, the room names not', () => {
    const [phrase] = CHAT_PHRASE_IDS;
    if (phrase === undefined) {
      throw new Error('the chat needs a phrase for this test');
    }
    const crate: Item = {
      seen: true,
      found: true,
      known: true,
      id: 'crate',
      kind: 'crate',
      label: 'KISTE',
      x: 0,
      y: 0,
      carriedBy: 'p1',
      delivered: false,
      deliverTo: null,
      requiredFor: null,
    };
    const log = drawn(
      frameWith({
        map: lab({ labels: [{ text: 'LABOR', x: 6, y: 2 }], items: [crate] }),
        markers: [{ x: 9.5, y: 1.5, color: '#2dd4bf', label: 'STATION' }],
        action: OPERATE,
        captions: [{ x: 6.5, y: 4, text: 'Spind entdeckt', at: 0 }],
        time: 0.5,
        chats: [{ playerId: 'p1', phrase, at: 0 }],
        perf: 200,
        hud: 0.5,
      }),
    );
    const alphaOf = (text: string): number | undefined =>
      callEntries(log, 'fillText').find((call) => call.args[0] === text)?.alpha;
    expect(alphaOf('LABOR')).toBe(1);
    const marks = ['STATION 7m', '[E] Bedienen', 'Spind entdeckt', chatText(phrase)];
    for (const mark of [...marks, '📦 KISTE — [Q] ablegen']) {
      expect(alphaOf(mark)).toBe(0.5);
    }
    expect(setsOf(log, 'globalAlpha').at(-1)).toBe(1);
  });

  /** Every text the pass drew with the font size it stood in, px: `text@size`. */
  function sized(log: ReturnType<typeof drawn>): string[] {
    let font = '';
    const out: string[] = [];
    for (const entry of log) {
      if (entry.kind === 'set' && entry.name === 'font') {
        font = String(entry.value);
      } else if (entry.kind === 'call' && entry.name === 'fillText') {
        const px = /(\d+(?:\.\d+)?)px/.exec(font)?.[1];
        out.push(`${String(entry.args[0])}@${Number(px).toFixed(2)}`);
      }
    }
    return out;
  }

  it('sets room names, prompt, captions, arrows, chat and carry line at the text size', () => {
    const [phrase] = CHAT_PHRASE_IDS;
    if (phrase === undefined) {
      throw new Error('the chat needs a phrase for this test');
    }
    const crate: Item = {
      seen: true,
      found: true,
      known: true,
      id: 'crate',
      kind: 'crate',
      label: 'KISTE',
      x: 0,
      y: 0,
      carriedBy: 'p1',
      delivered: false,
      deliverTo: null,
      requiredFor: null,
    };
    const exit = { x: 8, y: 4, open: true, openedAt: 1, atExit: [] };
    const parts = {
      map: lab({ labels: [{ text: 'LABOR', x: 6, y: 2 }], items: [crate], exit }),
      markers: [{ x: 9.5, y: 1.5, color: '#2dd4bf', label: 'STATION' }],
      action: OPERATE,
      captions: [{ x: 6.5, y: 4, text: 'Spind entdeckt', at: 0 }],
      time: 0.5,
      chats: [{ playerId: 'p1', phrase, at: 0 }],
      perf: 200,
    };
    const at = (textScale: number): string[] => {
      const viewport = { w: 800, h: 600, dpr: 1, textScale, top: 0, boxes: [] };
      return sized(drawn(frameWith({ ...parts, viewport })));
    };
    const normal = [
      'LABOR@13.00',
      'NOTAUSGANG@12.00',
      'STATION 7m@11.00',
      '[E] Bedienen@12.00',
      'Spind entdeckt@12.00',
      `${chatText(phrase)}@12.00`,
      '📦 KISTE — [Q] ablegen@12.00',
    ];
    expect(at(1)).toEqual(normal);
    for (const scale of [0.9, 1.15]) {
      expect(at(scale)).toEqual(
        normal.map((entry) => {
          const [text, px] = entry.split(/@(?=[\d.]+$)/);
          return `${text}@${(Number(px) * scale).toFixed(2)}`;
        }),
      );
    }
  });

  it('grows the prompt’s tag with the text size round the same point', () => {
    const tag = (textScale: number): unknown[] | undefined => {
      const viewport = { w: 800, h: 600, dpr: 1, textScale, top: 0, boxes: [] };
      return callsOf(drawn(frameWith({ action: OPERATE, viewport })), 'roundRect')[0];
    };
    // '[E] Bedienen' is 84 px wide in the fake context at any size: the tag 16 px wider.
    expect(tag(1)).toEqual([200, 139, 100, 20, 5]);
    const k = 1.15;
    const want = [250 - (84 + 16 * k) / 2, 150 - 11 * k, 84 + 16 * k, 20 * k, 5 * k];
    (tag(k) ?? []).forEach((value, i) => expect(value).toBeCloseTo(want[i] ?? NaN, 9));
  });

  it('sets every room name on a dark plate it reads from at 4.5:1, over lit floor or dark', () => {
    const map = lab({ labels: [{ text: 'LABOR', x: 6, y: 2 }] });
    const log = drawn(frameWith({ map }));
    // The plate under the letters: 13 px of them from 0.8 + 0.25 over the baseline at (550,
    // 250) to 0.3 + 0.25 under it, 0.5 of their size past their 35 px at either side.
    const [plate] = callsOf(log, 'roundRect');
    const want = [550 - 17.5 - 6.5, 250 - 1.05 * 13, 35 + 13, 1.6 * 13, 3];
    expect(plate).toHaveLength(5);
    (plate ?? []).forEach((value, i) => expect(value).toBeCloseTo(want[i] ?? NaN, 9));
    // The plate is filled in its colour before the letters go on it in theirs.
    const step = (match: (entry: (typeof log)[number]) => boolean): number => log.findIndex(match);
    const plateSet = step((e) => e.kind === 'set' && e.value === rgbaOf(NAME_PLATE));
    const inkSet = step((e) => e.kind === 'set' && e.value === rgbaOf(NAME_INK));
    const filled = log.findIndex((e, i) => i > plateSet && e.kind === 'call' && e.name === 'fill');
    expect(plateSet).toBeGreaterThanOrEqual(0);
    expect(filled).toBeGreaterThan(plateSet);
    expect(inkSet).toBeGreaterThan(filled);
    // The worst floor is white, the best black: the plate over it, the letters over the plate.
    for (const floor of [WHITE, BLACK]) {
      const plate = over(NAME_PLATE, floor);
      const letters = over(NAME_INK, plate);
      expect(contrast(letters, plate), `over ${floor.join(',')}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves out a room name that would cover the label under a thing, which matters more', () => {
    const crate: Item = {
      seen: true,
      found: true,
      known: true,
      id: 'crate',
      kind: 'crate',
      label: 'KISTE',
      x: 6.5,
      y: 1.9,
      carriedBy: null,
      delivered: false,
      deliverTo: null,
      requiredFor: null,
    };
    const named = (items: Item[]): unknown[] =>
      texts(drawn(frameWith({ map: lab({ labels: [{ text: 'LABOR', x: 6, y: 2 }], items }) })));
    expect(named([])).toContain('LABOR');
    // The crate's label hangs 0.41 under it, on the name's line.
    expect(named([crate])).not.toContain('LABOR');
    expect(named([{ ...crate, x: 2.5 }])).toContain('LABOR');
  });

  it('covers the picture as far as the light has failed: the cold open’s, or the ending’s', () => {
    const cover = (parts: Partial<Frame>): unknown[] =>
      setsOf(drawn(frameWith(parts)), 'fillStyle').filter(
        (fill) => typeof fill === 'string' && fill.startsWith('rgba(3, 5, 9'),
      );
    expect(cover({ scene: { lit: true, cover: 0.6 } })).toEqual(['rgba(3, 5, 9, 0.6)']);
    const ending = { lit: 0, pull: 0, dark: 0.8 };
    expect(cover({ scene: { lit: false, cover: 0.6 }, ending })).toEqual(['rgba(3, 5, 9, 0.8)']);
    expect(cover({})).toEqual([]);
  });
});
