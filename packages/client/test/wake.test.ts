import { describe, expect, it } from 'vitest';
import { wakeOnReturn } from '../src/ws.js';

/** A page's document as far as its visibility goes. */
class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'hidden';
}

describe('the line woken as the page comes back', () => {
  it('wakes on the network back, the page shown again, in focus, and visible again', () => {
    const win = new EventTarget();
    const doc = new Page();
    let woken = 0;
    const stop = wakeOnReturn(win as unknown as Window, doc as unknown as Document, () => {
      woken += 1;
    });
    for (const event of ['online', 'pageshow', 'focus']) {
      win.dispatchEvent(new Event(event));
    }
    expect(woken).toBe(3);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(woken).toBe(3);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(woken).toBe(4);
    stop();
    for (const event of ['online', 'pageshow', 'focus']) {
      win.dispatchEvent(new Event(event));
    }
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(woken).toBe(4);
  });
});
