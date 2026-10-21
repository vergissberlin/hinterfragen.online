# Installation und Betrieb

## Voraussetzungen und lokaler Start

Docker mit Compose, freier lokaler Port 8080 und 3001, optional Cloudflare-Konto und YouTube-API-Schlüssel. Node.js ab 22.23.4 für Entwicklung. Für PostgreSQL mindestens ein dauerhaftes Volume und ein externes Backupziel vorsehen.

```sh
cp .env.example .env
# In .env eigene zufällige Werte setzen; niemals in Chat oder Logs ausgeben.
# Für Passwörter und Tokens eignen sich getrennte Werte aus: openssl rand -hex 32
# PUBLIC_ORIGIN exakt setzen, einschließlich Port und ohne abschließenden Slash.
docker compose up -d --build
```

Die URL ist lokal `http://localhost:8080`, die Redaktion `http://localhost:3001/internal/editor`. Ein vom lokalen Implementierungslauf bereits erzeugtes `.env` nicht überschreiben. Es enthält unabhängige zufällige lokale Tokens und ist ignoriert.

Datenbankpasswort für die beispielhafte URL auf Hexzeichen beschränken oder URL-kodieren. Die Datenbank veröffentlicht standardmäßig keinen Port. Die API ist nur an Loopback gebunden. Alle Portaldaten liegen in den Compose-Volumes `postgres` und `catalog`.

Für die rein lokale Vorschau `PUBLIC_DEMO_MODE=true` setzen und Webimage neu bauen. Livebuilds erlauben keine Demo. Die drei PDFs werden beim Build generiert. Eigene Werte in `PUBLIC_*` sind öffentliche Buildvariablen, keine Secrets. `PUBLIC_YOUTUBE_CLIENT_ID` ist ausdrücklich optional.

## Livebetrieb und Cloudflare

1. Betreibername, zustellfähige Adresse und Kontakt hinterlegen (`PUBLIC_OPERATOR_NAME`, `PUBLIC_OPERATOR_ADDRESS`, `PUBLIC_OPERATOR_EMAIL`). Datenschutzseite an tatsächlichen Betreiber, Rechtsgrundlagen, Dienstleister, Übermittlungen und Speicherfristen anpassen und prüfen. Das technische Muster ersetzt diese Prüfung nicht.
2. `LIVE_MODE=true`, `PUBLIC_DEMO_MODE=false`, `PUBLIC_ORIGIN=https://hinterfragen.online` setzen. Build verweigert fehlende Betreiberangaben. Backend verweigert Livebetrieb ohne HTTPS-Origin, YouTube-Schlüssel und CDN-Zugang.
3. API-Schlüssel auf YouTube Data API beschränken. Cloudflare-Token nur mit Cache-Purge-Recht für die eigene Zone anlegen; `CLOUDFLARE_ZONE_ID` und `CLOUDFLARE_API_TOKEN` setzen.
4. Cloudflare Tunnel anlegen. `CLOUDFLARE_TUNNEL_TOKEN` setzen und `docker compose --profile cloudflare up -d --build` starten. Keine öffentlichen Hostports oder direkte Origin-DNS-Einträge ergänzen.
5. Öffentlichen Host `hinterfragen.online` auf `http://web:8080` routen. Kein öffentliches Routing der Backend- oder Datenbankadresse.
6. Für GitHub Actions einen separaten Host einrichten, mit **Cloudflare Access Service-Auth** geschützt. Nur Pfade `/internal/discover`, `/internal/agent-batch` und `/internal/import` an `http://backend:3001` leiten, alle anderen Pfade mit 404 ablehnen. Niemals Admin-Token als GitHub-Secret verwenden.
7. Redaktion weiterhin per SSH-Portweiterleitung auf Loopback öffnen. Betriebsflags lassen sich in der Oberfläche setzen; Token bleibt im Tab.
8. Cache Rules: HTML und statische Assets cachen; `/data/catalog.json` und `/data/stats.json` mit maximal 60 Sekunden Edge-TTL und Revalidierung. `/api/*`, `/internal/*`, `/data/runtime.json` sowie Fehlerantworten niemals cachen. Kein Always Online oder unbegrenztes stale serving für den Katalog.
9. WAF Managed Rules, Rate Limits und Schutzprofil aktivieren. Zugriff ohne Tunnel muss scheitern; bei dynamischen Routen Bypassregeln vermeiden. Cloudflare-Plan und Schutzumfang vor Launch prüfen.

Der Tunnel hat im Compose-Edge-Netz fest `172.29.74.5`; nginx vertraut ausschließlich dieser Adresse für `CF-Connecting-IP`. So kann ein normaler Besucher das IP-Limit nicht durch beliebige Forwarded-Header umgehen. Bei Subnetzkonflikt Compose-IPAM und nginx-Vertrauensadresse zusammen ändern. Keine pauschale Vertrauensregel für öffentliche Header oder alle privaten Netze verwenden.

## Redaktionelle Inbetriebnahme

YouTube-API-/Analysebedingungen prüfen. Im internen Editor einen Kontextdatensatz mit Video-ID, vollständigem Kontext, Fundstelle und wörtlicher Aussage samt Zeitmarke hinterlegen. Titel und Kanal werden gegen die API geprüft. Ohne `analysis` bleibt der Kandidat für einen Agentenlauf bereit; mit redaktionell geprüfter Analyse entsteht ein manueller Entwurf.

Schema und Schnittstellen: [Architektur](architecture.md). Veröffentlichungen sind anfangs pausiert. Nach Prüfung die Sperre in der Redaktion aufheben. Automatische Veröffentlichung zusätzlich erst nach [Kalibrierung](agent.md) aktivieren. Modell- und Prompt-Digests in `.env` müssen dem geprüften Bericht entsprechen. Keine Lorem-ipsum-Beispiele oder Testkandidaten live veröffentlichen.

## Angriffsmodus und Rücknahme

- In der Redaktion „Angriffsmodus an“ aktivieren. Tracking und Agentenübernahme pausieren; neue Veröffentlichungen sind gesperrt. Die kurzlebige Kommentierfreigabe wird deaktiviert. Statische Seite, Original-Links und PDFs bleiben verfügbar.
- Optional zusätzlich dynamische Routen am Cloudflare-Edge sperren. Bei vollständigem API-Ausfall sind statische Inhalte weiter auslieferbar; direkte API-Kommentare benötigen vor jedem Versand zusätzlich eine aktuelle Backend-Freigabe und stoppen bei einem API-Ausfall sofort.
- Einzelnen Beitrag mit „Zurückziehen“ entfernen. Erfolg umfasst lokalen Export und CDN-Invalidierung. Bei Fehlermeldung CDN-Zugang prüfen und „Katalog / CDN erneut aktualisieren“ betätigen; der Worker wiederholt den Export.
- Für spätere Portal-Logins denselben frühen Abschaltmechanismus verwenden. In V1 gibt es keinen solchen Login-Endpunkt.

## Backups und Wiederherstellung

```sh
mkdir -p .runtime/backups
docker compose exec -T db pg_dump -U portal -d portal -Fc > .runtime/backups/portal.dump
# Backup verschlüsselt auf ein separates System übertragen und Wiederherstellung regelmäßig testen.
```

Die Datei enthält Quelldaten und redaktionelle Inhalte. Zugriffe begrenzen, Aufbewahrung nach tatsächlichem Datenschutzkonzept festlegen. Lokale Sicherungen allein schützen nicht gegen Hostverlust. `.env`, geprüfte Kalibrierungsdatei und Cloudflare-Konfiguration getrennt sicher verwahren.

Wiederherstellung zunächst in einer isolierten Staginginstallation: leere Datenbank mit `pg_restore`, danach Backend/Worker starten, Veröffentlichungen pausieren, Verfügbarkeit und Katalog prüfen, erst dann Domain umschalten. Kein ungeprüftes Restore in eine bestehende Produktion. Die PDF- und Webassets sind reproduzierbar; der Katalog kann aus der Datenbank neu erzeugt werden.

## Monitoring und Aktualisierung

- Backend `/health` prüft Datenbankzugriff; Web `/health` prüft statische Auslieferung.
- Worker-Healthcheck: `runtime.json` jünger als drei Minuten. Container-Health allein startet einen hängenden Prozess nicht automatisch neu; externen Alarm konfigurieren.
- Externer Monitor: fehlgeschlagene GitHub-Läufe, Workerfehler, Katalogalter über drei Minuten, leere Beitragsliste und fehlgeschlagene CDN-Purges müssen einen Betreiber alarmieren. Keine produktive Alarmadresse ist im Repository hinterlegt.
- `docker compose logs --tail=50 worker backend` zeigt bewusst keine Rohinhalte oder Zugangstokens. Vor Weitergabe dennoch prüfen.
- Abhängigkeiten per Lockfile, Actions per Commit, Modell per SHA-256 und Runtime per Commit festgeschrieben. Containerbasisimages regelmäßig prüfen und aktualisieren. Nach Modell-/Promptänderungen neue Kalibrierung.
- Stoppen: `docker compose down` erhält Volumes. Niemals `down -v` verwenden, wenn Daten erhalten bleiben sollen.

Ein DDoS-Test gegen fremde Systeme ist nicht Teil der Abnahme. Lokale Ausfallsimulationen ersetzen keine Zusicherung gegen volumetrische Angriffe.
