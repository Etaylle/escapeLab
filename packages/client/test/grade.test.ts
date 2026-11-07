import { describe, expect, it } from 'vitest';
import {
  blend,
  GRADE_TURN_MS,
  gradeAt,
  gradePhase,
  GRADES,
  washed,
  washOf,
  type Wash,
} from '../src/world/grade.js';
import { EMERGENCY } from '../src/world/palette.js';

/** Expects `wash` to be `want`, to a hundredth of a byte and a thousandth of its strength. */
function expectWash(wash: Wash, want: Wash): void {
  expect(wash.alpha).toBeCloseTo(want.alpha, 3);
  wash.rgb.forEach((c, i) => expect(c).toBeCloseTo(want.rgb[i] ?? NaN, 2));
}

describe('gradePhase — the phase a frame stands in', () => {
  it('is the lab with its power, then the blackout, the escape and a run won', () => {
    expect(gradePhase({ powered: true, escaping: false, won: false })).toBe('normal');
    expect(gradePhase({ powered: false, escaping: false, won: false })).toBe('blackout');
    expect(gradePhase({ powered: false, escaping: true, won: false })).toBe('escape');
    expect(gradePhase({ powered: false, escaping: true, won: true })).toBe('won');
  });

  it('keeps the escape’s for a run lost in it, the blackout’s for one lost before', () => {
    expect(gradePhase({ powered: false, escaping: true, won: false })).toBe('escape');
    expect(gradePhase({ powered: false, escaping: false, won: false })).toBe('blackout');
  });
});

describe('the phases’ grades', () => {
  it('warm the lab with its power, cool the blackout, brighten a run won', () => {
    const [r, g, b] = GRADES.normal.rgb;
    expect(r).toBeGreaterThan(b);
    const [br, bg, bb] = GRADES.blackout.rgb;
    expect(bb).toBeGreaterThan(br);
    expect(bb).toBeGreaterThan(bg);
    expect(Math.min(...GRADES.won.rgb)).toBeGreaterThan(Math.max(r, g, b) * 0.8);
    expect(GRADES.won.alpha).toBeGreaterThan(GRADES.normal.alpha);
  });

  it('leave the escape’s red as it is: its grade lays nothing over the picture', () => {
    expect(GRADES.escape.alpha).toBe(0);
    expect(washed(EMERGENCY, GRADES.escape)).toEqual(EMERGENCY);
  });

  it('turn a colour in the blackout toward blue-grey, never past it', () => {
    const floor = [180, 140, 100] as const;
    const [r, , b] = washed(floor, GRADES.blackout);
    expect(r - b).toBeLessThan(floor[0] - floor[2]);
    expect(r).toBeLessThan(floor[0]);
    expect(b).toBeGreaterThan(Math.min(floor[2], GRADES.blackout.rgb[2]));
  });
});

describe('blend — one wash into another', () => {
  it('is the one at 0 and the other at 1', () => {
    expectWash(blend(GRADES.normal, GRADES.blackout, 0), GRADES.normal);
    expectWash(blend(GRADES.normal, GRADES.blackout, 1), GRADES.blackout);
  });

  it('fades a wash in from none in its own colour, only its strength rising', () => {
    const half = blend(GRADES.escape, GRADES.won, 0.5);
    expectWash(half, { rgb: GRADES.won.rgb, alpha: GRADES.won.alpha / 2 });
    expect(blend(GRADES.escape, GRADES.escape, 0.5).alpha).toBe(0);
  });

  it('lays on halfway what each wash would lay on, halved', () => {
    const half = blend(GRADES.normal, GRADES.blackout, 0.5);
    const picture = [120, 120, 120] as const;
    const each = [washed(picture, GRADES.normal), washed(picture, GRADES.blackout)];
    washed(picture, half).forEach((c, i) => {
      expect(c).toBeCloseTo(((each[0]?.[i] ?? 0) + (each[1]?.[i] ?? 0)) / 2, 6);
    });
  });
});

describe('gradeAt — the grade turning from phase to phase', () => {
  it('starts a world in its phase’s grade, with no turn to watch', () => {
    const { turn, wash } = gradeAt(null, 'blackout', 5_000);
    expect(wash).toEqual(GRADES.blackout);
    expectWash(washOf(turn, 5_000), GRADES.blackout);
  });

  it('turns to the next phase’s grade over 1.5 s, halfway at the middle, eased', () => {
    const first = gradeAt(null, 'normal', 0).turn;
    const turned = gradeAt(first, 'blackout', 1_000);
    expectWash(turned.wash, GRADES.normal);
    const { turn } = turned;
    expectWash(washOf(turn, 1_000 + GRADE_TURN_MS / 2), blend(GRADES.normal, GRADES.blackout, 0.5));
    const early = washOf(turn, 1_000 + GRADE_TURN_MS / 10);
    expect(early.alpha - GRADES.normal.alpha).toBeLessThan(
      (GRADES.blackout.alpha - GRADES.normal.alpha) / 10,
    );
    expectWash(washOf(turn, 1_000 + GRADE_TURN_MS), GRADES.blackout);
    expectWash(washOf(turn, 1_000 + GRADE_TURN_MS * 4), GRADES.blackout);
  });

  it('keeps its turn while the phase holds', () => {
    const { turn } = gradeAt(gradeAt(null, 'normal', 0).turn, 'blackout', 1_000);
    const again = gradeAt(turn, 'blackout', 1_400);
    expect(again.turn).toBe(turn);
  });

  it('turns from where it stands when the phase changes mid-turn: no jump', () => {
    const toBlackout = gradeAt(gradeAt(null, 'normal', 0).turn, 'blackout', 1_000).turn;
    const at = 1_000 + GRADE_TURN_MS / 3;
    const before = washOf(toBlackout, at);
    const toEscape = gradeAt(toBlackout, 'escape', at);
    expectWash(toEscape.wash, before);
    expectWash(washOf(toEscape.turn, at + GRADE_TURN_MS), GRADES.escape);
  });
});
