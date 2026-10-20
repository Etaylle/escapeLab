import { describe, expect, it } from 'vitest';
import {
  FAR_GAIN,
  gainBetween,
  heard,
  linkPlan,
  ownsLink,
  peakOf,
  SILENT,
  SPEAK_KEEP,
  SPEAK_ON,
  SPEAK_RELEASE_MS,
  voiceGain,
  WALL_SHARE,
  type Peer,
} from '../src/voice/rules.js';

describe('how loud a crew member sounds', () => {
  it('is full within four tiles', () => {
    for (const distance of [0, 1.5, 3.9, 4]) {
      expect(voiceGain(distance, true), `${distance} tiles`).toBe(1);
    }
  });

  it('fades linearly from four tiles to a floor at ten', () => {
    expect(voiceGain(7, true)).toBeCloseTo(1 - 0.5 * (1 - FAR_GAIN));
    expect(voiceGain(5.5, true)).toBeCloseTo(1 - 0.25 * (1 - FAR_GAIN));
    expect(voiceGain(10, true)).toBeCloseTo(FAR_GAIN);
    expect(FAR_GAIN).toBe(0.15);
  });

  it('never falls silent in the same run, however far, and fades only one way', () => {
    let before = Infinity;
    for (let distance = 0; distance <= 60; distance += 0.5) {
      const gain = voiceGain(distance, true);
      expect(gain).toBeLessThanOrEqual(before);
      expect(gain).toBeGreaterThanOrEqual(FAR_GAIN);
      expect(voiceGain(distance, false)).toBeGreaterThan(0.05);
      before = gain;
    }
    expect(voiceGain(40, true)).toBeCloseTo(FAR_GAIN);
  });

  it('keeps a third through a wall: the two have to raise their voices', () => {
    expect(WALL_SHARE).toBe(0.35);
    for (const distance of [0, 3, 7, 12]) {
      expect(voiceGain(distance, false)).toBeCloseTo(voiceGain(distance, true) * WALL_SHARE);
    }
  });
});

describe('how loud across the lab', () => {
  /**
   * Two rooms, a wall between them at x = 3 with a door in it at (3,3):
   * the left room is x 1–2, the right one x 4–5.
   */
  const lab = {
    tiles: ['#######', '#..#..#', '#..#..#', '#.....#', '#######'],
  };
  const open = new Set<string>();
  const shut = new Set(['3,3']);

  it('is by distance alone within one room', () => {
    expect(gainBetween(lab, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 }, open)).toBe(1);
  });

  it('drops to the wall share with a wall between the two', () => {
    const through = gainBetween(lab, { x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }, open);
    expect(through).toBeCloseTo(WALL_SHARE);
  });

  it('carries through an open door, not through a shut one', () => {
    const [left, right] = [
      { x: 1.5, y: 3.5 },
      { x: 5.5, y: 3.5 },
    ];
    expect(gainBetween(lab, left, right, open)).toBe(1);
    expect(gainBetween(lab, left, right, shut)).toBeCloseTo(WALL_SHARE);
  });
});

describe('who opens the link between two players', () => {
  it('is the lower id, and exactly one of the two', () => {
    const ids = ['3f1c', '9a20', 'a001', 'ff00'];
    for (const one of ids) {
      for (const other of ids.filter((id) => id !== one)) {
        expect(ownsLink(one, other) !== ownsLink(other, one), `${one} / ${other}`).toBe(true);
        expect(ownsLink(one, other)).toBe(one < other);
      }
    }
  });
});

describe('who speaks', () => {
  it('reads a stretch of samples by its peak, either way of the zero line', () => {
    expect(peakOf([])).toBe(0);
    expect(peakOf([0.01, -0.3, 0.2])).toBe(0.3);
    expect(peakOf(new Float32Array([0, 0.05, -0.02]))).toBeCloseTo(0.05);
  });

  it('stays silent through quiet, and keeps the same state while nothing changes', () => {
    expect(heard(SILENT, 0, 100)).toBe(SILENT);
    expect(heard(SILENT, SPEAK_ON * 0.9, 100)).toBe(SILENT);
  });

  it('starts at a loud level, and only a loud one', () => {
    const speaking = heard(SILENT, SPEAK_ON, 100);
    expect(speaking).toEqual({ speaking: true, loudAt: 100 });
    expect(heard(SILENT, SPEAK_KEEP, 100).speaking).toBe(false);
  });

  it('is kept by a softer level and through a breath between words', () => {
    let speech = heard(SILENT, 0.3, 0);
    speech = heard(speech, SPEAK_KEEP, 200);
    expect(speech).toEqual({ speaking: true, loudAt: 200 });
    speech = heard(speech, 0, 200 + SPEAK_RELEASE_MS - 1);
    expect(speech.speaking).toBe(true);
  });

  it('stops once it has been quiet for the release time', () => {
    const speaking = heard(SILENT, 0.3, 0);
    expect(heard(speaking, 0.001, SPEAK_RELEASE_MS)).toEqual({ speaking: false, loudAt: 0 });
  });
});

describe('the links after a view of the room', () => {
  const peer = (id: string, connected = true): Peer => ({ id, connected });
  /** As Ben ("b") sees it: he opens the link to Carla ("c"), Anna ("a") opens hers to him. */
  const ben = (other: string): boolean => ownsLink('b', other);
  const set = (...ids: string[]): Set<string> => new Set(ids);

  it('on joining: the owner opens the link, the other waits for its offer', () => {
    expect(linkPlan([peer('a'), peer('c')], set(), set(), ben)).toEqual({ close: [], open: ['c'] });
  });

  it('when somebody drops out or leaves: their link closes, nobody else is touched', () => {
    const dropped = linkPlan([peer('a'), peer('c', false)], set('a', 'c'), set('a', 'c'), ben);
    expect(dropped).toEqual({ close: ['c'], open: [] });
    const left = linkPlan([peer('a')], set('a', 'c'), set('a', 'c'), ben);
    expect(left).toEqual({ close: ['c'], open: [] });
  });

  it('when somebody comes back: a fresh link, opened by the owner, the stale one closed', () => {
    // Carla was gone in the view before; Ben still holds a link from before she dropped.
    expect(linkPlan([peer('a'), peer('c')], set('a'), set('a', 'c'), ben)).toEqual({
      close: ['c'],
      open: ['c'],
    });
    // Anna is back: her stale link closes, and Ben waits for her offer.
    expect(linkPlan([peer('a'), peer('c')], set('c'), set('a', 'c'), ben)).toEqual({
      close: ['a'],
      open: [],
    });
  });

  it('changes nothing while everybody stays', () => {
    expect(linkPlan([peer('a'), peer('c')], set('a', 'c'), set('a', 'c'), ben)).toEqual({
      close: [],
      open: [],
    });
  });

  it('opens again a link the owner lost, as after a failure', () => {
    expect(linkPlan([peer('a'), peer('c')], set('a', 'c'), set('a'), ben)).toEqual({
      close: [],
      open: ['c'],
    });
    // A link only the other end may open is not Ben's to open again.
    expect(linkPlan([peer('a'), peer('c')], set('a', 'c'), set('c'), ben).open).toEqual([]);
  });

  it('for a spectator listening in: a link to every player there, none once it stops', () => {
    const everyone = (): boolean => true;
    expect(linkPlan([peer('a'), peer('b', false), peer('c')], set(), set(), everyone)).toEqual({
      close: [],
      open: ['a', 'c'],
    });
    expect(linkPlan([], set('a', 'c'), set('a', 'c'), everyone)).toEqual({
      close: ['a', 'c'],
      open: [],
    });
  });
});
