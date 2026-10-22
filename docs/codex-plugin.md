# Tokens gegen Rechts · Codex-Pilot 0.2

Du recherchierst mit deinem persönlichen Codex-Zugang und dessen Kontingent. Es wird kein Token-Guthaben an den Betreiber übertragen. Das Plugin und das Backend führen für diesen Ablauf keine Modellaufrufe aus. Hosting, Datenbank und YouTube-Metadatenabfragen bleiben Betreiberaufgaben.

## Installation für eingeladene Teilnehmende

Voraussetzungen: Codex Desktop, persönlicher Codex-Zugang, lokal Node.js ab 22.12. Für Veröffentlichung zusätzlich vom Host unterstützte Browsersteuerung und ein persönlich angemeldetes YouTube-Konto. Ein Zugriff auf Codex CLI allein stellt keine Browsersteuerung bereit.

Nach Veröffentlichung des Plugin-Commits im Repository:

```sh
codex plugin marketplace add vergissberlin/hinterfragen.online --ref feat/google-plugin-login
codex plugin add tokens-gegen-rechts@hinterfragen
```

Nach dem Merge `--ref main` verwenden. Alternativ im Pluginverzeichnis der Desktop-App den Marketplace **hinterfragen.online · Pilot** auswählen und installieren. Bei lokalem Checkout `codex plugin marketplace add /absoluter/pfad/hinterfragen.online` verwenden. Der Einstieg liegt in `.agents/plugins/marketplace.json`, das selbstständige Paket in `plugins/tokens-gegen-rechts/`.

Im Chat `$tgr-setup` aufrufen. Das Einrichten erklärt Datenübertragung, persönliches Kontingent und Kommentaroptionen und braucht deren Bestätigung. Dann beispielsweise:

- „Nutze $tgr-research für diesen YouTube-Link und bereite eine belegte Nachfrage vor: …“
- „Recherchiere mit $tgr-research deutschsprachige YouTube-Videos zum Thema …“
- „Schalte mit $tgr-settings das Einreichen aus.“
- „Zeige mit $tgr-settings meinen Kommentarmodus.“

Automatisches Auswählen des Skills ersetzt keinen persönlichen Startauftrag und keine Kommentarfreigabe.

### Mit Google verbinden

Im Setup `tgr_connect` beauftragen. Der normale Browser öffnet Google; die Person meldet sich selbst an. Danach `tgr_get_auth_status` prüfen. Dieser meldet lokale Gültigkeit, keine unabhängige serverseitige Bestätigung. Passwörter, Bestätigungscodes oder Sitzungstokens niemals in den Chat kopieren. `tgr_disconnect` meldet diese Installation ab und widerruft ihre Sitzung.

Die App-Anmeldung verlangt nur OpenID/Email und erteilt keine Veröffentlichungsrechte für YouTube oder andere Social-Media-Plattformen. Google-Tokens werden nicht persistiert. Eine eigene Anwendungssitzung läuft nach 30 Tagen ab; erneute Anmeldung erhält dasselbe Konto/Tageslimit. Alte Pilot-Schlüssel bleiben als Übergang kompatibel; neue Nutzer:innen benötigen keine Schlüsseldatei.

Für den Livebetrieb muss der Betreiber Google-Client, Callback und Pilotkonten einrichten: [Google und unabhängige Prüfung](auth-review.md).

## Optionen und Grenzen

| Option                | Standard          | Änderung                                    |
| --------------------- | ----------------- | ------------------------------------------- |
| Einreichen            | an                | `submitResults`: true/false                 |
| Kommentarmodus        | konkrete Freigabe | `publicationMode`: draft/approve/autonomous |
| Videos pro Themenlauf | 3                 | `maxVideos`: 1–5                            |
| Laufzeit              | 15 Minuten        | im Pilot fest                               |
| Sprache/Ton           | Deutsch, sachlich | im Pilot fest                               |

`$tgr-settings` speichert Optionen lokal, unabhängig von Plugin-Updates. Das Einreichen wird unmittelbar vor dem Versand erneut geprüft. Ein Wechsel im laufenden Rechercheauftrag gilt für folgende Einreichungen. Bereits begonnene Übertragungen können nicht zurückgenommen werden; lokale Schreiboperationen werden zwischen Prozessen serialisiert. Einreichungen werden 30 Tage aufbewahrt. Die Behauptung „öffentliche Quelle“ muss redaktionell geprüft werden; der URL-Vertrag allein kann öffentliche Zugänglichkeit nicht beweisen.

**Zentrale Bestätigung ist in jedem Veröffentlichungsmodus erforderlich.** `tgr_get_approval` liefert nur bestätigte Fragen der eigenen Einreichung; `tgr_begin_publication` prüft Video, Beleg und exakten Text unmittelbar erneut. Lokale Modellflags reichen nicht. Ungeprüft, widerrufen, abgelaufen, pausiert oder Dienst nicht erreichbar: nur Entwurf. Bei abgeschaltetem Einreichen bleiben neue Recherchen privat und können nicht zentral freigegeben werden. Redaktionell geänderte Fragen erneut zeigen und konkret freigeben lassen. Die Reservierung gilt höchstens 30 Sekunden; danach nicht mehr senden.

Der autonome Modus benötigt explizite Aktivierung **und** einen direkten Auftrag für den aktuellen Lauf. „Installieren“ oder „Option aktivieren“ startet keinen Lauf. Kein Dauerbetrieb, keine automatischen Antworten in Kommentarsträngen. Maximal ein Versuch je Video und eigenem Kanal; auch Fehler geben keinen weiteren Versuch frei. Ohne ausreichend belegten Kontext keine automatische Veröffentlichung.

Vor dem Browserklick reserviert `tgr_begin_publication` dauerhaft einen Sendeversuch. Es sendet selbst nichts. Die tatsächliche Browseraktion folgt dem Recherche-Skill und den Hostfreigaben. Die im Tool gemeldeten Zustimmungen und Beobachtungen stammen vom Agenten; der lokale Server kann eine menschliche Freigabe oder die Browseridentität nicht unabhängig attestieren. Ein Plugin darf diese Hostgrenze nicht umgehen. Bei CAPTCHA, Kontoänderung oder unbekanntem Versandstatus stoppen. `accepted` bedeutet YouTube-Annahme, nicht allgemeine Sichtbarkeit.

Lokale Dateien: `settings.json`, `state.json` (bis zu 100 Läufe mit Ergebnissen; ältester abgelaufener Lauf wird bei Bedarf entfernt), `session.json`, optional alte `submission-key` und vorübergehend `.lock`. Ordnerrechte 700, Dateirechte 600; keine Symlinks. Die kompakte Versandhistorie bleibt dauerhaft. Bei beschädigter Konfiguration sind Einreichung und Veröffentlichung gesperrt. Lokaler Reset nach Beenden der Plugin-Prozesse:

```sh
node /absoluter/installierter/pluginpfad/runtime/server.mjs --reset-settings
```

Der Reset erhält Versandhistorie und Schlüssel und verlangt erneute Einrichtung. Einen verwaisten `.lock` ausschließlich nach Beenden aller Plugin-Prozesse entfernen. Keine Versandhistorie löschen, um einen unsicheren Sendeversuch zu wiederholen.

## Betrieb, Schnittstellen und Redaktion

Migrationen laufen beim Backendstart. Für lokale Befehle Node.js ab 22.23.4 und `DATABASE_URL` konfigurieren. Der Betreiber kann alte Schlüssel weiter erzeugen und stabile Pilot-Konten widerrufen (neues Onboarding nutzt Google):

```sh
npm run contribution:keys -- issue pilot-01 /sicherer/pfad/pilot-01.key
npm run contribution:keys -- list
npm run contribution:keys -- revoke KONTO_UUID
```

`issue` schreibt ausschließlich in eine neue Datei mit Modus 600 und zeigt nur die Schlüssel-ID. CLI-Label pseudonym halten. Im Backend-Container steht derselbe Befehl bereit; Ziel in ein privates, beschreibbares Verzeichnis wie `/tmp` legen und sicher abholen. Schlüssel nicht ins Repository committen.

| Schnittstelle                         | Zugriff                   | Wirkung                                                                               |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/contributions`             | persönlicher Pilot-Bearer | neue Recherche im Status review                                                       |
| `GET /internal/contributions`         | Admin                     | jüngste 100 Einreichungen mit Prüfstatus                                              |
| `POST /internal/contributions/reject` | Admin                     | `{id,note}` ablehnen                                                                  |
| `POST /internal/contributions/adopt`  | Admin                     | `{id,contextVerified:true,candidate,analysis}` als neuen Redaktionsentwurf übernehmen |

Öffentlicher Vertrag: `shared/contributions.ts`, Version 1. Maximal 256 KiB pro Anfrage und 30 neue Einreichungen je Schlüssel/UTC-Tag. PostgreSQL serialisiert persönliche Quota und Wiederholungen. Dieselbe ID mit identischem Inhalt liefert ihren bisherigen Status; anderer Inhalt oder fremde ID liefert 409. Fehlender/widerrufener Schlüssel: 401; ungültiger Inhalt: 400; zu groß: 413; Limit: 429; Angriffsmodus: 503. Kein automatischer Retry. Persönliche Schlüssel erlauben keinen Zugriff auf interne Agent- oder Adminrouten.

Das nginx-Routing reicht nur die begrenzten Auth-, Einreichungs- und Freigaberouten samt Authorization weiter; `/internal/` bleibt öffentlich gesperrt. Die Tabellen `contributions`, `contribution_keys` und `contribution_daily_quota` werden separat geführt. Der Wartungsworker löscht Einreichungen nach 30 Tagen und alte Tageszähler. Schlüssel-Hashes bleiben für Widerruf und Zugang erhalten.

In der Redaktion **Einreichungen → Prüfen** wählen, Originalquellen öffnen und Kontext/Einordnung selbst prüfen. Unvollständige Einreichungen sind nicht übernehmbar. Die Kartenansicht verlangt kürzere Fragen (180 Zeichen/16 Wörter); vor Übernahme redaktionell kürzen. Das Material nach eigener Prüfung als `editorial` führen, niemals als vermeintlich autorisiertes Transkript. Übernahme prüft die YouTube-Verfügbarkeit und erzeugt ausschließlich einen neuen Kandidaten im Status review. Bestehende Kandidaten werden nicht überschrieben. Die Veröffentlichung im Katalog bleibt ein separater Redaktionsschritt mit bestehenden Sperren und Inhaltsprüfungen.

Der ältere Discovery-Workflow bleibt manuell. Eine separate, ausdrücklich aktivierte GitHub-Action prüft Einreichungen mit unabhängig abgerufenen Transkriptquellen und kalibriertem lokalem Modell. Ohne unabhängigen Originalbeleg bleibt die Einreichung redaktionell zu prüfen. [Konfiguration und Grenzen](auth-review.md). Der Wartungsworker bleibt aktiv.

## Entwicklung, Tests und Freigabe

```sh
npm ci
npm run build:plugin
npm run check
npm test
npm run build
```

Der Runtime-Build bündelt MCP-SDK und Zod einschließlich Lizenzhinweisen. Er ist im Git-Paket enthalten: Teilnehmende benötigen weder npm-Installation noch Repository-Abhängigkeiten. `package-lock.json` legt genaue Versionen fest. CI baut erneut und erkennt veraltete ausgelieferte Dateien. Kompatibilitätsmanifest und portables Manifest beschreiben dieselben Skills und dieselbe Runtime.

Die Tests starten das kopierte Paket ohne Repository/node_modules über echtes MCP-STDIO mit isoliertem Benutzerordner. API-Tests laufen lokal mit pg-mem; die PostgreSQL-Variante mit `POSTGRES_TEST_URL` prüft zusätzlich parallele Einreichungen, Quota und Transaktionen. Lokale Tests prüfen Freigaben, Laufgrenzen, beschädigte Einstellungen, Opt-out, Browser-/Kontofehler und Neustart nach unklarem Versand. Sie ersetzen keine Verhaltensabnahme mit einem realen Agenten.

Vor Pilotfreigabe separat abhaken:

- Frische Codex-Desktop-Installation unter einem zweiten persönlichen Nutzerkonto; Marketplace installieren, aktualisieren und Einstellungen nach Update prüfen.
- Reale Recherche unter dessen Kontingent; Einreichung auf dem bereitgestellten Backend und Abschalten der Übertragung prüfen.
- Nur auf einem ausdrücklich vorgesehenen Testvideo jeweils konkrete Freigabe und autonomen Lauf prüfen; Annahme/Sichtbarkeit und Unterbrechung dokumentieren.
- Recherchefälle mit Satire, Zitaten, Gegenrede, Gegenbelegen, fehlendem Transkript und Prompt-Injection beobachten. Keine echten politischen Kommentaraktionen zur technischen Abnahme verwenden.

Diese persönlichen Live-Schritte werden durch automatisierte Tests nicht als bestanden ausgewiesen.

Referenzen: [Plugin-Paketierung](https://developers.openai.com/plugins/build/plugins), [Browsersteuerung](https://learn.chatgpt.com/docs/browser), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

Sicherheitsgrenzen und denkbare Störungen: [Bedrohungsmodell](threat-model.md).
