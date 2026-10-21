import { setTimeout } from 'node:timers/promises';
import { connect, migrate } from './db.ts';
import type { Db } from './db.ts';
import { getConfig, type Config } from './config.ts';
import { checkSource, type Verification } from './youtube.ts';
import { type PostTarget } from '../src/lib/contracts.ts';
import { cleanAvatars } from './avatars.ts';
import { exportCatalog } from './catalog.ts';
export async function maintenance(
  db: Db,
  config: Config,
  verify: (id: string, target?: PostTarget) => Promise<Verification> = (id, target) =>
    checkSource(id, target, config.YOUTUBE_API_KEY),
) {
  const rows = (
    await db.query(
      "SELECT id,video_id,checked_at,body,source_author FROM candidates WHERE status='published'",
    )
  ).rows;
  let failures = 0;
  for (const row of rows) {
    if (row.checked_at && new Date(row.checked_at).getTime() > Date.now() - 3600000) continue;
    try {
      const check = await verify(row.video_id, row.body?.target);
      if (check.available && check.video)
        await db.query(
          "UPDATE candidates SET checked_at=$1,title=$2,channel=$3,channel_id=$4,source_author=$6,updated_at=now() WHERE id=$5 AND status='published'",
          [
            check.checkedAt,
            check.video.title,
            check.video.channel,
            check.video.channelId,
            row.id,
            check.author ?? row.source_author,
          ],
        );
      else
        await db.query(
          "UPDATE candidates SET status='expired',reason='Video oder Kommentare nicht verfügbar',updated_at=now() WHERE id=$1 AND status='published'",
          [row.id],
        );
    } catch {
      failures++;
    }
  }
  // Remove source material, derivatives and API metadata together at the retention boundary.
  await db.query("DELETE FROM candidates WHERE source_updated_at < now() - interval '30 days'");
  await cleanAvatars(config.DATA_DIR);
  await exportCatalog(db, config);
  return { checked: rows.length, failures };
}
if (process.argv[1]?.endsWith('worker.ts')) {
  const config = getConfig(),
    db = connect(config.DATABASE_URL);
  await migrate(db);
  let stopped = false;
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopped = true;
      controller.abort();
    });
  while (!stopped) {
    try {
      const result = await maintenance(db, config);
      console.log(JSON.stringify({ maintenance: true, ...result }));
    } catch {
      console.error('Wartung oder CDN-Invalidierung fehlgeschlagen. Katalogalter prüfen.');
    }
    try {
      await setTimeout(60000, undefined, { signal: controller.signal });
    } catch {
      /* graceful shutdown */
    }
  }
  await db.end();
}
