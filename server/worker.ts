import { setTimeout } from 'node:timers/promises';
import { connect, migrate } from './db.ts';
import type { Db } from './db.ts';
import { getConfig, type Config } from './config.ts';
import { checkVideo } from './youtube.ts';
import { exportCatalog } from './catalog.ts';
export async function maintenance(
  db: Db,
  config: Config,
  verify = (id: string) => checkVideo(id, config.YOUTUBE_API_KEY),
) {
  const rows = (
    await db.query("SELECT id,video_id,checked_at FROM candidates WHERE status='published'")
  ).rows;
  let failures = 0;
  for (const row of rows) {
    if (row.checked_at && new Date(row.checked_at).getTime() > Date.now() - 3600000) continue;
    try {
      const check = await verify(row.video_id);
      if (check.available && check.video)
        await db.query(
          "UPDATE candidates SET checked_at=$1,title=$2,channel=$3,channel_id=$4,updated_at=now() WHERE id=$5 AND status='published'",
          [check.checkedAt, check.video.title, check.video.channel, check.video.channelId, row.id],
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
