/**
 * Quick chat: a fixed set of phrases so a crew can coordinate without voice
 * and without a text field. Fixed phrases keep it fast and keep abuse out.
 */

export const CHAT_PHRASES = {
  hier: 'Hier rüber!',
  warte: 'Warte kurz …',
  bereit: 'Bereit!',
  ansage: 'Brauche eine Ansage!',
  platte: 'Ich halte die Platte',
  drohne: 'Achtung, Drohne!',
  ventil: 'Alle an die Ventile!',
  fertig: 'Bei mir ist fertig',
} as const;

export type ChatPhrase = keyof typeof CHAT_PHRASES;

export const CHAT_PHRASE_IDS = Object.keys(CHAT_PHRASES) as ChatPhrase[];

export function chatText(phrase: ChatPhrase): string {
  return CHAT_PHRASES[phrase];
}
