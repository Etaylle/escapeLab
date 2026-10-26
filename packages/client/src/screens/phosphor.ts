import { useEffect, useRef } from 'react';

/**
 * A title that comes on as a phosphor screen does (intro.css `phosphor-title`): unsteady for a
 * moment, then lit — the game's name on the start screen, the mission's in the lobby — each the
 * first time a page load shows it, not again on coming back to it, and not at all under
 * reduced motion.
 */

/** The titles that have come on this page load, by where they stand. */
const cameOn = new Set<string>();

/** Whether the title at `where` comes on now: the first time this page load shows it. */
export function useComesOn(where: string): boolean {
  const first = useRef(!cameOn.has(where));
  useEffect(() => {
    cameOn.add(where);
  }, [where]);
  return first.current;
}

/** The class a title takes while it comes on; none once it has. */
export function phosphorClass(comesOn: boolean): string | undefined {
  return comesOn ? 'phosphor-title' : undefined;
}
