---
name: tgr-setup
description: Richte das Codex-Plugin Tokens gegen Rechts für eingeladene Teilnehmende ein, einschließlich Google-Anmeldung und persönlicher Optionen.
---

Lies `tgr_get_settings`. Erkläre vor dem ersten Lauf:

- Recherche und Formulierung nutzen den persönlichen Codex-Zugang und dessen Kontingent. Es wird kein Guthaben an den Betreiber übertragen. Das Plugin enthält keinen Modell-API-Aufruf.
- Standardmäßig werden öffentliche Quellen, Aussagekontext, Analyse und drei Fragen an https://hinterfragen.online zur redaktionellen Prüfung gesendet. Private Chats und Browserdaten gehören nicht zur Einreichung. Einreichen ist abschaltbar; Aufbewahrung auf dem Server: 30 Tage.
- Modi: `draft` liefert nur Text; `approve` braucht konkrete Zustimmung für Text, Video und Konto; `autonomous` benötigt zusätzlich einen ausdrücklichen Startauftrag je begrenztem Lauf. Standard: `approve`, drei Videos, 15 Minuten, Deutsch und sachlich.

Lass die Person diese Optionen wählen/bestätigen und speichere sie mit `tgr_update_settings`, einschließlich `onboardingComplete: true`. Erst dann kann ein Recherchelauf starten. Installation allein autorisiert keine Kommentare. Einrichten startet keinen Lauf.

Für Einreichungen `tgr_connect` nach persönlichem Verbindungsauftrag aufrufen. Das öffnet die Anmeldung im normalen Browser. Die Person meldet sich selbst bei Google an; niemals Passwörter, Bestätigungscodes, Cookies, Client-Secrets oder Sitzungstokens erfragen/ausgeben. Anschließend `tgr_get_auth_status` aufrufen. Dieser zeigt nur lokale Gültigkeit, keine unabhängige serverseitige Bestätigung. Die App-Anmeldung erteilt ausschließlich Einreichungszugang, keine Social-Media-Berechtigungen. Bei nicht freigeschaltetem Pilotkonto oder noch nicht eingerichtetem Google-Client bleibt lokale Recherche möglich. Abmelden mit `tgr_disconnect`.

Vor dem ersten Lauf erklären: Auch ein autonomer Modus darf ausschließlich zentral durch unabhängige KI-Prüfung oder Redaktion bestätigte Beiträge und exakte Fragen veröffentlichen. Einreichung ist noch keine Bestätigung. Ohne Bestätigung, bei Rücknahme oder nicht erreichbarer Freigabe nur Entwürfe. Wer Einreichen abschaltet, kann neue private Recherche nicht zur zentralen Prüfung geben und deshalb daraus nicht direkt über das Plugin veröffentlichen.

Browsersteuerung wird vom Host bereitgestellt. Prüfe ihre Verfügbarkeit und erkläre gegebenenfalls die Einrichtung des persönlich angemeldeten Browsers; fordere keine Cookies oder Zugangstokens an. Ohne Browser funktioniert die Recherche mit zugänglichen Webquellen und der Entwurfsmodus. Behaupte keine erfolgreiche Videoanalyse ohne zugänglichen Originalkontext.

Bei beschädigten Einstellungen stoppt das Plugin externe Aktionen. Die Person kann nach Beenden aller Plugin-Prozesse lokal `node <installierter-Pluginpfad>/runtime/server.mjs --reset-settings` ausführen. Das setzt Optionen zurück, nicht die Versandhistorie. Einen verwaisten `.lock` erst entfernen, wenn alle Plugin-Prozesse beendet sind.
