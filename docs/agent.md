# Agent und Kalibrierung

## Zeitgesteuerter Betrieb

Workflow `.github/workflows/agent.yml` läuft alle sechs Stunden oder manuell, nur auf dem vertrauenswürdigen Default-Branch mit gesetzten Variablen. Es gibt keinen `pull_request_target`-Trigger, keine Ausgabe von Quelldaten und keine öffentlichen Ergebnisartefakte. Ein Lauf hat maximal 30 Minuten; parallele Läufe werden vermieden.

GitHub Actions Variablen:

- `ENABLE_AGENT=true`
- `MODEL_LICENSE_ACCEPTED=true` erst nach Lizenzprüfung
- `AGENT_API_ORIGIN=https://agent.example.org` (eigener Cloudflare-Access-geschützter Host)

GitHub Actions Secrets:

- `AGENT_TOKEN`, identisch zur Agentenrolle des Backends, verschieden vom Admin-Token
- `YOUTUBE_API_KEY`, auf die YouTube Data API beschränkt
- `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` für einen Cloudflare-Access-Service-Token

Keine Portaldatenbank aus GitHub erreichbar machen. Der Agent recherchiert frei anhand der Suchbegriffe in `config/agent.json`. Metadaten allein erzeugen keine veröffentlichbaren Kandidaten. Fehlender Transkriptzugriff wird durch die interne Redaktion und einen belegten Kontext ergänzt. Eine offizielle Caption-Integration mit Video-Bearbeitungsrechten ist noch nicht enthalten.

## Modell und Cache

Startmodell: Llama 3.2 3B Instruct, Q4_K_M, circa 2 GB. Die GGUF-Datei wird aus einer festgeschriebenen Hugging-Face-Revision geladen; SHA-256 wird auch nach jedem Cache-Restore geprüft. Die Quantisierung stammt von bartowski, nicht von Meta selbst. Lizenz und Herkunft vor Aktivierung prüfen.

- Runtime-Cache: Betriebssystem, Architektur, vollständiger llama.cpp-Commit.
- Modell-Cache: vollständiger Modell-SHA-256.
- Keine zu breiten Restore-Keys; kein Cache von Transkripten, Kommentaren, Zugangsdaten oder Prompts mit Quelldaten.
- Cache-Miss baut die Runtime oder lädt das Modell erneut. GitHub darf Caches entfernen; sie sind keine dauerhafte Datenhaltung.
- Inferenz über CPU, strukturierte JSON-Ausgabe, feste Kontext-/Ausgabelimits und Zeitlimits. Lange Transkripte werden abschnittsweise zusammengefasst; wörtlicher Beleg und Umgebung bleiben erhalten. Bei Übergröße oder Fehlern keine Veröffentlichung.

Modelländerungen erfordern neue Prüfsumme, Lizenzprüfung, Benchmark und Kalibrierung. Prompt-, Parser- und Inferenzänderungen erfordern neue Kalibrierung und Aktualisierung von `PROMPT_SHA256`. Den gebundenen Digest mit `npx tsx scripts/prompt-digest.ts` ermitteln; er umfasst Prompt, Inferenzadapter, Datenvertrag und Runtime-Commit. Laufzeit und Ausgabequalität auf einem echten GitHub-Runner sind vor Aktivierung zu messen.

## Redaktioneller Abnahmekorpus

`config/corpus.json` ist ignoriert und muss aus mindestens 40 tatsächlich redaktionell bewerteten deutschen Fällen bestehen. Keine synthetischen Unit-Test-Fixtures als redaktionelle Abnahme ausgeben. Mindestens zehn geeignete und zehn ungeeignete Fälle sowie negative Fälle für Satire, Zitate, Gegenrede und Prompt-Injection.

Format:

```json
{
  "source": "editorial",
  "reviewedBy": "Verantwortliche Redaktion",
  "reviewedAt": "ISO-8601-Zeitpunkt",
  "cases": [
    {
      "id": "eindeutige-fall-id",
      "expected": false,
      "kind": "satire",
      "candidate": "Vollständiges Objekt gemäß candidateSchema, kein String",
      "comments": []
    }
  ]
}
```

Dieses Schema-Beispiel ist bewusst kein lauffähiger Abnahmekorpus. Quellen und Kontext müssen real eingetragen werden. `kind`: `ordinary`, `satire`, `quote`, `counterspeech`, `injection`.

Nach Installation der festgeschriebenen Runtime und bestätigter Modelllizenz:

```sh
npx tsx scripts/ensure-model.ts
export LLAMA_BINARY=/absoluter/pfad/zu/llama-cli
export LLAMA_MODEL_PATH="$PWD/.runtime/models/model.gguf"
export MODEL_LICENSE_ACCEPTED=true
export CORPUS_PATH="$PWD/config/corpus.json"
npm run benchmark
BENCHMARK_PATH=.runtime/benchmark.json npm run calibrate
```

Der Benchmark lädt in einen leeren temporären Cache und misst anschließend fünf Analysen kalt und warm; den Download des circa 2-GB-Modells einkalkulieren. Der Bericht entsteht unter `.runtime/benchmark.json`. Die Kalibrierung schreibt `.runtime/calibration-result.json`, ausschließlich ohne Rohtexte. Redaktionell prüfen und bei Erfolg als `config/calibration.json` bereitstellen; dieses Verzeichnis wird nur lesbar in die Container gemountet.

Freigabekriterien: kein falsch positiver Veröffentlichungsvorschlag, mindestens 70 % Treffer bei geeigneten Fällen, mindestens 95 % strukturell gültige Ausgaben, vollständige Kategorien und kalter/warmer Benchmark jeweils unter 30 Minuten. Abnahme höchstens 90 Tage alt; Modell- und Prompt-Hashes müssen passen. Das ist ein begrenzter Abnahmesatz, keine Garantie für fehlerfreie KI.

Erst danach `AUTO_PUBLISH=true` und die Veröffentlichungssperre in der Redaktion aufheben. Manuelle Veröffentlichungen benötigen keine Modellkalibrierung, bleiben aber an Inhaltsbelege und aktuelle Kommentarprüfung gebunden.

Referenzen: [Caption-Zugriff](https://developers.google.com/youtube/data/reference/rest/v3/captions/download), [Kommentare](https://developers.google.com/youtube/data/reference/rest/v3/commentThreads/list), [API-Bedingungen](https://developers.google.com/youtube/terms/developer-policies), [Modellkarte](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct), [GitHub Cache](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows).
