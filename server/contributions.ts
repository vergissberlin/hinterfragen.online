import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Verification } from './youtube.ts';
import { contributionSchema } from '../shared/contributions.ts';
import { candidateSchema, analysisSchema } from '../src/lib/contracts.ts';
import { digest, publicationIssues } from './policy.ts';

export const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
export async function issueContributionKey(db: Db, label: string) {
  const id = randomUUID(),
    key = 'tgr_' + randomBytes(32).toString('base64url');
  await db.query('INSERT INTO contribution_keys(id,label,key_hash) VALUES($1,$2,$3)', [
    id,
    z.string().trim().min(1).max(100).parse(label),
    keyHash(key),
  ]);
  return { id, key };
}
export async function registerContributions(
  app: FastifyInstance,
  db: Db,
  verify: (id: string) => Promise<Verification>,
) {
  app.post('/api/contributions', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const bearer = /^Bearer (tgr_[A-Za-z0-9_-]{43})$/.exec(
      String(request.headers.authorization ?? ''),
    );
    if (!bearer)
      return reply.code(401).send({ error: 'Einreichungsschlüssel fehlt oder ist ungültig.' });
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const done = async (code: number, body: unknown, commit = false) => {
        await connection.query(commit ? 'COMMIT' : 'ROLLBACK');
        return reply.code(code).send(body);
      };
      // Lock the key: quota, retries and revocation serialize across API replicas.
      const key = (
        await connection.query(
          'SELECT id,revoked_at FROM contribution_keys WHERE key_hash=$1 FOR UPDATE',
          [keyHash(bearer[1])],
        )
      ).rows[0];
      if (!key || key.revoked_at)
        return await done(401, { error: 'Einreichungsschlüssel fehlt oder ist ungültig.' });
      if (
        (await connection.query("SELECT enabled FROM system_flags WHERE name='attack_mode'"))
          .rows[0]?.enabled
      )
        return await done(503, { error: 'Einreichungen pausiert.' });
      const input = contributionSchema.parse(request.body);
      const previous = (
        await connection.query('SELECT key_id,status,body_digest FROM contributions WHERE id=$1', [
          input.submissionId,
        ])
      ).rows[0];
      if (previous) {
        if (previous.key_id !== key.id || previous.body_digest !== digest(input))
          return await done(409, { error: 'Einreichungs-ID bereits anders verwendet.' });
        return await done(200, {
          submissionId: input.submissionId,
          status: previous.status,
          duplicate: true,
        });
      }
      const used = (
        await connection.query(
          'SELECT count FROM contribution_daily_quota WHERE key_id=$1 AND day=$2',
          [key.id, new Date().toISOString().slice(0, 10)],
        )
      ).rows[0];
      if (Number(used?.count ?? 0) >= 30)
        return await done(429, { error: 'Tageslimit von 30 Einreichungen erreicht (UTC).' });
      const quota = await connection.query(
        `INSERT INTO contribution_daily_quota(key_id,day,count) VALUES($1,$2,1)
        ON CONFLICT(key_id,day) DO UPDATE SET count=contribution_daily_quota.count+1 WHERE contribution_daily_quota.count<30 RETURNING count`,
        [key.id, new Date().toISOString().slice(0, 10)],
      );
      if (!quota.rows.length)
        return await done(429, { error: 'Tageslimit von 30 Einreichungen erreicht (UTC).' });
      await connection.query(
        'INSERT INTO contributions(id,key_id,video_id,body,body_digest) VALUES($1,$2,$3,$4,$5)',
        [input.submissionId, key.id, input.videoId, input, digest(input)],
      );
      return await done(
        202,
        { submissionId: input.submissionId, status: 'review', duplicate: false },
        true,
      );
    } catch (error) {
      await connection.query('ROLLBACK');
      // Two different pilot keys may concurrently choose the same submission UUID.
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        return reply.code(409).send({ error: 'Einreichungs-ID bereits verwendet.' });
      throw error;
    } finally {
      connection.release();
    }
  });
  // Existing /internal/ hook authorizes these routes for admins only.
  app.get('/internal/contributions', async () => ({
    contributions: (
      await db.query(
        'SELECT id,video_id,status,body,review_note,created_at FROM contributions ORDER BY created_at DESC LIMIT 100',
      )
    ).rows,
  }));
  app.post('/internal/contributions/reject', async (request, reply) => {
    const { id, note } = z
      .object({ id: z.uuid(), note: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(request.body);
    const result = await db.query(
      "UPDATE contributions SET status='rejected',review_note=$1 WHERE id=$2 AND status='review' RETURNING id",
      [note, id],
    );
    return reply.code(result.rows.length ? 200 : 409).send({ rejected: !!result.rows.length });
  });
  app.post('/internal/contributions/adopt', async (request, reply) => {
    const input = z
      .object({
        id: z.uuid(),
        contextVerified: z.literal(true),
        candidate: candidateSchema,
        analysis: analysisSchema,
      })
      .strict()
      .parse(request.body);
    const row = (
      await db.query("SELECT body FROM contributions WHERE id=$1 AND status='review'", [input.id])
    ).rows[0];
    if (!row) return reply.code(409).send({ error: 'Einreichung nicht mehr in Prüfung.' });
    const original = contributionSchema.parse(row.body);
    if (
      !original.contextComplete ||
      !original.analysis.contextComplete ||
      original.analysis.satireOrCounterSpeech ||
      input.candidate.videoId !== original.videoId ||
      input.candidate.target?.type === 'comment' ||
      input.candidate.contextSource !== 'editorial' ||
      input.candidate.evidence.quote !== original.evidence.quote ||
      publicationIssues(input.candidate, input.analysis).length
    )
      return reply.code(400).send({
        error: 'Vollständiger, redaktionell geprüfter Kontext und passende Belege erforderlich.',
      });
    const check = await verify(original.videoId);
    if (!check.available || !check.video)
      return reply.code(409).send({ error: 'Video oder Kommentare nicht verfügbar.' });
    const candidate = {
      ...input.candidate,
      title: check.video.title,
      channel: check.video.channel,
      channelId: check.video.channelId,
      target: { type: 'video' as const },
    };
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const current = (
        await connection.query('SELECT status FROM contributions WHERE id=$1 FOR UPDATE', [
          input.id,
        ])
      ).rows[0];
      const paused = (
        await connection.query("SELECT enabled FROM system_flags WHERE name='attack_mode'")
      ).rows[0]?.enabled;
      if (current?.status !== 'review' || paused) {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'Prüfstatus geändert oder Übernahme pausiert.' });
      }
      const existing = await connection.query('SELECT id FROM candidates WHERE source_key=$1', [
        'video:' + candidate.videoId,
      ]);
      if (existing.rows.length) {
        await connection.query('ROLLBACK');
        return reply
          .code(409)
          .send({ error: 'Beitrag existiert bereits. Bestehender Inhalt bleibt erhalten.' });
      }
      const id = randomUUID();
      const saved = await connection.query(
        `INSERT INTO candidates(id,video_id,title,channel,channel_id,status,body,body_digest,analysis,checked_at,source_key)
        VALUES($1,$2,$3,$4,$5,'review',$6,$7,$8,$9,$10) ON CONFLICT(source_key) DO NOTHING RETURNING id`,
        [
          id,
          candidate.videoId,
          candidate.title,
          candidate.channel,
          candidate.channelId,
          candidate,
          digest(candidate),
          input.analysis,
          check.checkedAt,
          'video:' + candidate.videoId,
        ],
      );
      if (!saved.rows.length) {
        await connection.query('ROLLBACK');
        return reply
          .code(409)
          .send({ error: 'Beitrag existiert bereits. Bestehender Inhalt bleibt erhalten.' });
      }
      await connection.query(
        "UPDATE contributions SET status='adopted',candidate_id=$1,review_note='Redaktionell geprüft und als Entwurf übernommen' WHERE id=$2",
        [id, input.id],
      );
      await connection.query('COMMIT');
      return { adopted: true, candidateId: id, published: false };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  });
}
