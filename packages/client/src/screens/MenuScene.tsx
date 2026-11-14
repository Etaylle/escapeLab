import { useEffect, useRef, useState } from 'react';
import { reducedMotion, watchMotion } from '../settings.js';
import { openStage, type SceneStage } from '../world/menu/stage.js';

/** What the menu tells its scene: the mission whose lab it shows, and whether the lobby is up. */
interface SceneAsk {
  missionId: string | null;
  lobby: boolean;
}

/** No stage at all: what the teller tells before its canvas is there, and after it is gone. */
const UNSEEN: Pick<SceneStage, 'show' | 'lobby'> = {
  show: () => undefined,
  lobby: () => undefined,
};

/**
 * What MenuScene keeps of its scene between renders: the stage once `open` has opened it on its
 * canvas (`attach`), and what it was last told (`tell`) — the mission and whether it stands behind
 * the lobby —, each told the stage again only as it changes, and both told a stage opened after.
 */
export function sceneTeller(open: (canvas: HTMLCanvasElement) => SceneStage) {
  let stage = UNSEEN;
  let told: SceneAsk = { missionId: null, lobby: false };
  const tellMission = (missionId: string | null): void => {
    if (missionId !== told.missionId) stage.show(missionId);
  };
  const tellLobby = (lobby: boolean): void => {
    if (lobby !== told.lobby) stage.lobby(lobby);
  };
  return {
    attach(canvas: HTMLCanvasElement): () => void {
      const opened = open(canvas);
      stage = opened;
      opened.show(told.missionId);
      opened.lobby(told.lobby);
      return () => {
        opened.close();
        stage = UNSEEN;
      };
    },
    tell(ask: SceneAsk): void {
      tellMission(ask.missionId);
      tellLobby(ask.lobby);
      told = ask;
    },
  };
}

/**
 * The living scene behind the menu (world/menu/): the lab of `missionId` at night drifting along
 * the opening's shot, a vignette over it and the page's scanlines over all (styles/menu.css).
 * It lies behind the screen's content, over the whole window; hidden (`shown` false) — under
 * the Bestenliste, the booklet, the editor — it draws nothing. A mission picked anew comes in
 * over the lab before. Behind the lobby (`lobby`) it drifts on lit, its vignette even all round.
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
  const [scene] = useState(() =>
    sceneTeller((canvas) => openStage(canvas, { reduced: reducedMotion, watch: watchMotion })),
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    return canvas === null ? undefined : scene.attach(canvas);
  }, [scene]);
  useEffect(() => scene.tell({ missionId, lobby }), [scene, missionId, lobby]);
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
