# EscapeLab

Kooperatives Browser-Escape-Spiel: Jede Rolle sieht ein anderes Panel, gelöst wird nur gemeinsam
— per Stimme. Missionen sind reine Daten (`missions/*.json`) — neue Missionen brauchen keinen Code.

**Rätseltypen:** Kabel trennen (`wiring`), Symbol-Keypad (`keypad`), Schalterbank mit Prüf-Commit
(`switches`), Frequenz-Abgleich mit Farblegende (`simon`), unsichtbares Labyrinth (`maze`),
Synchron-Knöpfe (`button-sync`).
Layouts/Codes sind pro Partie zufällig (seeded, deterministisch replaybar), Fehler kosten
Countdown-Zeit. **Missionen:** Tutorial (2 Spieler), Blackout im Labor (2 Spieler, 5 Rätsel),
Kettenreaktion (3 Spieler, Wissen auf drei Rollen verteilt) und Doppelschicht (4 Spieler in
**zwei getrennten Flügeln**, die sich bis zum Finale nie erreichen können — jedes einzelne Rätsel
braucht Wissen aus beiden Hälften, und erst der Not-Aus entriegelt die Schleuse in der Mitte).

**Beitreten:** Auf der Startseite steht eine Liste aller **offenen Runden** mit Mission,
Schwierigkeit, wer schon wartet und wie viele Plätze frei sind — ein Klick auf *Beitreten*
genügt, niemand muss einen Code weitergeben. Laufende Runden erscheinen ebenfalls, dort führt
der Knopf zum Zuschauen. Ein Code-Feld bleibt für direkte Verabredungen.

**Ablauf einer Partie:** Lobby (Figur + Farbe wählen, Rolle wählen) → Briefing-Countdown →
Stationen in Reihenfolge finden und lösen → wenn alle gelöst sind, öffnet sich der **Notausgang**
und das ganze Team muss ihn gemeinsam erreichen, bevor die Zeit abläuft → Endbildschirm mit
Statistiken und persönlicher Bestzeit. **Hilfsmittel:** Klick auf die Welt setzt einen **Ping**
für alle (farbige Ringe, Pfeil wenn außerhalb des Bildes), `M` blendet die **Minikarte** ein,
`C` öffnet den **Schnellchat** (acht feste Sätze, Tasten `1`–`8`, erscheinen als Sprechblase
über der Figur) — damit funktioniert das Spiel auch ohne Voice-Chat.

**Tragen:** Manche Stationen bleiben tot, bis ein Gegenstand bei ihnen eingesetzt wurde — die
Ersatzsicherung liegt im Archiv und muss quer durchs Labor in den Reaktor. `E` ist dabei eine
einzige Kontexttaste (einsetzen → aufnehmen → Station aktivieren, in dieser Reihenfolge), `Q`
legt das Getragene ab, sodass Übergaben möglich sind.

**Schwierigkeit:** Der Host wählt in der Lobby zwischen *Entspannt*, *Normal* und *Hart* — das
skaliert Zeitbudget, alle Zeitstrafen, Drohnentempo und -reichweite sowie Häufigkeit und Dauer
der Notfälle. **Verbindungsabbruch:** Fehlt jemand aus der Crew, pausiert die Mission komplett
(Uhr, Patrouillen, Notfälle) und läuft nach der Rückkehr ohne Zeitverlust weiter.

**Gefahren unterwegs:** **Wachdrohnen** patrouillieren feste Routen und leuchten einen sichtbaren
Sichtkegel aus — wer hineinläuft, verliert Zeit (Sichtlinie zählt, an einer Station ist man
sicher). Dazu schlagen **Notfälle** zu: Mitten im Lauf fällt die Kühlung aus, das offene Rätsel
bricht ab, und alle Notventile müssen gleichzeitig besetzt werden — je ein Spieler pro Ventil, an
entgegengesetzten Enden der Karte.

**Spielwelt:** Alle Missionen spielen in einer gerenderten Top-Down-Laborwelt
(Canvas, Among-Us-Stil): flüssige Bewegung per WASD/Pfeiltasten, Kamera folgt, das Labor liegt
im Dunkeln und jede Figur trägt ein Licht. Bewegung ist client-autoritativ (lokale Simulation +
Positions-Streaming); der Server bleibt Autorität über Rätsel, Türen, Druckplatten (öffnen nur,
solange jemand draufsteht), Interaktionsdistanz und Timer. Rätsel sind leuchtende Stationen und
öffnen per `E` als Modal über der Welt. Missionen ohne `map`-Block (Tutorial) laufen im direkten
Rätsel-Flow. Welt-Code: `packages/client/src/world/` (GameWorld = Simulation/Rendering,
art = prozedurale Grafik, audio = prozedurale Sounds).

**Neue Missionen** sind reine JSON-Dateien in `missions/`. `packages/core/test/missionMaps.test.ts`
prüft jede davon automatisch: gleiche Zeilenlängen, alles auf Bodenfeldern, eine Station pro
Rätsel — und per Flutfüllung mit den echten Tür-Regeln, dass die Stationen in Reihenfolge
erreichbar sind und am Ende **alle** den Notausgang erreichen können.

## Struktur

| Paket | Zweck |
| --- | --- |
| `packages/core` | Spiellogik als pure State-Machine (`applyAction`), Missionsformat (zod), per-Rolle gefilterte Views, WebSocket-Protokoll. Keine I/O — vollständig deterministisch und testbar. |
| `packages/server` | Autoritativer Node-Server: Räume, Reconnect-Tokens, Missionstimer, WebSocket (`ws`). Clients schicken Intents; der Server validiert und broadcastet gefilterte Views. |
| `packages/client` | React + Vite UI: Join → Lobby → Spiel → Ende, Auto-Reconnect mit Session-Token. |

## Entwicklung

```sh
pnpm install
pnpm dev          # Server (Port 3001) + Vite-Client (Port 5173) parallel
```

Dann <http://localhost:5173> in zwei Browser-Tabs/Fenstern öffnen, Raum erstellen,
Code im zweiten Tab eingeben, Rollen wählen, starten.

```sh
pnpm test         # vitest (core: Spiellogik, server: Räume/Reconnect/Timer/Drohnen)
pnpm typecheck    # tsc --noEmit, strikt (noUncheckedIndexedAccess etc.)
pnpm lint         # eslint, zero warnings
pnpm --filter @escapelab/server smoke   # Ende-zu-Ende über echte WebSockets
```

**Zuschauen:** Wer den Raumcode eingibt und auf *Zuschauen* klickt, sieht das ganze Labor ohne
Dunkelheit, beide Figuren, die Drohnenkegel — **und die privaten Panele aller Rollen
nebeneinander**. Genau das macht das Zusehen unterhaltsam: Das Publikum sieht beide Hälften und
merkt vor den Spielenden, wo die Ansage schiefgeht. Zuschauer können nichts auslösen.

**Nach der Runde:** Der Endbildschirm zeigt ein Einsatzprotokoll (wann welche Station fiel, jeder
Alarm mit Grund und Kosten, Notfälle, eingesetzte Teile) sowie einen Rang von S bis C aus Alarmen
und Restzeit — plus die persönliche Bestzeit.

## Für den Demo Day (ein Prozess, eine URL)

```sh
pnpm build        # Client-Bundle nach packages/client/dist
pnpm start        # Server liefert Spiel + API + WebSocket auf einem Port
```

Beim Start schreibt der Server alle Netzwerk-Adressen in die Konsole
(`http://10.0.0.184:3001`) — unter dieser Adresse können Mitspielende im selben WLAN direkt
mit Laptop oder Handy beitreten, ohne irgendetwas zu installieren. Port über `PORT=8080`
änderbar.

## Architektur in einem Satz

`core` kennt weder Netzwerk noch Uhr (Zeit kommt als `at` in Aktionen) — der Server ist eine
dünne Schicht, die Aktionen mit Zeitstempeln versieht, und der Client rendert nur die View,
die der Server für seine Rolle gefiltert hat (private Infos anderer Rollen verlassen den
Server nie).

## Nächste Schritte (geplant)

- Playwright-E2E mit echten Browser-Kontexten (der WS-Smoke-Test deckt die Logik bereits ab:
  `pnpm --filter @escapelab/server smoke`)
- Produktions-Build (Server liefert statisches Client-Bundle aus) fürs Demo-Day-Deployment
- Missionseditor (Missionen sind bereits reine, zod-validierte JSON-Daten)
