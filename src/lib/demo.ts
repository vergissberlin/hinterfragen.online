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
      author: { name: 'Beispiel-Kanal', avatarUrl: '/avatars/demo-channel.svg' },
      target: { type: 'video' },
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
        'Was hat die letzte Wahl verändert?',
        'Welche Entscheidungen meinst du?',
        'Wie sollen Menschen sonst gemeinsam entscheiden?',
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
      author: { name: 'Beispiel-Person', avatarUrl: '/avatars/demo-person.svg' },
      target: {
        type: 'comment',
        commentId: 'demo-comment',
        text: 'Frauen sind für Führungsaufgaben nicht geeignet.',
      },
      topic: 'women',
      summary:
        'Ein erfundener Kommentar spricht Frauen pauschal Führungsqualitäten ab. Die Fragen lenken das Gespräch auf Kriterien und überprüfbare Erfahrungen.',
      evidence: {
        quote: 'Frauen sind für Führungsaufgaben nicht geeignet.',
        startSeconds: 18,
        context:
          'Frei erfundene Aussage zur Demonstration. Keine Zuordnung zu einer realen Person.',
      },
      questions: [
        'Woran erkennst du gute Führung?',
        'Was könnte deine Meinung ändern?',
        'Gilt das für jeden Menschen?',
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
      author: { name: 'Beispiel-Kanal', avatarUrl: '/avatars/demo-channel.svg' },
      target: { type: 'video' },
      topic: 'minorities',
      summary:
        'Ein erfundener Beitrag macht eine ganze Gruppe für gesellschaftliche Probleme verantwortlich. Die Fragen holen das Gespräch zurück zu konkreten Aussagen.',
      evidence: {
        quote: 'Diese ganze Gruppe ist an unseren Problemen schuld.',
        startSeconds: 65,
        context: 'Frei erfundenes Beispiel. Es wird keine reale Gruppe oder Person adressiert.',
      },
      questions: [
        'Welches Problem meinst du genau?',
        'Kannst du das über jeden Menschen dieser Gruppe sagen?',
        'Welche anderen Gründe könnte es geben?',
      ],
      checkedAt: '2026-10-21T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      demo: true,
    },
  ],
};
