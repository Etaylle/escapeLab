import { useEffect, useRef, useState, type RefObject } from 'react';
import { crewPass } from '../pass.js';
import { reducedMotion, watchMotion } from '../settings.js';
import { useVoice } from '../voice/useVoice.js';
import { startHero, walksIn, type HeroLook } from '../world/menu/heroStage.js';
import { browserSceneHost } from '../world/menu/loop.js';
import { doorsFresh, doorsMark } from './DoorWipe.js';
import { WAVE_SETTLE_MS } from './ProfileChip.js';

/** Whether this page came back from the lobby through the doors; null before it was asked. */
let cameBackOnPage: boolean | null = null;

/**
 * Whether this page came back from the lobby through the doors (DoorWipe.tsx): asked once a
 * page, as its first menu comes up and before the doors' note goes with the doors.
 */
function cameBack(): boolean {
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
  /** the name typed in the profile: the hero waves as a new one settles */
  name: string;
  /** the colour the profile shows */
  color: string;
  /** a panel lies open over the menu */
  panel: boolean;
  /** a run's card stands first in the menu */
  card: boolean;
  /** the menu goes for the lobby, the doors closing over it */
  leaving: boolean;
}

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the drifting lab, in the colour the profile shows — the
 * profile's own small figure stays, standing for it where the stage leaves no room — facing the
 * menu: breathing, glancing round now and then, a light across its visor while the microphone
 * sends, waving as a new name settles in the profile, the hand lamp's beam sweeping over the lab
 * behind it and holding a beat on the item the player attends to (world/menu/heroStage.ts). On
 * the first menu of a page it walks in from the stage's right edge and switches its lamp on with
 * the cold open's click; back from the lobby, and under reduced motion, it stands there. It turns
 * its head to what the player attends to — the item hovered or in the focus, else a run's card —
 * steps half a tile aside as a panel opens, and turns away toward the lab as the menu goes for
 * the lobby. Its canvas lies over the stage at the stage's density, under every panel, catching
 * no pointer; it moves no more than 30 times a second, only while it shows, and holds one still
 * pose under reduced motion.
 */
export function MenuHero({ name, color, panel, card, leaving }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | null>(null);
  const waveAt = useChangedAt(useSettled(name.trim(), WAVE_SETTLE_MS));
  const speaking = useSends();
  const asked = { color, speaking, panel, card, leaving };
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
