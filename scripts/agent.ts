import { randomUUID } from 'node:crypto';
import { candidateSchema } from '../src/lib/contracts.ts';
import { discover, commentSample } from '../server/youtube.ts';
import { agentConfig, analyze, promptDigest, verifyModel } from './inference.ts';
const base = process.env.AGENT_API_ORIGIN;
const token = process.env.AGENT_TOKEN;
const apiKey = process.env.YOUTUBE_API_KEY;
const model = process.env.LLAMA_MODEL_PATH;
const binary = process.env.LLAMA_BINARY;
if (!base?.startsWith('https://') || !token || !apiKey || !model || !binary)
  throw new Error('Agentenkonfiguration unvollständig.');
if (process.env.MODEL_LICENSE_ACCEPTED !== 'true')
  throw new Error('Modelllizenz muss vor Nutzung geprüft und akzeptiert werden.');
await verifyModel(model);
async function api(path: string, body?: unknown) {
  const response = await fetch(new URL(`/internal/${path}`, base), {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(process.env.CF_ACCESS_CLIENT_ID
        ? {
            'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
            'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET ?? '',
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Agenten-API antwortet mit Status ${response.status}.`);
  return response.json();
}
const found = await discover(apiKey, agentConfig.searchTerms, agentConfig.maxCandidates);
const discovery = await api('discover', { videos: found });
const batch = await api('agent-batch');
let processed = 0,
  failed = 0,
  published = 0;
for (const raw of (batch.candidates ?? []).slice(0, agentConfig.maxCandidates)) {
  const started = Date.now();
  try {
    const candidate = candidateSchema.parse(raw);
    const comments = await commentSample(candidate.videoId, apiKey);
    const analysis = await analyze(candidate, comments, binary, model);
    const result = await api('import', {
      runId: randomUUID(),
      candidate,
      analysis,
      modelDigest: agentConfig.model.sha256,
      promptDigest,
      durationMs: Date.now() - started,
    });
    processed++;
    if (result.published) published++;
  } catch {
    failed++; /* Do not leak raw content, URLs or credentials into public Action logs. */
  }
}
console.log(
  JSON.stringify({
    discovered: found.length,
    inserted: discovery.inserted,
    processed,
    failed,
    published,
  }),
);
if (failed) process.exitCode = 1;
