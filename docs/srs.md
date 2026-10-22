# EscapeLab — Software Requirements Specification (MoSCoW)

Stand: 2026-10-22 · Version 1.0 · Studienprojekt (Themengruppe Schefer-Wenzl/Miladinovic)

## 1. Zweck und Umfang

EscapeLab ist ein kooperatives Escape-Room-Spiel im Browser für zwei bis drei Personen an
getrennten Geräten im selben Netz. Die Crew befreit sich in einer begrenzten Zeit aus einem
verdunkelten Labor, indem sie Stationen löst, die nur gemeinsam zu bedienen sind. Dieses
Dokument legt die Anforderungen an das Produkt fest und priorisiert sie nach MoSCoW
(Must, Should, Could, Won't). Es gilt für den Referenz-Level „Blackout im Labor" und die
Plattform, auf der er läuft.

## 2. Kontext

| Aspekt | Festlegung |
|---|---|
| Nutzer | Spielende (2–3 je Runde), Zuschauende, Host, Missionsautor:innen |
| Plattform | Browser (Desktop, Handy im Querformat), ein Node-Server im LAN, keine Cloud |
| Architektur | Reiner Spielkern (deterministisch), autoritativer Server, React-Client mit Canvas/WebGL |
| Inhalte | Missionen als validierte JSON-Daten, Rätsel als Module, Handbuch druckbar |
| Qualitätssicherung | Unit- und Eigenschaftstests, serverseitiger Komplettdurchlauf, Browser-Walkthrough mit Screenshots und Bildzeit-Budget in CI |

Status-Legende: ✓ umgesetzt · ◐ teilweise · ○ offen

## 3. Funktionale Anforderungen

### Must (ohne diese ist das Produkt nicht brauchbar)

| ID | Anforderung | Status | Nachweis |
|---|---|---|---|
| M-01 | Zwei bis drei Personen spielen eine Runde gemeinsam über das Netz; der Server ist die einzige Wahrheit über den Spielzustand. | ✓ | Server-Tests, Smoke-Test |
| M-02 | Jede Station ist nur gemeinsam lösbar: Eingaben zählen nur, wenn eine zweite Person am anderen Pult oder an der Regelquelle steht. | ✓ | Kern-Tests, Validierungsbeweis je Crew |
| M-03 | Was eine Person sieht, folgt aus ihrem Standort (Pult, Regelquelle, Kennungsschild), nicht aus einer Rolle. | ✓ | Negativ-Assertions in Sichten |
| M-04 | Die Regeln jeder Station stehen in einem druckbaren Handbuch, das nie Antworten enthält. | ✓ | Handbuch-Tests |
| M-05 | Der Level „Blackout im Labor" ist mit jeder Crew-Größe und jeder Startplatz-Auslosung lösbar. | ✓ | Erreichbarkeitsbeweise in `parseMission` |
| M-06 | Zeitlimit, Alarmlimit und Flucht-Finale beenden eine Runde mit Sieg oder Verlust. | ✓ | Kern-Tests, Walkthrough bis zur Siegkarte |
| M-07 | Der Einstieg erklärt sich im Spiel: Stromausfall auf dem Bildschirm, ein erster Erfolg zu zweit, danach erst das erste Handbuchrätsel. | ✓ | Walkthrough (Kaltstart, Hebel) |
| M-08 | Verbindungsabbrüche pausieren die Runde; Wiedereinstieg mit demselben Platz. | ✓ | Smoke-Test (Reconnect) |
| M-09 | Push-to-Talk-Sprachverbindung zwischen den Spielenden ohne Fremddienste. | ✓ | Walkthrough mit Fake-Mikrofon |
| M-10 | Bedienung mit Tastatur und mit Touch (Handy im Querformat). | ✓ | Walkthrough in drei Bildschirmgrößen |

### Should (wichtig, aber eine Runde funktioniert auch ohne)

| ID | Anforderung | Status | Nachweis |
|---|---|---|---|
| S-01 | Ein Tutorial übt die Mechaniken und führt direkt in den Hauptlevel. | ✓ | Walkthrough („Weiter: Blackout") |
| S-02 | Rundenhistorie und Bestenliste je Mission und Schwierigkeit, ohne Konten. | ✓ | Server-Tests, Join-Karten |
| S-03 | Missionseditor im Browser mit Validierung, Probespiel und Teilen per Link. | ✓ | Editor-Tests, Walkthrough |
| S-04 | Räume mit eigener Identität (Möblierung, Licht, Klang) und Figuren mit Ausdruck. | ✓ | Art-Bible, Screenshots |
| S-05 | Funksprüche mit Stimme, Raumklang und adaptive Musik. | ✓ | Audio-Probe im Walkthrough |
| S-06 | Zuschauermodus mit Gesamtkarte und Mithören. | ✓ | Walkthrough |
| S-07 | Drei Schwierigkeitsgrade mit skalierter Zeit, Alarmlimit und Strafen. | ✓ | Kern-Tests |
| S-08 | Telemetrie je Runde (Zeiten je Station, Alarme) zur Abstimmung der Schwierigkeit. | ◐ | Log vorhanden, Abstimmung braucht echte Crews |

### Could (wünschenswert, wenn Zeit bleibt)

| ID | Anforderung | Status |
|---|---|---|
| C-01 | Weitere Missionen in der Qualität des Referenz-Levels. | ○ |
| C-02 | Wiedergabe einer gespielten Runde (Replay). | ○ |
| C-03 | Mehr Rätselmodule (z. B. weitere IT-Themen). | ◐ (Serverraum umgesetzt) |
| C-04 | Barrierefreiheit über Muster statt Farben hinaus (Screenreader-Pfade). | ◐ (Reduced Motion, Muster, Kontrast) |

### Won't (bewusst ausgeschlossen, für diese Version)

| ID | Ausschluss | Begründung |
|---|---|---|
| W-01 | Konten, Login, Cloud-Hosting, bezahlte Dienste | Lokaler LAN-Betrieb reicht; keine laufenden Kosten |
| W-02 | Native Apps | Browser und PWA decken Desktop und Handy ab |
| W-03 | Mehr als drei Spielende je Runde | Rätseldesign ist auf zwei bis drei Personen ausgelegt |
| W-04 | Wettbewerbs- oder Gegeneinander-Modus | Kern ist Kooperation |
| W-05 | Monetarisierung | Studienprojekt |

## 4. Nichtfunktionale Anforderungen

| ID | Anforderung | Prio | Status | Nachweis |
|---|---|---|---|---|
| N-01 | 60 Bilder/s auf aktueller Hardware; auf schwachen Geräten höchstens 40 ms je Bild (p95). | Must | ✓ | Bildzeit-Budget in CI (Software-Rendering) |
| N-02 | Kein Spielzustand im Client; Eingaben sind Absichten, der Server entscheidet. | Must | ✓ | Architekturtests |
| N-03 | Deterministische Runden über Seeds (Fehlersuche, Tests). | Must | ✓ | Seed-Tests, Walkthrough-Pins |
| N-04 | Spieltexte Deutsch, kurz, ohne Coaching-Ton. | Must | ✓ | Textguards in Tests |
| N-05 | Keine externen Abhängigkeiten zur Laufzeit (Assets, Dienste). | Must | ✓ | Procedurale Klänge, lokale Stimmdateien |
| N-06 | Grafische Qualität folgt einer Art-Bible mit fester Palette. | Should | ✓ | Palette-Test |
| N-07 | Reduzierte Bewegung und Farbenblind-taugliche Muster. | Should | ✓ | Tests, Handbuch-Legende |
| N-08 | HTTPS im LAN für Mikrofon und Installation als PWA. | Should | ✓ | `pnpm cert` |

## 5. Rahmenbedingungen und Annahmen

- Betrieb: ein Node-Prozess im LAN, Handys über WLAN, optional selbstsigniertes HTTPS.
- Entwicklung: TypeScript-Monorepo, Zero-Warnings-Politik, jede Änderung über Tests, Smoke und
  Browser-Walkthrough in CI.
- Offen zur Abstimmung mit echten Crews: Zeitlimit (derzeit 780 s), Hinweisverzögerung,
  Drohnen- und Notfallrhythmus.

## 6. Abnahme

Eine Anforderung gilt als erfüllt, wenn ihr Nachweis in CI grün ist und der Browser-Walkthrough
des Referenz-Levels die Situation zeigt. Bei Must-Anforderungen ist zusätzlich ein Playtest mit
einer unbeteiligten Crew vorgesehen.
