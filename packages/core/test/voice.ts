/**
 * The lab's voice, as the tests hold every text the game shows to it. Three sets of rules,
 * from the strictest:
 *
 * - PAPERS: the lab's documents — every manual page and the notes in their margins — never
 *   address or name a player, never order, stage or coach anybody (manuals.test.ts).
 * - WORLD: whatever else the lab or its machines say — device plates and displays, coach
 *   lines, slips, the run report, the goal line, refusals, the stories — never addresses or
 *   names a player either; a device plate may still tell its operator what it takes, in the
 *   infinitive („Nummer wählen, Wert ablesen.", „Nur mit Partner am Prüfpult."), and a
 *   machine may say that nobody stands where it needs somebody („Am Rack steht niemand.").
 * - ADDRESS: the interface — menus, buttons, settings, the editor — stays plain and
 *   functional, and says „du", „ihr" or „Sie" to nobody either.
 *
 * Mission control's lines on the radio are a person talking to colleagues and keep their own
 * guard (radioLines.test.ts).
 */

/** One thing a text in a voice never does: what it is called, and how to find it in a sentence. */
export type VoiceRule = readonly [what: string, breaks: (sentence: string) => boolean];

/** A text cut into sentences: at a stop that a capital or an opening quote follows. */
export const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+(?=[„A-ZÄÖÜ])/);

/** Imperatives to one person; a capitalised one counts only where it opens a sentence. */
const IMPERATIVES = new Set([
  'beachte',
  'drehe',
  'dreh',
  'drück',
  'drücke',
  'finde',
  'folge',
  'frage',
  'geh',
  'gehe',
  'gib',
  'halte',
  'lass',
  'lasse',
  'leg',
  'lege',
  'lies',
  'melde',
  'merk',
  'merke',
  'miss',
  'nenn',
  'nenne',
  'nimm',
  'notiere',
  'öffne',
  'prüfe',
  'ruf',
  'rufe',
  'sag',
  'sage',
  'schalte',
  'schau',
  'schließe',
  'schneid',
  'schneide',
  'schreib',
  'schreibe',
  'sende',
  'sieh',
  'stell',
  'stelle',
  'starte',
  'such',
  'suche',
  'tipp',
  'tippe',
  'trenn',
  'trenne',
  'vergleiche',
  'warte',
  'wähle',
  'wiederhole',
  'zähl',
  'zähle',
]);

/** Capitalised, these open a sentence as nouns: die Folge, die Stelle, der Tipp. */
const NOUNS = new Set([
  'Dreh',
  'Folge',
  'Frage',
  'Miss',
  'Ruf',
  'Sage',
  'Schau',
  'Stelle',
  'Suche',
  'Tipp',
  'Vergleiche',
  'Warte',
]);

/**
 * Imperatives to several people, as a sentence opens on them: „Bringt es her!", „Redet
 * miteinander!". Within a sentence the same words are the third person („die Tür geht auf"),
 * so only the opening counts.
 */
const PLURAL_IMPERATIVES = new Set([
  'Bringt',
  'Drückt',
  'Geht',
  'Haltet',
  'Holt',
  'Lauft',
  'Legt',
  'Lest',
  'Löst',
  'Nehmt',
  'Redet',
  'Rennt',
  'Sagt',
  'Schaut',
  'Seht',
  'Stellt',
  'Sucht',
  'Teilt',
  'Trennt',
  'Wartet',
]);

const wordsOf = (chunk: string): string[] => chunk.match(/[\p{L}]+/gu) ?? [];

/** Whether a chunk of a sentence commands a person: an imperative anywhere, or opening it. */
export function commands(chunk: string): boolean {
  return wordsOf(chunk).some((word, i) => {
    const lower = word.charAt(0).toLowerCase() + word.slice(1);
    const opens = i === 0 && !NOUNS.has(word);
    return IMPERATIVES.has(word) || (opens && word !== lower && IMPERATIVES.has(lower));
  });
}

/**
 * Whether a sentence reads as German: a letter or a quote English has not, or a word it never
 * uses. The code's own messages are English, and some English words are German orders or
 * pronouns too — „lies", „such", „miss", „dir" — so those count only in a German sentence.
 */
const GERMAN_WORDS = [
  ...['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'oder', 'nicht', 'ist', 'sind', 'wird'],
  ...['mit', 'von', 'für', 'auf', 'bei', 'nach', 'zum', 'zur', 'vom', 'beim', 'nur', 'noch'],
  ...['schon', 'ein', 'eine[mnrs]?', 'kein', 'keine[mnrs]?', 'es', 'sich', 'wie', 'wenn'],
  ...['dann', 'als', 'hier', 'dort', 'jetzt', 'zu', 'im', 'alle', 'laut'],
];
const GERMAN = new RegExp(`[äöüßÄÖÜ„“]|\\b(${GERMAN_WORDS.join('|')})\\b`, 'i');

/** Whether a sentence orders one person or several about, in any of its chunks. */
function orders(sentence: string): boolean {
  return (
    GERMAN.test(sentence) &&
    sentence
      .split(/(?<=[:;,])\s+/)
      .some((chunk) => commands(chunk) || PLURAL_IMPERATIVES.has(wordsOf(chunk)[0] ?? ''))
  );
}

const IHR: VoiceRule = ['spricht mit ihr an', (s) => /\b(ihr|euch|euer|eure[mnrs]?)\b/i.test(s)];
const SIE: VoiceRule = ['spricht mit Sie an', (s) => /\b(Sie|Ihnen|Ihre?[mnrs]?)\b/.test(s)];
const STAGES: VoiceRule = ['gibt eine Regieanweisung', (s) => /\b[Ww]er\b/.test(s)];

/** How a text speaks to someone. No text the game shows does, the interface's included. */
export const ADDRESS: readonly VoiceRule[] = [
  [
    'spricht mit du an',
    (s) => /\b(du|dich|dein\w*)\b/i.test(s) || (/\bdir\b/i.test(s) && GERMAN.test(s)),
  ],
  IHR,
  SIE,
];

/** What the lab's papers never do. */
export const PAPERS: readonly VoiceRule[] = [
  ['spricht mit du an', (s) => /\b(du|dich|dir|dein\w*)\b/i.test(s)],
  IHR,
  SIE,
  ['nennt einen Spieler', (s) => /Spieler|Partner|Crew|Bediener|Leser|Team|Person/.test(s)],
  [
    'nennt einen Menschen',
    (s) => /\b(jemand|niemand|[Mm]an)\b|\b(der|den|dem) [Aa]nderen?\b/.test(s),
  ],
  STAGES,
  ['befiehlt', (s) => s.split(/(?<=[:;,])\s+/).some(commands)],
  [
    'coacht das Gespräch',
    (s) => /an(ge)?sag|vor(ge)?les|zurück(ge)?ruf|ein(ge)?zähl|durch(ge)?(sag|geb)|redet/i.test(s),
  ],
  ['ruft aus', (s) => s.includes('!')],
];

/** The words for the people at the controls, as the game would call them and the lab never does. */
const PLAYER_WORDS = [
  'Spieler(in|innen|n|s)?',
  'Spielende[nr]?',
  'Crew\\w*',
  'Bediener(in|innen|n|s)?',
  'Leser(in|innen|n|s)?',
  'Team\\w*',
  'Person(en)?',
];
const PLAYERS = new RegExp(`\\b(${PLAYER_WORDS.join('|')})\\b`);

/** What the lab and its machines never do outside the papers. */
export const WORLD: readonly VoiceRule[] = [
  ...ADDRESS,
  ['nennt einen Spieler', (s) => PLAYERS.test(s)],
  ['spricht einen Partner an', (s) => /^Partner(in)?\s*[,:!]/.test(s)],
  ['nennt den anderen', (s) => /\b[Dd](er|en|em) [Aa]nderen?\b/.test(s)],
  STAGES,
  ['befiehlt', orders],
];

/** Every sentence of `texts` that breaks one of `rules`, with what it does. */
export function offVoice(texts: readonly string[], rules: readonly VoiceRule[] = PAPERS): string[] {
  return texts.flatMap((text) =>
    sentencesOf(text).flatMap((sentence) =>
      rules.filter(([, breaks]) => breaks(sentence)).map(([what]) => `${what}: „${sentence}"`),
    ),
  );
}
