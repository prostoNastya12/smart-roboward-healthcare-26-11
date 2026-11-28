# Smart RoboWard · Kurzfassung für die Jury

**Healthcare Hackathon Bayern · IFOHRA Challenge 9 · Stand 28. November 2026**

## Das Problem

Transportroboter im Krankenhaus bekommen ihre Aufträge über das Netzwerk und teilen sich Flure und Aufzüge mit Patienten und Personal. Wird ein Robotersystem angegriffen, bleibt heute oft nur, alles abzuschalten. Dann steht die Logistik der ganzen Station.

## Unser Vorgehen

Wir wollten nicht raten, welcher Schutz der beste ist. Wir haben sieben Kommunikationswege zwischen Roboter und Aufzug gebaut, vom offenen Netz bis zu unserem mehrschichtigen Entwurf. Alle wurden mit denselben Angriffen getestet. Die Regel für die Auswahl stand vor dem ersten Durchlauf fest. Auf dem Sieger haben wir danach zwei stärkere Wege aufgebaut.

| | Kommunikationsweg | Herkunft |
| --- | --- | --- |
| A | Offenes Netz | Ausgangslage |
| B | Nur Netzzugangskontrolle | Übliche Praxis im Krankenhaus |
| C | Signierte Einmal-Tickets | Lösung unseres Teammitglieds, unveränderter Code |
| D | Signierte Nachrichten je Gerät | Standardverfahren |
| E | Verschlüsselter Kanal mit gegenseitiger Authentifizierung | Standardverfahren, Prinzip von Mutual TLS |
| F | Fahrtberechtigung mit Besitznachweis | Unser Vorschlag |
| G | Mehrschichtiger Weg | Kombination aus E, F, Datensparsamkeit, Schutzschalter und Aufzugsprüfung |
| H | G mit Vier-Augen-Prinzip | Zweite Signatur des klinischen Auftragssystems |
| I | Zero-Trust-Relais | H, und dem Flottenserver wird nichts mehr anvertraut |

## Ergebnis

Die Zahlen stehen in `secure-comms/RESULTS.md` und werden aus der Messung erzeugt. Unter den sieben Kandidaten gewann **G** mit 22 von 23 abgewehrten Angriffen. Eingesetzt wird **I, das Zero-Trust-Relais**: 23 von 23, dazu 3 von 6 bekannten Grenzfällen. Alle Wege bestehen die 9 Normalfälle.

- **Netzzugangskontrolle** hält Außenstehende ab. Ein kompromittiertes Gerät im Netz kann alles.
- **Tickets** binden das Stockwerk an die Fahrt. Wer ein Ticket mitliest, kann es zuerst benutzen.
- **Signaturen** beweisen, wer fragt. Sie sagen nicht, ob dieses Gerät dieses Stockwerk anfordern darf.
- **Verschlüsselung** schützt jede Teilstrecke. Ein kompromittierter Flottenserver kann trotzdem Aufzugsrufe erfinden und Roboter umleiten.
- **Die Fahrtberechtigung** schließt die erste Lücke. Sie reist aber im Klartext.
- **Das Zero-Trust-Relais** vertraut dem Flottenserver nichts mehr an.

## Der eingesetzte Weg

1. Die Leitstelle signiert jeden Fahrauftrag. Der Roboter prüft die Signatur, bevor er losfährt. Ein gehackter Flottenserver kann ihn nicht in den Keller schicken.
2. Für jeden Aufzugsruf braucht der Roboter eine Berechtigung: dieser Roboter, dieser Aufzug, dieses Stockwerk, zehn Minuten. Das klinische Auftragssystem zeichnet gegen.
3. Roboter und Aufzugsadapter sprechen in einer versiegelten Sitzung. Der Flottenserver leitet sie weiter und kann sie nicht lesen.
4. Der Aufzugsadapter prüft außerdem den Zustand des Aufzugs, den Vorrang für Patiententransporte und einen Sensor am Aufzug.
5. Ein Roboter, der das System flutet, wird allein abgetrennt. Alles andere läuft weiter.
6. Jede Entscheidung steht in einem signierten Protokoll, dessen Stand ein Zeuge außerhalb des Adapters hält.

Niemand auf dem Weg sieht Patient, Medikament, Station, Fahrt oder Stockwerk. Der Aufzug erfährt nur das Stockwerk.

## Grenzen

- Die Geräte sind simuliert. Die Kryptografie ist echt (Ed25519, X25519, AES-256-GCM). Eine Vorführung über echte Netzwerkverbindungen liegt bei.
- Die Angriffe hat das Team selbst geschrieben. Ein zweiter Prüfer, der den Code nicht geschrieben hat, hat ihn zweimal angegriffen. Seine Funde sind behoben oder unten genannt. Das ist keine unabhängige Prüfung.
- Drei Angriffe gelingen weiterhin: ein Beobachter erkennt am Zeitpunkt der Nachrichten, wann ein Roboter den Aufzug ruft. Ein Flottenserver kann aufhören weiterzuleiten, dann pausieren die Roboter und Träger übernehmen, der Aufzug bleibt frei. Und eine Überlastung aus dem kabelgebundenen Netz trifft den Adapter.
- Der eingesetzte Weg verlangt am meisten von den Herstellern: Schlüssel auf den Robotern, ein Adapter, der Berechtigungen prüft, ein Auftragssystem, das signiert.

## Offenlegung

Der 3D-Simulator wurde vor dem Hackathon mit einem KI-Assistenten erzeugt und übernommen. Die Kommunikationswege, die Angriffe, die Auswertung und die Seiten entstanden vor Ort mit Claude. Drittanbieter: Three.js (MIT) und die Open-RMF-Klinikkarte (Apache-2.0). Einzelheiten stehen in `README.md` und `NOTICE.md`.

## Nächste Schritte

1. Den simulierten Aufzug durch eine Hersteller-Schnittstelle ersetzen.
2. Angriffe von Außenstehenden schreiben lassen und neu messen.
3. Ein begleiteter Pilot: eine Strecke, ein Aufzug, ein Partnerkrankenhaus.
