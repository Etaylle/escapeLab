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

### F-2 Handbuch- und Gerätetexte — Status: erledigt (N-readability, Merge 2026-11-02) · Größe: M
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

### N-2 Kamera — Status: erledigt (N-camera, Merge 2026-11-04) · Größe: M
- Der Bildausschnitt hängt von der Pixeldichte ab: 1440×820 zeigt 22×10,5 Kacheln bei Dichte 1,
  die ganze 27er-Breite bei Dichte 2 (MacBook). Vorschlag: Rahmen in CSS-Pixeln festlegen
  (11–12 Kacheln hoch auf jedem Bildschirm, mindestens doppelte Drohnenreichweite quer), Harness
  auch bei Dichte 2. Offene Frage: fester Radius um den Spieler (Among Us) oder Überblick
  (Overcooked)?
- Umgesetzt: Rahmen in CSS-Pixeln (`world/viewport.ts` `tileCss`), 11,5 Kacheln hoch ab 600 px
  Canvas-Höhe, darunter 9, je Kachel 28–96 px; das Band unter der Zielleiste hält zwei
  Drohnenreichweiten (Touch 1,5), sonst gewinnt das Band. 1440×820 zeigt bei Dichte 1 und 2
  dieselben 24,3×11,5 Kacheln, 1280×720 25,7×11,6, das Handy quer 25,7×9. Harness auch bei
  Dichte 2 (`camera-*.png`, `*-dpr2.png`); Tabelle in `docs/art-bible.md` (Framing),
  Vorher/Nachher im Audit-Addendum.

### N-3 Stimme am Pult — Status: erledigt (N-intercom, Merge 2026-11-04; Signalkette A↔B −25,6 → 0 dB) · Größe: S
- Die Sprachlautstärke fällt zwischen den Pulten der Signalkette auf 5 % (−25,6 dB), genau wo
  geredet werden muss. Vorschlag: zwischen den Pulten und der Quelle der aktiven Station volle
  Lautstärke per Funk, überall sonst Abstand.

### N-4 Erster Sieg — Status: erledigt (N-firstwin, Merge 2026-11-04; Fenster 3,5 s, Countdown aus Server-Zeit, Crew-Tag „zieht/drückt") · Größe: S
- Menschen brauchten 70–164 s für den Hebel oder schafften ihn nie (Skript: 25 s); 0 von 7
  menschlichen Läufen gewonnen. Vorschlag: Fenster 3–4 s plus gemeinsamer Countdown wie in
  Portal 2 („beide sehen GO im selben Moment"), für Hebel und Reaktor.
- Umgesetzt: Fenster 3,5 s an Blackouts Hebel und Reaktor und am Hebel des Tutorials; ab dem
  ersten Zug zeigt jede Seite an der Station dieselbe Zählung nach Server-Zeit („Anna hat
  gezogen — 2", Ziffern 3 · 2 · 1 · 0, ein Tick je Sekunde), weg beim Verfall oder Sieg; der
  Crew-Streifen sagt „zieht" / „drückt", solange ein Zug wartet. Regeln in `docs/gameplay.md`.

### N-5 Lesbarkeit — Status: erledigt (N-readability, Merge 2026-11-02; Vorher/Nachher im Audit-Addendum) · Größe: M
- Gerätetexte Median 11–13 px (min 8), Tasten unter 44 px, Rack scrollt bei 1280×720, auf dem
  Handy scrollt jedes Gerät; Ziel: Fließtext ≥ 14 px, Anzeigen ≥ 18 px, Ziele ≥ 44 px, eine
  Station je Buchaufschlag mit ganzen Tabellen (enthält F-2); Canvas-Beschriftungen folgen der
  Textgröße; Raumname über hellem Boden bekommt eine Platte (FLUR 1,3:1).
- Touch: 8-Wege-Pad ≥ 48 px unter dem linken Daumen, Aktionen rechts.

### T-1 Terminal und Notizen — Status: erledigt (N-notes, Merge 2026-11-01) · Größe: M
- Prompt fokussiert beim Öffnen und nach jedem Befehl, jede Taste tippt, Tab vervollständigt,
  Fehler am Prompt; Funk am Terminal per Maus/Touch/Pad. Aufnahmeformat je Quelle (Legende,
  Dienste, Kennung, Morse, Frequenzen, Regeln) ≤ 12 Zeilen mit Herkunft; Notizblock in
  Handschrift auf liniertem Papier (OFL-Schrift lokal), Lesbarkeit ≥ 15 px, Kontrast ≥ 4,5:1.
- Umgesetzt: Prompt hält die Tastatur (`puzzles/prompt.ts`), FUNK-Taste am Terminal, L1 spricht
  direkt; Aufnahmen mit Kopfzeile „Quelle · Teil" (`noting.ts`), Notizblock getrennt in Schrift
  und Aufnahmen, „aktualisiert" beim zweiten Mal; „Notieren" auch am Zettel der letzten Schicht
  und an angehefteten Notizen; Kalam (OFL) in `public/fonts`. Regeln in `docs/gameplay.md`,
  Aussehen in `docs/art-bible.md`.

### T-2 Jedes Pult sagt, wozu die Maschine da ist — Status: erledigt (N-small, Merge 2026-11-04) · Größe: S
- Audit: beide Hälften einer Station sehen aus wie Geräte, keine sagt die Aufgabe. Ein
  Typenschild-Satz je Pult in Weltsprache (was die Maschine tut, nicht was der Spieler tun
  soll), z. B. Prüfpult „misst die Spannung des gewählten Kabels"; kein Hinweis auf die Lösung.
- Beweis: Texte durch die Handbuch-Stimmen-Tests; Capture je Pult.

### T-3 Schnellchat trägt Stationsdaten — Status: erledigt (N-small, Merge 2026-11-04; Blackout ohne „Bei mir ist fertig", 8 Plätze) · Größe: S
- Heute acht feste Phrasen ohne Daten; „Alle an die Ventile!" nennt Ventile, die Blackout nicht
  hat. Phrasen je Mission aus `mission.json`, davon zwei mit Platzhalter (Zahl/Farbe/Dienst),
  per Steuerkreuz/Taste wählbar. Beweis: Tests, Capture des Chat-Rads in Blackout.

### T-6 Entdeckung ist eine Handlung — Status: erledigt (N-discovery, Merge 2026-11-04); Lampenkegel nachgeschärft im PR (N-fix1) · Größe: M
- Uros: „Nach den ersten Bewegungen im Raum ist schon alles aufgedeckt, der Sound klingelt paar
  Mal." Heute: 3,5 Kacheln + Sichtlinie. Neu: 2 Kacheln oder im Lampenkegel (600 ms, 3 Kacheln)
  mit Sichtlinie, ein Pult erst, wenn seine Station dran ist; Unentdecktes im Dunkeln nur, solange
  es in Sichtlinie liegt, und dann ohne Beschriftung, Regeln oder Schlüssel — bei Strom (Intro,
  Ausgang) steht das ganze Labor da wie bisher; das Schild leuchtet erst, wenn die Crew es
  gefunden hat; Hinweistext für Pult und Quelle der aktiven Station, Notiz, Teil, Schild, das
  Glöckchen dazu ≤ 1 je 1,5 s; nie zweimal je Objekt; Deko nie.
- Beweis: Captures beim Betreten des Archivs, Glöckchen-Zählung über die Audio-Probe.
- Nachgeschärft (N-fix1): Uros nach dem Spielen: „nach wenigen Schritten großer Radius". Der
  Kegel fand bis 7,5 Kacheln nach 250 ms und fegte einen 7 × 5-Raum in wenigen Schritten leer;
  jetzt findet die Lampe nur, worauf man sie aus der Nähe hält. Der Lichtkegel leuchtet weiter
  7,5 Kacheln weit, Fernes darin bleibt ohne Namen.

### T-7 Anwesenheit an Stationen nur ohne Wand — Status: erledigt (N-small, Merge 2026-11-04) · Größe: S
- Seit N-discovery zählen Quellen, Notizen und Schild nur Finder; an Stationen zählt Anwesenheit
  weiterhin nach Abstand allein (1,6 Kacheln, Wände ignoriert). Angleichen: Anwesenheit am Pult
  nur mit Sichtlinie oder nach eigenem Fund; Test wie der Säulen-Test der Quellen.

### H-1 Flucht-Budget relativ zum Runner — Status: erledigt (N-small, Merge 2026-11-04) · Größe: S
- CI auf c23afc5 (gleicher Code wie das grüne 65e3e1e): Systemcheck-Flucht p50 33,4 / p95 50,1
  zweimal — der ganze Runner lief mit halber Rate. Das Fenster misst seit M-ciwin einen Client,
  aber ein langsamer Runner kippt die Flucht (33 ms bei 4× Drossel) über die 40 ms.
- Neu: ein Fenster gilt, wenn p95 ≤ max(40 ms, 2 × p95 des ruhigen Lauffensters desselben Laufs);
  ein Rückschritt nur in der Flucht fällt weiter auf, ein langsamer Runner nicht. Protokollzeile
  nennt beide Werte. Tests in tools/framegate; Header-Kommentar und art-bible ergänzen.
- Langfristig: Flucht-Main-Thread billiger (Licht/Dunkel-Pässe, halbe Frame), siehe Audit-Addenda.

### T-4 Leerlauf zu zweit — Status: wartet (Entscheidung Uros) · Größe: M
- Audit: Ben wartet 7,7 s am Reaktor auf die Sicherung, Anna 5 s vor der Notstrom-Tür. Optionen:
  Wartende lesen die nächste Quelle vor, oder eine kleine Nebenaufgabe (Ventil halten). Erst
  nach dem zweiten Playtest entscheiden.

### T-5 Größere Räume — Status: erledigt (N-xxl, Merge 2026-11-05; Karte 36×22, Kamera reist 11,7 Kacheln, Sieg des Skripts 462 s) · Größe: L
- Räume ~9×7 (Serverraum 11×7), Flure 4 breit, Zwei-Kachel-Türen auf den Hauptwegen, Karte
  ~36×22, Laufwege ≤ 12 s, Decor ≥ 8 je Raum und Flur-Props alle 4 Kacheln, Drohnenrouten neu,
  Zeit per Messung, Kamera-Reisen vorher/nachher, Fixture/Harness/Smoke aus der Mission.
- Umgesetzt: Blackout 36×22 statt 27×17, dieselbe Schleife und Stationskette; Räume 9×7, der
  Serverraum 11×7 mit zwei Pfeilern, Flure 4 breit, die Hauptwege zwei Felder breit, nur die
  Türen, die Geräte sind, ein Feld (Ein-Feld-Öffnungen 15 → 6); je Raum 10–12 Möbel seiner Art,
  Wandschmuck in jedem Flur mindestens alle 4 Felder (Pfeiler im Ost- und Süd-Flur). Der
  längste Weg des Plans 11,7 s statt 9,2 s (ein Kerntest hält jeden unter 12 s), Seed 5 lost wie
  vorher. Flurwache auf dem langen Flur, Laborwache im Süd-Flur und Labor. Der Plan gewinnt mit
  42–43 % Restzeit (vorher 46–47 %), die 900 s bleiben. Die Kamera steht seitlich nur noch
  auf 63–69 % der Felder fest (88–97 %). Bakes bis 4096² Pixel und 8192 je Seite: die Flucht bei
  Dichte 2 wieder pixelgenau. Plan, Wege und Zahlen in `docs/art-bible.md`, `docs/gameplay.md`
  und im Audit-Addendum.

### N-6 Pacing und Stationsfolge — Status: wartet (Daten) · Größe: ?
- Erst nach N-4 und dem zweiten Playtest messen (`runs.jsonl`): Ziel, dass eine Erstspieler-
  Crew Station 2 in 5 Minuten schafft. Offene Fragen aus dem Audit: Zeitlimit beim ersten Lauf,
  Notstrom als zweite Station, dritter Spawn, Größe der Schleife.

## Nur lokal

### L-1 Aufnahmen rendern — Status: erledigt (2026-11-04, ec0ef9c + 031cb7a)
- Alle 14 Aufnahmen gerendert, `danger-tick` (Geigerzähler-Klick) ersetzt den Ping-Ton der
  Drohnenwarnung. Weitere Aufnahmen bei Bedarf über `/sounds` ankreuzen; der Befehl kommt von
  der Seite.

### L-2 Zweiter Playtest — Status: nur lokal
- Dieselbe Person wie beim ersten; Telemetrie `packages/server/data/runs.jsonl` auswerten
  (`pnpm --filter @escapelab/server runs`).

## Erledigt (zuletzt)
- Eröffnung mit Durchsage und Titel, Geräusche und Musik aus ElevenLabs, Pro-Mix mit Bussen,
  Figuren/Licht/Partikel, Controller und Tastenbelegung, Erfolge, Tagesschicht, Netzplan,
  Flucht-Spielraum (L-polish) — siehe `git log` bis 2026-11-01.
