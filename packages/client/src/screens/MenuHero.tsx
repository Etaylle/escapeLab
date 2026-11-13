import { useEffect, useRef, useState, type RefObject } from 'react';
import { crewPass } from '../pass.js';
import { reducedMotion, watchMotion } from '../settings.js';
import { useVoice } from '../voice/useVoice.js';
import { startHero, type HeroLook } from '../world/menu/heroStage.js';
import { browserSceneHost } from '../world/menu/loop.js';
import { WAVE_SETTLE_MS } from './ProfileChip.js';

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

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the drifting lab, in the colour the profile shows — the
 * profile's own small figure stays, standing for it where the stage leaves no room — facing the
 * menu: breathing, glancing round now and then, a light across its visor while the microphone
 * sends, waving as a new name settles in the profile, the hand lamp's beam sweeping over the lab
 * behind it and holding a beat on the item the player attends to (world/menu/heroStage.ts). Its
 * canvas lies over the stage at the stage's density, under every panel, catching no pointer; it
 * moves no more than 30 times a second, only while it shows, and holds one still pose under
 * reduced motion.
 */
export function MenuHero({ name, color }: { name: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | null>(null);
  const waveAt = useChangedAt(useSettled(name.trim(), WAVE_SETTLE_MS));
  const speaking = useSends();
  const look = useRef<HeroLook>({ color, speaking, waveAt: null });
  useEffect(() => {
    look.current = { color, speaking, waveAt: waveAt.current };
    wake.current?.();
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    const motion = { reduced: reducedMotion, watch: watchMotion };
    const started =
      canvas === null
        ? null
        : startHero(canvas, [look, crewPass().id], browserSceneHost(canvas), motion);
    wake.current = started?.wake ?? null;
    return () => {
      wake.current = null;
      started?.stop();
    };
  }, []);
  return <canvas ref={canvasRef} className="menu-hero" aria-hidden="true" hidden />;
}
