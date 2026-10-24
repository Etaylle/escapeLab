# EscapeLab

Kooperatives Browser-Escape-Spiel: Die Maschine sieht, wer am Pult steht, die Regeln, wer am Buch
steht — gelöst wird nur gemeinsam, per Stimme. Missionen sind reine Daten (`missions/*.json`) —
neue Missionen brauchen keinen Code.

**Rätseltypen:** Kabel trennen (`wiring`), Symbol-Keypad (`keypad`), Schalterbank mit Prüf-Commit
(`switches`), Speicherbank (`memory`), Frequenz-Abgleich mit Farblegende (`simon`), Morsefunk
(`morse`), der Knopf (`button`), unsichtbares Labyrinth (`maze`), Synchron-Knöpfe (`button-sync`),
Signalkette an zwei Pulten (`signal`), Sicherungskasten und Prüfpult an zwei Pulten (`circuit`),
Serverraum mit Terminal und Rack an zwei Pulten (`servers`).
Layouts/Codes sind pro Partie zufällig (seeded, deterministisch replaybar), Fehler kosten
Countdown-Zeit. **Missionen:** Tutorial (2 Spieler), Blackout im Labor (2–3 Spieler, 5 Rätsel),
Kettenreaktion (3 Spieler, jeder startet in einem anderen verschlossenen Raum und kommt nur mit
Hilfe heraus) und Doppelschicht (4 Spieler in **zwei getrennten Flügeln** — die Regeln jeder
Station liegen im anderen Flügel, und erst der Druckausgleich öffnet die Schleuse dazwischen).

**Blackout im Labor** (2–3 Spieler, 15 Minuten auf *Normal*): ein Labor von 27 × 17 Feldern, die
Räume als Ring — Archiv, Flur, Serverraum, Ost-Flur, Reaktor, Süd-Flur, Labor, Maschinenraum und
zurück in den Flur. Die Crew startet getrennt und außer Sicht (Archiv, beide Enden des Flurs) und
wirft zuerst gemeinsam den Notlicht-Hebel in der Mitte des Flurs, dann die Stationen in
Reihenfolge:

1. *Notstrom-Kasten* (`circuit`): Sicherungskasten im Maschinenraum hinter der Plattentür,
   Prüfpult im Flur davor; die Regeln im Handbuch im Archiv, die Laborkennung daneben. Nach
   jedem Schnitt wird neu gemessen, ein Fehlschnitt verdrahtet den Kasten neu.
2. *Signalkette* (`signal` mit Legende): Pult A im Flur, Pult B im Maschinenraum, die Legende
   auf dem Klemmbrett; ab Stufe 3 zeigt das sendende Pult die Zeichen nacheinander.
3. *Serverraum* (`servers`): Terminal und Rack an zwei Pulten im Raum hinter dem Schott, die
   Regeln im Spind dort.
4. *Frequenz-Abgleich* (`morse`): Pult im Labor, die Tabellen im Aktenschrank, dessen Schlüssel
   im Serverraum liegt.
5. *Reaktor-Neustart* (`button-sync`): erst mit der Ersatzsicherung aus dem Archiv; die ganze
   Crew drückt gemeinsam. Dann öffnet die Luke im Archiv, und es geht einmal quer durchs Labor
   hinaus — durchs Labor oder am Serverraum vorbei, beide Wege gleich lang.

Drei **Notizen der letzten Crew** hängen frei lesbar im Labor — am Hebel, im Serverraum und an
der Luke (`map.notes`): Sie erzählen, was in der Nacht geschah, und lösen nichts.

**Serverraum** (`servers`): Pult A ist ein Terminal mit Statustabelle,
Fehlercodes, Protokoll und Befehlszeile (`start`, `restart`, `status` — tippen oder antippen),
Pult B ein Rack mit Stromschalter und LED je Dienst, ohne einen Code. Sechs Dienste mit festen
Abhängigkeiten kommen nach ihrem Code wieder hoch (E11 start, E23 Strom aus und an, E42 erst die
Abhängigkeiten per restart); E50 ist Quarantäne: Strom aus, nie starten, sonst infiziert er einen
weiteren Dienst. Bewiesen im Kerntest, in Blackout und in der Probemission
`tools/fixtures/servers-probe.json`, die der Systemcheck-Rundgang über den Editor mit festem Seed
importiert und bis zur Lösung spielt.

Keine Station lässt sich allein bedienen (siehe *Nie allein*), und auf *Normal* beendet der
fünfte Alarm den Lauf — auf *Hart* der dritte, auf *Entspannt* gibt es keine Grenze.

**Beitreten:** Auf der Startseite steht eine Liste aller **offenen Runden** mit Kartenvorschau,
Mission, Schwierigkeit, wer schon wartet und wie viele Plätze frei sind — ein Klick auf *Beitreten*
genügt, niemand muss einen Code weitergeben. Laufende Runden erscheinen ebenfalls, dort führt
der Knopf zum Zuschauen. Ein Code-Feld bleibt für direkte Verabredungen.

**Ablauf einer Partie:** Lobby (Farbe wählen, **bereitmelden** — der Host kann erst starten,
wenn so viele da sind, wie die Mission braucht, und alle bestätigt haben; jede Änderung an
Mission oder Besetzung setzt die Bestätigungen zurück; die Startplätze werden beim Start
verlost) → Briefing-Countdown mit dem eigenen Startraum →
Stationen in Reihenfolge finden und lösen → wenn alle gelöst sind, öffnet sich der **Notausgang**
und das ganze Team muss ihn gemeinsam erreichen, bevor die Zeit abläuft → Endbildschirm mit
Statistiken und persönlicher Bestzeit. **Hilfsmittel:** Klick auf die Welt setzt einen **Ping**
für alle (farbige Ringe, Pfeil wenn außerhalb des Bildes), `M` blendet die **Minikarte** ein,
`N` den eigenen **Notizblock** (bleibt für den Raum gespeichert), `C` öffnet den **Schnellchat**
(acht feste Sätze, Tasten `1`–`8`, erscheinen als Sprechblase über der Figur) — damit
funktioniert das Spiel auch ohne Voice-Chat.

**Sprechen:** In der Lobby lässt sich das **Mikrofon** aktivieren (nie von selbst); dann geht
die Stimme hinaus, solange `V` gedrückt bleibt — auf dem Handy die 🎤-Taste; die Leiste schaltet
auf „Mikro: offen“.
Die Stimmen gehen direkt von Browser zu Browser (WebRTC; der Server vermittelt nur den Aufbau)
und klingen nach Nähe: bis 4 Kacheln voll, bis 10 Kacheln leiser werdend, durch Wände gedämpft
— nie ganz stumm. Wer spricht, steht in einem Ring. Zuschauer können mithören, nicht sprechen.
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
Labyrinth samt Wandplan), am Rand steht auf Wunsch eine **Notiz der letzten Crew** mit einem
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
der Notfälle. **Verbindungsabbruch:** Fehlt jemand aus der Crew, pausiert die Mission komplett
(Uhr, Patrouillen, Notfälle) und läuft nach der Rückkehr ohne Zeitverlust weiter.

**Endspurt:** In der letzten Hälfte der Zeit zieht das Ambiente hörbar an, unter einer Minute
pulsiert der Timer rot und die Ränder glühen, und die **letzten zehn Sekunden werden mit
ansteigenden Piepsern heruntergezählt** — der Schlusston kommt, wenn die Energie weg ist.

**Oberfläche:** Dauerhaft sichtbar ist nur, was sich ändert — Ziel und Fortschritt liegen als
Einblendung auf der Welt, die Uhr daneben, darunter eine schmale Leiste mit der Crew und dem
Live-Status jedes Mitglieds (hält die Platte, trägt etwas, an der Station, liest, getrennt) sowie
der letzten Funkzeile. Alles zum Nachschlagen — Auftrag, eine Legende der Kartenobjekte,
Tastenliste — steckt im **Info-Panel** (Taste `I`, alternativ `H`). Alles, wohin man laufen muss, bekommt am
Bildschirmrand einen **Richtungspfeil mit Entfernung**, solange es außer Sicht ist. Der Ton
lässt sich oben rechts abschalten.

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
Simulation/Rendering, art = prozedurale Grafik, audio = prozedurale Sounds).

**Neue Missionen** sind reine JSON-Dateien in `missions/`. `packages/core/test/missionMaps.test.ts`
prüft jede davon automatisch: gleiche Zeilenlängen, alles auf Bodenfeldern, eine Station pro
Rätsel — bei einem Rätsel mit zwei Pulten (Notstrom-Kasten, Signalkette, Serverraum) je eine für
Pult A und Pult B, mehr als vier Felder auseinander — und per Flutfüllung mit den echten
Tür-Regeln, dass die Stationen in Reihenfolge erreichbar sind und am Ende **alle** den Notausgang
erreichen können. Eine Plattentür kann mit `untilSolved` ein Rätsel nennen: Ist es gelöst, bleibt
sie auch ohne Platte offen (Blackout: die Maschinenraumtür nach dem Notstrom). An jeder Station mit
einem Pult muss außerdem — wohin ihre Regeln auch ausgelost werden — einer am Pult stehen können,
während ein anderer sie zugleich liest, und an jeder mit zwei Pulten müssen zwei Verschiedene
zugleich an beiden stehen können.

**Missions-Editor:** „Editor" auf der Startseite öffnet eine Werkbank: das Labor mit den Kacheln
des Spiels auf eine Leinwand malen, Startplätze, Türen, Platten, Stationen, Quellen, Schild,
Raumnamen, Ausgang, Teile, Drohnenwege und Notizen der letzten Crew (an eine Wand neben dem Boden
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
| `packages/server` | Autoritativer Node-Server: Räume, Reconnect-Tokens, Missionstimer, WebSocket (`ws`). Clients schicken Intents; der Server validiert und broadcastet gefilterte Views. |
| `packages/client` | React + Vite UI: Join → Lobby → Spiel → Ende, Auto-Reconnect mit Session-Token. |

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

**Zuschauen:** Wer den Raumcode eingibt und auf *Zuschauen* klickt, sieht das ganze Labor ohne
Dunkelheit, alle Figuren, die Drohnenkegel — **und die offene Station von allen Seiten**: Pult,
Regeln und Wandplan zugleich, dazu für jede Figur, ob sie am Pult steht, liest oder die Kennung
gesehen hat. Genau das macht das Zusehen unterhaltsam: Das Publikum sieht beide Hälften und
merkt vor den Spielenden, wo die Ansage schiefgeht. Zuschauer können nichts auslösen.

**Nach der Runde:** Der Endbildschirm zeigt einen Rang von S bis C aus Alarmen und Restzeit, die
**Beiträge** jedes Crewmitglieds (bedient, gelesen, gefunden, geliefert, Alarme, Notizen) und ein
Einsatzprotokoll (wann welche Station fiel, jeder Alarm mit Grund und Kosten, Notfälle, eingesetzte
Teile). Dazu führt dieses Gerät eine kleine Historie je Mission (Läufe, geschaffte Läufe,
Bestzeit, bester Rang). **Nochmal:** Alle bestätigen gleichberechtigt auf dem Endbildschirm, und sobald das letzte Ja
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
steht im Log.

**Ton und Funkstimme:** Jeder Raum klingt nach seiner Art, die Schritte des Partners kommen von
dort, wo er steht, und die Musik zieht mit dem Druck an — alles zur Laufzeit erzeugt
([`docs/sound.md`](docs/sound.md)). Nur die Funksprüche der Leitstelle sind Aufnahmen
(`packages/client/public/voice/`), gesprochen von einer neuronalen Stimme, die offline läuft
(Piper, Stimme „Thorsten"). Wer einen Funktext in `missions/*.json` ändert oder neu schreibt,
nimmt ihn auf einem Mac mit `uv` neu auf — der Test, der jede Zeile prüft, nennt den Befehl;
das Stimmmodell lädt der erste Lauf einmal nach `~/.cache/escapelab-piper/`:

```sh
pnpm --filter @escapelab/client voice            # nur fehlende Zeilen (Piper über uv, afconvert)
pnpm --filter @escapelab/client voice --fresh    # alle neu, etwa für eine andere Stimme
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

**Laufprotokoll (ohne Datenbank):** Jeder beendete Lauf, gewonnen oder verloren, hängt seinen
Bericht als eine Zeile JSON an eine Datei an; jede Revanche bekommt ihre eigene Zeile. Darin
stehen Mission, Schwierigkeit, Zeitlimit und Alarmgrenze, Crew-Größe und gezogene Startplätze,
Start, Ende und Ausgang (`won`, `lost:time`, `lost:alarms`), je Station wann sie dran war und
wann sie fiel, die Sekunden dazwischen, ihre Alarme und Notizen, dazu die Notfälle, alle Alarme
nach Ursache und die Beiträge. Namen kommen nicht hinein, die Crew heißt `p1` bis `pn`. Kann
der Server nicht schreiben (Platte voll, falscher Pfad), steht das im Server-Log, und das Spiel
läuft weiter.

| Variable | Wirkung |
| --- | --- |
| `RUNS_LOG` | Pfad der Protokolldatei, am besten absolut. Ohne: `packages/server/data/runs.jsonl`. Fehlende Ordner legt der Server an. |
| `RUNS_TOKEN` | Gibt `GET /runs.jsonl` frei, nur mit dem Header `Authorization: Bearer <RUNS_TOKEN>`. Ohne Token antwortet die Route 404. |

```sh
RUNS_TOKEN=… RUNS_LOG=/var/lib/escapelab/runs.jsonl pnpm start
curl -H "Authorization: Bearer $RUNS_TOKEN" http://<host>:3001/runs.jsonl -o runs.jsonl
pnpm --filter @escapelab/server runs runs.jsonl   # Tabelle zum Balancing
```

Die Tabelle zeigt je Mission und Schwierigkeit Läufe, Siegquote und mittlere Dauer (Median),
je Station die mittleren Sekunden und Alarme und die drei langsamsten Stationen. Ohne
Dateiangabe liest `runs` die Datei aus `RUNS_LOG` bzw. die Standarddatei.

## Architektur in einem Satz

`core` kennt weder Netzwerk noch Uhr (Zeit kommt als `at` in Aktionen) — der Server ist eine
dünne Schicht, die Aktionen mit Zeitstempeln versieht, und der Client rendert nur die View,
die der Server nach seinem Standort gefiltert hat (was nur an einer Station oder an einem
Handbuch zu sehen ist, geht nur an die Spielenden, die dort stehen).

## Nächste Schritte (geplant)

- Playwright-E2E mit echten Browser-Kontexten (der WS-Smoke-Test deckt die Logik bereits ab:
  `pnpm --filter @escapelab/server smoke`)
- Produktions-Build (Server liefert statisches Client-Bundle aus) fürs Demo-Day-Deployment
- Missionseditor (Missionen sind bereits reine, zod-validierte JSON-Daten)
