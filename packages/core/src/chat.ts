import { z } from 'zod';
import { fail } from './errors.js';

/**
 * Quick chat: a short list of phrases a crew coordinates with, without voice and without a
 * text field — fixed phrases keep it fast and keep abuse out. A mission names its eight
 * (`chat.phrases`); one that names none has the default list. A phrase may hold one slot,
 * filled as it is said from a short list: `{n}`, a number from 1 to 9, or `{name}`, one of the
 * phrase's own `names` („Kabel {n}", „Dienst {name}"). A client names a phrase by its place in
 * the list and the slot's value; the server passes the phrase on filled in.
 */

/** How many phrases the chat wheel holds: the digits 1–8 say them. */
export const CHAT_PHRASE_COUNT = 8;

/** Where a number from 1 to 9 goes in a phrase. */
export const NUMBER_SLOT = '{n}';
/** Where one of the phrase's `names` goes. */
export const NAME_SLOT = '{name}';

/** The longest a phrase may be, filled in or not: it has to fit a bubble over a figure. */
const PHRASE_MAX = 24;
/** The longest a name for `{name}` may be. */
const NAME_MAX = 8;
/** What `{n}` takes, in the order the wheel offers it: the digits a second press types. */
const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** One phrase of the quick chat, as a mission writes it. */
export interface ChatPhrase {
  /** its words, with `{n}` or `{name}` where a slot's value goes */
  text: string;
  /** what `{name}` may be, two to nine of them; only with `{name}` in the text */
  names?: string[] | undefined;
}

/** The phrases of a mission that names none: the crew's everyday words. */
export const DEFAULT_CHAT_PHRASES: readonly ChatPhrase[] = [
  { text: 'Hier rüber!' },
  { text: 'Warte kurz …' },
  { text: 'Bereit!' },
  { text: 'Brauche eine Ansage!' },
  { text: 'Ich halte die Platte' },
  { text: 'Achtung, Drohne!' },
  { text: 'Alle an die Ventile!' },
  { text: 'Bei mir ist fertig' },
];

/** What the slot of `phrase` takes, in the order the wheel offers it; nothing without a slot. */
export function slotValues(phrase: ChatPhrase): readonly string[] {
  if (phrase.text.includes(NUMBER_SLOT)) {
    return NUMBERS;
  }
  return phrase.text.includes(NAME_SLOT) ? (phrase.names ?? []) : [];
}

/** The phrase with `value` where its slot stands. */
function fill(phrase: ChatPhrase, value: string): string {
  return phrase.text.replace(NUMBER_SLOT, value).replace(NAME_SLOT, value);
}

/** The slots a phrase's text holds: `{n}`, `{name}`, and any other word in braces. */
const slotsIn = (text: string): string[] => text.match(/\{[^}]*\}/g) ?? [];

/** What is wrong with a phrase as a mission writes it; nothing for a sound one. */
function phraseIssues(phrase: ChatPhrase): string[] {
  const slots = slotsIn(phrase.text);
  const issues: string[] = [];
  if (slots.some((slot) => slot !== NUMBER_SLOT && slot !== NAME_SLOT)) {
    issues.push(`"${phrase.text}": a slot is ${NUMBER_SLOT} or ${NAME_SLOT}, nothing else`);
  }
  if (slots.length > 1) {
    issues.push(`"${phrase.text}": one slot a phrase at most`);
  }
  if (slots.includes(NAME_SLOT) !== (phrase.names !== undefined)) {
    issues.push(`"${phrase.text}": ${NAME_SLOT} and its names come together or not at all`);
  }
  const filled = slotValues(phrase).map((value) => fill(phrase, value));
  if ([phrase.text, ...filled].some((said) => [...said].length > PHRASE_MAX)) {
    issues.push(`"${phrase.text}": ${PHRASE_MAX} characters at most, its slot filled in`);
  }
  return issues;
}

const phraseSchema = z
  .object({
    text: z.string().trim().min(1),
    names: z
      .array(z.string().trim().min(1).max(NAME_MAX))
      .min(2)
      .max(NUMBERS.length)
      .refine((names) => new Set(names).size === names.length, 'the names have to differ')
      .optional(),
  })
  .superRefine((phrase, ctx) => {
    for (const message of phraseIssues(phrase)) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

/** The quick chat a mission may name: exactly eight phrases, each with one slot at most. */
export const chatSchema = z.object({
  phrases: z
    .array(phraseSchema)
    .length(CHAT_PHRASE_COUNT, `the quick chat holds ${CHAT_PHRASE_COUNT} phrases`),
});

/** The phrases of a mission's chat wheel, in order: its own, or the default list. */
export function phrasesOf(chat: { phrases: readonly ChatPhrase[] } | undefined): ChatPhrase[] {
  return [...(chat?.phrases ?? DEFAULT_CHAT_PHRASES)];
}

/**
 * The phrase as said, its slot filled with `value`: „Kabel {n}" with "3" is „Kabel 3". Fails
 * for a value its slot does not take, for a phrase with a slot said without one and for a
 * value given a phrase without a slot.
 */
export function sayPhrase(phrase: ChatPhrase, value: string | undefined): string {
  const values = slotValues(phrase);
  if (values.length === 0) {
    if (value !== undefined) {
      fail(`„${phrase.text}" hat keine Lücke für „${value}".`);
    }
    return phrase.text;
  }
  if (value === undefined || !values.includes(value)) {
    fail(`„${phraseShown(phrase)}" nimmt nur ${values.join(', ')}.`);
  }
  return fill(phrase, value);
}

/** The phrase as the wheel lists it before its slot is filled: „Kabel …". */
export function phraseShown(phrase: ChatPhrase): string {
  return phrase.text.replace(NUMBER_SLOT, '…').replace(NAME_SLOT, '…');
}
