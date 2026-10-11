# EscapeLab

Kooperatives Browser-Escape-Spiel: Jede Rolle sieht ein anderes Panel, gelöst wird nur gemeinsam
— per Stimme. Missionen sind reine Daten (`missions/*.json`) — neue Missionen brauchen keinen Code.

**Rätseltypen:** Kabel trennen (`wiring`), Symbol-Keypad (`keypad`), Schalterbank mit Prüf-Commit
(`switches`), Frequenz-Abgleich mit Farblegende (`simon`), Synchron-Knöpfe (`button-sync`).
Layouts/Codes sind pro Partie zufällig (seeded, deterministisch replaybar), Fehler kosten
Countdown-Zeit. **Missionen:** Blackout im Labor (2 Spieler, 5 Rätsel), Tutorial (2 Spieler),
Kettenreaktion (3 Spieler, Wissen auf drei Rollen verteilt).

**Ablauf einer Partie:** Lobby (Figur + Farbe wählen, Rolle wählen) → Briefing-Countdown →
Stationen in Reihenfolge finden und lösen → wenn alle gelöst sind, öffnet sich der **Notausgang**
und das ganze Team muss ihn gemeinsam erreichen, bevor die Zeit abläuft → Endbildschirm mit
Statistiken und persönlicher Bestzeit. **Hilfsmittel:** Klick auf die Welt setzt einen **Ping**
für alle (farbige Ringe, Pfeil wenn außerhalb des Bildes), `M` blendet die **Minikarte** ein.

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
pnpm test         # vitest (core: Spiellogik, server: Räume/Reconnect/Timer)
pnpm typecheck    # tsc --noEmit, strikt (noUncheckedIndexedAccess etc.)
pnpm lint         # eslint, zero warnings
```

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
