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

### H-2 Stationsschritte warten auf die Anwesenheit — Status: erledigt (N-h2, Merge 2026-11-05; echte Ursache: Solve nur in einer Sicht geprüft) · Größe: S
- CI auf f8a38a1 (Code identisch mit lokal grünen Läufen): „Ben stands at Signalkette, but no
  .station-modal after 3 tries". Der Harness drückt E, bevor der Server die Anwesenheit am Pult
  in die Sicht geschrieben hat (seit T-7 braucht sie Sichtlinie zur Pultmitte), und gibt nach
  drei schnellen Versuchen auf. Neu: vor E auf die Anwesenheit in der Sicht warten (Crew-Tag
  „am Pult"), bis 6 Versuche über 6 s, beim Scheitern den Serverstand (Position, Sicht,
  Anwesenheit) ins Protokoll; dasselbe für jeden Stations- und Quellenschritt.
- Umgesetzt: Der CI-Log zeigt die eigentliche Ursache. Der Harness sah die Lösung des
  Notstrom-Kastens nur in Annas Sicht; Bens Sicht zeigte noch den Kasten als aktive Station, und
  Ben lief zu dessen Pult A („on the way to 1,14") statt zur Signalkette. Jetzt wartet jeder
  Schritt nach einer Lösung, bis beide Sichten sie zeigen (Logzeile `catch-up`). Vor E an Pult,
  Quelle oder Notiz wartet der Harness bis 6 s auf die Anwesenheit, dann bis 6 Drücke über 6 s;
  scheitert es, nennt die Zeile `presence` Serverposition, Blickrichtung, Anwesenheitsfelder und
  je Pult Abstand, Sichtlinie und Fund (`tools/presence.mjs` mit Tests). Der Smoke hat das
  Rennen nicht: er wartet nach jedem Gang auf das Echo seiner Position, und der Server schickt
  die Sicht mit der Anwesenheit davor.

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

### P-1 Handy quer — Status: erledigt (N-phone, Merge 2026-11-05) · Größe: M
- Ein quer gehaltenes Handy zeigt das Labor, nicht das HUD: Zielleiste und Crew-Leiste falten
  sich bei 500 px Höhe oder weniger in eine Zeile von 44 px, das Weltband hält ≥ 65 % der Höhe,
  die Knöpfe rechts 2×2 und durchscheinend, Steuerung ≤ 30 % des Bands; Geräte und Blätter quer
  nachgeprüft; der Harness auch auf 932×430.
- Umgesetzt: eine Zeile über der Welt — LEDs über dem Ziel in einer Zeile, ein Funkspruch an
  seiner Stelle (höchstens zwei Zeilen), die Crew als Farbpunkte mit ihrem Tag 3 s nach jeder
  Änderung, der Wert der Laborkennung, Uhr mit Alarmmarken, Mikro, Notizen und Info als
  Symbolknöpfe; die Crew-Leiste unter der Welt entfällt dort. Bei 844×390 wächst die Leinwand
  von 289 auf 345 px, das Band unter der Leiste von 251 auf 302 px (64 → 77 % der Fensterhöhe),
  mit Funkspruch von 222 auf 302 px (57 → 77 %); bei 932×430 von 291 auf 342 px (68 → 80 %).
  Knöpfe rechts 2×2 zu 52 px, 8 px Abstand, 12 px vom Rand, 60 % Deckkraft bis zur Berührung,
  dann 2 s ganz; Steuerkreuz und Knöpfe decken 13,6 % des Bands (vorher 16,3 %, mit Funkspruch
  18,4 %), bei 932×430 10,8 %. Schnellchat neben den Knöpfen, Notizblock zwischen Steuerkreuz
  und Knöpfen, beide unter der Zeile. Alle sechs Geräte und die Relais-Konsole stehen auf
  844×390 und 932×430 ganz, ohne Scrollen, jedes Bedienelement ≥ 44 px, wie auf main. Harness:
  `game-phone-932.png`, `device-phone-932-<Station>.png`, `intro-phone-932.png`,
  `reading-notepad-landscape.png`. Zahlen in `docs/art-bible.md` („A phone held sideways").
- Das Buch quer: Bei 500 px Höhe oder weniger liegt es eine Seite auf einmal offen, nie als
  Doppelseite; der Bogen behält 30 em Breite in der Grundschrift (14 px, die Textgröße darauf)
  und nimmt die Höhe, die der Rahmen lässt; der Text scrollt im Bogen zwischen Kolumnentitel und
  Fußzeile, der Außenrand mit ihm. Die Seitenumbrüche bleiben, Seitenzahlen und Lesezeichen
  meinen dasselbe, das Blatt wendet sich wie bisher. Kopf, Laborkennung, Blättern und Zuklappen
  stehen in einer Spalte neben dem Bogen, wo der Rahmen 700 px breit ist; der Zettel der letzten
  Schicht links daneben, wo Platz ist. Vorher 4,6 px (844×390) und 5,6 px als Doppelseite
  (932×430), jetzt 14 px; Harness: `book-phone-landscape.png`.

### P-2 Buch auf dem Handy hochkant mit Notizblock — Status: erledigt (N-bookup, Merge 2026-11-05; 5,7 → 14 px) · Größe: S
- Hochkant (420×760) mit geöffneter Notizblock-Schublade fällt der Buchtext auf 5,7 px (wie vor
  P-1). Dieselbe Regel wie quer: eine Seite in Grundschrift ≥ 14 px, die im Bogen scrollt,
  Umbrüche gleich; Capture `book-phone-notepad.png`.
- Umgesetzt: Hochkant bis 560 px Breite gilt die Regel von quer, Schublade zu oder offen. Bis
  480 px Breite gibt der Bogen Papier statt Schrift her: die Spalte bleibt 25,2 em, der Bundsteg
  0,7 em, der Außenrand 2,7 em (das „Notieren" passt auch bei „Groß"), die Daumenregister treten
  zurück. Bei 420×760 vorher 12,3 px (Schublade zu) und 5,7 px (offen), jetzt 14 px; 1440×820,
  1280×720 und 844×390 unverändert.

### G-1 Grafik 2 — Status: erledigt (N-graphics2, Merge 2026-11-07; Kostentabelle in der Art-Bible) · Größe: L
- Maßstab sind Profi-Spiele (Alien: Isolation, Darkwood, Among Us, Enter the Gungeon, Hotline
  Miami, Dead Cells, Half-Life; was jedes tut, steht in `docs/art-bible.md`). Jede Wirkung
  höchstens 0,5 ms je Frame auf dem Canvas-Pfad (Hauptthread 4× gebremst, Software-Canvas) und
  0,3 ms Hauptthread auf dem GL-Pfad, verschränkt gegen den Stand davor gemessen; was darüber lag,
  wurde gekürzt oder ausgelassen.
- 1 Notlampen werden nach dem Blackout zu Rundumleuchten: zwei Keulen, eine Umdrehung in 3 s
  (reduzierte Bewegung 6 s, ohne Flackern), Bloom an der Linse; +0,36 ms zeichnen, +0,22 ms
  Sicht. Ausgelassen: die Keulen zusätzlich aus der Dunkelheit schneiden (+1,3 ms).
- 2 Tiefe: Wer hinter Regal, Rack, Spind, Aktenschrank oder Pfeiler steht, zeigt nur den
  oberen Teil; Namen und Drohnen darüber, Schatten darunter; +0,11 bis +0,30 ms.
- 3 Farbabstimmung je Phase (mit Strom warm, Blackout blaugrau, Flucht unverändert, Sieg hell),
  Übergang 1,5 s; +0,24 bis +0,33 ms. Gekürzt: eine Wäsche statt Multiplizieren (2,2 ms).
- 4 Lampenkegel mit weichem Rand und hellem, warmem Kern, Glanzpunkt an der Linse, Streifen auf
  Lino und Stahl, Staub dichter im Kern; der Kegel des Partners ist überall zu sehen, auch ohne
  seine Figur; +0,51 bis +0,93 ms, jede Wirkung ≤ 0,45. Gekürzt: Partnerkegel 5 statt
  7,5 Kacheln, sein Schein 1,6 statt 2,8 (ganzer Kegel 0,9 ms); warmer Kern nur der eigene.
- 5 Drohnen: Positionslichter rot und grün, 1 Hz versetzt, Rotorring, Lichtfleck vor ihnen am
  Boden (rot bei Alarm), weicher Schatten; +0,11 bis +0,25 ms.
- 6 Figuren: Armschwung, Drehung in drei Schritten, Hände am Pult, Lesen mit Blatt und gesenktem
  Kopf, beim Lösen 60 ms Halt von Figuren und Kamera mit weißem Blitz; reduzierte Bewegung
  behält nur die Haltungen; +0,05 bis +0,27 ms.
- 7 Bodenspuren je Raumart (Kaffeeringe, Blätter, Pfützen, Reifenspuren, Kabelbinder, Ruß am
  Sicherungskasten und am Reaktor), Fahrspur und Pfeile zum Ausgang in den Fluren; eine Schicht
  der Ausstattung des Clients, die Mission und Validierung nie sehen; gebacken, ±0,1 ms.
- Beweis: Tests je Punkt; Captures `beacon-sweep-a/b`, `depth-behind-shelf`, `grade-blackout`,
  `beam-core`, `drone-close`, `pose-console`, `pose-reading`, `decals-lab`; Harness: Blackout
  140 Captures, Systemcheck 89, je 0 Fehler mit und ohne `SHOTS_SOFTWARE_GL`, jedes Fenster
  16,7–16,8 ms p95 wie auf main (offene Panels unter Software-GL 33,4 wie dort). Die Flucht
  liegt auf der 4×-Bank an der Kante (16,6 von 16,7 ms Arbeit, p95 33,2 ≤ 33,4); Zahlen in
  `docs/art-bible.md` (Cost, Open).

### N-6 Pacing und Stationsfolge — Status: wartet (Daten) · Größe: ?
- Erst nach N-4 und dem zweiten Playtest messen (`runs.jsonl`): Ziel, dass eine Erstspieler-
  Crew Station 2 in 5 Minuten schafft. Offene Fragen aus dem Audit: Zeitlimit beim ersten Lauf,
  Notstrom als zweite Station, dritter Spawn, Größe der Schleife.
- Datenpunkt 2026-11-05, Karte 36×22: Die Skript-Crew gewinnt 462–502 s nach dem Blackout
  (40–43 % von 900 s übrig, davon bis 35 s Warten auf Drohnenlücken); der Harness warnt ab unter
  40 %. Vorschlag: Normal 1000 s (Entspannt/Hart skalieren mit), Entscheidung nach dem Playtest.

## Betrieb und Verbindung (2026-11-12)

Anlass: Uros flog am 10.11. im Zug aus einer laufenden Partie. Der Server läuft auf Render
(Free-Plan); jeder Deploy, jeder Spin-down nach 15 min Stille und jeder Neustart löscht alle
Räume, die nur im Speicher liegen. Der Push `099bbcb` um 17:39 ist der wahrscheinlichste
Auslöser. Vorbild für das Verhalten: Dota 2 (das laufende Spiel bindet dich, Rückkehr jederzeit,
Verlassen nur ausdrücklich), Jackbox (Code plus Name setzt dich auf jedem Gerät wieder auf
deinen Platz), Overcooked 2 (die Crew wählt zwischen Warten und Weiterspielen).

### R-1 Deploy nur, wenn niemand spielt — Status: entfällt (Entscheidung Uros 2026-11-12) · Größe: –
- Auto-Deploy bleibt an; Uros bestimmt, wann auf main gepusht wird, und damit den Deploy-
  Zeitpunkt. Claude pusht nur auf Ansage. Vor einem Push zeigt `/health` (R-5), ob eine Partie
  läuft. Ein Deploy-Gate per Workflow war gebaut und wurde wieder verworfen.
- Offen bei Render: Abschaltfrist auf 120 s (`maxShutdownDelaySeconds`), sobald R-2 die Frist
  für die Schnappschüsse braucht.

### R-2 Spielstand überlebt den Neustart — Status: im PR (R-snapshot) · Größe: L
- SIGTERM: Räume einfrieren (Wartungspause), jedem Client einen mit `ROOM_SECRET` (AES-GCM)
  verschlüsselten Schnappschuss schicken, geordnet schließen; dazu alle 5 s ein Schnappschuss,
  wenn sich etwas geändert hat. `resume` trägt den Schnappschuss mit; kennt der neue Server den
  Raum nicht, stellt er ihn daraus her, bleibt in der Pause, bis die Crew zurück ist, nimmt in
  den ersten 10 s den neuesten Stand. Raumcode bleibt, Einladungslinks gelten weiter.
- Beweis: Smoke tötet den Server mitten im Lauf (SIGTERM), startet ihn neu, die Partie geht ohne
  Zeitverlust weiter; Harness `restart-recovered.png`; Fehlen von `ROOM_SECRET` steht im Log.
- Umgesetzt: Schnappschuss nach jeder Änderung, höchstens alle 2 s (Blackout versiegelt 23 kB,
  0,05 ms je Schnappschuss); SIGTERM friert ein (`wartung`), schickt `restart`, schließt mit 1012,
  Exit 0 in 0,1 s; Wiederherstellung beim `resume`, 10-s-Fenster bis zur ersten Tat der Crew;
  Startseite zeigt die Karte aus dem gespeicherten Schnappschuss; Zuschauer fragen 30 s nach;
  Drohnen stehen in jeder Pause still, statt neu anzufangen. Smoke: SIGTERM (Frist um genau die
  Ausfallzeit verschoben) und SIGKILL (höchstens 2 s verloren). Harness `restart-maintenance.png`,
  `restart-recovered.png`, wo er den Server selbst startet (`SHOTS_SERVER`, CI jetzt auch).
- Die Minute dazwischen (Render hält die alte Instanz 60 s nach dem Umschalten): Jeder
  Schnappschuss nennt seine Instanz, der beim SIGTERM ist `final`. Ein fremder, nicht letzter
  wartet auf einer Instanz unter 90 s („EINSATZ WIRD WIEDERHERGESTELLT"), bis der letzte kommt
  oder die 90 s um sind; ein zu später steht mit beiden Nummern im Log. Smoke: zwei Server
  nebeneinander, Finn wartet auf dem neuen, bis Eva und Gus nach dem SIGTERM des alten kommen;
  nach SIGKILL ist der Raum 90 s nach dem Start des nächsten zurück.
- Offen bei Render: `ROOM_SECRET` setzen, `maxShutdownDelaySeconds` auf 120.

### R-3 Der Einsatz bindet die Crew — Status: erledigt (R-reconnect, Merge 2026-11-12; drei Review-Runden, Harness Blackout 147 Captures mit Abbruch-Übung) · Größe: L
- Dienstausweis je Browser (localStorage) statt Token im Tab; Startseite zeigt bei laufendem
  Einsatz die Karte „Zurück zum Einsatz / Einsatz aufgeben" und sperrt andere Räume; Pause bei
  Abbruch mit Zähler, nach 60 s (später 20 s) „Ohne <Name> weiter", die Person bleibt gebunden
  und kann jederzeit zurück; „Einsatz aufgeben" gibt den Platz frei, unter `players.min` endet
  der Lauf „EINSATZ ABGEBROCHEN"; Platz übernehmen per Code und Namen von einem anderen Gerät;
  der Getrennte sieht eine eigene Karte mit Zähler und Versuch; Leitung gilt nach 5 s ohne
  Uhrantwort oder 20 s Stille als tot, Wiederverbinden sofort bei Netz- und Tab-Rückkehr.
- Fehler aus dem Audit: ein Abbruch konnte eine pausierte Partie durch die Flucht beenden.
- Beweis: Core-, Server-, Client-Tests; Smoke mit 70-s-Abbruch, Aufgeben, Übernahme; Harness
  `pause-waiting`, `continue-without`, `reconnect-overlay`, `rejoin-card`, `takeover`.

### R-4 Funk zwischen Mobilnetzen — Status: wartet (Entscheidung Uros) · Größe: M
- Ohne TURN-Server verbinden sich zwei Handys in verschiedenen Mobilnetzen meist nicht; STUN ist
  nur mit `?stun=1` an. Optionen: STUN standardmäßig, TURN über einen kostenlosen Dienst oder
  den Render-Server selbst (Datenvolumen). Erst entscheiden, wenn R-3 steht.

### R-5 Sichtbarkeit — Status: erledigt (R-reconnect, Merge 2026-11-12) · Größe: S
- Server loggt Beitritt, Wiederverbinden, Abbruch, Abweisung, Weiter-ohne, Aufgeben, Übernahme,
  Laufende je eine Zeile; `/health` zählt Räume, laufende Partien, Spieler, Zuschauer, nennt
  Laufzeit und Commit (`RENDER_GIT_COMMIT`).

## Geplant (2026-11-12, Vorbilder je Punkt)

### V-1 Zwei Stimmen und eine Leitstelle, die reagiert — Status: bereit (nur lokal: Render der Zeilen) · Größe: M
- Vorbilder: Payday 2 (Bain koordiniert, reagiert auf Alarme, warnt vor der Zeit, viele
  Varianten je Ansage), Hitman (Diana: ruhig, kommentiert, bewertet am Ende), Portal 2
  (Anlagen-Durchsage und Person sind zwei Stimmen), Alien: Isolation (Durchsagen folgen dem
  Zustand der Station), Left 4 Dead (Varianten, damit sich nichts wiederholt).
- Zweite Stimme für die Durchsage der Anlage im Intro, Helmut bleibt Operator am Funk. Der
  Operator reagiert auf den ersten Alarm, auf 5, 2 und 1 Minute Restzeit, auf den Notfall, und
  spricht ein Debriefing für Sieg und Niederlage; zwei bis drei Varianten je Hinweis und Lösung,
  pro Lauf per Seed gewählt; Funkprobe in der Lobby, wenn alle bereit sind. Grob 8 000 Credits.
- Beweis: Manifest-Tests je Zeile, Varianten-Wahl deterministisch je Seed, Harness hört die
  neuen Momente (Audio-Probe), `docs/sound.md` aktualisiert (nennt heute noch 47 Zeilen und
  Thorsten).

### M-1 Drei Spielende: Beweis und Sichtbarkeit — Status: bereit · Größe: M
- Befund: mechanisch trägt die dritte Person (Leserin mit Regeln, Notizen und Funk an Zwei-Pult-
  Stationen; Platten, Sicherung, Schlüssel, Kameraplatte sonst), aber Modultests spielen Blackout
  nur zu zweit, der Harness auch; die Validierung beweist nur Erreichbarkeit.
- Vorbilder: Keep Talking (Needy-Module, die alle 30–60 s eine Hand brauchen), Lovers in a
  Dangerous Spacetime (gleiche Stationen, mit mehr Leuten parallel besetzt), Spaceteam (Befehle
  an bestimmte Pulte), Overcooked (verkettete Aufgaben, niemand steht herum).
- Modultests über alle Crewgrößen min..max; Harness mit dritter Spielerin (Cleo) in Blackout mit
  Captures; Zielzeile nennt der dritten Person ihre Aufgabe („Cleo: Platte halten"). Eine echte
  Drei-Pulte-Station oder ein Needy-Objekt nur bei drei Spielenden erst nach Playtest-Daten.

### I-1 Zugangskontrolle mit Zwei-Faktor — Status: wartet (Entscheidung Uros: Modul zuerst, Platz in Blackout nach dem Playtest) · Größe: L
- Pult A Login-Terminal, Pult B Token-Generator mit Code, der mit der Serveruhr alle 30 s
  wechselt (Restsekunden sichtbar), Quelle Benutzerliste mit Rollen. Vorbilder: Quadrilateral
  Cowboy (`door.open(3)`: das Terminal gibt die Tür drei Sekunden frei, jemand muss durch),
  Among Us (ID-Code ablesen und eintippen; Reaktor mit zwei Händen an zwei Panels).
- Dazu als eigenes Spielelement: eine Schleuse, die das Terminal fünf Sekunden öffnet, während
  die andere Person läuft (nutzt die vorhandene Bewegung).

### I-2 Firewall-Regelwerk — Status: wartet (Entscheidung Uros) · Größe: L
- Pult A zeigt laufende Pakete (Quelle, Ziel, Port), Pult B bearbeitet die Regelliste, erste
  passende Regel gewinnt, Quelle Sicherheitsrichtlinie. Vorbilder: Hacknet und Uplink (Trace-
  Zähler, sobald man drin ist), Exapunks (Regeln im gedruckten Heft).
- Dritter Entwurf in Reserve: Datensicherung (Plattenarray, Backup-Katalog, Rotationsplan).

### S-1 Titel wie ein Spiel — Status: bereit · Größe: M
- Vorbilder: Half-Life 2 und Firewatch (Menü über einer lebenden Szene), Alien: Isolation
  (Titel mit Röhrenflimmern und Brummen), Among Us (Figuren sind von Anfang an da).
- Hinter der Karte zieht das beleuchtete Labor aus dem Intro langsam vorbei; Titelthema aus
  ElevenLabs Music (60 s Schleife) und Anlagenbrummen; eigene Displayschrift (OFL, lokal); Klänge
  für Klick, Bereit, Beitritt; die eigene Figur erscheint neben dem Namensfeld und winkt; offene
  Runden zeigen die Figuren der Crew statt Punkten; Übergang in die Lobby als aufgehende Tür.
- Beweis: Captures join/lobby an allen Größen, Pixelchecks der anderen Bildschirme, Frame-Fenster
  der Startseite ≤ 16,7 ms p95 bei Software-GL.

### S-2 Begehbarer Pausenraum — Status: wartet (nach S-1 und R-3) · Größe: XL
- Vorbilder: Phasmophobia (begehbarer Raum, Tafel mit Auftragswahl, Tür öffnet beim Start),
  Deep Rock Galactic (Countdown erst, wenn alle in der Kapsel stehen), Lethal Company (Hebel
  startet), Among Us (frei herumlaufen und reden).
- Lobby als kleiner Raum im echten Renderer: Spinde in Crewfarben, Tafel mit Briefing, an der
  der Host die Mission wählt, Kaffeemaschine, Tür zu Trakt C geht auf, wenn alle bereit davor
  stehen; Bewegung, Anwesenheit, Näheklang wie im Spiel.

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
