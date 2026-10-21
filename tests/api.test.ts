import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../server/app.ts';
import { migrate } from '../server/db.ts';
import { envSchema, type Config } from '../server/config.ts';
import { candidate, analysis, model, prompt } from './fixtures.ts';
import { exportCatalog } from '../server/catalog.ts';
import { maintenance } from '../server/worker.ts';
let app: Awaited<ReturnType<typeof buildApp>>, db: pg.Pool, config: Config, dir: string;
let root: pg.Pool | undefined, schema: string | undefined;
const admin = { authorization: 'Bearer ' + 'x'.repeat(40) },
  agent = { authorization: 'Bearer ' + 'y'.repeat(40) };
const check = async () => ({
  available: true,
  checkedAt: new Date().toISOString(),
  video: {
    videoId: candidate.videoId,
    title: candidate.title,
    channel: candidate.channel,
    channelId: candidate.channelId,
  },
});
beforeEach(async () => {
  if (process.env.POSTGRES_TEST_URL) {
    root = new pg.Pool({ connectionString: process.env.POSTGRES_TEST_URL });
    schema = 'test_' + randomUUID().replaceAll('-', '');
    await root.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({
      connectionString: process.env.POSTGRES_TEST_URL,
      options: `-c search_path=${schema}`,
    });
  } else {
    const memory = newDb();
    for (const name of ['pg_advisory_lock', 'pg_advisory_unlock'])
      memory.public.registerFunction({
        name,
        args: [DataType.integer],
        returns: DataType.bool,
        implementation: () => true,
      });
    const adapter = memory.adapters.createPg();
    db = new adapter.Pool();
  }
  await migrate(db);
  dir = await mkdtemp(resolve(tmpdir(), 'hf-test-'));
  config = envSchema.parse({
    DATABASE_URL: 'postgres://test',
    ADMIN_TOKEN: 'x'.repeat(40),
    AGENT_TOKEN: 'y'.repeat(40),
    DATA_DIR: dir,
    AUTO_PUBLISH: 'true',
    MODEL_SHA256: model,
    PROMPT_SHA256: prompt,
    CALIBRATION_PATH: resolve(dir, 'missing.json'),
  });
  app = await buildApp(db, config, check);
});
afterEach(async () => {
  await app.close();
  await db.end();
  if (root) {
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
    root = undefined;
  }
  await rm(dir, { recursive: true, force: true });
});
async function save(withAnalysis = false) {
  const r = await app.inject({
    method: 'POST',
    url: '/internal/editorial',
    headers: admin,
    payload: { candidate, ...(withAnalysis ? { analysis } : {}) },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().saved).toBe(true);
  return (await db.query('SELECT * FROM candidates')).rows[0];
}
describe('Interne Grenzen und Redaktion', () => {
  it('trennt Agenten- und Redaktionsrechte', async () => {
    expect((await app.inject('/internal/candidates')).statusCode).toBe(401);
    expect((await app.inject({ url: '/internal/candidates', headers: agent })).statusCode).toBe(
      401,
    );
    expect((await app.inject('/internal/editor')).statusCode).toBe(200);
    expect((await app.inject({ url: '/internal/candidates', headers: admin })).statusCode).toBe(
      200,
    );
  });
  it('dedupliziert Entdeckungen und lässt keine Veröffentlichung ohne Kontext zu', async () => {
    const videos = [
      {
        videoId: candidate.videoId,
        title: candidate.title,
        channel: candidate.channel,
        channelId: candidate.channelId,
      },
    ];
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/internal/discover',
        headers: agent,
        payload: { videos },
      });
      expect(r.json().inserted).toBe(i === 0 ? 1 : 0);
    }
    const row = (await db.query('SELECT * FROM candidates')).rows[0];
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/publish',
          headers: admin,
          payload: { id: row.id },
        })
      ).json().published,
    ).toBe(false);
  });
  it('pausiert standardmäßig und veröffentlicht manuell erst nach Freigabe', async () => {
    const row = await save(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/publish',
          headers: admin,
          payload: { id: row.id },
        })
      ).json().published,
    ).toBe(false);
    await app.inject({
      method: 'POST',
      url: '/internal/flags',
      headers: admin,
      payload: { name: 'publication_paused', enabled: false },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/publish',
          headers: admin,
          payload: { id: row.id },
        })
      ).json().published,
    ).toBe(true);
    let catalog = JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8'));
    expect(catalog.posts).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain('transcript');
    await app.inject({
      method: 'POST',
      url: '/internal/withdraw',
      headers: admin,
      payload: { id: row.id },
    });
    catalog = JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8'));
    expect(catalog.posts).toHaveLength(0);
  });
  it('sperrt Auto-Veröffentlichung ohne echte Kalibrierung und behandelt Wiederholungen idempotent', async () => {
    await save();
    const payload = {
      runId: randomUUID(),
      candidate,
      analysis,
      modelDigest: model,
      promptDigest: prompt,
      durationMs: 100,
    };
    const r = await app.inject({
      method: 'POST',
      url: '/internal/import',
      headers: agent,
      payload,
    });
    expect(r.json()).toMatchObject({ imported: true, published: false });
    expect(
      (
        await app.inject({ method: 'POST', url: '/internal/import', headers: agent, payload })
      ).json().duplicate,
    ).toBe(true);
    expect((await db.query('SELECT * FROM analysis_runs')).rows).toHaveLength(1);
  });
  it('weist geänderten Agentenkontext zurück', async () => {
    await save();
    const r = await app.inject({
      method: 'POST',
      url: '/internal/import',
      headers: agent,
      payload: {
        runId: randomUUID(),
        candidate: { ...candidate, transcript: 'Manipuliert' },
        analysis,
        modelDigest: model,
        promptDigest: prompt,
        durationMs: 1,
      },
    });
    expect(r.statusCode).toBe(409);
  });
});
describe('Gleichzeitige redaktionelle Änderungen', () => {
  it('überschreibt keine Rücknahme während einer laufenden YouTube-Prüfung', async () => {
    const row = await save(true);
    await db.query("UPDATE system_flags SET enabled=false WHERE name='publication_paused'");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayed = await buildApp(db, config, async () => {
      entered();
      await gate;
      return check();
    });
    try {
      const publish = delayed.inject({
        method: 'POST',
        url: '/internal/publish',
        headers: admin,
        payload: { id: row.id },
      });
      const completed = publish.then((response) => response);
      await started;
      await app.inject({
        method: 'POST',
        url: '/internal/withdraw',
        headers: admin,
        payload: { id: row.id },
      });
      release();
      expect((await completed).json().published).toBe(false);
      expect(
        (await db.query('SELECT status FROM candidates WHERE id=$1', [row.id])).rows[0].status,
      ).toBe('withdrawn');
    } finally {
      release();
      await delayed.close();
    }
  });
});
describe('Tracking und Ausfallsicherheit', () => {
  it('aggregiert ohne Besucherkennung, begrenzt Wiederholungen und prüft Origin', async () => {
    const row = await save(true);
    await db.query("UPDATE candidates SET status='published' WHERE id=$1", [row.id]);
    const payload = { postId: row.id, type: 'original_open' };
    expect((await app.inject({ method: 'POST', url: '/api/events', payload })).statusCode).toBe(
      403,
    );
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/events',
            headers: { origin: config.PUBLIC_ORIGIN },
            payload,
          })
        ).statusCode,
      ).toBe(202);
    expect(Number((await db.query('SELECT count FROM daily_events')).rows[0].count)).toBe(1);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { origin: config.PUBLIC_ORIGIN },
      payload: { ...payload, userId: 'not-allowed' },
    });
    expect(malformed.statusCode).toBe(400);
  });
  it('deaktiviert Schreibaktionen und Kommentierfreigabe im Angriffsmodus', async () => {
    await app.inject({
      method: 'POST',
      url: '/internal/flags',
      headers: admin,
      payload: { name: 'attack_mode', enabled: true },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/events',
          headers: { origin: config.PUBLIC_ORIGIN },
          payload: { postId: randomUUID(), type: 'original_open' },
        })
      ).statusCode,
    ).toBe(503);
    const runtime = JSON.parse(await readFile(resolve(dir, 'runtime.json'), 'utf8'));
    expect(runtime.commentingEnabled).toBe(false);
  });
  it('nimmt abgelaufene und deaktivierte Beiträge aus dem Katalog', async () => {
    const row = await save(true);
    await db.query("UPDATE candidates SET status='published',checked_at=$1 WHERE id=$2", [
      new Date(Date.now() - 7300000),
      row.id,
    ]);
    await exportCatalog(db, config);
    expect(JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8')).posts).toHaveLength(0);
    const r = await maintenance(db, config, async () => ({ available: false }));
    expect(r.failures).toBe(0);
    expect((await db.query('SELECT status FROM candidates')).rows[0].status).toBe('expired');
  });
  it('verlängert bei YouTube-Ausfall keine Frist und löscht Quelldaten nach 30 Tagen', async () => {
    const row = await save(true);
    await db.query("UPDATE candidates SET status='published',checked_at=$1 WHERE id=$2", [
      new Date(Date.now() - 3700000),
      row.id,
    ]);
    const result = await maintenance(db, config, async () => {
      throw new Error('quotaExceeded');
    });
    expect(result.failures).toBe(1);
    expect(JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8')).posts).toHaveLength(1);
    await db.query('UPDATE candidates SET source_updated_at=$1 WHERE id=$2', [
      new Date(Date.now() - 31 * 86400000),
      row.id,
    ]);
    await maintenance(db, config, async () => {
      throw new Error('quotaExceeded');
    });
    expect((await db.query('SELECT id FROM candidates')).rows).toHaveLength(0);
    expect(JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8')).posts).toHaveLength(0);
  });
});

describe('Aktuelle Kommentierfreigabe', () => {
  it('verweigert zurückgezogene und gesperrte Ziele unabhängig vom CDN-Katalog', async () => {
    const row = await save(true);
    await db.query("UPDATE candidates SET status='published' WHERE id=$1", [row.id]);
    const url = '/api/commenting-status?postId=' + row.id;
    expect((await app.inject(url)).json()).toMatchObject({
      enabled: true,
      videoId: candidate.videoId,
    });
    await app.inject({
      method: 'POST',
      url: '/internal/withdraw',
      headers: admin,
      payload: { id: row.id },
    });
    expect((await app.inject(url)).json()).toEqual({ enabled: false });
    await db.query("UPDATE candidates SET status='published' WHERE id=$1", [row.id]);
    await db.query("UPDATE system_flags SET enabled=true WHERE name='attack_mode'");
    expect((await app.inject(url)).json()).toEqual({ enabled: false });
  });
});
