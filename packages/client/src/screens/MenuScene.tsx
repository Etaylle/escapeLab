import { useEffect, useRef } from 'react';
import { reducedMotion, watchMotion } from '../settings.js';
import { openStage, type SceneStage } from '../world/menu/stage.js';

/**
 * The living scene behind the menu (world/menu/): the lit lab of `missionId` drifting along
 * the opening's shot, a vignette over it and the page's scanlines over all (styles/menu.css).
 * It lies behind the screen's content, over the whole window; hidden (`shown` false) — under
 * the Bestenliste, the booklet, the editor — it draws nothing. A mission picked anew comes in
 * over the lab before. Behind the lobby (`lobby`) it drifts on, its vignette even all round.
 */
export function MenuScene({
  missionId,
  shown,
  lobby,
}: {
  missionId: string | null;
  shown: boolean;
  lobby: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<SceneStage | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    const opened = openStage(canvas, { reduced: reducedMotion, watch: watchMotion });
    stage.current = opened;
    return () => {
      opened.close();
      stage.current = null;
    };
  }, []);
  useEffect(() => {
    stage.current?.show(missionId);
  }, [missionId]);
  useEffect(() => {
    stage.current?.lobby(lobby);
  }, [lobby]);
  return (
    <div
      className={lobby ? 'menu-backdrop menu-backdrop--lobby' : 'menu-backdrop'}
      hidden={!shown}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="menu-scene" />
    </div>
  );
}
