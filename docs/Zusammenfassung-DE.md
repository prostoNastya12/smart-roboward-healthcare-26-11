# Smart RoboWard · Kurzfassung für die Jury

**Healthcare Hackathon Bayern · IFOHRA Challenge 9 · Stand 28. November 2026**

## Das Problem

Transportroboter im Krankenhaus bekommen ihre Aufträge über das Netzwerk und teilen sich Flure und Aufzüge mit Patienten und Personal. Wird ein Robotersystem angegriffen, bleibt heute oft nur, alles abzuschalten. Dann steht die Logistik der ganzen Station.

## Unser Vorgehen

Wir wollten nicht raten, welcher Schutz der beste ist. Wir haben sieben Kommunikationswege zwischen Roboter und Aufzug gebaut, vom offenen Netz bis zu unserem mehrschichtigen Entwurf. Alle sieben wurden mit denselben Angriffen getestet. Die Regel für die Auswahl stand vor dem ersten Durchlauf fest.

| | Kommunikationsweg | Herkunft |
| --- | --- | --- |
| A | Offenes Netz | Ausgangslage |
| B | Nur Netzzugangskontrolle | Übliche Praxis im Krankenhaus |
| C | Signierte Einmal-Tickets | Lösung unseres Teammitglieds, unveränderter Code |
| D | Signierte Nachrichten je Gerät | Standardverfahren |
| E | Verschlüsselter Kanal mit gegenseitiger Authentifizierung | Standardverfahren, Prinzip von Mutual TLS |
| F | Fahrtberechtigung mit Besitznachweis | Unser Vorschlag |
| G | Mehrschichtiger Weg | Kombination aus E, F, Datensparsamkeit, Schutzschalter und Aufzugsprüfung |

## Ergebnis

Die Zahlen stehen in `secure-comms/RESULTS.md` und werden aus der Messung erzeugt. Gewählt wurde **G, der mehrschichtige Weg**. Er hat alle Angriffe der Hauptliste abgewehrt und alle fünf Normalfälle bestanden. Die einzelnen Schutzmaßnahmen scheitern jeweils an anderer Stelle:

- **Netzzugangskontrolle** hält Außenstehende ab. Ein kompromittiertes Gerät im Netz kann alles.
- **Tickets** binden das Stockwerk an die Fahrt. Wer ein Ticket mitliest, kann es zuerst benutzen.
- **Signaturen** beweisen, wer fragt. Sie sagen nicht, ob dieses Gerät dieses Stockwerk anfordern darf.
- **Verschlüsselung** schützt jede Teilstrecke. Ein kompromittierter Server des Flottenherstellers kann trotzdem Aufzugsrufe erfinden.
- **Die Fahrtberechtigung** schließt diese Lücke. Sie reist aber im Klartext und begrenzt keine Überlastung.

## Der gewählte Weg

1. Die Leitstelle signiert für jede Fahrt eine Berechtigung: dieser Roboter, dieser Aufzug, dieses Stockwerk, zehn Minuten.
2. Der Roboter signiert jeden Ruf mit seinem eigenen Schlüssel.
3. Beide Netzstrecken sind verschlüsselt, mit frischen Schlüsseln je Verbindung.
4. Der Flottenserver trennt einen Roboter ab, der das System flutet.
5. Der Aufzugsadapter prüft die Berechtigung, den aktuellen Zustand des Aufzugs, den Vorrang für Patiententransporte und einen Sensor am Aufzug, bevor sich etwas bewegt.
6. Der Roboter sendet nur, was ein Aufzug braucht. Jede Entscheidung steht in einem signierten Protokoll.

## Grenzen

- Die Geräte sind simuliert. Die Kryptografie ist echt (Ed25519, X25519, AES-256-GCM).
- Die Angriffe hat das Team selbst geschrieben. Das ist keine unabhängige Prüfung.
- Zwei Angriffe gelingen bei allen sieben Wegen: eine kompromittierte Leitstelle, und ein Beobachter, der am Zeitpunkt der Nachrichten erkennt, wann ein Roboter den Aufzug ruft.
- Der gewählte Weg verlangt am meisten von den Herstellern: sieben Voraussetzungen, von der Zertifizierungsstelle bis zum Sensor am Aufzug.

## Offenlegung

Der 3D-Simulator wurde vor dem Hackathon mit einem KI-Assistenten erzeugt und übernommen. Die Kommunikationswege, die Angriffe, die Auswertung und die Seiten entstanden vor Ort mit Claude. Drittanbieter: Three.js (MIT) und die Open-RMF-Klinikkarte (Apache-2.0). Einzelheiten stehen in `README.md` und `NOTICE.md`.

## Nächste Schritte

1. Den simulierten Aufzug durch eine Hersteller-Schnittstelle ersetzen.
2. Angriffe von Außenstehenden schreiben lassen und neu messen.
3. Ein begleiteter Pilot: eine Strecke, ein Aufzug, ein Partnerkrankenhaus.
