# EscapeLab — Projektkonventionen

Kooperatives Multiplayer-Escape-Spiel (Studienprojekt, FH-Themengruppe Schefer-Wenzl/Miladinovic).

## Architektur-Invarianten (nicht aufweichen)

- `packages/core` bleibt pur: keine I/O, keine `Date.now()`/`Math.random()`-Aufrufe —
  Zeit kommt als `at`-Feld in Aktionen, Zufall (falls später nötig) als Seed im Zustand.
- Der Server ist autoritativ. Clients senden Intents, nie Zustand.
- Asymmetrische Information wird ausschließlich in `core/src/view.ts` (`viewFor`) durchgesetzt.
  Private Daten dürfen in keiner Server-Nachricht an die falsche Rolle auftauchen —
  Tests prüfen das über `JSON.stringify`-Negativ-Assertions.
- Missionen sind Daten (`missions/*.json`, zod-validiert). Ein neuer Rätseltyp ist ein Modul
  unter `core/src/puzzles/` plus Schema-Erweiterung der discriminated union in `mission.ts`.

## Sprache

Code, Kommentare, Commits: Englisch. Alle spielerseitigen Texte (UI, Fehlermeldungen aus
`GameError`, Missionsinhalte): Deutsch.

## Befehle

`pnpm dev` (Server 3001 + Client 5173), `pnpm test`, `pnpm typecheck`, `pnpm lint`
(zero warnings). Vor jedem Commit: alle drei grün.
