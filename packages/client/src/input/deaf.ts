import { useEffect } from 'react';

/**
 * A screen that shows a game and plays none — the demo's audience on the own view of one of its
 * crew (screens/Demo.tsx) — makes the game's keys deaf for as long as it stands: the notepad's
 * and the keys that put a sheet down (hooks.ts `useKeys`), and the opening's skip. What listens
 * for such a key asks `keysDeaf()` as the key comes. The rest needs no asking: the world of a
 * seat watched listens for no key at all, a console's prompt takes none inside an inert screen,
 * and Esc finds nothing of the screen's own to close — it opens the page's menu, as over any
 * audience's screen.
 */

let screens = 0;

/** Whether the game's keys do nothing now: a screen that only shows a game stands up. */
export const keysDeaf = (): boolean => screens > 0;

/** While `on`, the game's keys do nothing (`keysDeaf`). */
export function useDeafKeys(on: boolean): void {
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    screens += 1;
    return () => {
      screens -= 1;
    };
  }, [on]);
}
