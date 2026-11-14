import { Fragment, type ReactNode } from 'react';

/**
 * linked.tsx: a text with every web address in it a link — an attribution as a licence wants it
 * (screens/MusicSettings.tsx „Nennungen", the music packs on /sounds), its addresses to follow.
 */

/** `text` with every web address in it a link that opens apart from the game. */
export function linked(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s·()]+)/).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
