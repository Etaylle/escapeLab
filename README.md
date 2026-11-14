# EscapeLab

Kooperatives Browser-Escape-Spiel: Die Maschine sieht, wer am Pult steht, die Regeln, wer am Buch
steht — gelöst wird nur gemeinsam, per Stimme. Missionen sind reine Daten (`missions/*.json`) —
neue Missionen brauchen keinen Code.

**Rätseltypen:** Kabel trennen (`wiring`), Symbol-Keypad (`keypad`), Schalterbank mit Prüf-Commit
(`switches`), Speicherbank (`memory`), Frequenz-Abgleich mit Farblegende (`simon`), Morsefunk
(`morse`), der Knopf (`button`), unsichtbares Labyrinth (`maze`), Synchron-Knöpfe (`button-sync`),
Signalkette an zwei Pulten (`signal`), Sicherungskasten und Prüfpult an zwei Pulten (`circuit`),
Serverraum mit Terminal und Rack an zwei Pulten (`servers`), Zugangskontrolle mit Terminal und
Tokengerät an zwei Pulten (`access`).
Layouts/Codes sind pro Partie zufällig (seeded, deterministisch replaybar), Fehler kosten
Countdown-Zeit. **Missionen:** Tutorial (2 Spieler), Blackout im Labor (2–3 Spieler, 5 Rätsel),
die Übungshalle (2–3 Spieler, jede Station der Anlage einmal mit ihren Regeln daneben, in
beliebiger Reihenfolge und ohne Uhr), Kettenreaktion (3 Spieler, jeder startet in einem anderen
verschlossenen Raum und kommt nur mit Hilfe heraus) und Doppelschicht (4 Spieler in **zwei
getrennten Flügeln** — die Regeln jeder Station liegen im anderen Flügel, und erst der
Druckausgleich öffnet die Schleuse dazwischen).

**Blackout im Labor** (2–3 Spieler, 15 Minuten auf *Normal*): ein Labor von 36 × 22 Feldern, die
Räume etwa 9 × 7 groß als Ring — Archiv, Flur, Serverraum, Ost-Flur, Reaktor, Süd-Flur, Labor,
Maschinenraum und zurück in den Flur; die Flure vier Felder breit, die Hauptwege durch zwei Felder
breite Durchgänge, nur die Türen, die Geräte sind, ein Feld breit. Die Crew startet getrennt und
außer Sicht (Archiv, beide Enden des Flurs) und wirft zuerst gemeinsam den Notlicht-Hebel in der
Mitte des Flurs, dann die Stationen in Reihenfolge:

1. *Notstrom-Kasten* (`circuit`): Sicherungskasten im Maschinenraum hinter der Plattentür,
   Prüfpult im Flur davor; die Regeln im Handbuch im Archiv, die Laborkennung daneben. Nach
   jedem Schnitt wird neu gemessen, ein Fehlschnitt verdrahtet den Kasten neu.
2. *Signalkette* (`signal` mit Legende): Pult A im Flur, Pult B im Maschinenraum, die Legende
   auf dem Klemmbrett; ab Stufe 3 zeigt das sendende Pult die Zeichen nacheinander, in der
   letzten Stufe ohne Farbe, nur mit ihrem Muster, das die Legende einer Farbe zuordnet.
3. *Serverraum* (`servers`): Terminal und Rack an zwei Pulten im Raum hinter dem Schott, die
   Regeln im Spind dort.
4. *Frequenz-Abgleich* (`morse`): Pult im Labor, die Tabellen im Aktenschrank, dessen Schlüssel
   im Serverraum liegt.
5. *Reaktor-Neustart* (`button-sync`): erst mit der Ersatzsicherung aus dem Archiv; die ganze
   Crew drückt gemeinsam. Dann öffnet die Luke im Archiv, und es geht einmal quer durchs Labor
   hinaus — durchs Labor oder am Serverraum vorbei, beide Wege gleich lang.

Drei **Notizen der letzten Schicht** hängen frei lesbar im Labor — am Hebel, im Serverraum und an
der Luke (`map.notes`): Sie erzählen, was in der Nacht geschah, und lösen nichts.

**Serverraum** (`servers`): Pult A ist ein Terminal mit Statustabelle,
Fehlercodes, Protokoll und Befehlszeile (`start`, `restart`, `status` — tippen oder antippen),
Pult B ein Rack mit Stromschalter und LED je Dienst, ohne einen Code. Sechs Dienste mit festen
Abhängigkeiten kommen nach ihrem Code wieder hoch (E11 start, E23 Strom aus und an, E42 erst die
Abhängigkeiten per restart); E50 ist Quarantäne: Strom aus, nie starten, sonst infiziert er einen
weiteren Dienst. Bewiesen im Kerntest, in Blackout und in der Probemission
`tools/fixtures/servers-probe.json`, die der Systemcheck-Rundgang über den Editor mit festem Seed
importiert und bis zur Lösung spielt.

**Zugangskontrolle** (`access`): eine Anmeldung mit zwei Faktoren unter laufender Uhr. Pult A ist
ein Terminal wie das des Serverraums, das die freizugebenden Türen nennt und `login <konto>`, den
Token, `status` und `freigeben <tür>` annimmt; Pult B ein Tokengerät, das je Periode (30 s) an ein
Konto des Laufs gebunden ist und dessen sechsstelligen Token mit einem ablaufenden Balken zeigt.
Welches Konto welche Rolle hat und welche Türen eine Rolle freigibt, steht nur auf der
Benutzerliste des Laufs an der Quelle, jeden Lauf neu verteilt; das Gerät beginnt nie mit dem
Konto, das die erste Tür braucht. Ein falscher Token und eine Freigabe ohne Berechtigung kosten
einen Alarm, drei falsche Token in Folge sperren das Konto für 45 s. Noch in keiner Mission —
ihr Platz folgt dem Playtest —: bewiesen im Kerntest und in der Probemission
`tools/fixtures/access-probe.json`, die der Rundgang im Systemcheck über den Editor mit festem
Seed importiert und bis zur Lösung spielt, jeden Token vom Gerät abgelesen.

Keine Station lässt sich allein bedienen (siehe *Nie allein*), und auf *Normal* beendet der
fünfte Alarm den Lauf — auf *Hart* der dritte, auf *Entspannt* gibt es keine Grenze.

**Startseite:** Ein Hauptmenü wie in einem Spiel, über dem beleuchteten Labor der gewählten
Mission, das langsam vorbeizieht: *Einsatz starten* (die Missionskarten, „Runde eröffnen"),
*Beitreten*, *Offene Runden*, *Handbuch*, *Bestenliste*, *Meine Einsätze*, *Editor* und
*Einstellungen* — mit der Maus, der Tastatur (Pfeile, Enter, Esc) oder dem Controller
(Steuerkreuz, A, B). Oben rechts steht das Profil, das Konto des Browsers: Name, Farbe, die eigene
Figur, die winkt, sobald der Name sich ändert, und wie viele Einsätze das Konto gespielt hat. Das
Konto bewahrt Name, Farbe, Erfolge und Läufe über Neustarts und Deploys hinweg; *Meine
Einsätze* listet seine Läufe, die Einstellungen löschen es auf Wunsch
([`docs/accounts.md`](docs/accounts.md)).
*Offene Runden* listet jede Runde mit Kartenvorschau, Mission, Schwierigkeit, ihrer Crew als
Figuren und den freien Plätzen — ein Klick auf *Beitreten* genügt, niemand muss einen Code
weitergeben. Laufende Runden erscheinen ebenfalls, dort führt der Knopf zum Zuschauen. Unter
*Beitreten* bleibt ein Code-Feld für direkte Verabredungen, daneben *Zuschauen*. Bindet ein
laufender Einsatz den Dienstausweis, steht seine Karte als erster Menüpunkt da. In die Lobby
und zurück geht es durch die Schiebetüren des Labors; ab dem ersten Klick oder Tastendruck
spielen Titelthema und Anlagenbrummen, in der Lobby leiser weiter. Die Endkarte spielt nach
ihrem Stinger ein eigenes Thema: hell für einen gewonnenen, ein tiefes Dröhnen für einen
verlorenen Einsatz. Alle Musik und alle Geräusche sind mit ElevenLabs erzeugt, keine
Archivmusik (`docs/sound.md`, Abschnitt „Lizenz“).

**Ablauf einer Partie:** Lobby (Farbe wählen, **bereitmelden** — der Host kann erst starten,
wenn so viele da sind, wie die Mission braucht, und alle bestätigt haben; jede Änderung an
Mission oder Besetzung setzt die Bestätigungen zurück; die Startplätze werden beim Start
verlost) → Briefing-Countdown mit dem eigenen Startraum →
Stationen in Reihenfolge finden und lösen (in einer Mission mit `order: 'free'` in beliebiger:
jede steht offen, die Crew schaltet eine nach der anderen ein) → wenn alle gelöst sind, öffnet
sich der **Notausgang** und das ganze Team muss ihn gemeinsam erreichen, bevor die Zeit abläuft
(eine Mission mit `timeLimitSec: 0` hat keine Uhr und zählt die Zeit nur hoch) → Endbildschirm
mit Statistiken und persönlicher Bestzeit. **Hilfsmittel:** Klick auf die Welt setzt einen **Ping**
für alle (farbige Ringe, Pfeil wenn außerhalb des Bildes), `M` blendet die **Minikarte** ein,
`N` den eigenen **Notizblock** (bleibt für den Raum gespeichert), `C` öffnet den **Schnellchat**
(acht feste Sätze, Tasten `1`–`8`, erscheinen als Sprechblase über der Figur) — damit
funktioniert das Spiel auch ohne Voice-Chat.

**Sprechen:** In der Lobby lässt sich das **Mikrofon** aktivieren (nie von selbst); dann geht
die Stimme hinaus, solange `V` gedrückt bleibt — auf dem Handy die 🎤-Taste; die Leiste schaltet
auf „Mikro: offen“.
Die Stimmen gehen direkt von Browser zu Browser (WebRTC; der Server vermittelt nur den Aufbau)
und klingen nach Nähe: bis 4 Kacheln voll, bis 10 Kacheln leiser werdend, durch Wände gedämpft
— nie ganz stumm. An der aktiven Station — an ihren Pulten und den offenen Quellen dazu — hört
man sich dagegen über ihre Sprechanlage voll, wie weit auch immer; die PARTNER-Lampe am Gerät
zeigt dann „· Funk“. Wer spricht, steht in einem Ring. Zuschauer können mithören, nicht sprechen.
Ohne Mikrofon hört man die Crew trotzdem. Das Mikrofon braucht HTTPS (oder `localhost`); übers
Internet hilft `?stun=1` in der Adresse.

**Tragen:** Manche Stationen bleiben tot, bis ein Gegenstand bei ihnen eingesetzt wurde — die
Ersatzsicherung liegt im Archiv und muss quer durchs Labor in den Reaktor —, und manche Regeln
liegen in einem abgeschlossenen Schrank, dessen Schlüssel erst geholt werden muss (Blackout: vom
Serverraum zum Aktenschrank im Labor). `E` ist dabei eine einzige Kontexttaste: An der Abgabestelle
wird eingesetzt, sonst gilt, was am nächsten liegt — Teil aufnehmen, Station bedienen oder lesen;
die Einblendung sagt vorher, was `E` tut. `Q` legt das Getragene ab, sodass Übergaben möglich sind.

**Orte statt Rollen:** Das Pult einer offenen Station sieht und bedient nur, wer davorsteht
(`E` *Bedienen*, `Esc` tritt zurück — die Station behält ihren Zustand). Die Signalkette hat zwei
Pulte an verschiedenen Orten: Eins zeigt die Zeichenfolge, das andere drückt sie, und nach jeder
Stufe wechselt die Richtung. Die Regeln liegen anderswo — Buch, Terminal, Tafel, Klemmbrett,
Spind, Aktenschrank —, manche je Runde woanders.
Auf der Karte erscheint eine Quelle erst, wenn jemand nahe kommt; Spinde werden durchsucht,
Schränke mit ihrem Schlüssel aufgeschlossen. Gelesen wird Seite für Seite (`E` *Lesen*; beim
Labyrinth samt Wandplan), am Rand steht auf Wunsch eine **Notiz der letzten Schicht** mit einem
Hinweis (kostet Zeit). Andere ihrer Notizen hängen frei im Labor, an Wänden oder auf dem Boden:
Man findet sie wie eine Quelle, `E` *Lesen* öffnet den Zettel, umsonst und ohne Hinweis; das
Protokoll vermerkt „Notiz gelesen“.
Die Laborkennung hängt als Schild im Labor: Wer daran vorbeikommt, hat sie ab dann in der Leiste
und übernimmt sie per Knopf in den Notizblock.

**Die Papiere des Labors:** Jede Handbuchseite ist ein Dokument, das das Labor für die eigenen
Leute geschrieben hat, keine Anleitung an Spielende — Titelzeile mit Typ und Baujahr („Signalkette,
Typ SK-4 (Baujahr 1986)“), Zweck, Aufbau unter der Zeichnung, Betrieb (was als Fehler gilt und was
die Überwachung dann abzieht), die Tabellen der Maschine, ein Protokollauszug als durchgerechneter
Fall und Notizen aus der Werkstatt, höchstens 170 Wörter Fließtext je Seite. Die Randnotizen sind
Zettel von Leuten aus dem Labor („Nachtschicht: …“, „Admin: …“), nie die Lösung der Runde.
`core/test/manuals.test.ts` hält Aufbau, Länge und Ton aller Module und Hinweise fest: kein du, ihr
oder Sie, keine Spieler, Crew oder Partner, keine Imperative und Regieanweisungen; ein Verstoß nennt
den Satz.

**Nie allein:** Eine Eingabe am Pult zählt nur, solange noch jemand am anderen Pult oder bei den
Regeln dieser Station steht — sonst wird sie ohne Alarm abgewiesen. Der Kopf des Pults nennt die
zweite Person („Mit Ben bei: SPIND“, „Mit Ben an Pult B“) oder warnt, dass sie fehlt. Ausgenommen
sind Stationen, an denen die ganze Crew gemeinsam drückt.

**Schwierigkeit:** Der Host wählt in der Lobby zwischen *Entspannt*, *Normal* und *Hart* — das
skaliert Zeitbudget, alle Zeitstrafen, Drohnentempo und -reichweite sowie Häufigkeit und Dauer
der Notfälle.

**Wenn die Leitung abreißt:** Ein laufender Einsatz bindet die Crew wie ein Match in Dota 2.
Jeder Browser trägt einen Dienstausweis (Kennung und Geheimnis in `localStorage`), an den der
Server den Platz bindet; der Tab merkt sich nur den Raumcode, ein Neuladen ist sofort zurück im
Einsatz. Reißt eine Leitung ab, pausiert die Mission für alle (Uhr, Patrouillen, Notfälle), und
die anderen sehen „Warten auf Ben · 0:12“. Nach 60 Sekunden, bei jedem weiteren Abbruch desselben
Laufs nach 20, bietet die Karte „Ohne Ben weiter“: Die Uhr läuft wieder, und Stationen der ganzen
Crew, Luke und Flucht zählen Ben nicht mit, bis er zurück ist. Ist nur noch eine Person verbunden,
bietet die Karte stattdessen „Einsatz abbrechen“. Das Hauptmenü stellt einen laufenden Einsatz
als hellen ersten Menüpunkt voran, die übrigen gedimmt („Zurück zum Einsatz“, „Einsatz
aufgeben“), und sperrt andere Räume;
aufgeben gibt den Platz frei, unter der Mindestzahl der Crew endet der Lauf für alle („EINSATZ
ABGEBROCHEN“). Ein anderes Gerät übernimmt einen getrennten Platz mit Raumcode und genau dessen
Namen (wie bei Jackbox), sobald jemand aus der Crew es zulässt. Die eigene Seite erkennt eine
tote Leitung nach 5 Sekunden ohne Uhrantwort, 20 Sekunden Stille oder 8 Sekunden ohne offene
Verbindung, verbindet sofort neu und zeigt bis dahin „VERBINDUNG VERLOREN“ mit Versuch und
Wartezeit. Einzelheiten: `docs/gameplay.md`, „Verbindung und Wiedereintritt“.

**Pausenmenü und Verlassen:** Im Raum öffnen Esc, das Zahnrad oben, die Start-Taste des
Controllers oder „Menü“ in der Leiste das Pausenmenü — Weiter, Einstellungen, Handbuch und die
Wege hinaus —, ohne die Uhr der Crew anzuhalten; die Crew sieht „im Menü“ am Namen. „Zum
Hauptmenü“ trennt die Leitung sauber, der Platz bleibt gebunden wie nach einem Abbruch, und das
Hauptmenü führt mit „Zurück zum Einsatz“ zurück; „Einsatz aufgeben“ fragt einmal und sagt, was
es heißt. Verlässt der Host die Lobby, leitet sie, wer am längsten dabei ist. Die Zurück-Taste
des Browsers öffnet im Einsatz das Menü. Die Einstellungen stehen in Reitern — Ton, Bild,
Steuerung, Zugang, Konto —, jeder mit „Zurücksetzen“. Einzelheiten: `docs/gameplay.md`,
„Pausenmenü und Verlassen“.

**Endspurt:** In der letzten Hälfte der Zeit zieht das Ambiente hörbar an, unter einer Minute
pulsiert der Timer rot und die Ränder glühen, und die **letzten zehn Sekunden werden mit
ansteigenden Piepsern heruntergezählt** — der Schlusston kommt, wenn die Energie weg ist.

**Oberfläche:** Dauerhaft sichtbar ist nur, was sich ändert — Ziel und Fortschritt liegen als
Einblendung auf der Welt, die Uhr daneben, darunter eine schmale Leiste mit der Crew und dem
Live-Status jedes Mitglieds (hält die Platte, trägt etwas, an der Station, liest, getrennt) sowie
der letzten Funkzeile. Alles zum Nachschlagen — Auftrag, eine Legende der Kartenobjekte,
Tastenliste — steckt im **Info-Panel** (Taste `I`, alternativ `H`). Alles, wohin man laufen muss, bekommt am
Bildschirmrand einen **Richtungspfeil mit Entfernung**, solange es außer Sicht ist. Der Ton
lässt sich oben rechts abschalten; neben dem Raumcode zählt ein Chip, wie viele zuschauen.

**Gefahren unterwegs:** **Wachdrohnen** patrouillieren feste Routen und leuchten einen sichtbaren
Sichtkegel aus — wer hineinläuft, verliert Zeit (Sichtlinie zählt; wer am offenen Pult arbeitet
oder dessen Regeln liest, ist sicher). Hält jemand eine Kamera-Platte, hängt ihre Drohne still. Dazu schlagen **Notfälle** zu: Mitten im Lauf fällt die Kühlung aus, das offene Rätsel
bricht ab, und alle Notventile müssen gleichzeitig besetzt werden — je ein Spieler pro Ventil, an
entgegengesetzten Enden der Karte.

**Spielwelt:** Alle Missionen spielen in einer gerenderten Top-Down-Laborwelt
(Canvas, Among-Us-Stil): flüssige Bewegung per WASD/Pfeiltasten, Kamera folgt, das Labor liegt
im Dunkeln und jede Figur trägt ein Licht. Bewegung ist client-autoritativ (lokale Simulation +
Positions-Streaming), doch der Server nimmt nur Schritte an, die eine Figur gehen kann — keine
durch Wände oder geschlossene Türen —, und bleibt Autorität über Rätsel, Türen, Druckplatten
(öffnen, solange jemand draufsteht — eine Tür mit `untilSolved` bleibt nach dem genannten
Rätsel offen), Interaktionsdistanz und Timer. Rätsel sind leuchtende Stationen, ihr Pult öffnet
per `E` als Modal über der Welt. Welt-Code: `packages/client/src/world/` (GameWorld =
Simulation/Rendering, art = prozedurale Grafik, audio = Mix mit Bussen; die Klänge selbst kommen
aus `packages/client/audio/catalog.json`, siehe `docs/sound.md`).

**Neue Missionen** sind reine JSON-Dateien in `missions/`. `packages/core/test/missionMaps.test.ts`
prüft jede davon automatisch: gleiche Zeilenlängen, alles auf Bodenfeldern, eine Station pro
Rätsel — bei einem Rätsel mit zwei Pulten (Notstrom-Kasten, Signalkette, Serverraum) je eine für
Pult A und Pult B, mehr als vier Felder auseinander — und per Flutfüllung mit den echten
Tür-Regeln, dass die Stationen in Reihenfolge erreichbar sind (in freier Reihenfolge jede schon
ohne eine gelöste) und am Ende **alle** den Notausgang erreichen können — nur eine Mission in
freier Reihenfolge darf ohne enden, dann gewinnt die letzte Station den Lauf. Die Übungshalle
(`missions/uebungshalle.json`) entsteht aus der Modulliste: Nach einem neuen Modul schreibt
`node --import tsx ../core/test/writeHall.ts` (aus `packages/server`) sie samt Harness-Plan neu.
Eine Plattentür kann mit `untilSolved` ein Rätsel nennen: Ist es gelöst, bleibt
sie auch ohne Platte offen (Blackout: die Maschinenraumtür nach dem Notstrom). An jeder Station mit
einem Pult muss außerdem — wohin ihre Regeln auch ausgelost werden — einer am Pult stehen können,
während ein anderer sie zugleich liest, und an jeder mit zwei Pulten müssen zwei Verschiedene
zugleich an beiden stehen können.

**Missions-Editor:** „Editor" auf der Startseite öffnet eine Werkbank: das Labor mit den Kacheln
des Spiels auf eine Leinwand malen, Startplätze, Türen, Platten, Stationen, Quellen, Schild,
Raumnamen, Ausgang, Teile, Drohnenwege und Notizen der letzten Schicht (an eine Wand neben dem Boden
oder auf den Boden) setzen und in Seitenformularen bearbeiten. Die Prüfung
läuft bei jeder Änderung mit — dieselbe wie `parseMission`, Erreichbarkeitsbeweise inklusive —
und zeigt jeden Fehler auf der Karte. Gespeichert wird als eigene Mission `custom-…` nach
`missions/custom/` (nicht im Repo, Ort per `CUSTOM_MISSIONS_DIR`): `POST /missions/custom`
(JSON bis 256 kB), `DELETE /missions/custom/:id`, ohne Login, je Adresse 30 Änderungen pro
Minute; `GET /missions/:id` liefert eine Mission ganz. Jede Mission des Katalogs öffnet als
Vorlage (eine mitgelieferte als Kopie), Missionsdateien gehen per Export und Import hin und her.

## Struktur

| Paket | Zweck |
| --- | --- |
| `packages/core` | Spiellogik als pure State-Machine (`applyAction`), Missionsformat (zod), nach Standort gefilterte Views, WebSocket-Protokoll. Keine I/O — vollständig deterministisch und testbar. |
| `packages/server` | Autoritativer Node-Server: Räume, an Dienstausweise gebundene Plätze, Missionstimer, WebSocket (`ws`). Clients schicken Intents; der Server validiert und broadcastet gefilterte Views. |
| `packages/client` | React + Vite UI: Hauptmenü → Lobby → Spiel → Ende, Auto-Reconnect mit dem Dienstausweis des Browsers. |

## Entwicklung

```sh
pnpm install
pnpm dev          # Server (Port 3001) + Vite-Client (Port 5173) parallel
```

Dann <http://localhost:5173> in zwei Browser-Tabs/Fenstern öffnen, Raum erstellen,
Code im zweiten Tab eingeben, bereitmelden, starten.

```sh
pnpm test         # vitest (core: Spiellogik, server: Räume/Reconnect/Timer/Drohnen)
pnpm typecheck    # tsc --noEmit, strikt (noUncheckedIndexedAccess etc.)
pnpm lint         # eslint, zero warnings
pnpm --filter @escapelab/server smoke   # Ende-zu-Ende über echte WebSockets
```

Die Tests des Speichers in Postgres laufen gegen `TEST_DATABASE_URL` (eine Datenbank, in die sie
schreiben dürfen): Je Lauf legen sie dort ein eigenes Schema an, migrieren es und löschen es am
Ende; die CI stellt dafür einen Postgres-16-Container bereit. Ohne die Variable sagt eine Zeile am
Ende des Testlaufs, dass sie übersprungen wurden — mit dem Befehl, der sie per docker startet. Der
Smoke-Test spielt mit gesetzter Variable zusätzlich ein Tutorial auf einem Server, den das
Start-Script auf einem eigenen Schema startet und der es selbst migriert, und startet einen
Server so, wie Renders Start Command es tut.

**Zuschauen:** Wer den Raumcode eingibt und auf *Zuschauen* klickt, sieht das ganze Labor ohne
Dunkelheit, alle Figuren, die Drohnenkegel — **und die offene Station von allen Seiten**: Pult,
Regeln und Wandplan zugleich, dazu für jede Figur, ob sie am Pult steht, liest oder die Kennung
gesehen hat. Genau das macht das Zusehen unterhaltsam: Das Publikum sieht beide Hälften und
merkt vor den Spielenden, wo die Ansage schiefgeht. Zuschauer können nichts auslösen.

**Nach der Runde:** Der Endbildschirm zeigt einen Rang von S bis C aus Alarmen und Restzeit, die
**Beiträge** jedes Crewmitglieds (bedient, gelesen, gefunden, geliefert, Alarme, Notizen) und ein
Einsatzprotokoll (wann welche Station fiel, jeder Alarm mit Grund und Kosten, Notfälle, eingesetzte
Teile). Jeder Lauf kommt ins Konto jedes Crewmitglieds: *Meine Einsätze* im Hauptmenü listet
Mission, Datum, Ausgang, Zeit, Crew und Rang, die Bestenliste vergleicht alle Crews. **Nochmal:** Alle bestätigen gleichberechtigt auf dem Endbildschirm, und sobald das letzte Ja
da ist, startet derselbe Einsatz von selbst — ohne Umweg über die Lobby und ohne dass jemand
der Startknopf-Mensch sein muss. Fehlt jemand (Verbindung weg), wartet der Neustart auf die
Rückkehr. Über die Lobby geht es weiterhin, wenn Mission oder Schwierigkeit sich ändern sollen.

**Einen Lauf wiederholen (Seed):** Mit `?seed=<n>` in der Adresse eröffnet die Startseite einen
Raum mit festem Seed: Sein Lauf k (ab 0) spielt Seed n + k, Startplätze, Orte der Quellen und
jede Station wiederholen sich. Die Lobby zeigt „Seed n“ neben dem Code, der Endbildschirm und
das Laufprotokoll den Seed des Laufs — `?seed=` mit diesem Wert spielt genau diesen Lauf noch
einmal. Der Server nimmt einen Seed nur mit `ALLOW_SEED=1` an (`pnpm dev` und die CI setzen
es); ohne bleibt es beim Zufall, mit einer Zeile im Server-Log. Der Rundgang
(`tools/shots.mjs`) legt je Mission einen Seed fest, `SHOTS_SEED=<n>` wählt einen anderen. Auf
dem Seed von Blackout spielt er die Mission bis zur Siegerkarte: mit den Antworten aus
`tools/fixtures/blackout-plan.json`, die ein Kerntest aus den Lösern der Module gewinnt und
festhält, an den Drohnen vorbei und durch die Notfälle; weicht eine Station vom Plan ab, schlägt
der Lauf mit dem Seed fehl. An den Drohnen vorbei läuft er von Versteck zu Versteck — Feldern,
auf die keine Drohne je blickt —, jede Strecke erst, wenn kein Kegel sie trifft: Die Flüge sagt
`tools/patrol.mjs` aus dem Positionsstrom voraus, wie der Server sie fliegt; jede Entdeckung
steht im Log. Mit `SHOTS_SERVER=packages/server/src/index.ts` startet der Rundgang den Server
selbst, wie die CI, und probt mitten in einem Einsatz den Neustart: SIGTERM, die Karte
„WARTUNG · Der Server startet neu" auf jeder Seite, und nach dem Neustart alle zurück im Einsatz.

**Nur ein Teil des Rundgangs (Gruppen):** Jede Aufnahme des Rundgangs gehört zu genau einer von
achtzehn Gruppen (`tools/groups.mjs`); `SHOTS_ONLY=screens,intro` spielt nur diese,
`SHOTS_SKIP=perf` alle außer diesen — der schnelle Beweis eines Teils. Vor dem Rundgang laufen die
Proben, jede in einem Raum für sich: `editor`, `art`, `drones` (Gefahrensinn und eine Drohne aus der
Nähe), `reconnect`, `restart` und `three` (Blackout zu dritt bis zur Signalkette, die Zielzeile mit
jeder Hand: `three-lever`, `three-plate`, `three-hands`, `three-reader`, `three-phone-932`; der
Systemcheck nennt sie im Log als ausgelassen) — im Systemcheck dazu die Probe des Serverraums, die
zu `devices` gehört, die der Zugangskontrolle, `access`, und `hall` (die Übungshalle bis zur
Siegerkarte); Blackout nennt alle drei im Log als ausgelassen. Der Rundgang selbst: `screens` (Menü
und sein Ton, Bestenliste, Lobby, der Start aus ihr), `intro` (die Eröffnung bis `blackout.png`)
und `run` (die Mission bis zur Siegerkarte, nach dem gewonnenen Systemcheck die Einsätze des
Kontos und sein Löschen); im Lauf `devices` (jede Station,
auch auf dem quer gehaltenen Handy), `reading` (Quellen, Schild, Notizen der letzten Schicht,
Notizblock, Bücher), `hud` (das Spiel in jeder Fenstergröße, Einstellungen, Steuerung, Minikarte,
Sprint), `graphics` (Licht, Leuchten, Figuren, Kamera, Dichte 2), `audio` (Raumklang, Funk, Seite
des Partners, Musik), `voice` (Mikrofone, Sprechverbindungen) und `perf` (die Frame-Fenster). Die
Gruppen im Lauf brauchen `run` und ziehen ihn mit; `SHOTS_SKIP=run` lehnt sie ab. Jede ausgelassene,
abgelehnte oder mitgezogene Gruppe steht zu Beginn mit einer Zeile im Log, und was sie aufgenommen
hätte, zählt weder als übersprungen noch als fehlgeschlagen. Der Rundgang spielt nur so weit, wie
die gewählten Gruppen reichen: `screens` allein endet, sobald der Lauf gestartet ist, `intro` nach
`blackout.png`. Eine Aufnahme oder Prüfung gehört zur Gruppe des Schritts, der sie macht — jeder
Lauf hält jede Aufnahme an die Gruppe ihres Schritts, so prüft jeder volle Lauf die Tabelle —, und
wo der Schritt einer anderen Gruppe gehört, kommt sie nur mit dieser: die Frame-Fenster von `perf`
im Menü (`screens`), in der Eröffnung (`intro`: der Vorspann, das beleuchtete Labor und sein Blick
bei Dichte 2) und bei Dichte 2 am Pult und in der Flucht (`graphics`), die Sprechverbindungen von
`voice` nach dem Neuladen des Gast-Handys, das der Notizblock von `reading` auslöst, und der
Info-Knopf von `hud` nach einem unterwegs gelesenen Schild, ebenfalls `reading`, wo niemand am
Schild startet. Ohne beide Variablen spielt er alles wie bisher; die Zusammenfassung nennt die
gespielten Gruppen, die Zeile `groups` davor die Sekunden jeder Gruppe — was ihre eigenen Schritte
brauchten, bei `run` mit allen Wegen und Lösungen der Mission. Ein voller Blackout-Rundgang dauerte
auf einem M4 mit 16 GB (14.11.2026, Last 9 bis 17) 772 s:

| Gruppe | s | Gruppe | s | Gruppe | s |
| --- | --- | --- | --- | --- | --- |
| `editor` | 7,5 | `screens` | 25,0 | `reading` | 65,9 |
| `art` | 19,0 | `intro` | 12,3 | `hud` | 33,2 |
| `drones` | 8,2 | `run` | 292,3 | `graphics` | 51,9 |
| `reconnect` | 114,4 | `devices` | 17,7 | `audio` | 86,9 |
| `restart` | 10,8 | | | `voice` | 3,4 |
| `three` | 92,5 | | | `perf` | 22,8 |

`three` kam danach dazu (M-three): 92,5 s im vollen Rundgang desselben Tages bei Last 7 bis 31,
75 bis 91 s allein mit `SHOTS_ONLY=three`.

`SHOTS_ONLY=screens,intro` spielte Blackout in 48 s; jede Gruppe im Lauf zieht die Mission bis
zur Siegerkarte mit, und `SHOTS_ONLY=run` allein dauerte 262 s (den Systemcheck 85 s). Die
Übungshalle, `hall`, kommt nur im Systemcheck dazu: 189 s im CI (14.11.2026; der Schritt brauchte
9:42 seiner 14 Minuten), lokal 269 s bei Last um 30, davon 45,6 s an der Zugangskontrolle, deren
Tokengerät alle 15 s zum nächsten Konto wechselt. Ihre Frames misst sie, während 13 von 13
Stationen scharf sind: beim Host an 21,13 zwischen zwei Reihen der Halle, 8 von 17 Pulten und 2 von
13 Büchern im Bild (im CI p50 16,7 ms, p95 16,8 ms über 137 Frames), beim Publikum über die ganze
Halle, alle 17 Pulte und 13 Bücher im Bild (p50 16,7 ms, p95 16,7 ms über 121 Frames).

**Ton und Funkstimme:** Jeder Raum klingt nach seiner Art, die Schritte des Partners kommen von
dort, wo er steht, und die Musik zieht mit dem Druck an ([`docs/sound.md`](docs/sound.md)). Zwei
Stimmen sprechen: die Leitstelle am Funk — zum Start, nach jeder Lösung, wenn es still wird, beim
ersten Alarm, bei fünf, zwei und einer Minute Restzeit, im Notfall, mit einem Schlusswort auf der
Endkarte und mit einer Funkprobe in der Lobby — und die Anlage über ihre Lautsprecher. Eine Zeile
darf zwei oder drei Fassungen haben, ein Lauf sagt eine. Die Aufnahmen liegen in
`packages/client/public/voice/` (ElevenLabs: die Leitstelle „Helmut"). Die eigene Stimme der Anlage
entsteht per Voice Design und wartet wie die neuen Zeilen noch auf den Render, bis dahin spricht
Helmut die Durchsage im Intro (Befehle in `docs/sound.md`). Wer einen Funktext in
`missions/*.json` ändert oder neu schreibt, nimmt ihn neu auf — der Test, der jede Zeile prüft,
nennt den Befehl:

```sh
VOICE_ENGINE=elevenlabs pnpm --filter @escapelab/client voice   # nur fehlende Zeilen, ElevenLabs
pnpm --filter @escapelab/client voice            # nur fehlende Zeilen, offline (Piper über uv)
VOICE_ENGINE=say pnpm --filter @escapelab/client voice --fresh   # ohne Netz: die Mac-Stimme Anna
```

## Für den Demo Day (ein Prozess, eine URL)

```sh
pnpm cert         # einmal: Zertifikat für HTTPS im LAN (braucht openssl, macOS/Linux haben es)
pnpm build        # Client-Bundle nach packages/client/dist
pnpm start        # Server liefert Spiel + API + WebSocket auf einem Port
```

Beim Start schreibt der Server alle Netzwerk-Adressen in die Konsole
(`https://10.0.0.184:3001`, ohne Zertifikat `http://…`) — unter dieser Adresse können
Mitspielende im selben WLAN direkt mit Laptop oder Handy beitreten, ohne irgendetwas zu
installieren. Port über `PORT=8080` änderbar.

**HTTPS im LAN, ohne Hosting:** Mikrofon und wach bleibenden Bildschirm gibt ein Handy nur einer
sicheren Adresse frei, und `http://<LAN-IP>:3001` ist keine. `pnpm cert` legt ein
selbstsigniertes Zertifikat nach `packages/server/cert/` (nicht im Repo), gültig für `localhost`,
`127.0.0.1` und die LAN-Adressen dieses Rechners — nach einem Netzwechsel `pnpm cert --force`.
Liegt es dort, spricht der Server HTTPS (`TLS: an` im Log); die Adresse mit `https://` eintippen.
Beim ersten Besuch warnt jedes Handy einmal vor dem Zertifikat:

- Chrome (Android): „Erweitert“, dann „Weiter zu 10.0.0.184 (unsicher)“.
- Safari (iOS): „Details einblenden“, dann „diese Website besuchen“ und „Website besuchen“.
- Danach gehen Mikrofon und der wach bleibende Bildschirm im Lauf. Installieren als App und den
  Service Worker lässt Chrome erst zu, wenn das Handy dem Zertifikat vertraut — eine bestätigte
  Warnung reicht dafür nicht.

| Variable | Wirkung |
| --- | --- |
| `TLS_CERT`, `TLS_KEY` | Zertifikat und Schlüssel (PEM) von anderswo statt aus `packages/server/cert/`. |
| `TLS=off` | Immer http, auch mit Zertifikat. So laufen `pnpm dev` (Vite leitet per http weiter) und der Smoke-Test. |

**Auf dem Handy:** Ein Lauf geht in den Vollbildmodus (beim Bereitmelden oder Starten, sonst
beim ersten Antippen) und dreht sich ins Querformat — auch über `http://<LAN-IP>:3001`, in den
Browsern von Android; das iPhone kennt beides nicht. Die PWA-Teile brauchen dagegen eine sichere
Adresse, also HTTPS oder `localhost`: die App auf den Startbildschirm legen, der Service Worker
(Zwischenspeicher, Zeile „Neue Version — neu laden“) und ein Bildschirm, der wach bleibt. Über
die LAN-Adresse per http fehlen sie still; nur die Startseite sagt in einer Zeile, dass es
ohne HTTPS kein Mikrofon gibt.

**Laufprotokoll (die Datei, wo keine Datenbank ist):** Jeder beendete Lauf, gewonnen oder
verloren, kommt als Bericht in den Speicher des Servers; jede Revanche als eigener Lauf. Mit
`DATABASE_URL` ist das die Datenbank (siehe „Hosting auf Render" und
[`docs/accounts.md`](docs/accounts.md)), ohne hängt der Server den Bericht als eine Zeile JSON an
eine Datei an — der Rückfall für die Entwicklung, das LAN und die CI; geschrieben wird immer nur
an eine der beiden Stellen. Im Bericht stehen Mission, Schwierigkeit, Zeitlimit und Alarmgrenze,
die Crew mit den Namen, unter denen sie spielte, und ihren gezogenen Startplätzen, Start, Ende und
Ausgang (`won`, `lost:time`, `lost:alarms`, `lost:abandoned`), je Station wann sie dran war und
wann sie fiel, die Sekunden dazwischen, ihre Alarme und Notizen, dazu die Notfälle, alle Alarme
nach Ursache und die Beiträge (`p1` bis `pn`). Kann der Server einen Lauf nicht ablegen (Platte
voll, falscher Pfad, Datenbank weg), steht das im Server-Log, und das Spiel läuft weiter.

| Variable | Wirkung |
| --- | --- |
| `RUNS_LOG` | Pfad der Protokolldatei ohne Datenbank, am besten absolut. Ohne: `packages/server/data/runs.jsonl`. Fehlende Ordner legt der Server an. |
| `RUNS_TOKEN` | Gibt `GET /runs.jsonl` frei — alle abgelegten Läufe, ältester zuerst, aus der Datei oder der Datenbank —, nur mit dem Header `Authorization: Bearer <RUNS_TOKEN>`. Ohne Token antwortet die Route 404. |

```sh
RUNS_TOKEN=… RUNS_LOG=/var/lib/escapelab/runs.jsonl pnpm start
curl -H "Authorization: Bearer $RUNS_TOKEN" http://<host>:3001/runs.jsonl -o runs.jsonl
pnpm --filter @escapelab/server runs runs.jsonl   # Tabelle zum Balancing
```

Die Tabelle zeigt je Mission und Schwierigkeit Läufe, Siegquote und mittlere Dauer (Median),
je Station die mittleren Sekunden und Alarme und die drei langsamsten Stationen. Ohne
Dateiangabe liest `runs` die Datei aus `RUNS_LOG` bzw. die Standarddatei; mit Datenbank holt man
die Läufe per `GET /runs.jsonl` und gibt `runs` die geladene Datei.

## Hosting auf Render

Das öffentliche Spiel läuft als ein Web Service auf Render (Free-Plan): Build `corepack enable
&& pnpm install --frozen-lockfile && pnpm run build`, Start `pnpm run start`, Umgebung
`NODE_VERSION=22`, Health-Check-Pfad `/health`. Vier Eigenheiten von Render bestimmen den
Betrieb:

- **Jeder Deploy ersetzt die Instanz.** Offene WebSocket-Verbindungen brechen ab, und der Server
  hält Räume nur im Speicher — aber jede Crew trägt den Stand ihres Raums mit: 2 s nach einer Tat
  der Crew und, solange die Uhr eines Einsatzes läuft, spätestens alle 10 s samt den Standorten
  bekommt jeder Platz einen gepackten, mit `ROOM_SECRET` versiegelten Schnappschuss (Deflate,
  AES-256-GCM; Blackout mitten im Lauf rund 8 kB, beim Laufen 44 kB je Platz und Minute), und der
  Browser hält den neuesten in `localStorage` (`escapelab-snapshot:<Code>`). Ein Raum, dessen Uhr
  steht, schickt nur, was sich geändert hat. Für eine laufende Partie heißt ein Deploy deshalb eine
  Wartungspause von Sekunden: Die Uhr steht, die Karte sagt „WARTUNG · Der Server startet neu", die
  Seiten verbinden sich wie nach einem Abbruch neu, der neue Server stellt den Raum aus dem
  mitgebrachten Schnappschuss wieder her, und sobald die Crew zurück ist, läuft die Uhr dort weiter,
  wo sie stand. Auto-Deploy bleibt an, also ist jeder Push auf `main` ein Deploy; wer pusht, sieht
  in `/health` (`rooms.running`, `rooms.players`), ob gerade gespielt wird. Ein neues Feld im
  Spielzustand braucht im Schnappschuss-Schema (`packages/core/src/snapshot.ts`) einen Vorgabewert,
  sonst verwirft der neue Build die Schnappschüsse des alten, und der Deploy beendet jeden laufenden
  Einsatz; dann schlägt der Test fehl, der einen Schnappschuss des Builds davor öffnet
  (`packages/server/test/fixtures/blackout-snapshot.json`).
- **Der Free-Plan schläft und startet neu.** Nach 15 Minuten ohne HTTP-Anfrage oder
  WebSocket-Nachricht fährt die Instanz herunter, und Render darf Free-Instanzen jederzeit neu
  starten. Ein Neustart geht wie ein Deploy aus; endet die Instanz ohne SIGTERM, hart, verliert
  die Partie höchstens die letzten 2 s einer Tat und 10 s der Wege, und der Raum ist erst 90 s
  nach dem ersten aus der Crew zurück, der wiederkommt — so lange wartet er auf einen letzten
  Schnappschuss, der nach einem Absturz nie kommt (siehe unten). Ein Schnappschuss gilt 24 Stunden
  und nie für einen beendeten Einsatz.
- **Vor dem Ersetzen schickt Render SIGTERM.** Bei einem Deploy schaltet Render die neuen
  Verbindungen auf die neue Instanz um und schickt der alten 60 s später SIGTERM; dann nimmt der
  Server keine Verbindung mehr an, friert jede Partie ein (Wartungspause), schickt jedem Platz
  den letzten Schnappschuss (`restart`), schließt alle Sockets mit 1012 und beendet sich in
  Sekunden mit 0. Render wartet darauf 30 s; die Frist gehört auf 120 s, damit auch ein
  langsamer Abschied Luft hat: `maxShutdownDelaySeconds: 120` per Render-API (Update service,
  erlaubt bis 300). Das Signal muss bis zum Server durchkommen: `pnpm run start` ersetzt sich
  per `exec` durch `pnpm --filter @escapelab/server start`, und das durch
  `node --import tsx src/index.ts`, also steht weder eine Shell noch die tsx-CLI dazwischen.
  Wer pnpm ganz aus dem Weg haben will, trägt als Start Command direkt
  `cd packages/server && exec node --import tsx src/index.ts` ein — das geht genauso, denn der
  Server wendet die Migrationen der Datenbank selbst an, bevor er sie öffnet und lauscht (siehe
  unten). Ob es ankommt, zeigt das Log
  der alten Instanz beim ersten Deploy: Es muss `[escapelab] SIGTERM: going down for a restart`
  enthalten, dann je Raum `going down for a restart, snapshot seq …` — fehlt die Zeile, hat
  Render die Instanz ohne Wort beendet. Die Logs im Dashboard reichen 7 Tage zurück;
  `[escapelab] server on …` markiert jeden Neustart, `this boot is instance …` die Kennung der
  Instanz, `restored room …` jeden wiederhergestellten Raum, der Reiter „Events" jeden Deploy.
- **Die Minute dazwischen.** Wer in den 60 s zwischen Umschalten und SIGTERM neu verbindet (Netz
  weg, Seite neu geladen), landet schon auf der neuen Instanz, mit einem älteren Schnappschuss
  als dem Stand, den die anderen auf der alten weiterspielen. Jeder Schnappschuss nennt die
  Instanz, die ihn versiegelt hat, und der beim SIGTERM ist ihr letzter (`final`). Aus einem
  Schnappschuss einer anderen Instanz, der nicht ihr letzter ist, stellt die neue den Raum
  deshalb erst her, wenn der letzte kommt — mit den anderen, nach dem SIGTERM der alten — oder
  90 s nach dem ersten solchen Schnappschuss, dann aus dem neuesten, den sie bis dahin bekommen
  hat (`… is not the last of instance …, waiting up to …` im Log). Die 90 s zählen ab da, wie
  lange die neue Instanz auch schon läuft: Render schaltet erst um, wenn sie gesund ist, wer danach
  abbricht, landet auf ihr, und der letzte Schnappschuss der alten kommt spätestens rund 61 s nach
  dem Umschalten. So lange zeigt die Karte des Spielers „EINSATZ WIRD WIEDERHERGESTELLT" — auf dem
  Startbildschirm, auch nach dem Neuladen der Seite, mit den Sekunden, die sie schon wartet, und
  nur „Einsatz aufgeben" offen —, und das Publikum wartet mit; ein noch neuerer Stand ersetzt den
  Raum wie sonst in den ersten 10 s
  danach. Was später kommt, bleibt liegen, und das Log nennt beide Stände
  (`snapshot seq … came too late, the room goes on from seq …`). Ein letzter Schnappschuss — beim
  SIGTERM, auch beim Einschlafen des Free-Plans — wartet nie. Vor einem Push lohnt `/health`
  trotzdem: Jeder Deploy hält laufende Partien für Sekunden an.

**Konten und Läufe in der Datenbank.** Render Free löscht die Platte bei jedem Deploy und jedem
Neustart — ohne Datenbank fangen Laufprotokoll, Bestenliste, „Meine Einsätze" und alle Erfolge
dann von vorn an, und die Konten leben nur im Speicher, bis der Server stoppt. Mit
`DATABASE_URL` hält der Server Konten, Läufe und Erfolge in Postgres
([`docs/accounts.md`](docs/accounts.md)); eine kostenlose Datenbank gibt es bei Neon
(neon.tech). Render kennt sie auf einem von zwei Wegen, beide unter „Environment" und nirgends
sonst, auch nicht im Repo:

- **Neons Integration** setzt zwei Variablen: `DATABASE_URL`, die gepoolte Verbindung über Neons
  Pooler (Host mit `-pooler`), für die Abfragen des Servers, und `DATABASE_URL_UNPOOLED`, die
  direkte, für die Migrationen, denn Prismas Schema-Engine geht nicht über PgBouncer. Ein Zusatz
  wie `pgbouncer=true` gehört nicht in die gepoolte: Neons Pooler (PgBouncer 1.24) hält Prepared
  Statements, und Prisma rät ab PgBouncer 1.21 davon ab.
- **Von Hand** reicht `DATABASE_URL` allein: Projekt anlegen, im Dialog „Connect" die direkte
  Verbindung (nicht „pooled") für Prisma wählen und die Zeichenkette als `DATABASE_URL`
  eintragen. Ohne `DATABASE_URL_UNPOOLED` nehmen auch die Migrationen sie.

Bevor der Server die Datenbank öffnet und lauscht, wendet er selbst die Migrationen an (`prisma
migrate deploy` aus `packages/server/prisma/migrations/`, über `DATABASE_URL_UNPOOLED`, sonst
über `DATABASE_URL`) — gleich, ob ihn `pnpm run start` startet, das nur ihn startet, oder
Renders direktes Start Command. Das Log zeigt, was die Prisma-CLI sagt, Zeile für Zeile als
`[escapelab] migrate: …`, ohne Zeichenkette, Host, Port und Benutzer der Datenbank; scheitert
die Migration, endet der Server mit `not started: the migrations did not apply (P…)` und
Exit-Code 1, bevor er lauscht. Den Prisma-Client erzeugt `pnpm install`, einmal, über die
postinstall des Servers (das Build Command bleibt, wie es ist). Welcher Speicher läuft, sagt das
Start-Log in einer Zeile:
`store: Postgres at DATABASE_URL: …` oder `store: run log …, accounts in memory until the server
stops (no DATABASE_URL)`.

- **Neon nicht erreichbar.** Dann scheitert schon die Migration, mit `Error: P1001: Can't reach
  database server at …` und `not started: the migrations did not apply (P1001)`, und der Server
  startet nicht. Eine alte Instanz, die weiterspielt, gibt es nur bei einem Deploy, weil Render
  erst auf eine gesunde neue umschaltet. Bei einem Neustart oder wenn der Free-Plan aus dem
  Schlaf aufwacht, gibt es keine: Dann ist das Spiel weg, bis Neon wieder antwortet und ein
  Start gelingt.
- **Eine Migration bricht mittendrin ab** (Deploy abgebrochen, Instanz beendet, Fehler im SQL).
  Postgres nimmt ihre Änderungen zurück, denn Prisma führt jede Migration in einer Transaktion
  aus. Prisma vermerkt sie aber als gescheitert, und jeder weitere Start bricht ab mit `Error:
  P3009 … migrate found failed migrations in the target database` und `not started: the
  migrations did not apply (P3009)`, der Server startet nicht.
  Lösen lässt sich das nur von einem eigenen Rechner aus, mit der direkten Neon-Zeichenkette
  (dem Wert von `DATABASE_URL_UNPOOLED`, wo Render beide hat) allein in dieser Shell und dem
  Namen der Migration aus der Meldung:

  ```sh
  DATABASE_URL='…' pnpm --filter @escapelab/server prisma migrate resolve \
    --rolled-back 20261113135816_accounts
  ```

  Danach die Ursache beheben und neu deployen: Der nächste Start wendet die Migration erneut an.

| Wo | Name | Wirkung |
| --- | --- | --- |
| Render-Umgebung | `DATABASE_URL` | Die Postgres-Datenbank (Neon) für Konten, Läufe und Erfolge, gepoolt oder direkt; ohne: Datei und Konten im Speicher (siehe oben). |
| Render-Umgebung | `DATABASE_URL_UNPOOLED` | Die direkte Verbindung derselben Datenbank für die Migrationen, von Neons Integration neben die gepoolte `DATABASE_URL` gesetzt; ohne: Die Migrationen nehmen `DATABASE_URL`. |
| Render-Umgebung | `RUNS_TOKEN` | Gibt das Laufprotokoll per `GET /runs.jsonl` frei (siehe oben). |
| Render-Umgebung | `ROOM_SECRET` | Schlüssel der Schnappschüsse (SHA-256 davon für AES-256-GCM): im Dashboard unter „Environment" als Variable anlegen, 32 oder mehr zufällige Zeichen, etwa `openssl rand -hex 32`, und nie ändern — ein neuer Schlüssel öffnet die alten Schnappschüsse nicht. Ohne ihn macht der Server bei jedem Start einen eigenen Schlüssel, das Start-Log sagt `ROOM_SECRET unset … rooms will not survive a restart`, und kein Raum überlebt einen Neustart; mit weniger als 32 Zeichen startet er nicht. Der Deploy, mit dem er dazukommt, trägt die laufenden Räume noch nicht hinüber. |

## Architektur in einem Satz

`core` kennt weder Netzwerk noch Uhr (Zeit kommt als `at` in Aktionen) — der Server ist eine
dünne Schicht, die Aktionen mit Zeitstempeln versieht, und der Client rendert nur die View,
die der Server nach seinem Standort gefiltert hat (was nur an einer Station oder an einem
Handbuch zu sehen ist, geht nur an die Spielenden, die dort stehen).

## Nächste Schritte

Was als Nächstes gebaut wird, steht mit Status, Größe und Vorbildern in `docs/backlog.md`;
die Anforderungen nach MoSCoW in `docs/srs.md`, der technische Überblick für Vorträge in
`docs/projektueberblick.md`.
