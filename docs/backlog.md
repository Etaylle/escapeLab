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

### H-3 Capture-Gruppen im Harness — Status: erledigt (H-quick, Merge 2026-11-14) · Größe: S
- `tools/groups.mjs` nennt 15 Gruppen; `SHOTS_ONLY=screens,intro` beweist ein Menü-Paket in
  48 s statt 12 min, `SHOTS_SKIP=run` lässt den Lauf aus; jeder Schritt läuft unter dem Gate
  seiner Gruppe, ein voller Lauf scheitert an einem falsch eingeordneten Capture. Ohne Variablen
  ist der Lauf identisch zu vorher (per Aufrufgraph geprüft). Gemessene Kosten je Gruppe in der
  README.

### H-4 Der gemessene Lauf unter Software-GL urteilt wieder — Status: im PR (H-sgl, Spec `spec-H-sgl.md`) · Größe: M
- Befund 2026-11-14: Der Lauf mit `SHOTS_SOFTWARE_GL=1` scheitert auf main selbst — Systemcheck am
  Panel-Ausblend-Check in 5 von 6 Läufen und am letzten Sync-Check, Blackout an meter-swing,
  panel-close und einem 43-px-Ziel am Handy, der Notstrom-Kasten seit Tagen. Jeder dieser Checks
  liest die Latenz des Screenshots, als wäre sie die Zeit der Animation; so entscheidet die Last,
  nicht der Code, und das Tor für Pakete mit Zeichenarbeit je Frame (S-hero) steht offen.
- Gemessen auf main 997275c, je zwei Läufe unter Software-GL bei der Last, die da war (1-Minuten-Last
  alle 20 s; Tabelle in der Art-Bible, Cost, „What the timing checks read"):
  - panel-close.png, die Blende wie gespielt: gescheitert in 3 von 4 Läufen (Last im Mittel 45, 26
    und 15). Die Seite zeichnete das erste Bild der Blende und das nächste 117, 817 und 583 ms
    auseinander, das Gerät war nach ihrer eigenen Uhr dazwischen weg, 152 bis 167 ms nach Beginn;
    main las die Lücke als Blende („gone in 124 / 815 / 571 ms", kein Bild in der Mitte). Bestanden
    nur bei Last 7, mit einem Bild bei 0,95 als einzigem in der Mitte. Der angehaltene Schuss war
    jedes Mal mittig.
  - meter-swing.png: bestand zweimal, einmal fälschlich — 186 ms nach der Probe bei −52,4° gelesen,
    der Screenshot erst 763 ms nach der Probe fertig, die Nadel darauf in Ruhe bei −10,8°.
  - device-phone-signalkette-a.png: gescheitert einmal, „Zurücktreten" und „Notizen" 43,38 px hoch
    bei 44 px Layout — das Öffnen des Geräts (`panel-up` ab 0,98, `device-open` ab 0,94, je 150 ms)
    beim Messen erst 50 ms weit. Das Layout ist echt 44 px; die Prüfung lag falsch.
  - Die letzte Gleichzeit-Station (Systemcheck, Läufe des Signal-Bauers): auf dem quer gehaltenen
    Handy nimmt das Funkband die Stelle der LED-Leiste ein; kam die Prüfung spät, war die Leiste
    weg, und der unbehandelte Funk-Lauscher beendete den Prozess vor der Zusammenfassung. In diesen
    vier Läufen bewegte sich die Leiste rechtzeitig.
  - device-solved.png: zweimal übersprungen (Schuss 570 und 2912 ms nach „gelöst", das Gerät zu
    nach 572 und 2931 ms), wie bisher mit den Zeiten. lever-countdown las beide Seiten 1301 bis
    1303 ms nach dem Zug, beide „2". Die übrigen Skips sind die der Missionen (Systemcheck 16,
    Blackout 4), wie in der CI auf main.
- Umgesetzt: Jede Zeitprüfung liest, was die Seite auf ihrer eigenen Uhr festhielt
  (`tools/panelfade.mjs`, `tools/pageclock.mjs`). Die Blende: ein MutationObserver hält Beginn und
  Ende fest, jedes Bild bis zum Ende Deckkraft und Stand der Blende; mindestens ein Bild muss das
  Gerät halb zeigen, wie auf main. Zeigt keines es so, scheitert die Prüfung an einem Bild zwischen
  halber und neun Zehntel Blende; gab es dort keines, wird übersprungen (`panel-close (fade)`) mit
  den Zeiten der gezeichneten Bilder. Die Nadel hält die Seite 60 ms in ihren Ausschlag an, sobald
  sich ihre Drehung nach dem Druck ändert (MutationObserver; `transitionrun` kommt erst mit dem
  nächsten Bild, unter Last nach dem Ausschlag), bis die Aufnahme sitzt. Die Ziele auf dem Handy
  werden gemessen, wenn die Animationen des Geräts auf der Uhr der Seite zu Ende sind (höchstens
  3 s, sonst übersprungen mit der Wartezeit). Die LED-Leiste merkt sich jede Seite vor den Drücken.
  Die Beweisläufe fanden sechs weitere Stellen derselben Art: Die Nadel hielt den späten Ausschlag
  der vorigen Probe fest (jetzt wartet der Rundgang, bis die Nadel auf der letzten Ablesung steht);
  figure-celebrate.png fand die Figur nach vier Aufnahmen gelandet (Last 42–57), und walk-cycle
  verfehlte auch auf main ohne Software-GL beide Schrittfenster (Last 24–38) — für die Aufnahmen der
  Figuren und des Schritts hält die Seite ihre Bilder an, bis die Aufnahme sitzt; eine Blende,
  während der die Seite gar kein Bild zeichnete, galt als Blende ohne Animation (jetzt
  übersprungen); und das Tempo des Menüs unter Software-GL (16,8 ms) entschied auch in Beweisläufen
  mit angehobenem Budget (Last 158) — es gilt jetzt, wo der Lauf das Budget des Gates hat, sonst
  steht es im Log; nudge.png wartete auf eine dritte Meldung, wo der langsame Lauf beide der Station
  schon unterwegs verbraucht hatte — jetzt übersprungen, mit den Zeiten der beiden. Jedes
  Frame-Fenster nennt die 1-Minuten-Last, unter der es lief, die Zusammenfassung die zu Beginn und
  am Ende; kein Budget geändert.

### T-9 Tests an der Wanduhr — Status: erledigt (2026-11-13) · Größe: S
- Zwei Tests lasen die echte Uhr und wurden unter Last rot: `certificate.test.ts` (openssl liest
  seine Uhr zweimal, ein Lauf über eine Sekundengrenze machte aus 825 Tagen 825,00001; jetzt
  gerundet) und `coldOpen.test.tsx` (Zielleiste und Briefing rendern nach `Date.now()`, bei Last
  über 15 wurde aus „10:59" „10:58"; jetzt eingefrorene Uhr). Regel: Tests fälschen die Zeit.

### T-8 Signalkette: das Muster zählt — Status: erledigt (T-signal-grey, Merge 2026-11-14; zwei Review-Runden; Cloud-CI grün auf e26424b: Blackout 157 Captures; Blackout farblos ab Stufe 4) · Größe: S
- Uros beim Spielen: „Ist das Muster ganz ohne Nutzen?" Mit Legende ja: Die Pulte zeichnen je
  Farbe ein Muster und die Legende nennt es, aber die Lösung braucht nur die Farbe; die Spalte
  ist Dekoration, die wie eine Regel aussieht.
- Neu: In der letzten Stufe verliert die Anzeige ihre Farbe, die Zeichen erscheinen grau nur mit
  ihrem Muster; die Muster-Spalte der Legende ist dann der einzige Weg zur Farbe. Feld
  `greyFrom` (Standard letzte Stufe), Sichten ohne Farbwort in diesen Stufen, Löser über die
  Legende, Frühschicht-Hinweis, Panel mit kontrastreichem Muster, Plan neu erzeugt.
- Umgesetzt: `greyFrom` (leer = letzte Stufe mit Legende, 0 = nie, ohne Legende abgelehnt; im
  Editor „Farblos ab Stufe"). Ab dieser Stufe trägt jede Sicht ein Zeichen nur als Form und
  Muster, kein Farbwort (Negativ-Assertions über jede Sicht, im Smoke über den Draht); der Löser
  liest die Farbe über die Muster der Legende. Betrieb nennt die Stufe und dass die Legende
  jedem Muster seine Farbe gibt, die Werkstatt die Stufe, ab der die Anzeige farblos ist; dafür
  ist Betrieb gestrafft, jede Regel bleibt, und Blackouts Seite hält mit 168 Wörtern Fließtext
  die Grenze von 170 (zuvor 169, mit der grauen Stufe ungestrafft 194). Das Panel zeichnet die
  Zeichen grau mit 64 px, das Muster fett (jede Musterzelle ≥ 18 px, Tinte 9,4:1), dazu
  ANZEIGE · FARBLOS. Der Notizblock nimmt die Legende mit beiden Muster-Spalten, eine
  Leerstelle auseinander (37 Zeichen, Grenze 38): Jedes Pult findet seine Zeile direkt über das
  Muster. Der Editor sagt im Hilfetext, dass eine neue Kette auf 0 steht und erst ein leeres
  Feld die letzte Stufe gibt.
  Blackout: `greyFrom` 4, dritte Frühschicht-Notiz (mit Uros' zweitem Satz 132 Zeichen, Grenze
  120: „Die Farbe dazu steht in der Legende."), Plan mit vier grauen Ringen in Stufe 4. Der
  Walkthrough spielt die Stufe nach Plan (signal-grey.png, signal-grey-phone-932.png); Sieg
  548,8 s nach dem Lichtausfall, main 553,9 s (je ein Lauf unter Last 8–11).

### T-4 Leerlauf zu zweit — Status: wartet (Entscheidung Uros) · Größe: M
- Audit: Ben wartet 7,7 s am Reaktor auf die Sicherung, Anna 5 s vor der Notstrom-Tür. Optionen:
  Wartende lesen die nächste Quelle vor, oder eine kleine Nebenaufgabe (Ventil halten). Erst
  nach dem zweiten Playtest entscheiden.
- Studie G-2, Rang 1 (Keep Talking, Lovers): das Nadelventil — solange eine Station offen ist,
  wacht daneben alle 40–60 s eine Anzeige auf, die eine Hand braucht; verpasst, ein Alarm.

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
- Studie G-2, Rang 4 (Escape Academy, Escape Simulator): ein Lehrgang ohne Uhr — der erste Lauf
  einer Crew ohne Uhr, dann Übungshalle, Tutorial und Blackout, je Schritt eine neue Idee; die
  Missionen ohne Uhr aus G-2 sind das Werkzeug dafür.
- Plätze je Station (M-three, `core/test/hands.test.ts`), gegen die größte Crew der Mission:
  Blackout hat zu dritt überall genug (Notlicht 3, Notstrom 4, Signalkette 3, Subsysteme 3,
  Frequenz 3, Reaktorstart 4). Die Kettenreaktion (Crew von drei) gibt fünf von sechs Stationen
  nur zwei Plätze, Pult und Handbuch: Lastverteilung, Kühlkreislauf, Freigabecode,
  Resonanz-Dämpfung und Leitungsnetz je 2, Synchron-Abschaltung 4; ihre drei Plattentüren halten
  ohne `untilSolved` und zählen nicht. Die Doppelschicht (Crew von vier): Notstrom-Brücken,
  Freigabecode, Kühlkreislauf, Funkfeuer und Druckausgleich je 2, Leitungsnetz 3, Not-Aus beider
  Flügel 4. Das Labor `doppelpult-drei` (Crew von drei) bleibt, wie es ist: sein Kabelkasten
  nach der Signalkette hat zwei Plätze, Pult und Buch; acht Testdateien bauen auf ihm. Nicht
  gepatcht: nach dem Playtest entscheiden, ob die Prototypen eine Hand mehr bekommen (Platte bis
  zur Lösung, Teil, zweite Quelle) oder ihre Crew kleiner wird.

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

### R-2 Spielstand überlebt den Neustart — Status: erledigt (R-snapshot, Merge 2026-11-13; drei Review-Runden; Harness-Übung: SIGTERM 0,1 s, alle Seiten 0,6 s nach dem Hochfahren zurück, Schnappschuss 7,9 kB) · Größe: L
- SIGTERM: Räume einfrieren (Wartungspause), jedem Client einen mit `ROOM_SECRET` (AES-GCM)
  verschlüsselten Schnappschuss schicken, geordnet schließen; dazu 2 s nach jeder Tat und alle 10 s,
  solange die Uhr läuft, ein Schnappschuss, wenn sich etwas geändert hat. `resume` trägt den
  Schnappschuss mit; kennt der neue Server den Raum nicht, stellt er ihn daraus her, bleibt in der
  Pause, bis die Crew zurück ist, nimmt in den ersten 10 s den neuesten Stand. Raumcode bleibt,
  Einladungslinks gelten weiter.
- Beweis: Smoke tötet den Server mitten im Lauf (SIGTERM), startet ihn neu, die Partie geht ohne
  Zeitverlust weiter; Harness `restart-recovered.png`; Fehlen von `ROOM_SECRET` steht im Log.
- Umgesetzt: Schnappschuss 2 s nach jeder Tat, alle 10 s, solange die Uhr läuft, nie für bloße Wege,
  gepackt (Deflate) und nur, wo sich etwas geändert hat — Blackout mitten im Lauf 7,9 kB statt 25,6
  kB, beim Laufen 44 kB je Platz und Minute statt rund 690 kB, 0,14 ms je Versiegeln; SIGTERM friert
  ein (`wartung`), schickt `restart`, schließt mit 1012, Exit 0 in 0,1 s; Wiederherstellung beim
  `resume`, 10-s-Fenster bis zur ersten Tat der Crew; Startseite zeigt die Karte aus dem
  gespeicherten Schnappschuss; Zuschauer fragen 30 s nach; Drohnen stehen in jeder Pause still,
  statt neu anzufangen. Smoke: SIGTERM (Frist um genau die Ausfallzeit verschoben) und SIGKILL
  (höchstens 10 s der Wege verloren). Harness `restart-maintenance.png`, `restart-recovered.png`, wo
  er den Server selbst startet (`SHOTS_SERVER`, CI jetzt auch).
- Die Minute dazwischen (Render hält die alte Instanz 60 s nach dem Umschalten): Jeder Schnappschuss
  nennt seine Instanz, der beim SIGTERM ist `final`. Mit einem fremden, nicht letzten wartet der
  Raum bis zu 90 s ab dem ersten, der so wiederkommt, wie lange die Instanz auch läuft („EINSATZ
  WIRD WIEDERHERGESTELLT"), bis der letzte kommt; ein letzter wartet nie, ein zu später steht mit
  beiden Nummern im Log. Smoke: zwei Server nebeneinander, Finn wartet auf dem neuen, bis Eva und
  Gus nach dem SIGTERM des alten kommen; nach SIGKILL ist der Raum 90 s nach dem ersten
  Wiederkommen zurück.
- Schnappschüsse überdauern Deploys: Unbekannte Schlüssel gehen durch, Modulzustände werden nur nach
  ihrem Typ geprüft, und neue Felder im Spielzustand brauchen einen Vorgabewert — der Test zu
  `test/fixtures/blackout-snapshot.json` (Schnappschuss des Builds davor) wacht darüber.
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
- Die Pause bei Abbruch ist am 2026-11-14 auf Wunsch von Uros ersetzt worden (R-6): Der Lauf geht
  weiter, „Ohne X weiter" steht seither in der Leiste über der Welt statt auf einer Karte, und die
  Wartung eines Neustarts wartet nur auf die, die dabei in der Leitung waren.

### R-4 Funk zwischen Mobilnetzen — Status: wartet (Entscheidung Uros) · Größe: M
- Ohne TURN-Server verbinden sich zwei Handys in verschiedenen Mobilnetzen meist nicht; STUN ist
  nur mit `?stun=1` an. Optionen: STUN standardmäßig, TURN über einen kostenlosen Dienst oder
  den Render-Server selbst (Datenvolumen). Erst entscheiden, wenn R-3 steht.

### R-5 Sichtbarkeit — Status: erledigt (R-reconnect, Merge 2026-11-12) · Größe: S
- Server loggt Beitritt, Wiederverbinden, Abbruch, Abweisung, Weiter-ohne, Aufgeben, Übernahme,
  Laufende je eine Zeile; `/health` zählt Räume, laufende Partien, Spieler, Zuschauer, nennt
  Laufzeit und Commit (`RENDER_GIT_COMMIT`).

### R-6 Kein Stillstand, wenn eine Leitung abreißt — Status: erledigt (R-nopause, Merge 2026-11-14, 5020329; zwei Review-Runden und zwei Deltas; Cloud-CI grün auf 4b272b7, Check und Walkthrough; Neustart wartet nur auf Plätze, die beim Versiegeln online waren; leere Leitung hält als Wartung) · Größe: M
- Uros 2026-11-14 mit Screenshot der Karte „MISSION PAUSIERT · Warten auf uros": „Sollte man das
  Spiel im Hintergrund nicht stoppen, wenn jemand weg ist? Alles sollte gleich bleiben und danach
  fortführen." Kehrt die Dota-Pause aus R-3 um: Uhr, Patrouillen und Notfälle laufen weiter, der
  Platz bleibt gebunden, wer zurückkommt, spielt sofort weiter; die Pausenkarte bleibt nur für die
  Wartung (R-2). Der Ausgefallene steht still, hält, was er hielt, und wird von Patrouillen nicht
  gesehen; Notfälle würfeln ohne seine Konsole; „Ohne X weiter" nach 60 s (später 20 s) bleibt in
  Crew-Leiste und HUD, weil Stationen zu zweit bedient werden. Vorbilder: Overcooked 2, Among Us,
  Deep Rock Galactic (die Mission läuft, der Platz bleibt offen).
- Umgesetzt: `paused` gibt es nur noch für die Wartung; ein Abbruch hält den Avatar samt Platten und
  Luke, Drohnen übersehen ihn, Konsolen und Ventile brauchen Hände in der Leitung, das Relais
  würfelt für die Crew in der Leitung neu, sobald eine Leitung 5 s weg ist (ein Neuladen würfelt
  nichts). Die Leitstelle sagt „Bens Leitung ist weg." einmal an, die Crew-Leiste graut Ben mit
  „getrennt · 0:12", die Leiste über der Welt bietet nach 60 s (später 20 s) „Ohne Ben weiter" oder
  allein „Einsatz abbrechen"; die Karte des Hauptmenüs zählt die Uhr herunter. Die Wartung eines
  Neustarts wartet nur auf die Plätze, die beim SIGTERM (oder im letzten Schnappschuss) in der
  Leitung waren; wer vorher weg war, bleibt weg wie zuvor, mit der Wartezeit seines Abbruchs — ein
  Abbruch wird nie über einen Deploy zur Pause (Entscheidung 2026-11-14). Ist niemand der Crew mehr
  in der Leitung, hält der Lauf ab dem letzten Abbruch als Wartung, bis der Erste zurück ist
  („WARTUNG · NIEMAND AUF DER LEITUNG"); der Raum schließt nach 10 Minuten leer wie bisher
  (Entscheidung 2026-11-14).
- Beweis: Core-, Server-, Client-Tests (auch: eine Crew von zwei, beide weg, einer zurück); Smoke;
  Harness `away-badge` (Uhr gegen die Wanduhr), `continue-without`, `rejoin-card`; der
  Neustart-Drill mit Cem, der vor dem SIGTERM weg ist: der Einsatz läuft weiter, sobald Anna und
  Ben zurück sind.

## Geplant (2026-11-12, Vorbilder je Punkt)

### V-1 Zwei Stimmen und eine Leitstelle, die reagiert — Status: erledigt (V-voices, Merge 2026-11-14; vier Review-Runden; Cloud-CI grün auf f5e2785; Render der 48 Zeilen durch Uros offen; kleiner Rest: der Guard der Notfall-Zeilen lässt „ohne Alarm"/„ohne Strafe" noch durch) · Größe: M
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

### V-2 Musik mit einem Thema, im Geist von Expedition 33 — Status: erledigt (M-music, Merge 2026-11-14; zwei Review-Runden; Cloud-CI auf ac29d77 grün; Render der Partitur offen, Befehle unten) · Größe: L
- Uros 2026-11-14: „Die Musik im Hauptmenü ist ein einfacher Ton mit Störung" und „Musik will
  ich wie Expedition 33." Gemessen: Das Titelthema ist, wie sein Prompt es verlangte, ein dunkles
  Pad über einem Drone (RMS −14,5 dBFS, Crest 14,5 dB, gleichförmig); die drei Takes des
  Anlagenbrummens kamen fast stumm (−50 dBFS mit einem Klick), +31 dB machten den Klick im Menü
  zum Knacken.
- Vorbild: Clair Obscur: Expedition 33 (Lorien Testard): ein Motiv, das bleibt, Klavier und
  Streicher, eine Stimme ohne Worte, ein Bogen der Dynamik, elektronische Farbe gegen akustische
  Wärme, französisch-romantische Melancholie; hier die Nachtschicht einer Forschungsanlage der
  1980er, die Elektronik ein Analogsynthesizer. Nichts kopiert: ein eigenes Motiv, kein Name im
  Plan.
- Umgesetzt: die ganze Musik als eine Partitur (`score` in `audio/catalog.json`), ein
  Kompositionsplan für Eleven Music (`music_v2_5`) mit acht Abschnitten in einer Generation —
  Titelthema 93,3 s, Lobby 61,3 s, Titel der Eröffnung 40 s, drei Stems je 72 s, zwei Endthemen
  je 40 s, zusammen 490,7 s —, A-Moll, 90 bpm, das Motiv in jedem Abschnitt, die Dämmerung in
  C-Dur. Takes warten immer aufs Ohr: `/sounds` zeigt je Take eine Zeile mit jedem Stück in der
  Reihenfolge des Plans und den einen Befehl, der ihn ganz behält; `--keep score=<n>` schneidet ihn
  an den Taktgrenzen des Plans, als AAC mit 160 kbit/s, jedes Stück auf −19 LUFS (BS.1770). Im
  Spiel loopen Stems und Titelthema auf den Takten aus dem Manifest, die Lobby blendet auf dem
  nächsten Takt in ihr eigenes Stück über, die Endthemen enden wirklich, der Titel ersetzt den
  alten Cue (auf dem Pegel der Stems statt 6 dB darüber); ein Bett, das mehr als +12 dB bräuchte,
  lehnt das Skript in einer Zeile ab, und das Spiel spielt es nicht.
- Offen, nur lokal (Uros): drei Takes in zwei Läufen, je Take etwa 8.833 Credits zum Satz des
  Skripts (18 je Sekunde), zusammen etwa 26.500 (zum Listenpreis von 900 je Minute 22.080) — mehr
  als die geschätzten 19.000, weil die Partitur 8,2 statt 7 Minuten dauert; die Musik darf je Lauf
  18.000 ausgeben, also erst zwei Takes, dann einer. In `packages/client` des Haupt-Checkouts:
  `node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts
  --candidates 2 --only score`, dann dasselbe nur mit `--only score`; anhören unter `/sounds`
  (`pnpm dev`), behalten mit `node scripts/sfx.ts --keep score=<n>`; danach verliert
  `AWAITING_RENDER` die acht Stücke, und der alte Cue samt `scripts/introCue.ts` kann gehen. Das
  Brummen neu: `--candidates 5 --only bed-facility`, etwa 200 Credits.
- Beweis: Skript mit Mocks (Plan auf ganzen Takten, Schnitt mit 10-ms-Kanten, Läufe unter der
  Obergrenze, Behalten der Partitur und jede Ablehnung, ein Bett über +12 dB abgelehnt) und
  Client (Loop-Punkte aus dem Manifest, Lobby-Stück, Brummen optional, Endthemen enden, Titel
  statt Cue, `/sounds` mit den Takes der Partitur), jeder neue Test einmal mutiert; Typecheck,
  Lint, Client 3.391 Tests grün, Smoke grün; Walkthroughs der Cloud auf e40e812 grün (Blackout
  155/4/0, Systemcheck 96/15/0, Captures und Skips wie auf main, Audio-Zensus im Lauf
  unverändert; das Menü hält drei Gain-Knoten ohne Quelle mehr).
- Offen aus der zweiten Review (klein): die AAC-Prüfung (`canPlayType`) läuft nur in der
  Capture-Gruppe `screens`; ein Lauf mit `SHOTS_ONLY=audio` spielt eine behaltene Partitur
  ungeprüft, weil der Musik-Zensus im Lauf nur protokolliert.
- Nachtrag Uros 2026-11-14 08:00: das generierte Menüthema ist ihm „nichts Besonderes"; das
  Menüthema wird durch ein freies, von Menschen komponiertes Stück ersetzt (CC0/CC BY/Pixabay,
  Nennung unter „Lizenz"), der Rest der Partitur bleibt (zwei Takes gerendert, je 6.747 Credits).
  Vorschlagsliste mit Hörlinks sucht ein Agent; Einbau (Schleifennaht auf dem Takt, −19 LUFS)
  als kleines Paket M-2, sobald Uros gewählt hat.

### M-2 Musikpakete, wählbar in den Einstellungen — Status: in Arbeit (M-packs, Spec `spec-M-packs.md`) · Größe: L
- Uros 2026-11-14 09:35: „Builde mir von allen Kombinationen Musikpakete, die ich im Spielmenü
  aussuchen kann: Paket 1, 2, 3 …, und je Platz einstellbar." Drei Suchagenten fanden am Morgen
  Kandidaten für alle acht Plätze (OpenGameArt, Free Music Archive, FreePD-Archiv, incompetech,
  itch.io; Pixabay nur außerhalb des Repos); die Liste liegt als private Seite bei Uros.
- Ein Paket ist Daten (`audio/packs/<id>/pack.json`: je Platz Datei, Lizenz, Nennung, Länge,
  Schleife als Takte oder Crossfade); Stücke als AAC in `public/music/packs/`, 60–120 s Schleifen,
  30–45 s Enden, −19 LUFS; `scripts/packs.ts` holt die Quellen einmal, schneidet, misst, schreibt
  das Manifest und den Nennungsblock. Pakete zum Start: nachtschicht (die eigene Partitur),
  yalciner, cheremisinov (+ Krux für die Stems), macleod, panchout/Hitctrl, zhelanov; nur CC0 und
  CC BY. In Einstellungen → Ton: Paketwahl, Feinwahl je Platz aus allen Paketen, Vorhören,
  „Nennungen"; Wahl je Gerät in `settings.ts`.

### V-3 Stimmenbesetzung: Stimmen, die sich abwechseln — Status: in Arbeit (V-cast, Spec `spec-V-cast.md`) · Größe: M
- Uros 2026-11-14 08:05: „Ich will alles hören, und vielleicht ist cool, wenn sich sogar alle
  Stimmen abwechseln oder kombinieren; nutze das Beste und Maximum aus ElevenLabs."
- Rollen statt Sprecher: `pa` (Anlage), `operator` (Leitstelle im Dienst, je Lauf per Seed aus
  zwei bis drei Personen gewählt), `lead` (Schichtleitung: 5/2/1 Minuten und die verlorene
  Nachbesprechung); v3-Regie-Tags in den Takes; `--design <rolle>`, `--keep <rolle>=<n>`,
  `--plan` (Zeilen, Zeichen, Credits je Person), `--fresh` rendert nur die gewählte Besetzung
  und nur fehlende Dateien; Seite `/voices` (nur `pnpm dev`) spielt alle Stimmproben und alle
  gerenderten Zeilen je Sprecher. Kosten: je weiterer Operator ≈ 10.000 Credits; der große
  Render wartet auf die fertige Besetzung.

### M-1 Drei Spielende: Beweis und Sichtbarkeit — Status: erledigt (M-three, Merge 2026-11-14, a2ef8da; drei Review-Runden; Cloud-CI grün auf 347d444, Check und Walkthrough; CI-Budget um zwei Minuten angehoben) · Größe: M
- Befund: mechanisch trägt die dritte Person (Leserin mit Regeln, Notizen und Funk an Zwei-Pult-
  Stationen; Platten, Sicherung, Schlüssel, Kameraplatte sonst), aber Modultests spielen Blackout
  nur zu zweit, der Harness auch; die Validierung beweist nur Erreichbarkeit.
- Vorbilder: Keep Talking (Needy-Module, die alle 30–60 s eine Hand brauchen), Lovers in a
  Dangerous Spacetime (gleiche Stationen, mit mehr Leuten parallel besetzt), Spaceteam (Befehle
  an bestimmte Pulte), Overcooked (verkettete Aufgaben, niemand steht herum).
- Modultests über alle Crewgrößen min..max; Harness mit dritter Spielerin (Cleo) in Blackout mit
  Captures; Zielzeile nennt der dritten Person ihre Aufgabe („Cleo: Platte halten"). Eine echte
  Drei-Pulte-Station oder ein Needy-Objekt nur bei drei Spielenden erst nach Playtest-Daten.
- Studie G-2, Rang 1 und 8: das Nadelventil als dritte Hand (T-4); das Relais, an dem je Notfall
  ein Bedienelement ausfällt und seine Anweisung zum nächsten wandert (Spaceteam).
- Umgesetzt (M-three): Die Modultests spielen jede Mission für jede Crewgröße durch den Reducer,
  Blackout zu zweit und zu dritt, je 200 Seeds ohne Alarm; die dritte Hand liest an Zwei-Pult-
  Stationen und läuft sonst (Teile, Schlüssel, Spind, Platten bis zur Lösung), und an jeder
  Station arbeiten so viele, wie sie Plätze hat (`core/src/hands.ts`). Blackout hat zu dritt an
  jeder Station Platz für alle: 3, 4, 3, 3, 3, 4. Der Server meldet jetzt, wer auf welcher Platte
  steht; die Zielzeile nennt ab drei Spielenden jede Hand, die eigene zuerst („Cleo: Klemmbrett ·
  Anna: Pult A · Ben: Pult B", frei: „Cleo: frei — Handbuch, HALTEN"), das quer gehaltene Handy
  die eigene als Chip. Harness-Probe `three`: Anna, Ben und Cleo bis zur Signalkette, fünf
  Captures, 75 bis 100 s. Kettenreaktion und Doppelschicht: siehe N-6.

### I-1 Zugangskontrolle mit Zwei-Faktor — Status: erledigt (I-access, Merge 2026-11-14; drei Review-Runden; Cloud-CI grün auf 4136fa0; Modul mit Probe-Mission und Drill im Systemcheck-Lauf, Platz in Blackout nach dem Playtest, N-6) · Größe: L
- Pult A Login-Terminal, Pult B Token-Generator mit Code, der mit der Serveruhr alle 30 s
  wechselt (Restsekunden sichtbar), Quelle Benutzerliste mit Rollen. Vorbilder: Quadrilateral
  Cowboy (`door.open(3)`: das Terminal gibt die Tür drei Sekunden frei, jemand muss durch),
  Among Us (ID-Code ablesen und eintippen; Reaktor mit zwei Händen an zwei Panels).
- Dazu als eigenes Spielelement: eine Schleuse, die das Terminal fünf Sekunden öffnet, während
  die andere Person läuft (nutzt die vorhandene Bewegung).
- Studie G-2, Rang 3 und 5: Leitstand mit Türcodes (Lethal Company: wer läuft, liest den Code an
  der Tür, das Terminal öffnet sie für fünf Sekunden) und Kartenleser mit Gefühl (Among Us: Pult B
  nennt die Karte, sie geht in einem gedruckten Tempofenster durch den Leser).
- Umgesetzt als Modul `access` (`docs/gameplay.md`, „The Zugangskontrolle"): Das Terminal nennt
  die angeforderten Türen und nimmt `login`, den Token, `status` und `freigeben`; das
  Tokengerät ist je Periode an ein Konto gebunden und zeigt dessen Token mit ablaufendem
  Balken; welches Konto welche Rolle hat und welche Türen eine Rolle freigibt, steht nur auf der
  Benutzerliste des Laufs, jeden Lauf neu verteilt, und das Gerät beginnt nie mit dem Konto der
  ersten Tür. Falscher Token und Freigabe ohne Berechtigung sind Alarme, drei falsche Token
  sperren das Konto auf der Uhr der Station. Felder `doors`, `tokenSec`, `openSec`,
  `lockSec`. Die Tür offen zu halten, während jemand durchläuft, bleibt Fiktion, keine Regel.
- Steht in der Übungshalle (G-2) und in der Probemission `tools/fixtures/access-probe.json`, die
  der Rundgang im Systemcheck spielt (Gruppe `access`). Offen für N-6: ob und wo die Station in
  Blackout steht — mit zwei Spielenden muss die Liste vor den Pulten gelesen (oder notiert) werden.

### I-2 Firewall-Regelwerk — Status: wartet (Entscheidung Uros) · Größe: L
- Pult A zeigt laufende Pakete (Quelle, Ziel, Port), Pult B bearbeitet die Regelliste, erste
  passende Regel gewinnt, Quelle Sicherheitsrichtlinie. Vorbilder: Hacknet und Uplink (Trace-
  Zähler, sobald man drin ist), Exapunks (Regeln im gedruckten Heft).
- Dritter Entwurf in Reserve: Datensicherung (Plattenarray, Backup-Katalog, Rotationsplan).
- Studie G-2, Rang 9 (Operation: Tango): beide Hälften zugleich in Bewegung — Pakete fließen an
  Pult A, während Pult B die Regeln bearbeitet.

### S-1 Hauptmenü wie ein Spiel — Status: erledigt (S-menu, Merge 2026-11-13; zwei Review-Runden; Szene 1,07 ms je Frame, Menü-Fenster 16,7 ms p95; vier Musik-Einträge warten auf den Render) · Größe: L
- Uros 2026-11-12 mit Screenshot: „Das soll besser werden wie echte Spiele, Main Menu." Befund
  im Bild: eine Karte auf leerer Seite, Systemschrift, kein Ton, keine Figuren, ein nativer
  Tooltip über den Missionskarten, der Aufkleber „Erster Einsatz?" über dem Tutorial-Titel,
  Safaris Passwortmanager über dem Code-Feld.
- Neu: lebende Szene (beleuchtetes Labor, langsame Fahrt, 30 fps im Leerlauf) hinter Titel und
  senkrechtem Menü (Einsatz starten, Beitreten, Offene Runden, Handbuch, Bestenliste, Editor,
  Einstellungen), per Tastatur und Controller; Profil-Chip oben rechts mit Name, Farbe und
  eigener Figur (Platz für die Anmeldung aus K-1); gebundener Einsatz als erster Menüpunkt;
  Titelthema und Anlagenbrummen als Katalog-Einträge zum Rendern; Tür-Wischblende in die Lobby.
- Vorbilder: Half-Life 2 und Firewatch (Menü über einer lebenden Szene), Alien: Isolation
  (Titel mit Röhrenflimmern und Brummen), Among Us (Figuren sind von Anfang an da).
- Hinter der Karte zieht das beleuchtete Labor aus dem Intro langsam vorbei; Titelthema aus
  ElevenLabs Music (60 s Schleife) und Anlagenbrummen; eigene Displayschrift (OFL, lokal); Klänge
  für Klick, Bereit, Beitritt; die eigene Figur erscheint neben dem Namensfeld und winkt; offene
  Runden zeigen die Figuren der Crew statt Punkten; Übergang in die Lobby als aufgehende Tür.
- Beweis: Captures join/lobby an allen Größen, Pixelchecks der anderen Bildschirme, Frame-Fenster
  der Startseite ≤ 16,7 ms p95 bei Software-GL.
- Nachtrag Uros (Musik wie in Profispielen, kommerziell nutzbar): die Lobby behält das Titelthema
  6 dB leiser samt Brummen; die Endkarte spielt nach ihrem Stinger ein eigenes Thema
  (`end-won`, `end-lost`, je 32 s, einmal); immer nur ein Musikstück zugleich; `docs/sound.md`
  hat einen Abschnitt „Lizenz".
- Offen nach dem PR: Titelthema (`menu-theme`, 60 s), die zwei Endthemen und das Anlagenbrummen
  (`bed-facility`, 10 s wie jedes Raumbett) rendert Uros, etwa 2.352 Credits; die Befehle stehen
  in `docs/sound.md` unter „The end cards", bis dahin klingen nur die Bedienlaute und die
  Stinger. Die 47 Leitstellen-Zeilen vom 2026-10-25 sind vielleicht vor dem bezahlten Plan
  entstanden: neu aufnehmen (Befehl unter „Lizenz"), dann ist alles kommerziell nutzbar.

### S-audition Musik nach Gehör wählen — Status: erledigt (S-audition, 2026-11-13) · Größe: S
- `--candidates 3` macht von jedem Musikstück drei Takes nach `packages/client/takes/`, die
  Seite `/sounds` spielt sie unter ihrem Stück (nur mit `pnpm dev`), und
  `node scripts/sfx.ts --keep <id>=<n>` übernimmt den gewählten Take samt Manifest; Befehle und
  Kosten je Take stehen in `docs/sound.md` unter „Takes und Auswahl".

### S-2 Begehbarer Pausenraum — Status: wartet (nach S-1 und R-3) · Größe: XL
- Vorbilder: Phasmophobia (begehbarer Raum, Tafel mit Auftragswahl, Tür öffnet beim Start),
  Deep Rock Galactic (Countdown erst, wenn alle in der Kapsel stehen), Lethal Company (Hebel
  startet), Among Us (frei herumlaufen und reden).
- Lobby als kleiner Raum im echten Renderer: Spinde in Crewfarben, Tafel mit Briefing, an der
  der Host die Mission wählt, Kaffeemaschine, Tür zu Trakt C geht auf, wenn alle bereit davor
  stehen; Bewegung, Anwesenheit, Näheklang wie im Spiel.

### S-3 Hauptfigur im Menü — Status: erledigt (S-hero, Merge 2026-11-14; drei Review-Runden; Cloud-CI grün auf da61eca; Figur ab ≈ 1100 px Breite, +0,64 ms je Frame mit Strahl, Mikro-Schimmer +0,27 ms; der gemessene Software-GL-Lauf folgt nach H-4 über den ganzen main) · Größe: M
- Uros 2026-11-13 mit dem Titelbild von God of War III: „Eine coole Hauptfigur-Animation noch vor
  der Karte, die Karte kann bleiben." Nicht dasselbe, aber das Prinzip: die Figur groß und
  lebendig im Vordergrund rechts, die Welt dahinter, das Menü links.
- Die eigene Figur in der eigenen Farbe, etwa 5 Kacheln hoch, mit Atmen, Umschauen,
  Visier-Schimmer bei Mikro, Winken bei Namenswechsel; die Handlampe wirft ihren Kegel mit
  Staub auf das ziehende Labor und hält kurz auf dem Menüpunkt unter der Maus; Auftritt beim
  ersten Menü: Hereinlaufen von rechts, Klick, Lampe an; Kopf dreht sich zum Menüpunkt, Figur
  tritt beiseite, wenn ein Panel aufgeht; ab etwa 1100 px Breite, wo sie neben dem breitesten
  Panel mindestens 3,5 Kacheln hoch stehen kann (1080 px bei 720 px Höhe, 1115 px bei 820),
  darunter und am Handy bleibt der Chip. Kosten ≤ 1 ms je Frame zusammen.
- Im PR: Figur und Kegel zusammen 0,64 ms je Frame (Figur 0,30, Kegel 0,34; Bench 4× gedrosselt,
  Canvas-Pfad), Menü-Fenster 16,7–16,8 ms p95 bei Software-GL. Ein sendendes Mikro kostet mit dem
  Visier-Schimmer +0,27 ms je Frame (vorher +1,88, als er die ganze obere Ebene der Figur je Frame
  neu zeichnen ließ; im exklusiven Bench-Fenster bestätigt, +0,24 gegen +2,32); Figur und Kegel
  kamen dabei bei Last 4–17 auf 0,90 ms ohne und 1,17 ms mit Mikro. Abweichend von der Spec: der
  Kegel ist ein einmal gebackenes, je Grad gedrehtes Bild statt eines Verlaufs je Frame (der kostete
  1,3 ms und mehr); bei 1024 px Breite gäbe der Platz neben dem breitesten Panel nur 2,6 Kacheln her
  (3,1 bei 640 px Höhe), dort steht nur der Chip; der Chip behält seine kleine Figur.

### S-4 Konto in die Leiste, Hero mit Geschichte, Tür vor jedem Menüwechsel — Status: in Arbeit (S-hero2, Spec `spec-S-hero2.md`) · Größe: M
- Uros 2026-11-14 09:45 mit Screenshot des Menüs: Der Konto-Chip sitzt „auf dem Premium-Platz"
  über der Bühne und gehört in die obere Leiste (Avatar, den der Nutzer setzt, oder nichts); der
  Hero soll „cooler" werden wie das God-of-War-Titelbild (kein Gesicht, etwas Eigenes), sich bei
  Klick auf einen Menüpunkt bewegen; die Tür-Animation vor Menüwechseln zurück; das Design besser.
- Plan: Konto-Element in der Leiste (Kopf der eigenen Figur als Avatar, Name, Klick öffnet den
  Konto-Reiter; hochgeladene Bilder nicht in diesem Paket); Bühne hinter dem Hero dunkler, der
  Kegel als Hauptlicht mit Staub und Kantenlicht, Dreiviertel-Pose, Atmen, Umschauen, Lampenflackern;
  Klick: halber Schritt, Lampe flackert auf, dann die Tür (voll zu Lobby/Editor/Lauf, kurze Blende
  vor Panels); reduzierte Bewegung: Schnitte; Design-Durchgang (Titel, Menüpunkte, Panelrahmen,
  Abstände, Handy); Budget ≤ 1 ms je Frame bleibt, Stills zuerst zur Auswahl.
- Nachtrag Uros 09:58: je Menüpunkt ein eigener Ort im Labor statt derselben driftenden Stelle –
  die Kamera fährt beim Hover langsam hin (Einsatz starten → Reaktor und Notausgang, Beitreten →
  Pforte im Flur, Offene Runden → Leitstand, Handbuch → Archiv, Bestenliste → Tafel, Meine
  Einsätze → Spinde, Editor → Werkstatt, Einstellungen → Maschinenraum), die Lampe leuchtet den
  Raum aus; mit reduzierter Bewegung Schnitte; Orte mit Koordinaten in der Art-Bible.

### U-1 Pausenmenü, Verlassen wie Dota 2, Einstellungen und Chrome — Status: erledigt (U-pause, Merge 2026-11-14; drei Review-Runden mit Playwright-Repros; Cloud-CI grün auf fe6222c; Rest: nach „Zum Hauptmenü" bleibt ein toter Zurück-Schritt je Tab) · Größe: L
- Uros 2026-11-14: „Spielabbruch richtig: Der Spieler kann das Spiel nicht verlassen, wann er
  will, und ins Hauptmenü zurück. Wie Dota 2: joinen, nach Disconnect reconnecten, verlassen."
  Und: „Einstellungen im Spiel haben kein gutes UI; alles, was nicht direkt Spiel ist, Leisten,
  Menüs, soll besser werden wie echte Spiele." Heute führt aus `Game.tsx` kein Weg ins Menü.
- Pausenmenü per Esc, Zahnrad, Controller-Start (Weiter, Einstellungen, Handbuch, Zum Hauptmenü,
  Einsatz aufgeben, Raum verlassen, Zuschauen beenden), ohne die Uhr der Crew anzuhalten; „Zum
  Hauptmenü" schließt die Leitung sauber und lässt den Platz gebunden (Menükarte „Zurück zum
  Einsatz"); Host-Übergabe in der Lobby; Zurück-Taste des Browsers öffnet das Menü; Einstellungen
  in Reitern Ton, Bild, Steuerung, Zugang, Konto mit Live-Vorschau und Zurücksetzen je Reiter;
  Leisten und Panels im Stil des Hauptmenüs. Vorbilder: Dota 2, Hades, Celeste, Deep Rock,
  Helldivers 2, Overcooked 2.

### G-2 Vorbilder-Studie und Übungshalle — Status: erledigt (G-testground, Merge 2026-11-14, 0deec7d; drei Review-Runden; Cloud-CI grün auf 244bcac, Check und Walkthrough; Hallen-Drill 189 s auf dem Runner) · Größe: L
- Uros 2026-11-14: „Minispiele und Gameplay-Elemente von wo abschauen; im Tutorial ein Testground,
  wo alle Minispiele testbar und spielbar sind; Gameplay-Verbesserung ist ein anderes Ticket."
- `docs/gameplay-models.md`: je Vorbild (Keep Talking, Among Us, Spaceteam, We Were Here,
  Operation: Tango, Portal 2 Co-op, Escape Simulator/Academy, Overcooked 2, Lovers in a Dangerous
  Spacetime, Phasmophobia, Lethal Company) zwei bis drei entlehnbare Mechaniken, gemappt auf
  unsere Invarianten, mit einer Rangliste von 8–10 Übernahmen als Backlog-Zeilen. Dazu Missionen
  mit freier Stationsreihenfolge und ohne Uhr, und die Mission „Übungshalle": jede Station einmal,
  Regeln daneben, aus der Modulliste erzeugt, im Harness bis zum Ende gespielt.
- Umgesetzt: die Studie mit zehn gereihten Übernahmen und dem, was wir bewusst nicht übernehmen;
  neu daraus G-3 bis G-6, die übrigen hängen an T-4, M-1, I-1, I-2 und N-6. Missionen mit
  `order: 'free'`: jede Station offen, die Crew wählt, jeweils eine läuft, die Zielzeile zählt
  die übrigen; mit `timeLimitSec: 0` ohne Uhr: die Leiste zählt hoch, weder Alarm noch Notiz
  kostet Zeit, keine Anstöße der Leitstelle (`docs/gameplay.md`). Die Übungshalle: 40 × 33
  Felder, dreizehn Stationen mit siebzehn Pulten (jeder Typ außer dem Relais, das nur als Notfall
  läuft), je Station Buch und Schild in einer eigenen Nische, Licht von Anfang an, ohne Uhr,
  Drohnen, Notfälle und Luke (die letzte Station gewinnt den Lauf), 2–3 Spielende; aus der
  Modulliste erzeugt, im Menü mit „Jede Station zum Üben"; jeder Systemcheck-Rundgang spielt sie
  vorab als eigene Probe (Gruppe `hall`) bis zum Sieg.

### G-3 Teile aus einer Lösung — Status: wartet (Entscheidung Uros) · Größe: M
- Studie Rang 2 (Overcooked 2, Among Us): Eine gelöste Station gibt ein Teil aus, das eine andere
  braucht, etwa eine Sicherung oder eine Lochkarte. In freier Reihenfolge teilt sich eine Crew zu
  dritt dann in ein Paar an der nächsten Station und eine Person, die das Teil trägt; jede Station
  behält ihre zwei. Die Teile, ihr Tragen und ihre Ablage gibt es schon (`items`,
  `requiredFor`), neu ist ein Teil, das erst mit einer Lösung erscheint, und die Validierung,
  dass es seine Station erreicht. Antwortet auf T-4 und M-1, ohne eine Regel an einer Station zu
  ändern.

### G-4 Lagetafel — Status: wartet (Entscheidung Uros) · Größe: M
- Studie Rang 6 (Phasmophobia, das Journal als Gedächtnis der Crew): eine Tafel in der Welt, an
  die der Notizblock Mitschriften heftet („Anheften"); wer davor steht, sieht alle Zettel der
  Runde, sonst niemand — die Sicht folgt der Anwesenheit. Angeheftet wird nur, was jemand selbst
  mitgeschrieben hat, so wie der Notizblock die eigene Abschrift ist; eine Eingabe braucht
  weiter zwei. Braucht ein Kartenelement `board`, eine Liste der Zettel je Runde im Server und
  die Sicht der Tafel.

### G-5 Rollentausch in einer Station — Status: wartet (Entscheidung Uros) · Größe: S
- Studie Rang 7 (We Were Here Together): Die zweite Stufe einer Station nimmt Eingaben nur von
  der Person, die in der ersten gelesen hat; das Gerät sagt es auf seinem Schild („Stufe 2:
  Freigabe nur von der Prüfseite"). Ein Wächter im `apply` des Moduls als Schalter je Modul, die
  Sichten bleiben, wie sie sind; wer liest und wer drückt, tauscht mitten im Gerät.

### G-6 Anhang Laborkennung — Status: wartet (Entscheidung Uros) · Größe: S
- Studie Rang 10 (Keep Talking, die Anhänge des Handbuchs): eine gedruckte Seite „Anhang:
  Laborkennung", die Kennung, Kontrollleuchten und Notstromzellen einmal erklärt; jede Regel, die
  sie liest, verweist darauf, statt sie in eigenen Worten neu zu erklären. Liegt bei jeder Quelle,
  die eine Station mit Laborkennung abdeckt; die Handbuch-Stimmtests prüfen den Wortlaut.

### K-1 Konto wie bei Dota — Status: K-1a erledigt (K-accounts, Merge 2026-11-14; vier Review-Runden, Cloud-CI grün mit Postgres-Dienst); K-1b bereit (Entscheidung Uros 2026-11-12: eigene Konten, Google zuletzt) · Größe: L
- Reihenfolge: **K-1a** Datenbank (Neon-Postgres, Prisma) mit Konto je Dienstausweis (Kennung,
  Anzeigename, Farbe, Erfolge), Läufe und Bestenliste in der Datenbank statt der Datei, die
  Render bei jedem Deploy löscht, „Meine Einsätze"; ohne `DATABASE_URL` weiter Datei und Gast
  (Entwicklung, CI). **K-1b** Anmeldung mit Google (Identity Services, `jose`), die ein Konto
  geräteunabhängig macht; Übernahme und Bestätigung entfallen für Angemeldete.
- K-1a im PR (K-accounts): Prisma 6 (Prisma 7 verlangt einen Treiber-Adapter samt `pg`),
  Tabellen accounts, identities, runs, run_members, achievements; Speicher hinter einer
  Schnittstelle (Datei oder Postgres, eine Zeile im Start-Log), Konto je Dienstausweis mit Name
  und Farbe, „Konto löschen" in den Einstellungen, Läufe je Sitz nach Konto in einer Transaktion,
  Erfolge je Konto, „Meine Einsätze" neben der Bestenliste; CI mit Postgres-16-Dienst, Smoke mit
  `TEST_DATABASE_URL`, `docs/accounts.md`. Offen bei Render: `DATABASE_URL` (Neon) setzen.
- Uros 2026-11-12: „Wieso nicht wie Dota Accounts?" Heute bindet ein Dienstausweis je Browser
  (R-3); ein anderes Gerät kommt nur per Übernahme mit Bestätigung der Crew hinein. Ein Konto
  macht die Identität geräteunabhängig: anmelden, und der laufende Einsatz holt einen zurück,
  Übernahme und Bestätigung entfallen für Angemeldete, Bestenliste und „Meine Einsätze" hängen
  am Konto.
- Vorschlag ohne eigene Nutzerdatenbank (Render Free hat keine Platte): Anmeldung über einen
  Identitätsanbieter (Google, dazu GitHub für Studierende), der Server prüft das ID-Token und
  leitet daraus den Ausweis ab (`HMAC(sub)`); Gastmodus bleibt wie heute. Braucht: OAuth-Client
  beim Anbieter (Uros), `GOOGLE_CLIENT_ID` in Render, eine Bibliothek zur Token-Prüfung (`jose`,
  begründet), später eine kleine Datenbank (Neon oder Turso, kostenlos) für Verlauf und
  Erfolge je Konto.
- Alternative mit eigenen Konten (Name und Passwort, `crypto.scrypt`, Neon-Postgres,
  Wiederherstellungscodes statt E-Mail): mehr Code, mehr Angriffsfläche, kein Dritter.
- **K-1c** An- und Abmelden, Konto wechseln — Status: bereit (Spec `spec-K-login.md`, nach
  U-pause) · Größe: M. Uros 2026-11-14: „Bei Konten sollte man sich an- und abmelden oder wechseln
  können." Ausweisnummer vom Server geprägt (lesbar, ohne 0/O/1/I), Kennwort vom Spieler gesetzt
  (`crypto.scrypt`, 8–128 Zeichen, kein E-Mail, noch keine Wiederherstellung), „Anmelden" zeigt
  den Dienstausweis des Geräts auf das Konto um, „Abmelden" prägt einen neuen Ausweis (Gast), der
  Platz im Einsatz folgt dem Konto (Wiedereintritt von jedem angemeldeten Gerät ohne Übernahme);
  Limits je Adresse und je Ausweisnummer. Google (K-1b) bleibt zuletzt.

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
