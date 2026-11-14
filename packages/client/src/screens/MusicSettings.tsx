import { useEffect, useState, useSyncExternalStore } from 'react';
import { changeSettings, getSettings, useSettings } from '../settings.js';
import {
  chosenFor,
  entryOf,
  installedPacks,
  packFor,
  type MusicChoice,
} from '../world/musicPacks.js';
import { previewing, subscribePreview, togglePreview } from '../world/musicPreview.js';
import { SLOTS, type PackFile, type Slot } from '../world/packFile.js';
import { musicListed } from '../world/samples.js';
import { Icon } from './Icon.js';
import { linked } from './linked.js';

/**
 * „Musik" in the settings' „Ton" (Settings.tsx, docs/sound.md „Musikpakete"): the music packs
 * the game ships, the one in force lit — another chosen plays at once where the menu plays, in the
 * lobby on the next bar, in a run at the stems' next loop point (world/musicPacks.ts); „Feinwahl",
 * for each place of the music the piece of any pack, the pack's own unless another is picked; a
 * ▶ beside each piece plays it here, the music under it pulled down, until it ends, another is
 * played, its ▶ is pressed again or the settings close (world/musicPreview.ts) — none beside a
 * piece of the score that awaits its render; and „Nennungen", every piece in play with its
 * attribution as its licence wants it, its addresses linked — what plays in a place whose piece
 * awaits its render is named in another's, or is the game's own. The choice is kept on this device
 * (settings.ts `music`) and the tab's „Zurücksetzen" puts it back.
 */

/** What each place of the music is called here. */
export const SLOT_NAMES: Readonly<Record<Slot, string>> = {
  'menu-theme': 'Hauptmenü',
  lobby: 'Lobby',
  title: 'Eröffnung',
  calm: 'Einsatz · ruhig',
  tense: 'Einsatz · Druck',
  critical: 'Letzte Minute',
  'end-won': 'Geschafft',
  'end-lost': 'Gescheitert',
};

/** The music with the pack `pack` chosen: the pieces picked kept, but those of that very pack. */
export function withPack(choice: MusicChoice, pack: string): MusicChoice {
  const pieces = Object.fromEntries(
    Object.entries(choice.pieces).filter(([, picked]) => picked !== pack),
  );
  return { pack, pieces };
}

/** The music with the piece of `pack` picked for `slot`: none kept where it is the pack's own. */
export function withPiece(choice: MusicChoice, slot: Slot, pack: string): MusicChoice {
  const pieces = Object.fromEntries(
    Object.entries(choice.pieces).filter(([place]) => place !== slot),
  );
  return { pack: choice.pack, pieces: pack === choice.pack ? pieces : { ...pieces, [slot]: pack } };
}

/** The piece played for the ear now, by its key, kept up to date. */
function usePreviewing(): string | null {
  return useSyncExternalStore(subscribePreview, previewing, previewing);
}

/**
 * The block drawn anew once the music's list is here: from then on it is known which pieces of
 * the score have a recording, to be played and named, and which await their render.
 */
function useMusicListed(): void {
  const [, setListed] = useState(false);
  useEffect(() => {
    let live = true;
    void musicListed().then(() => {
      if (live) setListed(true);
    });
    return () => {
      live = false;
    };
  }, []);
}

/** The packs, one to press, the one in force lit: its name, its composers below it. */
function PackPicker({ packs, chosen }: { packs: readonly PackFile[]; chosen: MusicChoice }) {
  return (
    <div className="music-packs" role="radiogroup" aria-label="Musikpaket">
      {packs.map((pack) => {
        const on = pack.id === chosen.pack;
        return (
          <button
            key={pack.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-pack={pack.id}
            className={on ? 'music-pack music-pack--on' : 'music-pack'}
            onClick={() => changeSettings({ music: withPack(getSettings().music, pack.id) })}
          >
            <span className="music-pack-title">{pack.title}</span>
            <span className="music-pack-by">{pack.composers.join(', ')}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What the ▶ beside a piece plays: the piece of `slot` in `pack`, called `title`. */
interface Playable {
  readonly pack: string;
  readonly slot: Slot;
  readonly title: string;
  /** whether it has a recording to play: none where a piece of the score awaits its render */
  readonly had: boolean;
}

/** The ▶ beside a piece: it plays the piece for the ear, or stops it where it plays. */
function PlayButton({ pack, slot, title, had }: Playable) {
  const playing = usePreviewing() === `${pack}/${slot}`;
  return (
    <button
      type="button"
      className="music-play"
      aria-pressed={playing}
      aria-label={playing ? `${title} anhalten` : `${title} anhören`}
      disabled={!had}
      onClick={() => togglePreview(pack, slot)}
    >
      <Icon name={playing ? 'pause' : 'play'} />
    </button>
  );
}

/** A place of the music in the Feinwahl: the piece of every pack for it, the one in play lit. */
export function SlotPicker(props: { slot: Slot; packs: readonly PackFile[]; chosen: MusicChoice }) {
  const { slot, packs, chosen } = props;
  const inPlay = packFor(slot, chosen);
  return (
    <fieldset className="music-slot">
      <legend>{SLOT_NAMES[slot]}</legend>
      <div className="music-pieces" role="radiogroup" aria-label={SLOT_NAMES[slot]}>
        {packs.map((pack) => {
          const piece = pack.pieces[slot];
          const on = pack.id === inPlay;
          const own = pack.id === chosen.pack ? ' (Paket)' : '';
          return (
            <div key={pack.id} className="music-piece-row">
              <button
                type="button"
                role="radio"
                aria-checked={on}
                data-piece={`${pack.id}/${slot}`}
                className={on ? 'music-piece music-piece--on' : 'music-piece'}
                onClick={() => changeSettings({ music: withPiece(chosen, slot, pack.id) })}
              >
                {`${piece.title} · ${piece.author} · ${pack.title}${own}`}
              </button>
              <PlayButton
                pack={pack.id}
                slot={slot}
                title={piece.title}
                had={entryOf(pack.id, piece) !== null}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * „Nennungen": every piece in play, with its place and its attribution — none for a place whose
 * piece of the score awaits its render, where another's plays or none.
 */
function Credits({ chosen }: { chosen: MusicChoice }) {
  const playing = SLOTS.flatMap((slot) => {
    const { piece, entry } = chosenFor(slot, chosen);
    return entry === null ? [] : [{ slot, piece }];
  });
  return (
    <div className="music-credits">
      <h3 className="music-credits-head">Nennungen</h3>
      <ul>
        {playing.map(({ slot, piece }) => (
          <li key={slot} data-credit={slot}>
            <span className="music-credit-slot">{SLOT_NAMES[slot]}</span>
            <span className="music-credit-text">{linked(piece.attribution)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** „Musik": the packs, the Feinwahl to open, and the Nennungen of the music in play. */
export function MusicSettings() {
  const { music } = useSettings();
  const [fine, setFine] = useState(false);
  useMusicListed();
  const packs = installedPacks();
  return (
    <fieldset className="settings-group settings-music">
      <legend>Musik</legend>
      <PackPicker packs={packs} chosen={music} />
      <p className="music-note">
        Ein anderes Paket setzt im Hauptmenü sofort ein, in der Lobby zum nächsten Takt, im
        Einsatz an der nächsten Schleife.
      </p>
      <button
        type="button"
        className="music-fine-toggle"
        aria-expanded={fine}
        onClick={() => setFine(!fine)}
      >
        Feinwahl
      </button>
      {fine && (
        <div className="music-fine">
          {SLOTS.map((slot) => (
            <SlotPicker key={slot} slot={slot} packs={packs} chosen={music} />
          ))}
        </div>
      )}
      <Credits chosen={music} />
    </fieldset>
  );
}
