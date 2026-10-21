---
name: tgr-setup
description: Richte das Codex-Plugin Tokens gegen Rechts für eingeladene Teilnehmende ein, einschließlich persönlicher Optionen und lokaler Einreichungsschlüssel.
---

Lies `tgr_get_settings`. Erkläre vor dem ersten Lauf:

- Recherche und Formulierung nutzen den persönlichen Codex-Zugang und dessen Kontingent. Es wird kein Guthaben an den Betreiber übertragen. Das Plugin enthält keinen Modell-API-Aufruf.
- Standardmäßig werden öffentliche Quellen, Aussagekontext, Analyse und drei Fragen an https://hinterfragen.online zur redaktionellen Prüfung gesendet. Private Chats und Browserdaten gehören nicht zur Einreichung. Einreichen ist abschaltbar; Aufbewahrung auf dem Server: 30 Tage.
- Modi: `draft` liefert nur Text; `approve` braucht konkrete Zustimmung für Text, Video und Konto; `autonomous` benötigt zusätzlich einen ausdrücklichen Startauftrag je begrenztem Lauf. Standard: `approve`, drei Videos, 15 Minuten, Deutsch und sachlich.

Lass die Person diese Optionen wählen/bestätigen und speichere sie mit `tgr_update_settings`, einschließlich `onboardingComplete: true`. Erst dann kann ein Recherchelauf starten. Installation allein autorisiert keine Kommentare. Einrichten startet keinen Lauf.

Schlüssel niemals im Chat erfragen, anzeigen oder auslesen. Eine sicher erhaltene Schlüsseldatei hinterlegt die Person selbst im lokalen Terminal:
`node <installierter-Pluginpfad>/runtime/server.mjs --install-key /absoluter/pfad/pilot-key`
Die Quelldatei muss privat sein (600). Das Ziel ist `~/.config/tokens-gegen-rechts/submission-key`. Ein bestehender Schlüssel wird nicht überschrieben. Kein Schlüssel nötig für lokale Recherche mit deaktivierter Einreichung. Fehlender Schlüssel verhindert nur die Übertragung.

Browsersteuerung wird vom Host bereitgestellt. Prüfe ihre Verfügbarkeit und erkläre gegebenenfalls die Einrichtung des persönlich angemeldeten Browsers; fordere keine Cookies oder Zugangstokens an. Ohne Browser funktioniert die Recherche mit zugänglichen Webquellen und der Entwurfsmodus. Behaupte keine erfolgreiche Videoanalyse ohne zugänglichen Originalkontext.

Bei beschädigten Einstellungen stoppt das Plugin externe Aktionen. Die Person kann nach Beenden aller Plugin-Prozesse lokal `node <installierter-Pluginpfad>/runtime/server.mjs --reset-settings` ausführen. Das setzt Optionen zurück, nicht die Versandhistorie. Einen verwaisten `.lock` erst entfernen, wenn alle Plugin-Prozesse beendet sind.
