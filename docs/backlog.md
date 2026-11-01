# Backlog — ein Level, ein Fundament

Ziel: „Blackout im Labor" wird das Fundament, auf dem alles Weitere steht. Kein neuer Umfang,
sondern jede Kleinigkeit richtig: Bewegung, Kamera, Reichweiten, Rückmeldungen, Minispiele,
Handbücher, Ton. Profi-Spiele sind der Maßstab (`docs/art-bible.md`, `docs/sound.md`,
`docs/gameplay.md` nennen Werte und Quellen).

Regeln für die Nachtschicht (`.github/workflows/nachtschicht.yml`): ein Punkt pro Nacht, der
oberste mit Status `bereit`; Status wechselt zu `im PR` mit Branchnamen, nach dem Merge zu
`erledigt` mit Commit. Punkte mit `nur lokal` brauchen den Mac (ElevenLabs-Schlüssel,
Playtest); Punkte mit `wartet` sind noch nicht entschieden. Uros sortiert; die Reihenfolge ist
die Entscheidung.

## Bereit

### F-1 Fundament-Fehler der Rückmeldung — Status: erledigt (N-foundation, Merge 2026-11-01) · Größe: M
- Pause hält die Uhr nur auf dem Server an: HUD-Countdown, Pieptöne und der Schlag bei 0
  laufen weiter, verbrauchte Pieptöne fehlen danach (`screens/Game.tsx`, `world/sim.ts`,
  `core/src/actions.ts` pause/resume).
- Das Fehlerbanner (`.banner.error`, z 40) liegt unter jedem offenen Pult (z 55) und wird von
  jeder gesendeten Nachricht gelöscht, beim Gehen alle 80 ms (`ws.ts`, `stream.ts`): Abweisungen
  müssen sichtbar bleiben, bis der Spieler sie gelesen hat, auch über dem Pult.
- Das Zirpen bei E (`GameWorld.tsx`) bestätigt vor der Serverantwort, auch bei „Gesperrt …";
  derselbe Ton markiert das Ende eines Notfalls. Bestätigung erst mit der Antwort; eigener Ton
  für Notfall-Ende, keiner für einen verpassten.
- Gegen die Wand laufen klingt und sieht aus wie Laufen (`sim.ts` Schrittzähler ohne Bewegung).
- Senden auf einem noch verbindenden Socket wirft (`ws.ts`): Eingaben während des
  Wiederverbindens puffern oder verwerfen, nie werfen.
- Reichweiten Server/Client angleichen (`srv/room.ts` 1,6/2,0 gegen `interact.ts` 1,5; Items
  0,95 gegen 0,9) und E mit der aktuellen Position senden, damit „Zu weit weg" nicht entsteht,
  wenn der Prompt stand.
- Beweis: je ein Test, der ohne den Fix rot ist; Smoke; Walkthrough beider Missionen 0 Fehler.

### F-2 Handbuch- und Gerätetexte — Status: bereit · Größe: M
- Tabellen nie über einen Seitenwechsel brechen, wenn sie ganz auf die nächste Seite passen
  (`client/src/pages.ts`); die Morsetafel im Aktenschrank (13 Zeilen) steht auf einer Seite.
- Zeichnung und zugehörige Tabelle bleiben zusammen.
- „Textgröße" (0,9/1/1,15) gilt für Buchseiten ohne Scrollen (Seitenschätzung in `pages.ts`
  kennt die Skala) und für Gerätetexte; Canvas-Texte (Prompt, Raumnamen, Untertitel) folgen ihr.
- Beweis: Seitentest mit der echten Morsetafel; Captures des Aktenschranks bei allen drei
  Größen und 1280×720 ohne Scrollen.

### F-3 Kleinigkeiten der ersten Minute — Status: bereit · Größe: S
- Hebel-Partnernamen nach Person, nicht nach Anzahl (`LeverPanel.tsx`); bei drei Spielern sagt
  der Funk „zwei Leute", das Schild „NUR ZU DRITT": Funktext aus der Crewgröße bilden.
- Die Bestätigung „Laborkennung notiert" drängt sich am Archiv-Spawn vor den ersten Funkspruch
  (3,5 s später): Funk zuerst, Toast danach oder leiser.
- Tutorial-Story nennt feste Tasten („WASD … E … M"): aus der Tastenbelegung bilden.
- Beweis: Tests; Walkthrough.

### F-4 Harness beendet sich nach einem Fehler — Status: erledigt (L-polish 10bcce8) · Größe: S
- Ein werfender Schritt lässt `watchSightings` laufen; `tools/shots.mjs` endet nie, CI hängt
  bis zum Timeout.

## Aus dem Fundament-Audit (`docs/foundation-audit.md`, 2026-11-01)

### N-1 Netz und Körper — Status: erledigt (N-foundation, Merge 2026-11-01; Vorher/Nachher im Audit-Addendum) · Größe: L
- Positionen tragen keinen Zeitstempel; die Partnerfigur ruckelt (Schritt 0–7,2 px je Frame,
  153 ms hinterher). Zeitstempel in `pos`, Partner 150 ms in der Vergangenheit zeichnen
  (Valve/Fiedler), Variation von 0,44 auf ≤ 0,25.
- Plattentür, die sich auf einen Gehenden schließt, friert ihn ein (4 von 4 im LAN): die
  Start-Kachel-Regel des Servers in die Client-Kollision.
- Ein-Kachel-Öffnungen fangen den Körper (nur ±0,22 Kacheln passen): Ecken-Nudge bis 0,3
  Kacheln (Celeste: 4 px).
- Uhren folgen jedem Gerät statt dem Server (5 s Versatz; in der Pause zählt die Partneruhr
  weiter und springt zurück): Server-Zeitversatz schätzen, Uhr steht mit dem Lauf.
- Beweis: Messskripte des Audits wiederholen (`scratchpad`-Pfade stehen im Audit); Walkthrough.

### N-2 Kamera — Status: wartet (Entscheidung Uros) · Größe: M
- Der Bildausschnitt hängt von der Pixeldichte ab: 1440×820 zeigt 22×10,5 Kacheln bei Dichte 1,
  die ganze 27er-Breite bei Dichte 2 (MacBook). Vorschlag: Rahmen in CSS-Pixeln festlegen
  (11–12 Kacheln hoch auf jedem Bildschirm, mindestens doppelte Drohnenreichweite quer), Harness
  auch bei Dichte 2. Offene Frage: fester Radius um den Spieler (Among Us) oder Überblick
  (Overcooked)?

### N-3 Stimme am Pult — Status: wartet (Entscheidung Uros) · Größe: S
- Die Sprachlautstärke fällt zwischen den Pulten der Signalkette auf 5 % (−25,6 dB), genau wo
  geredet werden muss. Vorschlag: zwischen den Pulten und der Quelle der aktiven Station volle
  Lautstärke per Funk, überall sonst Abstand.

### N-4 Erster Sieg — Status: wartet (Entscheidung Uros) · Größe: S
- Menschen brauchten 70–164 s für den Hebel oder schafften ihn nie (Skript: 25 s); 0 von 7
  menschlichen Läufen gewonnen. Vorschlag: Fenster 3–4 s plus gemeinsamer Countdown wie in
  Portal 2 („beide sehen GO im selben Moment"), für Hebel und Reaktor.

### N-5 Lesbarkeit — Status: bereit · Größe: M
- Gerätetexte Median 11–13 px (min 8), Tasten unter 44 px, Rack scrollt bei 1280×720, auf dem
  Handy scrollt jedes Gerät; Ziel: Fließtext ≥ 14 px, Anzeigen ≥ 18 px, Ziele ≥ 44 px, eine
  Station je Buchaufschlag mit ganzen Tabellen (enthält F-2); Canvas-Beschriftungen folgen der
  Textgröße; Raumname über hellem Boden bekommt eine Platte (FLUR 1,3:1).
- Touch: 8-Wege-Pad ≥ 48 px unter dem linken Daumen, Aktionen rechts.

### N-6 Pacing und Stationsfolge — Status: wartet (Daten) · Größe: ?
- Erst nach N-4 und dem zweiten Playtest messen (`runs.jsonl`): Ziel, dass eine Erstspieler-
  Crew Station 2 in 5 Minuten schafft. Offene Fragen aus dem Audit: Zeitlimit beim ersten Lauf,
  Notstrom als zweite Station, dritter Spawn, Größe der Schleife.

## Nur lokal

### L-1 Zwölf Aufnahmen rendern — Status: nur lokal
- `packages/client/test/sampleManifest.test.ts` `AWAITING_RENDER`: step-lino/steel 1–3,
  alarm-sting, door-close 1–2, drone-pass, hatch-open-done, ui-tick; danach die Liste leeren.
- Eigener Ton für die Drohnenwarnung statt des Ping-Tons (`world/danger.ts`).

### L-2 Zweiter Playtest — Status: nur lokal
- Dieselbe Person wie beim ersten; Telemetrie `packages/server/data/runs.jsonl` auswerten
  (`pnpm --filter @escapelab/server runs`).

## Erledigt (zuletzt)
- Eröffnung mit Durchsage und Titel, Geräusche und Musik aus ElevenLabs, Pro-Mix mit Bussen,
  Figuren/Licht/Partikel, Controller und Tastenbelegung, Erfolge, Tagesschicht, Netzplan,
  Flucht-Spielraum (L-polish) — siehe `git log` bis 2026-11-01.
