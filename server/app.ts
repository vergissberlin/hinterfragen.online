import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import {
  candidateSchema,
  sourceKey,
  type PostTarget,
  analysisSchema,
  eventSchema,
  importSchema,
} from '../src/lib/contracts.ts';
import { digest, loadCalibration, publicationIssues } from './policy.ts';
import { checkSource, type Verification } from './youtube.ts';
import { exportCatalog } from './catalog.ts';
import { registerContributions } from './contributions.ts';
const discoverySchema = z
  .object({
    videos: z
      .array(
        z
          .object({
            videoId: z.string().regex(/^[\w-]{11}$/),
            title: z.string().min(1).max(200),
            channel: z.string().min(1).max(150),
            channelId: z.string().regex(/^UC[\w-]{22}$/),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export async function buildApp(
  db: Db,
  config: Config,
  verifyVideo: (id: string, target?: PostTarget) => Promise<Verification> = (id, target) =>
    checkSource(id, target, config.YOUTUBE_API_KEY),
) {
  const app = Fastify({ bodyLimit: 512000, logger: false, trustProxy: false });
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) =>
      config.NODE_ENV === 'production' && request.headers['x-client-ip']
        ? String(request.headers['x-client-ip'])
        : request.ip,
  });
  const dedupe = new Map<string, number>();
  let salt = randomBytes(32),
    saltExpiry = Date.now() + 86400000;
  let lastDedupePrune = 0;
  const authorized = (request: FastifyRequest, scope: 'admin' | 'agent') => {
    const actual = Buffer.from(String(request.headers.authorization ?? ''));
    const expected = Buffer.from(
      `Bearer ${scope === 'admin' ? config.ADMIN_TOKEN : config.AGENT_TOKEN}`,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const flag = async (name: string) =>
    (await db.query('SELECT enabled FROM system_flags WHERE name=$1', [name])).rows[0]?.enabled ===
    true;
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    reply.header('X-Content-Type-Options', 'nosniff');
    if (path.startsWith('/internal/') && path !== '/internal/editor') {
      reply.header('Cache-Control', 'no-store');
      const agentAllowed = [
        '/internal/discover',
        '/internal/agent-batch',
        '/internal/import',
      ].includes(path);
      if (!authorized(request, 'admin') && !(agentAllowed && authorized(request, 'agent')))
        return reply.code(401).send({ error: 'Nicht autorisiert.' });
    }
    if (path === '/api/events') {
      if (request.headers.origin !== config.PUBLIC_ORIGIN)
        return reply.code(403).send({ error: 'Ungültiger Ursprung.' });
      // Set only by nginx on its private network; never trust arbitrary X-Forwarded-For.
      if (!request.headers['x-client-ip'] && config.NODE_ENV === 'production')
        return reply.code(403).send({ error: 'Proxy erforderlich.' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: 'Ungültige Eingabe.', fields: error.issues.map((i) => i.path.join('.')) });
    const status =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    // No raw payloads, tokens or upstream URLs in logs/responses.
    app.log.error({ status }, 'Anfrage fehlgeschlagen');
    return reply.code(status).send({
      error: status === 429 ? 'Zu viele Anfragen.' : 'Anfrage konnte nicht verarbeitet werden.',
    });
  });
  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  app.get(
    '/api/commenting-status',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { postId } = z.object({ postId: z.uuid() }).strict().parse(request.query);
      if (await flag('attack_mode')) return { enabled: false };
      const row = (
        await db.query(
          "SELECT video_id,body,checked_at FROM candidates WHERE id=$1 AND status='published'",
          [postId],
        )
      ).rows[0];
      if (!row?.checked_at || new Date(row.checked_at).getTime() <= Date.now() - 7200000)
        return { enabled: false };
      return {
        enabled: true,
        videoId: row.video_id,
        evidenceQuote: row.body?.evidence?.quote,
        targetKey: sourceKey({ videoId: row.video_id, target: row.body?.target }),
      };
    },
  );
  app.post(
    '/api/events',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (await flag('attack_mode')) return reply.code(503).send({ error: 'Tracking pausiert.' });
      const event = eventSchema.parse(request.body);
      const row = (
        await db.query("SELECT checked_at FROM candidates WHERE id=$1 AND status='published'", [
          event.postId,
        ])
      ).rows[0];
      if (!row || !row.checked_at || new Date(row.checked_at).getTime() < Date.now() - 7200000)
        return reply.code(404).send({ error: 'Beitrag nicht verfügbar.' });
      if (Date.now() > saltExpiry) {
        salt = randomBytes(32);
        saltExpiry = Date.now() + 86400000;
        dedupe.clear();
      }
      if (Date.now() - lastDedupePrune > 60000) {
        for (const [key, expires] of dedupe) if (expires < Date.now()) dedupe.delete(key);
        lastDedupePrune = Date.now();
      }
      const client =
        config.NODE_ENV === 'production' ? String(request.headers['x-client-ip']) : request.ip;
      const key = createHmac('sha256', salt)
        .update(`${client}:${event.postId}:${event.type}`)
        .digest('hex');
      if ((dedupe.get(key) ?? 0) > Date.now()) return reply.code(202).send({ accepted: true });
      if (dedupe.size >= 10000) return reply.code(429).send({ error: 'Tracking ausgelastet.' });
      dedupe.set(key, Date.now() + 600000);
      await db.query(
        'INSERT INTO daily_events(day,post_id,event_type,count) VALUES ($1,$2,$3,1) ON CONFLICT(day,post_id,event_type) DO UPDATE SET count=daily_events.count+1',
        [new Date().toISOString().slice(0, 10), event.postId, event.type],
      );
      return reply.code(202).send({ accepted: true });
    },
  );
  app.get('/internal/editor', async (_request, reply) =>
    reply.type('text/html').send(await readFile(new URL('./editor.html', import.meta.url), 'utf8')),
  );
  app.get('/internal/status', async () => ({
    attackMode: await flag('attack_mode'),
    publicationPaused: await flag('publication_paused'),
    calibrationPassed: await loadCalibration(
      config.CALIBRATION_PATH,
      config.MODEL_SHA256,
      config.PROMPT_SHA256,
    ),
    autoPublishConfigured: config.AUTO_PUBLISH === 'true',
  }));
  app.post('/internal/flags', async (request) => {
    const body = z
      .object({ name: z.enum(['attack_mode', 'publication_paused']), enabled: z.boolean() })
      .strict()
      .parse(request.body);
    await db.query('UPDATE system_flags SET enabled=$1 WHERE name=$2', [body.enabled, body.name]);
    await exportCatalog(db, config);
    return { ok: true };
  });
  app.get(
    '/internal/candidates',
    async () =>
      (
        await db.query(
          'SELECT id,video_id,title,channel,channel_id,status,reason,body,analysis,checked_at FROM candidates ORDER BY updated_at DESC LIMIT 100',
        )
      ).rows,
  );
  app.post('/internal/discover', async (request) => {
    if (await flag('attack_mode')) return { inserted: 0, paused: true };
    const { videos } = discoverySchema.parse(request.body);
    let inserted = 0;
    for (const video of videos) {
      if (
        (
          await db.query('SELECT id FROM candidates WHERE source_key=$1', [
            'video:' + video.videoId,
          ])
        ).rows.length
      )
        continue;
      const r = await db.query(
        'INSERT INTO candidates(id,video_id,title,channel,channel_id,source_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_key) DO NOTHING RETURNING id',
        [
          randomUUID(),
          video.videoId,
          video.title,
          video.channel,
          video.channelId,
          'video:' + video.videoId,
        ],
      );
      inserted += r.rows.length;
    }
    return { inserted };
  });
  app.post('/internal/editorial', async (request) => {
    const input = z
      .object({ candidate: candidateSchema, analysis: analysisSchema.optional() })
      .strict()
      .parse(request.body);
    const verified = await verifyVideo(input.candidate.videoId, input.candidate.target);
    if (!verified.available || !verified.video)
      return { saved: false, reason: 'Video oder offene Kommentare nicht verfügbar.' };
    const candidate = {
      ...input.candidate,
      title: verified.video.title,
      channel: verified.video.channel,
      channelId: verified.video.channelId,
      ...(verified.target?.type === 'comment' ? { target: verified.target } : {}),
    };
    if (candidate.target?.type === 'comment' && verified.target?.type !== 'comment')
      return { saved: false, reason: 'Kommentar konnte nicht geprüft werden.' };
    if (
      !(
        candidate.target?.type === 'comment' ? (candidate.target.text ?? '') : candidate.transcript
      ).includes(candidate.evidence.quote)
    )
      return { saved: false, reason: 'Beleg fehlt wörtlich im Kontext.' };
    const id = randomUUID();
    await db.query(
      `INSERT INTO candidates(id,video_id,title,channel,channel_id,status,body,body_digest,analysis,checked_at,source_key,source_author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(source_key) DO UPDATE SET title=EXCLUDED.title,channel=EXCLUDED.channel,channel_id=EXCLUDED.channel_id,status=EXCLUDED.status,body=EXCLUDED.body,body_digest=EXCLUDED.body_digest,analysis=EXCLUDED.analysis,checked_at=EXCLUDED.checked_at,source_author=EXCLUDED.source_author,reason=NULL,source_updated_at=now(),updated_at=now()`,
      [
        id,
        candidate.videoId,
        candidate.title,
        candidate.channel,
        candidate.channelId,
        input.analysis ? 'review' : 'ready',
        candidate,
        digest(candidate),
        input.analysis ?? null,
        verified.checkedAt,
        sourceKey(candidate),
        verified.author ?? { name: verified.video.channel, channelId: verified.video.channelId },
      ],
    );
    await exportCatalog(db, config);
    return { saved: true };
  });
  app.get('/internal/agent-batch', async () => {
    if (await flag('attack_mode')) return { candidates: [], paused: true };
    const result = await db.query(
      "SELECT body FROM candidates WHERE status='ready' ORDER BY created_at LIMIT 5",
    );
    return { candidates: result.rows.map((r) => r.body) };
  });
  app.post('/internal/import', async (request, reply) => {
    if (await flag('attack_mode'))
      return reply.code(503).send({ error: 'Agentenübernahme pausiert.' });
    const input = importSchema.parse(request.body);
    const previous = await db.query('SELECT candidate_id FROM analysis_runs WHERE run_id=$1', [
      input.runId,
    ]);
    if (previous.rows.length) return { imported: true, duplicate: true };
    const row = (
      await db.query('SELECT * FROM candidates WHERE source_key=$1', [sourceKey(input.candidate)])
    ).rows[0];
    if (!row || row.status !== 'ready' || row.body_digest !== digest(input.candidate))
      return reply.code(409).send({ error: 'Kandidat oder Kontext ist nicht mehr aktuell.' });
    const calibration = await loadCalibration(
      config.CALIBRATION_PATH,
      input.modelDigest,
      input.promptDigest,
    );
    const permitted =
      config.AUTO_PUBLISH === 'true' &&
      input.modelDigest === config.MODEL_SHA256 &&
      input.promptDigest === config.PROMPT_SHA256 &&
      calibration &&
      !(await flag('publication_paused')) &&
      !(await flag('attack_mode'));
    const issues = publicationIssues(input.candidate, input.analysis);
    const check =
      permitted && !issues.length
        ? await verifyVideo(input.candidate.videoId, input.candidate.target)
        : { available: false, checkedAt: undefined };
    const publish = permitted && !issues.length && check.available;
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const updated = await connection.query(
        "UPDATE candidates SET analysis=$1,status=$2,reason=$3,checked_at=COALESCE($4,checked_at),updated_at=now() WHERE id=$5 AND status='ready' AND body_digest=$6" +
          (publish
            ? " AND NOT EXISTS (SELECT 1 FROM system_flags WHERE enabled=true AND name IN ('attack_mode','publication_paused'))"
            : '') +
          ' RETURNING id',
        [
          input.analysis,
          publish ? 'published' : 'review',
          issues.join('; ') ||
            (publish
              ? null
              : 'Automatische Freigabe gesperrt oder Verfügbarkeitsprüfung fehlgeschlagen'),
          check.checkedAt ?? null,
          row.id,
          digest(input.candidate),
        ],
      );
      if (!updated.rows.length) {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'Kandidat wurde zwischenzeitlich geändert.' });
      }
      await connection.query(
        'INSERT INTO analysis_runs(run_id,candidate_id,model_digest,prompt_digest,duration_ms,result) VALUES($1,$2,$3,$4,$5,$6)',
        [
          input.runId,
          row.id,
          input.modelDigest,
          input.promptDigest,
          input.durationMs,
          input.analysis,
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
    return { imported: true, published: publish };
  });
  app.post('/internal/publish', async (request) => {
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.body);
    if ((await flag('attack_mode')) || (await flag('publication_paused')))
      return { published: false, reason: 'Veröffentlichungen sind pausiert.' };
    const row = (await db.query('SELECT * FROM candidates WHERE id=$1', [id])).rows[0];
    if (!row?.body || !row.analysis || row.status !== 'review')
      return { published: false, reason: 'Geprüfter Entwurf erforderlich.' };
    const issues = publicationIssues(
      candidateSchema.parse(row.body),
      analysisSchema.parse(row.analysis),
    );
    if (issues.length) return { published: false, reason: issues.join('; ') };
    const check = await verifyVideo(row.video_id, row.body.target);
    if (!check.available)
      return { published: false, reason: 'Video oder Kommentare nicht verfügbar.' };
    const updated = await db.query(
      "UPDATE candidates SET status='published',checked_at=$1,updated_at=now() WHERE id=$2 AND status='review' AND body_digest=$3 AND analysis=$4::jsonb AND NOT EXISTS (SELECT 1 FROM system_flags WHERE enabled=true AND name IN ('attack_mode','publication_paused')) RETURNING id",
      [check.checkedAt, id, row.body_digest, JSON.stringify(row.analysis)],
    );
    if (!updated.rows.length)
      return { published: false, reason: 'Entwurf oder Freigabe wurde zwischenzeitlich geändert.' };
    await exportCatalog(db, config);
    return { published: true };
  });
  app.post('/internal/withdraw', async (request) => {
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.body);
    await db.query(
      "UPDATE candidates SET status='withdrawn',reason='Redaktionell zurückgezogen',updated_at=now() WHERE id=$1",
      [id],
    );
    await exportCatalog(db, config);
    return { withdrawn: true };
  });
  app.post('/internal/export', async () => ({ posts: await exportCatalog(db, config) }));
  await registerContributions(app, db, (id) => verifyVideo(id));
  return app;
}
