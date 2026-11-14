import { useEffect, useRef, useState } from 'react';
import type { MissionInfo } from '@escapelab/core';
import type { MenuLayer } from '../menuLayer.js';
import { closeDoorsThen } from './DoorWipe.js';
import { GiveUpAsk } from './GiveUp.js';
import { HandbookScreen } from './Handbook.js';
import { PauseMenu, type PauseItem } from './PauseMenu.js';
import { SettingsPanel } from './Settings.js';

/**
 * The menus over the screens, in the order they stack (menuLayer.ts): the pause menu over a room,
 * the ask before a run's seat is given up and the booklet of a mission, both opened from it, and
 * the settings over everything — opened from the pause menu, or by the gear off any room. The
 * ways out of the room go through the lab's doors (DoorWipe.tsx): to the main menu, the seat kept
 * (ws.ts `toMenu`), or the seat given up (`leaveRoom`).
 */

/** The room's mission as the pause menu names it and opens its booklet. */
export interface RoomMission {
  id: string;
  title: string;
}

/** A run's seats as the ask before giving one up counts them: taken, and the fewest it takes. */
export interface RoomCrew {
  taken: number;
  least: number;
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
  /** a run's seats, for the ask before one is given up; null for the audience and off a room */
  crew: RoomCrew | null;
  missions: MissionInfo[];
  /** out of the room: a seat given up, the audience gone (ws.ts `leaveRoom`) */
  leaveRoom: () => void;
  /** off to the main menu, the seat kept (ws.ts `toMenu`) */
  toMenu: () => void;
}

/** What each of the pause menu's items does; „Einsatz aufgeben" asks first (`ask`). */
function itemActions(
  props: Pick<Props, 'layer' | 'leaveRoom' | 'toMenu'>,
  mission: RoomMission,
  ask: () => void,
): Record<PauseItem, () => void> {
  const { layer, leaveRoom, toMenu } = props;
  return {
    resume: layer.closePause,
    settings: layer.openSettings,
    handbook: () => layer.openHandbook(mission.id),
    'main-menu': () => closeDoorsThen(toMenu),
    'give-up': ask,
    leave: () => closeDoorsThen(leaveRoom),
    'stop-watching': leaveRoom,
  };
}

/**
 * The pause menu over the room, with the item last taken — and over it, once „Einsatz aufgeben"
 * was taken, the ask (GiveUp.tsx `GiveUpAsk`) — where it stands open.
 */
function RoomMenu(props: Omit<Props, 'missions'>) {
  const { layer, mission, crew } = props;
  const [last, setLast] = useState<PauseItem>('resume');
  const [asking, setAsking] = useState(false);
  const { phase, pause } = layer;
  // Opened anew, the focus stands on „Weiter" again, and nothing is asked.
  useEffect(() => {
    if (!pause) {
      setLast('resume');
      setAsking(false);
    }
  }, [pause]);
  if (!pause || phase === null || mission === null) {
    return null;
  }
  const actions = itemActions(props, mission, () => setAsking(true));
  return (
    <>
      <PauseMenu
        phase={phase}
        missionTitle={mission.title}
        covered={layer.settings || layer.handbook !== null || asking}
        last={last}
        onPick={(item) => {
          setLast(item);
          actions[item]();
        }}
        onClose={layer.closePause}
      />
      {asking && crew !== null && (
        <GiveUpAsk
          taken={crew.taken}
          least={crew.least}
          onGiveUp={() => closeDoorsThen(props.leaveRoom)}
          onBack={() => setAsking(false)}
        />
      )}
    </>
  );
}

/** The menus over the screens, in the order they stack. */
export function MenuLayers({ layer, mission, crew, missions, leaveRoom, toMenu }: Props) {
  return (
    <>
      <RoomMenu
        layer={layer}
        mission={mission}
        crew={crew}
        leaveRoom={leaveRoom}
        toMenu={toMenu}
      />
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
