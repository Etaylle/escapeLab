# EscapeLab — Software Requirements Specification (MoSCoW)

Stand: 2026-10-23 · Version 1.1

## 1. Zweck

EscapeLab ist ein kooperatives Escape Room Spiel im Browser für mindestens zwei Personen an
getrennten Geräten im selben Netz. Die Crew befreit sich aus einem verdunkelten Labor, indem
sie Stationen löst, die nur gemeinsam zu bedienen sind. Dieses Dokument legt fest, was das
Produkt tut und was nicht, priorisiert nach MoSCoW (Must, Should, Could, Won't). Es gilt für
den Referenz Level „Blackout im Labor" und die Plattform, auf der er läuft.

## 2. Kontext

| Aspekt | Festlegung |
|---|---|
| Nutzer | Spielende, Zuschauende, Host, Missionsautor:innen |
| Plattform | Browser auf Desktop und Handy, ein Server im lokalen Netz, keine Cloud |
| Inhalte | Missionen als Daten, Rätsel als Module, Handbuch druckbar |

## 3. Anforderungen

### Must — ohne das ist es nicht EscapeLab

| ID | Anforderung |
|---|---|
| M-1 | Eine Runde braucht mindestens zwei Personen; die Level sind nicht allein spielbar. |
| M-2 | Jede Station ist nur gemeinsam lösbar; die nötigen Informationen sind auf die Spielenden verteilt. |
| M-3 | Die Regeln der Stationen stehen in einem Handbuch im Spiel, das keine Antworten enthält. |
| M-4 | Eine Runde endet mit Sieg oder Verlust: alle Stationen gelöst und die Crew am Ausgang, oder die Zeit abgelaufen. |
| M-5 | Das Spiel läuft im Browser über das lokale Netz, ohne Konto und ohne Installation. |
| M-6 | Spielende können miteinander sprechen, über das Spiel oder nebeneinander. |
| M-7 | Der Spielzustand liegt auf dem Server; ein Verbindungsabbruch beendet die Runde nicht. |

### Should — das, was das Spiel gut macht

| ID | Anforderung |
|---|---|
| S-1 | Ein Tutorial übt die Mechaniken und führt in den Hauptlevel. |
| S-2 | Der Einstieg erklärt sich im Spiel: der Stromausfall passiert auf dem Bildschirm, ein erster Erfolg zu zweit kommt vor dem ersten Handbuchrätsel. |
| S-3 | Räume mit eigener Identität: Möblierung, Licht, Klang und Figuren mit Ausdruck. |
| S-4 | Funksprüche mit Stimme, Raumklang und Musik, die mit dem Druck wächst. |
| S-5 | Handbuchtexte sind Dokumente aus der Welt, keine Anweisungen an Spieler. |
| S-6 | Notizen im Spiel, auch während man liest oder ein Gerät bedient. |
| S-7 | Drei Schwierigkeitsgrade; eine Leitstelle hilft, wenn nichts passiert. |
| S-8 | Zuschauermodus, Rundenhistorie und Bestenliste. |
| S-9 | Ein Missionseditor im Browser mit Validierung. |

### Could — ambitioniert

| ID | Anforderung |
|---|---|
| C-1 | Weitere Level in der Qualität des Referenz-Levels, auch für drei oder mehr Personen. |
| C-2 | Wiedergabe gespielter Runden. |
| C-3 | Weitere Rätselmodule, auch mit IT- und Technik-Themen. |
| C-4 | Schwierigkeit, die sich aus der Telemetrie echter Crews abstimmt. |
| C-5 | Barrierefreiheit über Muster und Kontraste hinaus. |
| C-6 | Teilen von Missionen und Bestenlisten über das lokale Netz hinaus. |

### Won't — bewusst nicht, in dieser Version

| ID | Ausschluss |
|---|---|
| W-1 | Konten, Login, Cloud-Hosting, bezahlte Dienste. |
| W-2 | Native Apps. |
| W-3 | Ein Solo-Modus oder Gegeneinander. |
| W-4 | Monetarisierung. |

## 4. Rahmenbedingungen

- Betrieb: ein Server im lokalen Netz, Handys über WLAN.
- Entwicklung: TypeScript, automatisierte Tests und ein Browser-Durchlauf des Referenz-Levels in der Integration.
- Zeitlimit, Hinweise und Schwierigkeit werden anhand echter Testrunden abgestimmt.
