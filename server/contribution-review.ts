import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { analysisSchema, candidateSchema } from '../src/lib/contracts.ts';
import { contributionSchema, publicSourceSchema } from '../shared/contributions.ts';
import { digest, loadCalibration, publicationIssues } from './policy.ts';
import type { Verification } from './youtube.ts';
import { exportCatalog } from './catalog.ts';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewResultSchema = z
  .object({
    id: z.uuid(),
    bodyDigest: hash,
    modelDigest: hash,
    promptDigest: hash,
    outcome: z.enum(['approved', 'deferred']),
    reason: z.enum(['source_unavailable', 'context_unverified', 'unsuitable', 'verified']),
    candidate: candidateSchema.optional(),
    analysis: analysisSchema.optional(),
    source: z.object({ url: publicSourceSchema, textDigest: hash }).strict().optional(),
  })
  .strict();
export async function registerContributionReview(
  app: FastifyInstance,
  db: Db,
  config: Config,
  verify: (id: string) => Promise<Verification>,
) {
  app.get('/internal/contributions/review-batch', async () => {
    if (
      config.CONTRIBUTION_REVIEW_ENABLED !== 'true' ||
      (await db.query("SELECT enabled FROM system_flags WHERE name='attack_mode'")).rows[0]?.enabled
    )
      return { contributions: [] };
    return {
      contributions: (
        await db.query(
          "SELECT id,body,body_digest FROM contributions WHERE status='review' AND (ai_checked_at IS NULL OR ai_checked_at < now() - interval '1 day') ORDER BY created_at LIMIT 5",
        )
      ).rows,
    };
  });
  app.post('/internal/contributions/review-result', async (request, reply) => {
    const input = reviewResultSchema.parse(request.body);
    const row = (
      await db.query('SELECT body,body_digest,status FROM contributions WHERE id=$1', [input.id])
    ).rows[0];
    if (!row || row.body_digest !== input.bodyDigest || row.status !== 'review')
      return reply.code(409).send({ error: 'Einreichung geändert oder bereits bearbeitet.' });
    const defer = async (reason: string) => {
      await db.query(
        "UPDATE contributions SET ai_checked_at=now(),ai_reason=$1 WHERE id=$2 AND body_digest=$3 AND status='review'",
        [reason, input.id, input.bodyDigest],
      );
      return { approved: false, reason };
    };
    if (input.outcome === 'deferred') return defer(input.reason);
    const original = contributionSchema.parse(row.body);
    const { candidate, analysis, source } = input;
    const sourceAllowed =
      !!source &&
      config.REVIEW_SOURCE_ORIGINS.split(',')
        .map((s) => s.trim())
        .includes(new URL(source.url).origin);
    if (
      !candidate ||
      !analysis ||
      !source ||
      !sourceAllowed ||
      input.reason !== 'verified' ||
      candidate.videoId !== original.videoId ||
      candidate.target?.type === 'comment' ||
      candidate.contextSource !== 'verified_public_source' ||
      candidate.sourceReference !== source.url ||
      candidate.evidence.quote !== original.evidence.quote ||
      candidate.evidence.startSeconds !== original.evidence.startSeconds ||
      digest(candidate.transcript) !== source.textDigest ||
      publicationIssues(candidate, analysis).length
    )
      return reply
        .code(400)
        .send({ error: 'Unabhängiger Quellenbeleg und passende Analyse erforderlich.' });
    if (
      config.CONTRIBUTION_REVIEW_ENABLED !== 'true' ||
      input.modelDigest !== config.MODEL_SHA256 ||
      input.promptDigest !== config.CONTRIBUTION_REVIEW_PROMPT_SHA256 ||
      !(await loadCalibration(
        config.CONTRIBUTION_REVIEW_CALIBRATION_PATH,
        input.modelDigest,
        input.promptDigest,
      ))
    )
      return defer('calibration_required');
    const check = await verify(original.videoId);
    if (!check.available || !check.video) return defer('source_unavailable');
    const verifiedCandidate = {
      ...candidate,
      title: check.video.title,
      channel: check.video.channel,
      channelId: check.video.channelId,
      target: { type: 'video' as const },
    };
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const current = (
        await connection.query(
          'SELECT status,body_digest FROM contributions WHERE id=$1 FOR UPDATE',
          [input.id],
        )
      ).rows[0];
      const flags = (
        await connection.query(
          "SELECT name FROM system_flags WHERE enabled=true AND name IN ('attack_mode','publication_paused')",
        )
      ).rows;
      if (
        current?.status !== 'review' ||
        current.body_digest !== input.bodyDigest ||
        flags.length
      ) {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'Freigabe pausiert oder Einreichung geändert.' });
      }
      const existing = await connection.query('SELECT id FROM candidates WHERE source_key=$1', [
        'video:' + candidate.videoId,
      ]);
      if (existing.rows.length) {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'Bestehender Beitrag wird nicht überschrieben.' });
      }
      const id = randomUUID();
      const inserted = await connection.query(
        `INSERT INTO candidates(id,video_id,title,channel,channel_id,status,body,body_digest,analysis,checked_at,source_key)
        VALUES($1,$2,$3,$4,$5,'published',$6,$7,$8,$9,$10) ON CONFLICT(source_key) DO NOTHING RETURNING id`,
        [
          id,
          verifiedCandidate.videoId,
          verifiedCandidate.title,
          verifiedCandidate.channel,
          verifiedCandidate.channelId,
          verifiedCandidate,
          digest(verifiedCandidate),
          analysis,
          check.checkedAt,
          'video:' + candidate.videoId,
        ],
      );
      if (!inserted.rows.length) {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'Beitrag zwischenzeitlich angelegt.' });
      }
      await connection.query(
        "UPDATE contributions SET status='adopted',candidate_id=$1,review_note='Unabhängige KI-Prüfung bestätigt',ai_checked_at=now(),ai_reason='verified',review_provenance=$2 WHERE id=$3",
        [
          id,
          {
            kind: 'ai',
            modelDigest: input.modelDigest,
            promptDigest: input.promptDigest,
            source,
            submissionDigest: input.bodyDigest,
            reviewedAt: new Date().toISOString(),
          },
          input.id,
        ],
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    await exportCatalog(db, config);
    return { approved: true };
  });
}
