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

### F-1 Fundament-Fehler der Rückmeldung — Status: bereit · Größe: M
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

### F-4 Harness beendet sich nach einem Fehler — Status: im PR (L-polish) · Größe: S
- Ein werfender Schritt lässt `watchSightings` laufen; `tools/shots.mjs` endet nie, CI hängt
  bis zum Timeout.

## Wartet auf das Fundament-Audit

### A-1 Bewegung und Kamera — Status: wartet
- Geschwindigkeit, Beschleunigung, Wandgleiten, Partnerfigur bei 12/15 Hz, sichtbare Kacheln
  je Bildschirmgröße; Zielwerte kommen aus dem Audit (Referenzen: Among Us, Overcooked, Valve).

### A-2 Minispiel-Darstellung — Status: wartet
- Panelgrößen, Affordanzen, Rückmeldezeiten je Station; Zweipult-Verständlichkeit ohne Text.

### A-3 Informationsfluss zu zweit — Status: wartet
- Wo das Spiel Reden erzwingt, wo einer wartet; Leerlauf im gepinnten Plan.

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
