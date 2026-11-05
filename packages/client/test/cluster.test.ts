import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUSTER_AWAKE_MS, ClusterWake } from '../src/world/cluster.js';
import type { Box } from '../src/world/viewport.js';

const T0 = 1_000;

describe('the action cluster’s wake', () => {
  it('stands at rest until a finger comes down on it', () => {
    const wake = new ClusterWake();
    expect(wake.awake(T0)).toBe(false);
    expect(wake.nextLook(T0)).toBeNull();
    wake.down(1);
    expect(wake.awake(T0)).toBe(true);
    // Held — a sprint, a word spoken — it stays whole however long, with nothing to wait for.
    expect(wake.awake(T0 + 60_000)).toBe(true);
    expect(wake.nextLook(T0 + 60_000)).toBeNull();
  });

  it('stays whole CLUSTER_AWAKE_MS after the last finger lifted, and no longer', () => {
    expect(CLUSTER_AWAKE_MS).toBe(2000);
    const wake = new ClusterWake();
    wake.down(1);
    wake.up(1, T0);
    expect(wake.awake(T0 + CLUSTER_AWAKE_MS - 1)).toBe(true);
    expect(wake.awake(T0 + CLUSTER_AWAKE_MS)).toBe(false);
    // Looked at again a moment past its rest, then never again.
    expect(wake.nextLook(T0)).toBe(CLUSTER_AWAKE_MS + 1);
    expect(wake.nextLook(T0 + CLUSTER_AWAKE_MS)).toBeNull();
  });

  it('asks for another look where a timer came a moment early, never leaving it whole', () => {
    const wake = new ClusterWake();
    wake.down(1);
    wake.up(1, T0);
    // A timer set for T0 + 2001 that fires at T0 + 1999.5 finds it whole: it waits once more.
    const early = T0 + CLUSTER_AWAKE_MS - 0.5;
    expect(wake.awake(early)).toBe(true);
    expect(wake.nextLook(early)).toBeCloseTo(1.5, 9);
    expect(wake.awake(early + 1.5)).toBe(false);
  });

  it('counts its two seconds from the last of two fingers', () => {
    const wake = new ClusterWake();
    wake.down(1);
    wake.down(2);
    wake.up(1, T0);
    expect(wake.awake(T0 + 5000)).toBe(true);
    wake.up(2, T0 + 5000);
    expect(wake.awake(T0 + 5000 + CLUSTER_AWAKE_MS - 1)).toBe(true);
    expect(wake.awake(T0 + 5000 + CLUSTER_AWAKE_MS)).toBe(false);
  });

  it('wakes again at a new touch, and takes a finger it never had for nothing', () => {
    const wake = new ClusterWake();
    wake.up(7, T0);
    expect(wake.awake(T0)).toBe(false);
    wake.down(1);
    wake.up(1, T0);
    wake.down(2);
    expect(wake.awake(T0 + 10_000)).toBe(true);
    wake.up(2, T0 + 10_000);
    expect(wake.nextLook(T0 + 10_000)).toBe(CLUSTER_AWAKE_MS + 1);
  });
});

/** What the block opened by `header` holds, up to its matching brace; '' where there is none. */
function blockAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) {
    return '';
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    depth += source.charAt(i) === '{' ? 1 : source.charAt(i) === '}' ? -1 : 0;
    if (depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return '';
}

/** A length a rule of `block` sets on `property`, px; NaN where it sets none. */
function px(block: string, property: string): number {
  const match = new RegExp(`\\n\\s*${property}: (\\d+)px;`).exec(block);
  return Number(match?.[1] ?? NaN);
}

const WORLD = readFileSync(new URL('../src/styles/world.css', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
const TOUCH = blockAfter(WORLD, '/* ── the controls on a touch screen');
/** The cluster's sizes as the stylesheet sets them on a touch screen, CSS px. */
const SIZES = blockAfter(TOUCH, '.world-wrap {');
const CELL = px(SIZES, '--cluster-cell');
const GAP = px(SIZES, '--cluster-gap');
const EDGE = px(SIZES, '--controls-edge');

describe('the action cluster on a touch screen', () => {
  it('stands two by two, 52 px a button, 8 px apart, 12 px off the world’s edges', () => {
    expect([CELL, GAP, EDGE]).toEqual([52, 8, 12]);
    const cluster = blockAfter(TOUCH, '.world-thumb {');
    expect(cluster).toMatch(/display: grid;/);
    expect(cluster).toMatch(/grid-template-columns: repeat\(2, var\(--cluster-cell\)\);/);
    expect(cluster).toMatch(/grid-template-rows: repeat\(2, var\(--cluster-cell\)\);/);
    expect(cluster).toMatch(/gap: var\(--cluster-gap\);/);
    const controls = blockAfter(TOUCH, '.world-controls {');
    for (const side of ['left', 'right', 'bottom']) {
      expect(controls).toMatch(new RegExp(`\\n\\s*${side}: var\\(--controls-edge\\);`));
    }
  });

  it('puts the action in the corner, the sprint beside it, talk and the chat over them', () => {
    expect(blockAfter(TOUCH, '.world-thumb {')).toMatch(/'chat talk'\s*'sprint act';/);
    expect(blockAfter(TOUCH, '.world-interact {')).toMatch(/grid-area: act;/);
    expect(blockAfter(TOUCH, '.world-sprint {')).toMatch(/grid-area: sprint;/);
    expect(blockAfter(TOUCH, '.world-talk {')).toMatch(/grid-area: talk;/);
    expect(blockAfter(TOUCH, '.world-drop,\n  .world-chat-toggle {')).toMatch(/grid-area: chat;/);
    expect(blockAfter(TOUCH, '.world-thumb--carrying .world-chat-toggle {')).toMatch(
      /display: none;/,
    );
  });

  it('stands at 60 % until touched, whole while awake, the pad at its 85 %', () => {
    expect(blockAfter(TOUCH, '.world-thumb {')).toMatch(/opacity: 0\.6;\s*transition: opacity/);
    expect(blockAfter(TOUCH, '.world-thumb.world-thumb--awake {')).toMatch(
      /opacity: 1;\s*transition: none;/,
    );
    expect(blockAfter(TOUCH, '.world-pad {')).toMatch(/opacity: 0\.85;/);
    // The box round both no longer dims them: each group keeps its own.
    expect(blockAfter(TOUCH, '.world-controls {')).toMatch(/opacity: 1;/);
  });

  it('keeps the steering pad three by three at 48 px', () => {
    const pad = blockAfter(UI, '\n.world-pad {');
    expect(pad).toMatch(/grid-template-columns: repeat\(3, 48px\);/);
    expect(pad).toMatch(/grid-template-rows: repeat\(3, 48px\);/);
  });

  it('opens the chat wheel over the cluster, sideways beside it and under the row', () => {
    const wheel = blockAfter(TOUCH, '.chat-wheel {');
    expect(wheel).toMatch(/bottom: calc\(var\(--cluster-reach\) \+ 8px\);/);
    const row = blockAfter(WORLD, '.game--row .chat-wheel {');
    expect(row).toMatch(/right: calc\(var\(--cluster-reach\) \+ 8px\);/);
    expect(row).toMatch(/max-height: calc\(100% - 44px - 20px\);/);
  });
});

/** How much of `band` the boxes cover, a share of its area: each box clipped to it. */
function coverage(boxes: readonly Box[], band: Box): number {
  const clipped = (box: Box): number =>
    Math.max(0, Math.min(box.right, band.right) - Math.max(box.left, band.left)) *
    Math.max(0, Math.min(box.bottom, band.bottom) - Math.max(box.top, band.top));
  const area = (band.right - band.left) * (band.bottom - band.top);
  return boxes.reduce((sum, box) => sum + clipped(box), 0) / area;
}

describe('the controls over the band of world on a phone held sideways', () => {
  /** The pad's side: three cells of 48 px in a 1-px border. */
  const PAD = 3 * 48 + 2;
  /** The cluster's side, as the stylesheet sets it. */
  const CLUSTER = 2 * CELL + GAP;
  /**
   * The world's canvas inside its border at 844×390 and 932×430 as the walkthrough measures it,
   * the HUD's row 44 px over its top.
   */
  const PHONES = [
    { name: '844×390', w: 826, h: 345 },
    { name: '932×430', w: 914, h: 385 },
  ];

  it('cover 30 % of its area at most: some 14 % at 844×390, 11 at 932×430', () => {
    for (const { name, w, h } of PHONES) {
      const band: Box = { left: 0, top: 44, right: w, bottom: h };
      const pad: Box = { left: EDGE, top: h - EDGE - PAD, right: EDGE + PAD, bottom: h - EDGE };
      const cluster: Box = {
        left: w - EDGE - CLUSTER,
        top: h - EDGE - CLUSTER,
        right: w - EDGE,
        bottom: h - EDGE,
      };
      const share = coverage([pad, cluster], band);
      expect(share, name).toBeLessThanOrEqual(0.3);
      expect(share, name).toBeCloseTo(name === '844×390' ? 0.136 : 0.109, 3);
    }
  });

  it('measures a box by what of it lies in the band, nothing for one beside it', () => {
    const band: Box = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(coverage([{ left: 50, top: 50, right: 150, bottom: 150 }], band)).toBe(0.25);
    expect(coverage([{ left: 100, top: 0, right: 120, bottom: 100 }], band)).toBe(0);
    expect(coverage([], band)).toBe(0);
  });
});
