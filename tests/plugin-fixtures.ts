import { randomUUID } from 'node:crypto';
import { candidate, analysis } from './fixtures.ts';
import type { Contribution } from '../shared/contributions.ts';
export function research(overrides: Partial<Contribution> = {}): Contribution {
  return {
    version: 1,
    submissionId: randomUUID(),
    videoId: candidate.videoId,
    title: candidate.title,
    sources: [
      {
        url: 'https://www.youtube.com/watch?v=' + candidate.videoId,
        title: 'Synthetisches Testvideo',
      },
    ],
    evidence: candidate.evidence,
    contextText: candidate.transcript,
    contextComplete: true,
    analysis: structuredClone(analysis),
    pluginVersion: '0.1.0',
    ...overrides,
  };
}
