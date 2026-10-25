import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, type Mission } from '../src/index.js';
import { ADDRESS, offVoice, WORLD } from './voice.js';

/**
 * What a mission says outside its papers and its radio, in the lab's voice: the story the
 * lobby, the info panel and the end screen tell — written as the lab's own record, never to
 * the crew — the names on the map and on the stations, the notes pinned to its walls and the
 * plate an emergency puts up. The catalog's title and subtitle are the interface's: plain,
 * and nobody addressed. The strings in the code are the source scan's
 * (client/test/worldVoice.test.ts); the manuals' and the margins' rules are manuals.test.ts's,
 * the radio's radioLines.test.ts's.
 */

describe('the world-voice guard', () => {
  it('finds a text that addresses, names, stages or orders a player, and prints it', () => {
    const lines = [
      'Du startest im ARCHIV.',
      'Lest eure Anweisung laut vor.',
      'Die ganze Crew an die Station.',
      'Notizen der letzten Crew zu §3.',
      'Partner, die Platte halten.',
      'Der andere liest die Folge.',
      'Wer es gelesen hat, sagt sie an.',
      'Tippe oder tippe an: start, restart.',
      'Der Station fehlt noch: SICHERUNG. Bringt es her!',
      'Jede Person an ein eigenes Ventil.',
    ];
    expect(offVoice(lines, WORLD)).toEqual([
      'spricht mit du an: „Du startest im ARCHIV."',
      'spricht mit ihr an: „Lest eure Anweisung laut vor."',
      'befiehlt: „Lest eure Anweisung laut vor."',
      'nennt einen Spieler: „Die ganze Crew an die Station."',
      'nennt einen Spieler: „Notizen der letzten Crew zu §3."',
      'spricht einen Partner an: „Partner, die Platte halten."',
      'nennt den anderen: „Der andere liest die Folge."',
      'gibt eine Regieanweisung: „Wer es gelesen hat, sagt sie an."',
      'befiehlt: „Tippe oder tippe an: start, restart."',
      'befiehlt: „Bringt es her!"',
      'nennt einen Spieler: „Jede Person an ein eigenes Ventil."',
    ]);
  });

  it('lets a machine say what it takes and where nobody stands, as a plate would', () => {
    const plates = [
      'Am Rack steht niemand.',
      'Nur mit Partner am Prüfpult.',
      'Nummer wählen, Wert ablesen.',
      'Zeichen von links nach rechts ansagen.',
      'Dieses Pult sendet — das andere gibt ein.',
      'Die Tür bleibt nur offen, solange jemand auf der Platte steht.',
      'ALARM — Fehlversuch! −20 Sekunden',
      'Die Tür geht auf, sobald die Station läuft.',
    ];
    expect(offVoice(plates, WORLD)).toEqual([]);
  });

  it('reads the code’s English as English: „lies", „such", „dir" order nobody there', () => {
    const english = [
      'the note at 3,4 lies where nobody can read it',
      'no such room',
      'missions dir is empty',
    ];
    expect(offVoice(english, WORLD)).toEqual([]);
    expect(offVoice(['Lies die Folge vor.', 'Das Pult gehört dir.'], WORLD)).toEqual([
      'befiehlt: „Lies die Folge vor."',
      'spricht mit du an: „Das Pult gehört dir."',
    ]);
  });

  it('holds the interface only to speaking to nobody', () => {
    expect(offVoice(['Crew mithören', 'Noch 2 Personen nötig'], ADDRESS)).toEqual([]);
    expect(offVoice(['Trag oben deinen Namen ein.'], ADDRESS)).toEqual([
      'spricht mit du an: „Trag oben deinen Namen ein."',
    ]);
  });
});

/** Every text of `mission` in the lab's voice, outside its papers and its radio. */
function worldTextsOf(mission: Mission): string[] {
  const { map, story } = mission;
  return [
    story.intro,
    story.win,
    story.lose,
    ...mission.puzzles.map((puzzle) => puzzle.title),
    ...map.labels.map((label) => label.text),
    ...map.plates.map((plate) => plate.label),
    ...map.manuals.map((source) => source.label),
    ...map.items.map((item) => item.label),
    ...map.notes.map((note) => note.text),
    ...(map.sabotage === undefined ? [] : [map.sabotage.label, map.sabotage.hint]),
  ].filter((text) => text !== '');
}

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

const byId = missions.map((m) => [m.id, m] as const);

describe.each(byId)('the texts of mission %s', (_id, mission) => {
  it('tell the story, name the places and pin up the notes in the lab’s voice', () => {
    expect(offVoice(worldTextsOf(mission), WORLD)).toEqual([]);
  });

  it('keep the catalog’s title and subtitle plain, nobody addressed', () => {
    expect(offVoice([mission.title, mission.subtitle], ADDRESS)).toEqual([]);
  });
});
