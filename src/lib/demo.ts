import type { Catalog } from './contracts.ts';
// Invented examples, never claimed to be real YouTube findings. No outbound targets.
export const demoCatalog: Catalog = {
  version: 1,
  generatedAt: '2026-10-21T00:00:00.000Z',
  demo: true,
  posts: [
    {
      id: 'demo-democracy',
      videoId: '',
      title: 'Wenn eine einfache Antwort zu einfach ist.',
      channel: 'Erfundenes Beispiel',
      topic: 'democracy',
      summary:
        'Ein fiktiver Beitrag behauptet, demokratische Abstimmungen seien grundsätzlich nutzlos. Eine gute Frage macht sichtbar, was diese Behauptung auslässt.',
      evidence: {
        quote: 'Wahlen ändern doch sowieso nichts.',
        startSeconds: 42,
        context:
          'Dieses Beispiel ist frei erfunden. Es zeigt, wie sich eine pauschale Behauptung hinterfragen lässt.',
      },
      questions: [
        'Woran würdest du erkennen, dass eine Wahl etwas verändert hat?',
        'Welche konkreten Entscheidungen meinst du damit?',
        'Wie könnten Menschen deiner Ansicht nach sonst über gemeinsame Regeln entscheiden?',
      ],
      checkedAt: '2026-10-21T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      demo: true,
    },
    {
      id: 'demo-women',
      videoId: '',
      title: 'Eine Behauptung. Viele offene Fragen.',
      channel: 'Erfundenes Beispiel',
      topic: 'women',
      summary:
        'Ein erfundener Beitrag spricht Frauen pauschal Führungsqualitäten ab. Die Fragen lenken das Gespräch auf Kriterien und überprüfbare Erfahrungen.',
      evidence: {
        quote: 'Frauen sind für Führungsaufgaben nicht geeignet.',
        startSeconds: 18,
        context:
          'Frei erfundene Aussage zur Demonstration. Keine Zuordnung zu einer realen Person.',
      },
      questions: [
        'An welchen konkreten Fähigkeiten würdest du gute Führung festmachen?',
        'Welche Belege würden deine Einschätzung verändern?',
        'Würdest du dieselben Maßstäbe bei jedem Menschen anlegen?',
      ],
      checkedAt: '2026-10-21T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      demo: true,
    },
    {
      id: 'demo-minorities',
      videoId: '',
      title: 'Nachfragen, wo Menschen pauschal werden.',
      channel: 'Erfundenes Beispiel',
      topic: 'minorities',
      summary:
        'Ein erfundener Beitrag macht eine ganze Gruppe für gesellschaftliche Probleme verantwortlich. Die Fragen holen das Gespräch zurück zu konkreten Aussagen.',
      evidence: {
        quote: 'Diese ganze Gruppe ist an unseren Problemen schuld.',
        startSeconds: 65,
        context: 'Frei erfundenes Beispiel. Es wird keine reale Gruppe oder Person adressiert.',
      },
      questions: [
        'Welches konkrete Problem meinst du und wie entsteht es?',
        'Wie unterscheidest du zwischen einzelnen Handlungen und einer ganzen Gruppe?',
        'Welche anderen Ursachen hast du dabei berücksichtigt?',
      ],
      checkedAt: '2026-10-21T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      demo: true,
    },
  ],
};
