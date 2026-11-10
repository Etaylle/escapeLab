# EscapeLab: technischer Projektüberblick

Stand: Commit 9a536a7 vom 2026-11-07; 461 Commits an 17 Tagen seit 2026-10-11, davon 73 Merges.

## 1. Was EscapeLab ist

EscapeLab ist ein kooperatives Browser-Escape-Spiel: Zwei bis drei Personen an getrennten Geräten befreien sich gegen einen Countdown aus einem verdunkelten Labor.

- Stationen haben bis zu zwei Pulte an verschiedenen Orten, jedes zeigt nur seinen Teil der Maschine. Die Regeln liegen anderswo, im Handbuch, Spind oder Aktenschrank.
- Eine Eingabe zählt nur, solange eine zweite Person am anderen Pult oder an einer Regelquelle steht. Abgesprochen wird per Sprachchat.
- Fehler kosten Zeit. Gewonnen ist, wenn alle Stationen gelöst sind und die ganze Crew den Notausgang erreicht.
- Referenz ist „Blackout im Labor“: 2 bis 3 Spielende, 900 s auf Normal, 36×22 Felder, sechs Stationen (Notlicht-Hebel, Notstrom, Signalkette, Serverraum, Funk, Reaktorstart).

Quellen: README.md, docs/srs.md, missions/*.json.

## 2. Architektur und Stack

pnpm-Monorepo, striktes TypeScript, drei Pakete:

- **core:** reine Zustandsmaschine (`applyAction`), Missionen als zod-validiertes JSON mit Lösbarkeitsbeweis, 12 Rätselmodule.
- **server:** autoritativer Node-Server (`ws`) mit Räumen, Timer, Drohnen und einer Sicht je Spieler.
- **client:** React 19, Vite 7; Welt in Canvas 2D, Lichtebene in WebGL2 mit Canvas-Fallback, Web-Audio-Mix, Sprache per WebRTC von Browser zu Browser.

Invarianten aus CLAUDE.md:

1. `core` bleibt pur: Zeit kommt als Feld `at` in der Aktion, Zufall als Seed im Zustand.
2. Der Server entscheidet, Clients senden nur Absichten.
3. Sichten folgen der Anwesenheit am Pult oder an der Quelle, nicht einer Rolle; Tests prüfen per Negativ-Assertion, dass nichts Fremdes mitgeht.
4. Niemand bedient allein; die Validierung beweist, dass zwei Verschiedene zugleich dort stehen können.
5. Rätseltypen sind Module mit Vertrag; Handbücher enthalten Regeln, nie Antworten, und jedes Modul liefert `solve()`, mit dem Eigenschaftstests die Lösbarkeit beweisen.

Quellen: CLAUDE.md, README.md, package.json-Dateien, packages/core/src/puzzles/index.ts.

## 3. Wie entwickelt wurde

- Ein orchestrierendes Modell schreibt je Paket eine Spec mit Beweis-Zeile; Opus-Agenten bauen sie in eigenen git-Worktrees.
- Abnahme: Tests, Typecheck, Lint ohne Warnungen, Smoke-Test über echte WebSockets, Pixelvergleiche zwischen Basis und Branch.
- Der Playwright-Rundgang `tools/shots.mjs` spielt beide Missionen mit zwei Spielenden und einem Zuschauer bis zum Sieg, speichert Screenshots und prüft Frame-Fenster (Bildzeiten je Spielabschnitt, 95. Perzentil) gegen ein Budget. GitHub Actions wiederholt Tests und Rundgang für jeden Pull Request.
- Audit-Pakete lesen und messen nur; ihre Befunde werden Backlog-Punkte. Anforderungen stehen nach MoSCoW in `docs/srs.md`.
- `nachtschicht.yml` ist ein vorbereiteter Automatismus: Werktags um 02:00 UTC soll Claude Code den obersten Punkt mit Status `bereit` bauen und einen Pull Request öffnen. Im Git-Verlauf ist kein Lauf zu sehen.

Quellen: docs/backlog.md, docs/foundation-audit.md, docs/srs.md, .github/workflows/*.yml.

## 4. Was gebaut wurde

1. **Walking Skeleton, 11.10.:** Welt, Rätsel, Missionen; am selben Tag Drohnen, Notfälle, Lobby-Liste, Zuschauer.
2. **Rätselplattform, 12.–14.10.:** Rätsel als Module mit Vertrag, druckbares Handbuch, Sichten nach Anwesenheit, Stationen mit zwei Pulten.
3. **Tutorial und Blackout-Inhalte, 11.–14.10.:** Lehrkarte, verstreute Regelquellen, Missionen auf Regelmodule umgebaut.
4. **Kaltstart, Finale, Gerätegefühl, 20.–21.10.:** Blackout beginnt mit Strom und einem Zwei-Hand-Hebel; Fluchtfinale; Geräte mit Gewicht und Ton.
5. **Art-Bible, WebGL, Sound, Figuren, 21.–22.10.:** Renderpässe, WebGL-Lichtebene, Raumklänge, animierte Figuren.
6. **Serverraum, große Karte, 22.–23.10.:** Terminal-und-Rack-Minispiel, Blackout als 27×17-Ring, Handbücher als Dokumente aus der Welt.
7. **Stimme, Eröffnung, 24.–26.10.:** Leitstellen-Funk (erst Piper, dann ElevenLabs), Effekt- und Musikkatalog, gefilmte Eröffnung.
8. **Pro-Pakete, 31.10.–1.11.:** Sound-Mix mit Bussen, Grafik, Controller, Erfolge, Tagesschicht, Netzplan.
9. **Fundament-Audit und Fixes, 1.–7.11.:** Zehn Befunde, daraus Pakete zu Netz und Uhr, Entdeckung, Lesbarkeit, Terminal und Notizen, Kamera, Funk am Pult, erstem Sieg, Karte 36×22, Handy, Grafik 2.

Quellen: docs/backlog.md, README.md, git log.

## 5. Messbare Ergebnisse

Audit-Zeilen: gleiche Skripte, Basis im selben Zeitraum daneben gemessen.

| Messgröße | Vorher | Nachher |
|---|---|---|
| Partnerfigur, Schrittvarianz | 0,435 | 0,271 (Ziel 0,25 verfehlt) |
| Plattentür schließt auf Gehende, LAN, 8 Versuche | 8 eingefroren | 0 |
| E beim Eintreffen am Pult, 200 ms Umlaufzeit, 8 Versuche | 4 | 8 |
| Sichtbreite bei 1440×820, Dichte 1 und 2 (Kacheln) | 22,2 und 27 | 24,3 und 24,3 |
| Kamerareise von Wand zu Wand, 1440×820 (Kacheln) | 2,7 | 11,7 |
| Kleinste Schrift: Gerät, HUD, Buch am Handy quer | 8, 9, 4,6 px | 11,1, 12, 14 px |
| Stimme zwischen den Pulten der Signalkette | −25,6 dB | 0 dB |
| Flucht-Frame p95, 4× gebremst | 33,4 ms | 16,8 ms, nach Grafik 2 33,2 ms |
| Tests core, server, client, tools (1.11., 5.11.) | 1392, 250, 2714, 77 | 1532, 268, 2867, 87 |
| Rundgang-Captures Blackout, Systemcheck, 0 fehlgeschlagen (1.11., 7.11.) | 99, 76 | 140, 89 |

Frame-Fenster-Budget: p95 höchstens max(40 ms, 2 × ruhiges Fenster desselben Laufs). Gemessen wurden 16,7 bis 16,8 ms, offene Panels unter Software-GL 33,4 ms. Jede Grafikwirkung höchstens 0,5 ms je Frame (Canvas-Pfad, 4× gebremst).

Quellen: docs/foundation-audit.md (Nachträge), docs/backlog.md, docs/art-bible.md (Cost).

## 6. Offene Punkte und nächster Schritt

Backlog: 20 von 24 Punkten erledigt.

- **Zweiter Playtest** (nur lokal): Auswertung von `runs.jsonl`. Von 7 protokollierten Läufen mit Menschen (20.–26.10., vor den Fixes) wurde keiner gewonnen; das 3,5-s-Fenster mit Countdown ist gebaut, seine Wirkung ungemessen.
- **Zeitbudget** (wartet auf Daten): Die Skript-Crew gewinnt 462 bis 502 s nach dem Blackout und lässt 40 bis 43 % der 900 s übrig. Vorschlag: 1000 s; Ziel: Erstspieler schaffen Station 2 in 5 Minuten.
- **Leerlauf zu zweit** (wartet auf Entscheidung): Im Audit wartet eine Figur 7,7 s am Reaktor; Optionen: die nächste Quelle vorab lesen oder eine Nebenaufgabe.
- **Nächster Schritt:** zweiter Playtest, danach beide Entscheidungen.

Quellen: docs/backlog.md, docs/foundation-audit.md.
