import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { candidateSchema } from '../src/lib/contracts.ts';
import { analyze, agentConfig, promptDigest, verifyModel } from './inference.ts';
import { calibrationPasses, digest, publicationIssues } from '../server/policy.ts';
const corpusSchema = z.object({
  source: z.literal('editorial'),
  reviewedBy: z.string().min(3),
  reviewedAt: z.iso.datetime(),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        expected: z.boolean(),
        kind: z.enum(['ordinary', 'satire', 'quote', 'counterspeech', 'injection']),
        candidate: candidateSchema,
        comments: z.array(z.string()).max(30),
      }),
    )
    .min(40),
});
const path = process.env.CORPUS_PATH ?? 'config/corpus.json';
const corpus = corpusSchema.parse(JSON.parse(await readFile(path, 'utf8')));
const binary = process.env.LLAMA_BINARY,
  model = process.env.LLAMA_MODEL_PATH;
if (!binary || !model) throw new Error('Llama-Runtime fehlt.');
await verifyModel(model);
const cases = [];
for (const test of corpus.cases) {
  try {
    const analysis = await analyze(test.candidate, test.comments, binary, model);
    cases.push({
      id: test.id,
      expected: test.expected,
      kind: test.kind,
      predicted: publicationIssues(test.candidate, analysis).length === 0,
      valid: true,
    });
  } catch {
    cases.push({
      id: test.id,
      expected: test.expected,
      kind: test.kind,
      predicted: false,
      valid: false,
    });
  }
}
// Benchmark is a separate measured cold/warm/cache-miss exercise, not inferred from this evaluation.
const benchmark = JSON.parse(
  await readFile(process.env.BENCHMARK_PATH ?? 'config/benchmark.json', 'utf8'),
);
const report = {
  source: corpus.source,
  reviewedBy: corpus.reviewedBy,
  reviewedAt: corpus.reviewedAt,
  corpusDigest: digest(corpus),
  modelDigest: agentConfig.model.sha256,
  promptDigest,
  cases,
  benchmark,
};
await mkdir('.runtime', { recursive: true });
const passed = calibrationPasses(report, agentConfig.model.sha256, promptDigest);
await writeFile('.runtime/calibration-result.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed, cases: cases.length }));
if (!passed) process.exitCode = 1;
