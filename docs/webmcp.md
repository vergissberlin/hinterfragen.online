# Tokens gegen Rechts: WebMCP und Kommentieren

WebMCP ist eine experimentelle Browser-Schnittstelle, kein per URL ansprechbarer MCP-Server. Die Integration erkennt `document.modelContext`, mit Fallback für ältere `navigator.modelContext`-Implementierungen. Ohne Unterstützung bleiben alle normalen Funktionen verfügbar. Toolargumente werden unabhängig vom Browser per Zod validiert; Toolregistrierungen werden beim Verlassen der Seite abgebrochen.

## Werkzeuge

| Name                      | Eingabe                               | Ergebnis                                                                                                                       |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `get_current_post`        | `{}`                                  | Aktueller Beitrag, Quellenhinweis, Frageimpulse; Fremdinhalte als untrusted markiert                                           |
| `next_post`               | `{}`                                  | Nächster gültiger Beitrag in den gewählten Themen                                                                              |
| `prepare_question`        | `{questionIndex?:0..2, text?:string}` | Sichtbarer Entwurf, Frage und Original-URL; keine Veröffentlichung oder Clipboard-Änderung                                     |
| `request_youtube_publish` | `{}`                                  | Öffnet eine Prüfung für den aktuellen Entwurf; ohne konfigurierte Verbindung strukturierter Hinweis mit Frage und Original-URL |

Beispielauftrag an den eigenen Browser-Agenten: „Öffne hinterfragen.online, lies einen Beitrag und bereite eine sachliche Nachfrage vor. Zeige mir den Text und das Ziel vor einer Veröffentlichung.“

## Warum ein Link das YouTube-Kommentarfeld nicht befüllt

Die Same-Origin-Grenze verhindert Zugriff auf das DOM von youtube.com. YouTube bietet in diesem Ablauf keinen dokumentierten URL-Parameter für einen vorausgefüllten Kommentar. WebMCP auf unserer Seite hebt diese Grenze nicht auf.

Es gibt zwei Wege:

1. Frage vorbereiten und kopieren, Original öffnen. Ein ausdrücklich vom Nutzer beauftragter Browser-Agent kann anschließend auf YouTube arbeiten, abhängig von Browser, Konto und dessen eigenen Freigaben.
2. Einmalige Veröffentlichung über `commentThreads.insert` nach YouTube-OAuth und sichtbarer Freigabe auf unserer Seite. Das ist ein API-Kommentar; das YouTube-Kommentarfeld wird dabei nicht befüllt.

## Optionale API-Verbindung einrichten

1. Google-Cloud-Projekt erstellen oder vorhandenes eigenes Projekt wählen und YouTube Data API v3 aktivieren.
2. OAuth-Consent-Screen mit tatsächlichen Betreiber-/Datenschutzangaben einrichten. Anforderungen für Verifizierung und Testnutzer vor dem öffentlichen Start prüfen.
3. OAuth-Client vom Typ „Web application“ erstellen. Exakte Origins eintragen, lokal etwa `http://localhost:8080` und produktiv `https://hinterfragen.online`.
4. Öffentliche Client-ID als **Buildvariable** `PUBLIC_YOUTUBE_CLIENT_ID` setzen und Webimage neu bauen. Kein Client-Secret im Browser oder Repository verwenden.
5. Auf einem echten, freigegebenen Beitrag die Frage vorbereiten und „Mit YouTube veröffentlichen“ wählen.
6. Google laden, anschließend „YouTube verbinden“ klicken. Der zweite Klick erhält die nötige Nutzerinteraktion für das OAuth-Popup.
7. Google verlangt `https://www.googleapis.com/auth/youtube.force-ssl`. Dieser Scope ist umfassender als reines Kommentieren; die Oberfläche weist darauf hin. Keine stillschweigende Zustimmung annehmen.
8. Nach Autorisierung Ziel und exakten Text prüfen und „Diesen Kommentar veröffentlichen“ klicken. Werkzeugaufrufe können diese Freigabe nicht direkt erteilen.

Tokens bleiben im Arbeitsspeicher. Kein Refresh-Token, kein Portal-Login, kein Versand an unser Backend. Berechtigung lässt sich in der Oberfläche mit gültigem Token oder jederzeit über das Google-Konto widerrufen.

Einzelne Versandversuche werden im Tab gegen Wiederholung gesperrt. Bei unklarem Netzwerkstatus kein automatischer Retry, da die API keine sichere Idempotenzkennung für diesen Aufruf bietet. Annahme durch die API garantiert keine öffentliche Sichtbarkeit nach YouTube-Moderation. Es gibt keine Massenversand- oder Kampagnen-Queue und keine Punkte für API-Kommentare.

Der Browser muss vor dem Versand eine frische Betriebsfreigabe, den aktuellen Beitrag und eine nicht cachebare Backend-Freigabe für genau diesen Beitrag abrufen. Bei Angriffsmodus, abgelaufener Freigabe oder ausgefallenem Backend wird kein API-Kommentar gesendet. Kopieren und manuelles Öffnen bleiben verfügbar.

Die WebMCP-Verträge und simulierten Browseraufrufe werden automatisiert getestet. Native Registrierung und Werkzeugausführung sind zusätzlich in Chromium mit aktivierter experimenteller WebMCP-Schnittstelle getestet. Ein externer browserseitiger Agent und reale Google-Autorisierung sind vor öffentlicher Aktivierung separat zu prüfen.

Referenzen: [Chrome-WebMCP-Anleitung](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/agentic-javascript-tools.md), [YouTube-Kommentar anlegen](https://developers.google.com/youtube/data/reference/rest/v3/commentThreads/insert), [Google Tokenmodell](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
