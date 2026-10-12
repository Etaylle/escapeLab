# EscapeLab — Projektkonventionen

Kooperatives Multiplayer-Escape-Spiel (Studienprojekt, FH-Themengruppe Schefer-Wenzl/Miladinovic).

## Architektur-Invarianten (nicht aufweichen)

- `packages/core` bleibt pur: keine I/O, keine `Date.now()`/`Math.random()`-Aufrufe —
  Zeit kommt als `at`-Feld in Aktionen, Zufall (falls später nötig) als Seed im Zustand.
- Der Server ist autoritativ. Clients senden Intents, nie Zustand.
- Was ein Spieler sieht, folgt aus seiner **Anwesenheit**, nicht aus seiner Rolle: Der Server
  leitet aus den Positionen ab, wer am Pult, an einem Lese-Objekt oder am Kennungsschild steht
  (`set-presence`, wie bei den Druckplatten), und nur `core/src/view.ts` (`viewFor`) und die
  `view()`-Funktion des jeweiligen Rätselmoduls setzen das in Sichten um. Die Instanz einer
  Station erreicht nur Spieler am Pult, die Laborkennung nur Spieler, die das Schild gesehen
  haben — Tests prüfen das über `JSON.stringify`-Negativ-Assertions. Rollen sind nur Name,
  Farbe und Startpunkt.
- Missionen sind Daten (`missions/*.json`, zod-validiert). Ein Rätseltyp ist ein Modul unter
  `core/src/puzzles/<typ>.ts` nach dem Vertrag in `core/src/puzzles/module.ts` (Schema, Zustand,
  Eingaben, Sicht nach Anwesenheit, gedrucktes Handbuch, `solve`) plus je ein Eintrag in
  `core/src/puzzles/index.ts` und `client/src/puzzles/index.ts` (Panel). Sonst ändert sich nichts:
  Reducer und Protokoll kennen nur `puzzle-input`.
- Das Handbuch eines Moduls (`manual()`) enthält Regeln, nie Antworten, und hängt weder vom Seed
  noch vom Zustand ab — es ist druckbar. Jedes Modul liefert `solve()` über die Sichten von Pult
  und Lese-Objekt; Eigenschaftstests beweisen damit, dass die Crew aus ihren Sichten jede
  Instanz lösen kann.

## Sprache

Code, Kommentare, Commits: Englisch. Alle spielerseitigen Texte (UI, Fehlermeldungen aus
`GameError`, Missionsinhalte): Deutsch.

## Befehle

`pnpm dev` (Server 3001 + Client 5173), `pnpm test`, `pnpm typecheck`, `pnpm lint`
(zero warnings). Vor jedem Commit: alle drei grün.
