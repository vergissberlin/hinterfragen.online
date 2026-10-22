import { contributionSchema } from '../shared/contributions.ts';
import { digest, publicationIssues } from '../server/policy.ts';
import { checkVideo } from '../server/youtube.ts';
import { candidateSchema } from '../src/lib/contracts.ts';
import { analyze, agentConfig, verifyModel } from './inference.ts';
import { reviewDigest } from './review-digest.ts';
import { independentTranscript } from './review-source.ts';
const origin = process.env.AGENT_API_ORIGIN,
  token = process.env.AGENT_TOKEN,
  binary = process.env.LLAMA_BINARY,
  model = process.env.LLAMA_MODEL_PATH;
if (
  !origin?.startsWith('https://') ||
  new URL(origin).origin !== origin ||
  !token ||
  !binary ||
  !model ||
  process.env.MODEL_LICENSE_ACCEPTED !== 'true'
)
  throw new Error('Prüfkonfiguration unvollständig.');
const allowed = (process.env.REVIEW_SOURCE_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
await verifyModel(model);
async function api(path: string, body?: unknown) {
  const response = await fetch(new URL('/internal/contributions/' + path, origin), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
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
  if (!response.ok) throw new Error('Prüf-API nicht verfügbar.');
  return response.json();
}
const batch = await api('review-batch');
let checked = 0,
  approved = 0,
  deferred = 0,
  failed = 0;
for (const row of (batch.contributions ?? []).slice(0, 5)) {
  try {
    const input = contributionSchema.parse(row.body);
    const base = {
      id: row.id,
      bodyDigest: row.body_digest,
      modelDigest: agentConfig.model.sha256,
      promptDigest: reviewDigest,
    };
    const source = await independentTranscript(input, allowed);
    if (!source) {
      await api('review-result', { ...base, outcome: 'deferred', reason: 'context_unverified' });
      deferred++;
      continue;
    }
    const video = await checkVideo(input.videoId, process.env.YOUTUBE_API_KEY ?? '');
    if (!video.available || !video.video) {
      await api('review-result', { ...base, outcome: 'deferred', reason: 'source_unavailable' });
      deferred++;
      continue;
    }
    const candidate = candidateSchema.parse({
      ...video.video,
      transcript: source.transcript,
      contextSource: 'verified_public_source',
      sourceReference: source.url,
      language: 'de',
      evidence: input.evidence,
    });
    const analysis = await analyze(candidate, [], binary, model);
    checked++;
    if (publicationIssues(candidate, analysis).length) {
      await api('review-result', { ...base, outcome: 'deferred', reason: 'unsuitable' });
      deferred++;
      continue;
    }
    const result = await api('review-result', {
      ...base,
      outcome: 'approved',
      reason: 'verified',
      candidate,
      analysis,
      source: { url: source.url, textDigest: digest(source.transcript) },
    });
    if (result.approved) approved++;
    else deferred++;
  } catch {
    failed++;
  }
}
console.log(JSON.stringify({ checked, approved, deferred, failed }));
if (failed) process.exitCode = 1;
