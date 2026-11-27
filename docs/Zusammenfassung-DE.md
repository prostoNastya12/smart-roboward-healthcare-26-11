# Smart RoboWard · Kurzfassung für die Jury

**Healthcare Hackathon Bayern · IFOHRA Challenge 9 · Stand 27. November 2026**

## Das Problem

Transportroboter im Krankenhaus bekommen ihre Aufträge über das Netzwerk und teilen sich Flure und Aufzüge mit Patienten und Personal. Wird ein Robotersystem angegriffen, bleibt heute oft nur, alles abzuschalten. Dann steht die Logistik der ganzen Station.

## Unsere Lösung

Smart RoboWard prüft zweimal, bevor sich etwas bewegt.

1. **Auftragsprüfung.** Jeder Auftrag braucht ein signiertes, einmal gültiges Ticket und muss zu Rolle und Station der anfragenden Person passen. Der Roboter erhält nur Auftragsnummer und Ziel, keine Patientendaten. Bei einer Angriffswelle trennt ein Schutzschalter die Roboterzone ab, und die Station arbeitet im Handbetrieb weiter.
2. **Aufzugsprüfung.** Für jeden Aufzugsruf entscheidet das System: erlauben, anhalten oder ablehnen. Es vergleicht den Ruf mit der aktuellen Fahrt, mit der von der Haustechnik freigegebenen Zuordnung der Stockwerksnamen und mit dem aktuellen Zustand des Aufzugs. Ein Patiententransport hat immer Vorrang.
3. **Übergabe an Menschen.** Wird eine Fahrt angehalten, kann ein Träger das Paket übernehmen. Die Station sieht jederzeit, wer es hat, und bestätigt den Empfang genau einmal.

## Was heute läuft

Alles läuft ohne Internet im Browser, mit erfundenen Daten und einem simulierten Krankenhaus.

- **Live-Angriff:** Ein simulierter Angreifer schickt gefälschte und wiederholte Aufträge an die Flotte.
- **Leitstand Stationssicherheit:** Fünf Szenarien am gemeinsamen Aufzug, mit Entscheidung, Begründung und nächstem Schritt für das Personal.
- **Auswertung:** 10.000 simulierte Fahrten mit Streckenkarte und Alarmstatistik.

## Messergebnisse (Simulation)

| Messung | Ergebnis | Vergleich |
| --- | --- | --- |
| Gefälschte Anfragen blockiert | 10 von 10 | Ohne Schutz: 1 von 10 |
| Berechtigte Aufträge erledigt | 10 von 10 | Ohne Schutz: 10 von 10 |
| Erledigte Stationsaufgaben während einer Angriffswelle | 100 %, davon 149 von 150 im Handbetrieb | Ohne Abschottung: 51 % |
| Erkannte Roboter-Stillstände | 90 von 100 | Fester Schwellenwert: 0 von 100 |
| Fehlalarme je 100 unauffällige Fahrten | 1,39 | Fester Schwellenwert: 1,33 |

Die Testfälle hat das Team selbst geschrieben. Die Zahlen sind kein klinischer Nachweis. Es war kein echtes Krankenhausgerät beteiligt.

## Offenlegung

Der 3D-Simulator wurde vor dem Hackathon mit einem KI-Assistenten erzeugt und übernommen. Die beiden Prüfstufen, die Auswertung und die Seiten entstanden vor Ort mit Claude. Drittanbieter: Three.js (MIT) und die Open-RMF-Klinikkarte (Apache-2.0). Einzelheiten stehen in `README.md` und `NOTICE.md`.

## Nächste Schritte

1. Den simulierten Aufzug durch eine Hersteller-Schnittstelle ersetzen.
2. Angriffe und harmlose Sonderfälle von Außenstehenden schreiben lassen und neu messen.
3. Ein begleiteter Pilot: eine Strecke, ein Aufzug, ein Partnerkrankenhaus.
