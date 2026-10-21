import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Analysis, Candidate } from '../src/lib/contracts.ts';
export const digest = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function publicationIssues(candidate: Candidate, analysis: Analysis): string[] {
  const issues: string[] = [];
  if (!analysis.suitable) issues.push('Nicht geeignet');
  if (!analysis.publicActor) issues.push('Öffentlicher Akteur nicht belegt');
  if (!analysis.contextComplete || analysis.satireOrCounterSpeech)
    issues.push('Kontext unklar oder Gegenrede/Satire');
  if (
    analysis.evidenceQuote !== candidate.evidence.quote ||
    !(
      candidate.target?.type === 'comment' ? (candidate.target.text ?? '') : candidate.transcript
    ).includes(candidate.evidence.quote)
  )
    issues.push('Aussage nicht wörtlich im belegten Kontext');
  if (new Set(analysis.questions.map((q) => q.toLocaleLowerCase('de'))).size !== 3)
    issues.push('Fragen sind nicht verschieden');
  // Additional rejection signal, never treated as a full semantic safety validator.
  if (
    analysis.questions.some((q) => /\b(idiot|arschloch|drecks\w*|umbringen|verrecken)\b/i.test(q))
  )
    issues.push('Unzulässige Formulierung');
  return issues;
}
const caseSchema = z.object({
  id: z.string().min(1),
  expected: z.boolean(),
  predicted: z.boolean(),
  valid: z.boolean(),
  kind: z.enum(['ordinary', 'satire', 'quote', 'counterspeech', 'injection']),
});
export const calibrationSchema = z.object({
  source: z.literal('editorial'),
  reviewedBy: z.string().min(3),
  reviewedAt: z.iso.datetime(),
  corpusDigest: z.string().regex(/^[a-f0-9]{64}$/),
  modelDigest: z.string().regex(/^[a-f0-9]{64}$/),
  promptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(caseSchema).min(40),
  benchmark: z.object({
    candidates: z.literal(5),
    coldMs: z.number().positive(),
    warmMs: z.number().positive(),
    cacheMissPassed: z.literal(true),
  }),
});
export function calibrationPasses(raw: unknown, model: string, prompt: string, now = Date.now()) {
  const result = calibrationSchema.safeParse(raw);
  if (!result.success) return false;
  const r = result.data;
  if (
    r.modelDigest !== model ||
    r.promptDigest !== prompt ||
    Date.parse(r.reviewedAt) > now ||
    now - Date.parse(r.reviewedAt) > 90 * 86400000
  )
    return false;
  if (
    new Set(r.cases.map((c) => c.id)).size !== r.cases.length ||
    r.benchmark.coldMs > 1800000 ||
    r.benchmark.warmMs > 1800000
  )
    return false;
  const positive = r.cases.filter((c) => c.expected),
    negative = r.cases.filter((c) => !c.expected);
  if (
    positive.length < 10 ||
    negative.length < 10 ||
    negative.some((c) => c.predicted) ||
    r.cases.filter((c) => c.valid).length / r.cases.length < 0.95
  )
    return false;
  if (
    !['satire', 'quote', 'counterspeech', 'injection'].every((k) =>
      negative.some((c) => c.kind === k),
    )
  )
    return false;
  return positive.filter((c) => c.predicted && c.valid).length / positive.length >= 0.7;
}
export async function loadCalibration(path: string, model: string, prompt: string) {
  try {
    return calibrationPasses(JSON.parse(await readFile(path, 'utf8')), model, prompt);
  } catch {
    return false;
  }
}
