import { useEffect, useRef, useState, type RefObject } from 'react';
import { crewPass } from '../pass.js';
import { NAME_SETTLE_MS } from '../profileName.js';
import { reducedMotion, watchMotion } from '../settings.js';
import { useVoice } from '../voice/useVoice.js';
import { startHero, walksIn, type HeroLook, type Taken } from '../world/menu/heroStage.js';
import { browserSceneHost } from '../world/menu/loop.js';
import { doorsFresh, doorsMark } from './DoorWipe.js';

/** Whether this page came back from the lobby through the doors; null before it was asked. */
let cameBackOnPage: boolean | null = null;

/**
 * Whether this page came back from the lobby through the doors (DoorWipe.tsx): asked once a
 * page, as its first menu comes up and before the doors' note goes with the doors.
 */
export function cameBack(): boolean {
  cameBackOnPage ??= doorsFresh(doorsMark(), Date.now());
  return cameBackOnPage;
}

/** `value` once it has stood still for `ms`; as it was first, until then. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** When `settled` last changed, by the page's clock — not as the hero came up; null for never. */
function useChangedAt(settled: string): RefObject<number | null> {
  const at = useRef<number | null>(null);
  const was = useRef(settled);
  useEffect(() => {
    if (settled !== was.current) {
      was.current = settled;
      at.current = performance.now();
    }
  }, [settled]);
  return at;
}

/** Whether the microphone is on and sends: open, or the talk key held. */
function useSends(): boolean {
  const state = useVoice()?.state;
  return state !== undefined && state.mic === 'on' && (state.open || state.held);
}

/** What the menu hands its hero. */
interface Props {
  /** the profile's name (profileName.ts): the hero waves as a new one settles */
  name: string;
  /** the colour the profile wears (BarAccount.tsx `profileColor`) */
  color: string;
  /** the item whose panel lies open over the menu; null for none */
  panel: string | null;
  /** a run's card stands first in the menu */
  card: boolean;
  /** the menu goes for the lobby, the doors closing over it */
  leaving: boolean;
  /** the item of the menu taken last; null for none */
  taken: Taken | null;
}

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the lab at night, in the colour the profile wears — the
 * top bar's avatar, its head, stands for it where the stage leaves no room — facing the menu:
 * breathing, looking round now and then, a light across its visor while the microphone sends,
 * waving as a new name settles, the hand lamp's beam sweeping over the lab behind it, its light
 * flickering once a minute (world/menu/heroStage.ts). On the first menu of a page it walks in
 * from the stage's right edge and switches its lamp on with the cold open's click; back from the
 * lobby, and under reduced motion, it stands there. It turns its head to what the player attends
 * to — the item hovered or in the focus, else a run's card —, its visor catching the item's glow,
 * and its beam to the room of the item picked out, which the scene travels to (places.ts); it
 * steps half a tile aside as a panel opens, flares its lamp at every item taken and steps toward
 * the menu at one that leaves it (`taken`), and turns away toward the lab as the menu goes for
 * the lobby. Its canvas lies over the stage at the stage's density, under every panel, catching
 * no pointer; it moves no more than 30 times a second, only while it shows, and holds one still
 * pose under reduced motion.
 */
export function MenuHero({ name, color, panel, card, leaving, taken }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | null>(null);
  const waveAt = useChangedAt(useSettled(name.trim(), NAME_SETTLE_MS));
  const speaking = useSends();
  const asked = { color, speaking, panel, card, leaving, taken };
  const look = useRef<HeroLook>({ ...asked, waveAt: null });
  useEffect(() => {
    look.current = { ...asked, waveAt: waveAt.current };
    wake.current?.();
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    const motion = { reduced: reducedMotion, watch: watchMotion };
    const hero = [look, crewPass().id, walksIn(reducedMotion(), cameBack())] as const;
    const started = startHero(canvas, hero, browserSceneHost(canvas), motion);
    wake.current = started?.wake ?? null;
    return () => {
      wake.current = null;
      started?.stop();
    };
  }, []);
  return <canvas ref={canvasRef} className="menu-hero" aria-hidden="true" hidden />;
}
