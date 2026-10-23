import type { ManualBlock, ManualSection } from './module.js';

/**
 * Every station's printed page is a document the lab wrote for its own
 * people, a Betriebsanleitung: the machine's type plate, what it is for here,
 * how it is built, how it runs and what counts as a fault, the tables it
 * follows, an excerpt from its log and the workshop's notes. It describes the
 * machine and never addresses whoever reads it — from what the machine does,
 * anyone can tell what to do. The same frame on every page, so the book reads
 * as one lab's papers.
 */

/** The headings of the parts every page has; the title line heads the first. */
export const BUILD = 'Aufbau';
export const OPERATION = 'Betrieb';
export const WORKSHOP = 'Aus der Werkstatt';
/** The title of the box that holds the log excerpt. */
export const LOG = 'Protokollauszug';

/** What the machine's type plate says. */
export interface TypePlate {
  /** what the lab calls the machine: „Signalkette" */
  name: string;
  /** its type designation: „SK-4" */
  type: string;
  year: number;
}

/** A station's document, part by part, in the order the page prints them. */
export interface LabDocument {
  plate: TypePlate;
  /** Zweck: what the machine does for the lab, and why it stands where it does */
  purpose: string;
  /** the drawing that heads Aufbau: the client draws it for `of`, captioned `device` */
  figure: { of: string; device: string };
  /** Aufbau: what the parts show and carry */
  build: string;
  /** Betrieb: how it runs, what it takes, what counts as a fault and what that costs */
  operation: string;
  /** the tables and rule lists the machine follows, each section under its own heading */
  law: readonly ManualSection[];
  /** Protokollauszug: one past operation as the log has it, an entry a line */
  log: readonly string[];
  /** Aus der Werkstatt: one or two notes on how the machine behaves in practice */
  workshop: readonly string[];
}

/** The title line: „Signalkette, Typ SK-4 (Baujahr 1986)". */
export function titleLine({ name, type, year }: TypePlate): string {
  return `${name}, Typ ${type} (Baujahr ${year})`;
}

/** What an alarm costs, as Betrieb says it: „20 Sekunden Einsatzzeit". */
export function costOf(seconds: number): string {
  return `${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'} Einsatzzeit`;
}

const NUMBER_WORDS = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
] as const;

/** A count as running text sets it: in words from two to twelve, in digits otherwise. */
export function spelled(count: number): string {
  return count >= 2 && count <= 12 ? (NUMBER_WORDS[count] ?? String(count)) : String(count);
}

/** The drawing that heads Aufbau; the client draws it for the module type `of`. */
export function deviceFigure(of: string, device: string): ManualBlock {
  return { kind: 'figure', of, caption: `Abb. 1 — ${device}` };
}

const paragraph = (text: string): ManualBlock => ({ kind: 'p', text });

/**
 * The document as printed sections: the title line over the purpose, Aufbau
 * under the drawing, Betrieb, the machine's tables, the log excerpt closing
 * the last of them, and the workshop's notes at the end.
 */
export function labDocument(doc: LabDocument): ManualSection[] {
  const log: ManualBlock = { kind: 'example', title: LOG, lines: [...doc.log] };
  const sections: ManualSection[] = [
    { heading: titleLine(doc.plate), blocks: [paragraph(doc.purpose)] },
    {
      heading: BUILD,
      blocks: [deviceFigure(doc.figure.of, doc.figure.device), paragraph(doc.build)],
    },
    { heading: OPERATION, blocks: [paragraph(doc.operation)] },
    ...doc.law.map(({ heading, blocks }) => ({ heading, blocks: [...blocks] })),
  ];
  const last = sections.length - 1;
  return [
    ...sections.map((section, i) =>
      i === last ? { ...section, blocks: [...section.blocks, log] } : section,
    ),
    { heading: WORKSHOP, blocks: doc.workshop.map(paragraph) },
  ];
}
