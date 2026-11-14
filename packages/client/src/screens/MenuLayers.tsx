import { useEffect, useRef, useState } from 'react';
import type { MissionInfo } from '@escapelab/core';
import type { MenuLayer } from '../menuLayer.js';
import { closeDoorsThen } from './DoorWipe.js';
import { HandbookScreen } from './Handbook.js';
import { PauseMenu, type PauseItem } from './PauseMenu.js';
import { SettingsPanel } from './Settings.js';

/**
 * The menus over the screens, in the order they stack (menuLayer.ts): the pause menu over a room,
 * the booklet of a mission opened from it, and the settings over everything — opened from the
 * pause menu, or by the gear off any room.
 */

/** The room's mission as the pause menu names it and opens its booklet. */
export interface RoomMission {
  id: string;
  title: string;
}

/**
 * A mission's booklet over the room (screens/Handbook.tsx), opened from the pause menu: the
 * page as the menu's „Handbuch" shows it, its own way back and Esc putting it away again.
 */
function HandbookOver({
  missions,
  missionId,
  select,
  close,
}: {
  missions: MissionInfo[];
  missionId: string;
  select: (missionId: string) => void;
  close: () => void;
}) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="overlay handbook-over" role="dialog" aria-modal="true" aria-label="Handbuch">
      <div className="handbook-over-page">
        <HandbookScreen
          missions={missions}
          missionId={missionId}
          selectMission={select}
          back={close}
        />
      </div>
    </div>
  );
}

interface Props {
  layer: MenuLayer;
  /** the room's mission: its name heads the pause menu; null off any room */
  mission: RoomMission | null;
  missions: MissionInfo[];
  /** out of the room: a lobby's seat given up, the audience gone (ws.ts `leaveRoom`) */
  leaveRoom: () => void;
}

/** What each of the pause menu's items does. */
function itemActions(
  layer: MenuLayer,
  mission: RoomMission,
  leaveRoom: () => void,
): Record<PauseItem, () => void> {
  return {
    resume: layer.closePause,
    settings: layer.openSettings,
    handbook: () => layer.openHandbook(mission.id),
    leave: () => closeDoorsThen(leaveRoom),
    'stop-watching': leaveRoom,
  };
}

/** The pause menu over the room, with the item last taken, where it stands open. */
function RoomMenu({ layer, mission, leaveRoom }: Omit<Props, 'missions'>) {
  const [last, setLast] = useState<PauseItem>('resume');
  const { phase, pause } = layer;
  // Opened anew, the focus stands on „Weiter" again.
  useEffect(() => {
    if (!pause) {
      setLast('resume');
    }
  }, [pause]);
  if (!pause || phase === null || mission === null) {
    return null;
  }
  const actions = itemActions(layer, mission, leaveRoom);
  return (
    <PauseMenu
      phase={phase}
      missionTitle={mission.title}
      covered={layer.settings || layer.handbook !== null}
      last={last}
      onPick={(item) => {
        setLast(item);
        actions[item]();
      }}
      onClose={layer.closePause}
    />
  );
}

/** The menus over the screens, in the order they stack. */
export function MenuLayers({ layer, mission, missions, leaveRoom }: Props) {
  return (
    <>
      <RoomMenu layer={layer} mission={mission} leaveRoom={leaveRoom} />
      {layer.handbook !== null && (
        <HandbookOver
          missions={missions}
          missionId={layer.handbook}
          select={layer.openHandbook}
          close={layer.closeHandbook}
        />
      )}
      {layer.settings && <SettingsPanel onClose={layer.closeSettings} />}
    </>
  );
}
