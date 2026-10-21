import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { cacheAvatar } from './avatars.ts';
import { catalogSchema, publicPostSchema } from '../src/lib/contracts.ts';
export async function atomicJson(directory: string, filename: string, data: unknown) {
  await mkdir(directory, { recursive: true });
  const temporary = resolve(directory, `.${filename}.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(data), { mode: 0o644 });
  await rename(temporary, resolve(directory, filename));
}
export async function purgeCatalog(config: Config) {
  if (!config.CLOUDFLARE_API_TOKEN || !config.CLOUDFLARE_ZONE_ID) return;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.CLOUDFLARE_ZONE_ID)}/purge_cache`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: ['/data/catalog.json', '/data/stats.json'].map(
          (p) => new URL(p, config.PUBLIC_ORIGIN).href,
        ),
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok || !((await response.json()) as { success?: boolean }).success)
    throw new Error('CDN-Invalidierung fehlgeschlagen');
}
export async function exportCatalog(pool: Db, config: Config, now = Date.now()) {
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock(74391021)');
    const result = await db.query(
      "SELECT * FROM candidates WHERE status='published' AND checked_at IS NOT NULL",
    );
    const posts = [];
    for (const r of result.rows) {
      if (!r.body || !r.analysis || new Date(r.checked_at).getTime() + 7200000 <= now) continue;
      const author = r.source_author ?? { name: r.channel, channelId: r.channel_id };
      const avatarUrl = await cacheAvatar(author.avatarSourceUrl, config.DATA_DIR, now);
      const parsed = publicPostSchema.safeParse({
        id: r.id,
        videoId: r.video_id,
        title: r.title,
        channel: r.channel,
        channelId: r.channel_id,
        target:
          r.body.target?.type === 'comment'
            ? { type: 'comment', commentId: r.body.target.commentId }
            : { type: 'video' },
        author: {
          name: author.name,
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(author.channelId
            ? { profileUrl: 'https://www.youtube.com/channel/' + author.channelId }
            : {}),
        },
        topic: r.analysis.topic,
        summary: r.analysis.summary,
        evidence: r.body.evidence,
        questions: r.analysis.questions,
        checkedAt: new Date(r.checked_at).toISOString(),
        expiresAt: new Date(new Date(r.checked_at).getTime() + 7200000).toISOString(),
        demo: false,
      });
      if (parsed.success) posts.push(parsed.data);
    }
    await atomicJson(
      config.DATA_DIR,
      'catalog.json',
      catalogSchema.parse({
        version: 1,
        generatedAt: new Date(now).toISOString(),
        demo: false,
        posts,
      }),
    );
    const aggregate = await db.query(
      'SELECT event_type, SUM(count) AS total FROM daily_events GROUP BY event_type',
    );
    const counts = Object.fromEntries(aggregate.rows.map((r) => [r.event_type, Number(r.total)]));
    await atomicJson(config.DATA_DIR, 'stats.json', {
      original_open: counts.original_open ?? 0,
      question_copy: counts.question_copy ?? 0,
      updatedAt: new Date(now).toISOString(),
    });
    const flags = (await db.query('SELECT name,enabled FROM system_flags')).rows;
    await atomicJson(config.DATA_DIR, 'runtime.json', {
      commentingEnabled: !flags.some((r) => r.name === 'attack_mode' && r.enabled),
      expiresAt: new Date(now + 120000).toISOString(),
    });
    await purgeCatalog(config);
    return posts.length;
  } finally {
    try {
      await db.query('SELECT pg_advisory_unlock(74391021)');
    } finally {
      db.release();
    }
  }
}
