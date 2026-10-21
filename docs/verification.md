# Prüfprotokoll

Stand: 21. Oktober 2026. Lokale Implementierung und technische Vorschau; keine produktive Veröffentlichung.

## Durchgeführt

- Astro-/TypeScript-Prüfung ohne Fehler, Warnungen oder Hinweise.
- 27 Unit-/Integrationstests erfolgreich: Inhaltsbelege, Publikationsgrenzen, Kalibrierungssperre, Redaktion und Rollen, idempotente Imports, Rücknahmen, konkurrierende Freigabe, Datenablauf, Ereignisaggregation und YouTube-Fehlerfälle.
- Dieselben 27 Tests zusätzlich gegen echtes PostgreSQL 17 im lokalen Docker-Netz ausgeführt. Jeder Test nutzt ein eigenes Schema; die redaktionelle Datenbank wurde nicht mit Testbeiträgen befüllt.
- 16 Browserfälle: Desktop und mobiles Chromium, lokale Themenfilter und Zähler, Kopieren und Bearbeiten, Tastatur und native Touch-Gesten, fehlender/abgelaufener Katalog, Trackingausfall und optionale YouTube-Veröffentlichung mit simuliertem Google-Dienst.
- Native WebMCP-Registrierung und Ausführung aller vier Werkzeuge in Chromium 156 mit aktivierter experimenteller Schnittstelle geprüft, zusätzlich zu den simulierten Vertragstests. Kein externer KI-Agent als Testperson verwendet.
- YouTube-Simulationen bestätigen: kein Versand vor Freigabeklick, kein Token im lokalen Speicher, kein automatischer Retry bei unklarem Ergebnis, kein Versand bei Angriffsmodus, zurückgenommenem Beitrag oder fehlender Backend-Freigabe.
- Produktions-Build und alle drei Dockerimages gebaut. Compose-Konfiguration geprüft; Dienste lokal gestartet.
- Backend und Wartungsdienst gestoppt: Startseite, statischer Katalog und PDF blieben mit HTTP 200 erreichbar; dynamische Kommentierfreigabe schlug fehl.
- Datenbank gestoppt: dieselben statischen Inhalte blieben erreichbar; dynamische Freigabe schlug fehl. Nach Neustart erholte sich das Backend.
- Desktop-/Mobilansicht der Docker-Webapp visuell geprüft: keine Browserfehler und kein horizontaler Überlauf.
- A4/A3/A2-PDFs gerendert und visuell geprüft. Papiermaße und Seitenzahlen geprüft. Alle acht QR-Codes aus den gerenderten Seiten erfolgreich dekodiert; Ziel jeweils `https://hinterfragen.online`.
- Live-Build ohne Betreiberangaben wird verweigert. Lokale Admin-/Agent-/Datenbank-Secrets im öffentlichen Build nicht gefunden. `.env` und redaktioneller Korpus sind ignoriert.

Reproduktion: `npm run check`, `npm test`, `npm run build`, `npm run test:posters` (Poppler erforderlich), `npm run test:e2e`. PostgreSQL-Tests verwenden `POSTGRES_TEST_URL`; sie legen isolierte Testschemas an und benötigen dafür Rechte. Niemals auf einer fremden Produktionsdatenbank ausführen.

## Vor öffentlichem Start noch erforderlich

- Tatsächliche Betreiberangaben und Datenschutzprüfung für die konkrete Installation.
- Cloudflare-Zone, Tunnel, Access-Service-Authentifizierung, WAF, Cache-Regeln und erfolgreiche Invalidierung auf der echten Domain.
- Echte YouTube-Zugänge, Quoten und Prüfung der API-/Analysebedingungen.
- Modelllizenz und GGUF-Herkunft prüfen; echten kalten/warmen Benchmark auf dem vorgesehenen GitHub-Runner durchführen.
- Mindestens 40 tatsächlich redaktionell bewertete deutsche Abnahmefälle. Diese wurden nicht erfunden oder durch Unit-Test-Fixtures ersetzt. Bis dahin bleibt automatische Veröffentlichung gesperrt.
- GitHub-Actions-Läufe im Zielrepository tatsächlich ausführen. Workflows sind implementiert, aber aus diesem lokalen Arbeitslauf nicht remote gestartet worden.
- Reale Google-OAuth-Autorisierung, gegebenenfalls Google-Verifizierung und ein bewusst freigegebener Einzelkommentar auf einem geeigneten Testvideo. Es wurde kein echter Kommentar veröffentlicht.
- Externen Browser-Agenten mit WebMCP prüfen; die native technische Schnittstelle ist bereits getestet, allgemeine Browserunterstützung wird nicht behauptet.
- Physischer Testausdruck und Scan, externes Backup mit Wiederherstellungstest, externe Alarmierung für Ausfälle und leeren Katalog.

Profile, Portal-OAuth, öffentliche Bestenliste und nicht-sachliche Tonalitäten bleiben wie vereinbart Phase 2. Der vorbereitete Datenvertrag allein ist keine implementierte Profilfunktion.
