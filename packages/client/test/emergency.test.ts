import { describe, expect, it } from 'vitest';
import { stillOpen, type Opened } from '../src/screens/Game.js';

const nothing: Opened = { operating: false, readingId: null, notes: false, info: false };
const everything: Opened = { operating: true, readingId: 'handbuch', notes: true, info: true };

describe('an emergency and what is open', () => {
  it('closes the station, the pages, the notepad and the info panel the moment it starts', () => {
    expect(stillOpen(everything, false, true)).toEqual(nothing);
    expect(stillOpen({ ...nothing, readingId: 'handbuch' }, false, true)).toEqual(nothing);
  });

  it('lets the player open things again while it runs', () => {
    const notes = { ...nothing, notes: true };
    expect(stillOpen(notes, true, true)).toEqual(notes);
  });

  it('reopens nothing when it ends, and closes nothing either', () => {
    expect(stillOpen(nothing, true, false)).toEqual(nothing);
    const reading = { ...nothing, readingId: 'handbuch' };
    expect(stillOpen(reading, true, false)).toEqual(reading);
  });

  it('touches nothing while none runs', () => {
    expect(stillOpen(everything, false, false)).toEqual(everything);
  });
});
