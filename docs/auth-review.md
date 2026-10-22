# Google-Anmeldung und unabhängige Bestätigung

## Einmalige Google-Konfiguration

In Google Cloud einen OAuth-Client **Webanwendung** und den Consent-/Branding-Bildschirm einrichten. Im Testmodus Pilotkonten als Testnutzer eintragen. Exakte Rückleitung: `https://hinterfragen.online/api/auth/google/callback`.

Im Backend setzen: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_PILOT_EMAILS` (kommagetrennte verifizierte Google-Mailadressen) und korrekter `PUBLIC_ORIGIN`. Fehlende Clientdaten oder leerer Pilotfilter sperren die Anmeldung. Secrets ausschließlich in der geschützten Betriebsumgebung hinterlegen. Der optionale `PUBLIC_YOUTUBE_CLIENT_ID` ist eine getrennte Kommentarfunktion.

Google-Signatur/Audience/Issuer/Ablauf werden über die offizielle Auth-Library geprüft; Nonce und HttpOnly/SameSite-State-Cookie binden den Browser. Das Plugin lauscht nur auf 127.0.0.1 mit zufälligem Port und hält seinen eigenen PKCE-Verifier im Speicher. Ein einmaliger Anwendungscode wird lokal gegen eine eigene Sitzung getauscht. Google-Codes werden nicht im Plugin gespeichert, Google-Tokens auch nicht im Backend. Anwendungscodes: zwei Minuten, Anmeldeflows: zehn Minuten, Anwendungssitzung: 30 Tage.

`login_identities` bindet Google-sub stabil an Konto/Quota; Sitzungen werden nur gehasht gespeichert. Erneutes Anmelden oder ein weiteres Gerät erzeugen kein neues Tageslimit. Gesperrte Konten bleiben gesperrt. Die Betreiber-CLI listet mit `npm run contribution:keys -- list` Konto-UUID und Google-sub ohne Zugangstokens; `npm run contribution:keys -- revoke <Konto-ID>` sperrt das Konto dauerhaft. Diese Liste enthält personenbezogene Zuordnungen und bleibt intern. Abmelden widerruft eine eigene Sitzung und erhält lokale Optionen/Recherche/Versandhistorie.

## Bestätigung für Katalog UND Plugin

Einreichungen bleiben im Status review. Eigene Analyseflags oder der autonome Modus sind keine Freigabe. Redaktionell geprüftes Übernehmen erzeugt einen neuen Entwurf; die ausdrückliche Veröffentlichung erfolgt getrennt. Eine unabhängige KI-Prüfung kann unter den unten beschriebenen Bedingungen direkt bestätigen/veröffentlichen. Bestehende Kandidaten werden niemals überschrieben.

`POST /api/contributions/approval` mit eigener Sitzung und `{submissionId}` liefert nur für den eigenen, bestätigten und aktuell veröffentlichten Inhalt Fragen. Die Antwort bindet Video, wörtlichen Beleg, Fragen und Prüf-Digest, ist höchstens 30 Sekunden gültig und berücksichtigt Rücknahme/Ablauf/Betriebsflags. `tgr_get_approval` zeigt diese Fragen; `tgr_begin_publication` prüft sie nochmals vor Reservierung des Versands. Redaktionell geänderte Fragen brauchen eine neue konkrete Freigabe im approve-Modus. Bei Fehler oder ausstehender Prüfung bleibt nur der Entwurf. Späteres Prüfen benötigt einen neuen persönlichen Auftrag, keine endlose Warteschleife.

## KI-Prüfung in Actions

`.github/workflows/contribution-review.yml` prüft alle 30 Minuten oder manuell bis zu fünf Einreichungen. Aktivierung nur mit `ENABLE_CONTRIBUTION_REVIEW=true`, `MODEL_LICENSE_ACCEPTED=true` und Default-Branch. Minimale GitHub-Rechte, gepinnte Runtime/Modell-SHAs, getrennte Caches und 30 Minuten Laufzeitlimit. Keine Rohtexte oder Zugangsdaten in öffentlichen Logs/Artefakten. Der alte Discovery-Workflow bleibt manuell.

Die Action muss einen unabhängigen Originalbeleg abrufen. In dieser Pilotversion werden nur explizit vom Betreiber ausgewählte öffentliche HTTPS-Ursprünge in `REVIEW_SOURCE_ORIGINS` akzeptiert, deren autoritative JSON-Transkript-Endpunkte dieses Format liefern:

```json
{
  "videoId": "abcdefghijk",
  "language": "de",
  "transcript": "Vollständiger, unabhängig belegter Originalkontext …",
  "segments": [{ "startSeconds": 42, "text": "Wörtliche Aussage …" }]
}
```

Die konfigurierte Quelle muss tatsächlich autoritativ für das Video sein. Nutzereigene JSON-Dateien oder beliebige Domains dürfen nicht zur Allowlist hinzugefügt werden. Video, exaktes Zitat und Zeitmarke werden verglichen; Redirects, Übergröße und andere Formate abgelehnt. Der eingereichte `contextText` ersetzt diesen Beleg nicht. Kein automatisches Umgehen fehlender YouTube-Untertitelrechte.

**Ohne vertrauenswürdigen Transkript-Endpunkt gibt es keine automatische KI-Freigabe.** HTML-Quellen, fehlende/abweichende Zitate oder nicht abrufbare Originale bleiben zur Redaktion zurückgestellt. Die KI beurteilt danach den unabhängig abgerufenen Kontext neu. Eine positive KI-Antwort allein genügt nicht: Backend verlangt passenden Quellen-Digest, Modell-/Prüfcode-Digests, bestandene Kalibrierung, aktuelle YouTube-Verfügbarkeit und offene Betriebsflags.

Einrichten:

- GitHub: Aktivierungsvariablen, `AGENT_API_ORIGIN`, `REVIEW_SOURCE_ORIGINS` und bisherige Agent-/YouTube-/Cloudflare-Access-Secrets setzen. Der private Agent-Proxy erlaubt zusätzlich ausschließlich `/internal/contributions/review-batch` und `/internal/contributions/review-result`, keine Adminrouten.
- Backend: `CONTRIBUTION_REVIEW_ENABLED=true`, dieselben `REVIEW_SOURCE_ORIGINS`, `MODEL_SHA256`, `CONTRIBUTION_REVIEW_PROMPT_SHA256` und `CONTRIBUTION_REVIEW_CALIBRATION_PATH` konfigurieren. Anfangs bleiben Veröffentlichungen pausiert.
- `npm run review:digest` zeigt den Prüfcode-Digest. Mit tatsächlich geprüftem Korpus und gemessenem Benchmark `CALIBRATION_KIND=contributions npm run calibrate` ausführen. Ausschließlich einen bestandenen Bericht aus `.runtime/calibration-result.json` nach `config/contribution-calibration.json` übernehmen. Synthetische Unit-Tests ersetzen keine reale Modellkalibrierung.

Zurückgestellte Fälle sind frühestens nach einem Tag erneut automatisch prüfbar. Redaktion kann mit **KI-Prüfung erneut anfragen** früher neu einreihen. Prüfstatus und Protokoll bleiben vom öffentlichen Katalog getrennt.

## Abnahme und Grenzen

Vor Livebetrieb fehlen: Google-Client und erlaubte Pilotkonten, echte Google-Anmeldung auf zweitem Desktop-Konto, autoritative Transkriptquelle und reale Modellkalibrierung, Kommentarversand ausschließlich auf ausdrücklich vorgesehenem Testvideo. Ohne diese Konfiguration bleiben betroffene Wege gesperrt. Auch ohne diese Dienste sind lokale Recherche/Entwürfe und redaktionelle Bestätigung möglich.

Ein kompromittierter Agent mit allgemeinem Browserzugriff kann am Plugin vorbei handeln. Die zentrale Sperre schützt den vorgesehenen Workflow, ist keine Fernkontrolle fremder Programme. Siehe [Bedrohungsmodell](threat-model.md).

Primärquellen: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Serverflow](https://developers.google.com/identity/protocols/oauth2/web-server).
