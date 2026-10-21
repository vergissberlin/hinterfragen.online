import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { candidateSchema } from '../src/lib/contracts.ts';
import { analyze } from './inference.ts';
import { ensureModel } from './model-cache.ts';
const corpus = z
  .object({
    source: z.literal('editorial'),
    cases: z
      .array(z.object({ candidate: candidateSchema, comments: z.array(z.string()).max(30) }))
      .min(5),
  })
  .parse(JSON.parse(await readFile(process.env.CORPUS_PATH ?? 'config/corpus.json', 'utf8')));
if (!process.env.LLAMA_BINARY || process.env.MODEL_LICENSE_ACCEPTED !== 'true')
  throw new Error('Runtime und bestätigte Lizenz erforderlich.');
const directory = await mkdtemp(resolve(tmpdir(), 'hf-model-benchmark-'));
try {
  const coldStart = Date.now(),
    cold = await ensureModel(directory);
  for (const c of corpus.cases.slice(0, 5))
    await analyze(c.candidate, c.comments, process.env.LLAMA_BINARY, cold.path);
  const coldMs = Date.now() - coldStart;
  const warmStart = Date.now(),
    warm = await ensureModel(directory);
  for (const c of corpus.cases.slice(0, 5))
    await analyze(c.candidate, c.comments, process.env.LLAMA_BINARY, warm.path);
  const report = {
    candidates: 5,
    coldMs,
    warmMs: Date.now() - warmStart,
    cacheMissPassed: cold.downloaded && !warm.downloaded,
  };
  await writeFile(
    process.env.BENCHMARK_PATH ?? '.runtime/benchmark.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (report.coldMs > 1800000 || report.warmMs > 1800000 || !report.cacheMissPassed)
    process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
