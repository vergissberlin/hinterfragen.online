# hinterfragen.online

**Man wird ja wohl noch fragen dürfen?** Eine schlanke Webapp mit belegtem Kontext und sachlichen Frageimpulsen zu problematischen Aussagen.

## Lokal starten

Node.js ab 22.23.4:

```sh
npm ci
npm run dev:demo
```

Die Vorschau enthält **ausschließlich erfundene Beispiele**, keine echten Accounts. `npm run dev` startet mit leerem Livekatalog. Druckvorlagen mit `npm run posters` erzeugen.

```sh
npm run check
npm test
npm run build
npm run test:posters # benötigt Poppler / pdftoppm
npm run test:e2e
```

## Enthalten

- Anonyme Kartenansicht, Themenfilter, Swipe und Tastaturbedienung, Fragen in einfacher Sprache und lokaler Aktivitätszähler.
- Direkter Original-Link sowie Name und Avatar des Beitragsautors oder des ausgewählten Kommentarautors; Antworten landen im passenden Thread.
- PostgreSQL, interne Redaktion, begrenztes Klicktracking, statischer Katalog und Docker Compose.
- Codex-Plugin für einen eingeladenen Pilot: persönliche Recherche, lokale Einstellungen und separate redaktionelle Einreichungen ohne Betreiber-Modellkontingent. Der ältere Llama-Agent ist nur manuell startbar.
- A4 mit sechs QR-Karten sowie A3-/A2-Plakate.
- **Tokens gegen Rechts:** experimentelles WebMCP für Browser-Agenten. Optionales Veröffentlichen eines einzelnen Kommentars über YouTube nach sichtbarer Prüfung und Autorisierung.

YouTube-Kommentare lassen sich nicht durch einen Link vorbefüllen. Ohne API-Verbindung: Frage kopieren und Original öffnen. Mit `PUBLIC_YOUTUBE_CLIENT_ID`: optionale Kontoautorisierung und Veröffentlichung über die offizielle API. Keine Portal-Anmeldung und kein Hintergrundversand.

Profile, OAuth-Portal-Login, Bestenliste und fünf Tonalitäten sind **Phase 2**, nicht Bestandteil von V1. Datenvertrag und sachlicher Ersatz sind vorbereitet.

## Dokumentation

- [Codex-Plugin: Installation, Einstellungen und Pilotabnahme](docs/codex-plugin.md)

- [Betrieb und Installation](docs/operations.md)
- [Agent, Kalibrierung und Caching](docs/agent.md)
- [WebMCP und YouTube-Autorisierung](docs/webmcp.md)
- [Architektur und Schnittstellen](docs/architecture.md)
- [Prüfprotokoll und verbleibende Live-Abnahme](docs/verification.md)

Öffentlicher Start erst nach Betreiberangaben, Datenschutzprüfung, echten Quellen und Zugängen. Automatische Veröffentlichung ist standardmäßig aus; zusätzlich sind Veröffentlichungen in der Datenbank pausiert.

Lizenz: [GPL-3.0](LICENSE). Modell und Abhängigkeiten haben eigene Lizenzbedingungen.
