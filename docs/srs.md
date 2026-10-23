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
| M-1 | Eine Runde braucht mindestens zwei Personen. |
| M-2 | Die Level sind nicht allein spielbar. |
| M-3 | Die nötigen Informationen sind auf die Spielenden verteilt. |
| M-4 | Eine Runde ist gewonnen, wenn alle Stationen gelöst sind und die Crew den Ausgang erreicht. |
| M-5 | Eine Runde ist verloren, wenn die Zeit abläuft. |
| M-6 | Das Spiel ist im Browser spielbar. |
| M-7 | Es braucht weder Konto noch Installation. |
| M-8 | Spielende können miteinander sprechen, über das Spiel oder nebeneinander. |
| M-9 | Ein Verbindungsabbruch beendet die Runde nicht. |

### Should — das, was das Spiel gut macht

| ID | Anforderung |
|---|---|
| S-1 | Ein Tutorial übt die Mechaniken und führt in den Hauptlevel. |
| S-2 | Der Einstieg erklärt sich im Spiel statt in einem Text. |
| S-3 | Ein erster Erfolg zu zweit kommt vor dem ersten Handbuchrätsel. |
| S-4 | Räume unterscheiden sich sichtbar voneinander. |
| S-5 | Figuren zeigen, was sie tun: tragen, sprechen, erschrecken, feiern. |
| S-6 | Funksprüche haben eine Stimme. |
| S-7 | Musik und Raumklang wachsen mit dem Druck. |
| S-8 | Handbuchtexte sind Dokumente aus der Welt, keine Anweisungen an Spieler. |
| S-9 | Notizen sind im Spiel möglich, auch während man liest oder ein Gerät bedient. |
| S-10 | Es gibt drei Schwierigkeitsgrade. |
| S-11 | Eine Leitstelle meldet sich, wenn länger nichts passiert. |
| S-12 | Zuschauende sehen die Runde mit. |
| S-13 | Rundenhistorie und Bestenliste je Level. |
| S-14 | Ein Missionseditor im Browser mit Validierung. |

### Could — ambitioniert

| ID | Anforderung |
|---|---|
| C-1 | Weitere Level in der Qualität des Referenz-Levels. |
| C-2 | Wiedergabe gespielter Runden. |
| C-3 | Weitere Rätselmodule, auch mit IT- und Technik-Themen. |
| C-4 | Level für drei oder mehr Personen. |

### Won't — bewusst nicht, in dieser Version

| ID | Ausschluss |
|---|---|
| W-1 | Konten, Login, Cloud-Hosting, bezahlte Dienste. |
| W-2 | Ein Solo-Modus oder Gegeneinander. |
| W-3 | Monetarisierung. |

## 4. Rahmenbedingungen

- Betrieb: ein Server im lokalen Netz, Handys über WLAN.
- Entwicklung: TypeScript, automatisierte Tests und ein Browser-Durchlauf des Referenz-Levels in der Integration.
- Zeitlimit, Hinweise und Schwierigkeit werden anhand echter Testrunden abgestimmt.
