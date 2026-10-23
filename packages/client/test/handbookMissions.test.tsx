import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { moduleFor, parseMission } from '@escapelab/core';
import type { ManualHere, ManualSection, Mission, MissionManual } from '@escapelab/core';
import { paginate } from '../src/pages.js';
import { Book, stationTitle } from '../src/screens/Book.js';
import { Handbook } from '../src/screens/Handbook.js';

/**
 * Every shipped mission's printed pages, as the lab's documents: the
 * printable booklet renders a chapter for every station with its whole
 * document, and every source in the lab lays the stations it covers out as
 * a book with no page left empty — so a text that breaks the layout, or a
 * station that prints nothing, shows here before it shows in play.
 */

const MISSIONS = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(MISSIONS)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => parseMission(JSON.parse(readFileSync(new URL(file, MISSIONS), 'utf8'))));

type Source = Mission['map']['manuals'][number];

const noop = (): void => undefined;

/** A station's document, as its module prints it from the mission's def. */
const documentOf = (def: Mission['puzzles'][number]): ManualSection[] =>
  moduleFor(def.type).manual(def);

/** The booklet as the server hands it out for a mission (server/src/missions.ts). */
function bookletOf(mission: Mission): MissionManual {
  return {
    missionTitle: mission.title,
    hintCostSec: mission.hintCostSec,
    stations: mission.puzzles.map((def, index) => ({
      index,
      title: def.title,
      readAt: [
        ...new Set(
          mission.map.manuals.filter((m) => m.puzzleIds.includes(def.id)).map((m) => m.label),
        ),
      ],
      usesEdgework: moduleFor(def.type).usesEdgework,
      manual: documentOf(def),
    })),
  };
}

/** What a reader at `source` gets: the stations it covers, in mission order, no notes asked. */
function sourceOf(mission: Mission, source: Source): ManualHere {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    sections: mission.puzzles.flatMap((def, index) =>
      source.puzzleIds.includes(def.id)
        ? [
            {
              puzzleId: def.id,
              index,
              title: def.title,
              manual: documentOf(def),
              notes: [],
              noteReadyAt: null,
              notesLeft: 0,
              costSec: mission.hintCostSec,
            },
          ]
        : [],
    ),
  };
}

/** Every heading and paragraph a document prints: what a reader has to find on the page. */
const runningParts = (manual: readonly ManualSection[]): string[] =>
  manual.flatMap(({ heading, blocks }) => [
    heading,
    ...blocks.flatMap((block) => (block.kind === 'p' ? [block.text] : [])),
  ]);

describe.each(missions.map((mission) => [mission.id, mission] as const))(
  'the papers of %s',
  (_id, mission) => {
    it('print a chapter for every station, each with its whole document', () => {
      const booklet = bookletOf(mission);
      const html = renderToStaticMarkup(<Handbook manual={booklet} />);
      expect(booklet.stations).toHaveLength(mission.puzzles.length);
      for (const station of booklet.stations) {
        const missing = runningParts(station.manual).filter((part) => !html.includes(part));
        expect(missing, station.title).toEqual([]);
      }
    });

    it.each(mission.map.manuals.map((source) => [source.label, source] as const))(
      'lay %s out as a book with no page left empty',
      (_label, source) => {
        const here = sourceOf(mission, source);
        expect(here.sections.length).toBeGreaterThan(0);
        const pages = paginate(
          here.sections.map((section) => ({
            title: stationTitle(section),
            manual: section.manual,
            reader: false,
          })),
        );
        const [cover, ...rest] = pages;
        expect(cover?.section).toBeNull();
        expect(rest.filter((page) => page.fragments.length === 0)).toEqual([]);
        here.sections.forEach((section, i) => {
          const own = rest.filter((page) => page.section === i);
          expect(own.length, section.title).toBeGreaterThan(0);
          // A station's first page opens on its title and the title line of its document.
          expect(own[0]?.fragments.slice(0, 2)).toEqual([
            { kind: 'title', text: stationTitle(section) },
            { kind: 'heading', text: section.manual[0]?.heading },
          ]);
        });
      },
    );

    it.each(mission.map.manuals.map((source) => [source.label, source] as const))(
      'open %s at each of its stations, the document on the page',
      (_label, source) => {
        const here = sourceOf(mission, source);
        for (const section of here.sections) {
          const html = renderToStaticMarkup(
            <Book
              manual={here}
              puzzle={null}
              current={section.index}
              spread
              binding="bound"
              imprint={{ mission: mission.title, room: null }}
              onAskNote={noop}
            />,
          );
          expect(html, section.title).toContain(section.manual[0]?.heading ?? '—');
        }
      },
    );
  },
);
