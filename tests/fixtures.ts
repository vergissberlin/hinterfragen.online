import type { Analysis, Candidate } from '../src/lib/contracts.ts';
export const candidate: Candidate = {
  videoId: 'abcdefghijk',
  title: 'Erfundenes Testvideo',
  channel: 'Fiktiver Testkanal',
  channelId: 'UC' + 'x'.repeat(22),
  transcript:
    'Redaktionell erfasster Testkontext. Wahlen sind grundsätzlich nutzlos. Danach folgt eine Erläuterung.',
  contextSource: 'editorial',
  sourceReference: 'Erfundenes Testmaterial, keine reale Quelle',
  language: 'de',
  evidence: {
    quote: 'Wahlen sind grundsätzlich nutzlos.',
    startSeconds: 42,
    context: 'Fiktiver Testkontext vor und nach der Aussage.',
  },
};
export const analysis: Analysis = {
  suitable: true,
  publicActor: true,
  publicActorReason: 'Nur für den Test als öffentlicher Akteur markiert.',
  topic: 'democracy',
  summary: 'Fiktive Aussage im Testkontext.',
  reasoning: 'Ausschließlich synthetischer Testfall.',
  contextComplete: true,
  satireOrCounterSpeech: false,
  evidenceQuote: candidate.evidence.quote,
  questions: [
    'Welche konkreten Entscheidungen meinst du?',
    'Welche Belege würden deine Einschätzung ändern?',
    'Woran würdest du eine Veränderung erkennen?',
  ],
};
export const model = 'a'.repeat(64),
  prompt = 'b'.repeat(64);
export function testCalibration() {
  return {
    source: 'editorial',
    reviewedBy: 'UNIT TEST ONLY',
    reviewedAt: new Date().toISOString(),
    corpusDigest: 'c'.repeat(64),
    modelDigest: model,
    promptDigest: prompt,
    cases: Array.from({ length: 40 }, (_, i) => ({
      id: `test-${i}`,
      expected: i < 20,
      predicted: i < 20,
      valid: true,
      kind: i < 20 ? 'ordinary' : ['satire', 'quote', 'counterspeech', 'injection'][i % 4],
    })),
    benchmark: { candidates: 5, coldMs: 1000, warmMs: 500, cacheMissPassed: true },
  };
}
