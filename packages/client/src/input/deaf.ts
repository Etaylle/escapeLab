import { useEffect } from 'react';

/**
 * A screen that shows a game and plays none — the demo's audience on the own view of one of its
 * crew (screens/Demo.tsx) — makes the game's keys deaf for as long as it stands: the notepad's,
 * the keys that put a sheet down, Esc over a panel, the opening's skip, a console's prompt. What
 * listens for a key of the game asks `keysDeaf()` as the key comes; the page's own keys — the
 * menu's, the demo's — never ask.
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
