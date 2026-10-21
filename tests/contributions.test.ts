import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../server/app.ts';
import { migrate } from '../server/db.ts';
import { envSchema, type Config } from '../server/config.ts';
import { candidate, analysis, model, prompt } from './fixtures.ts';
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

import { research } from './plugin-fixtures.ts';
import { issueContributionKey } from '../server/contributions.ts';

async function pilot() {
  const issued = await issueContributionKey(db, 'Synthetischer Pilot');
  return { ...issued, headers: { authorization: 'Bearer ' + issued.key } };
}
describe('Codex-Piloteinreichungen', () => {
  it('trennt persönliche, interne Agent- und Adminschlüssel', async () => {
    const key = await pilot(),
      payload = research();
    for (const headers of [{}, admin, agent, { authorization: 'Bearer invalid' }]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/contributions', headers, payload }))
          .statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload,
        })
      ).statusCode,
    ).toBe(202);
    const stored = (await db.query('SELECT * FROM contribution_keys WHERE id=$1', [key.id]))
      .rows[0];
    expect(JSON.stringify(stored)).not.toContain(key.key);
    expect(
      (await app.inject({ url: '/internal/contributions', headers: key.headers })).statusCode,
    ).toBe(401);
    await db.query('UPDATE contribution_keys SET revoked_at=now() WHERE id=$1', [key.id]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload,
        })
      ).statusCode,
    ).toBe(401);
  });
  it('nimmt nur erlaubte Verträge an und legt nichts ungeprüft im Katalog ab', async () => {
    const key = await pilot(),
      payload = research();
    const call = (body: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/contributions',
        headers: key.headers,
        payload: body as Record<string, unknown>,
      });
    expect((await call({ ...payload, privateChat: 'private' })).statusCode).toBe(400);
    expect(
      (await call({ ...payload, evidence: { ...payload.evidence, quote: 'erfunden' } })).statusCode,
    ).toBe(400);
    expect(
      (await call({ ...payload, sources: [{ url: 'http://localhost/private', title: 'private' }] }))
        .statusCode,
    ).toBe(400);
    expect((await call({ ...payload, title: 'x'.repeat(256 * 1024) })).statusCode).toBe(413);
    expect((await call(payload)).json()).toMatchObject({ status: 'review', duplicate: false });
    expect((await db.query('SELECT * FROM candidates')).rows).toHaveLength(0);
  });
  it('dedupliziert Wiederholungen und erhält verschiedene Recherchen zum selben Video', async () => {
    const key = await pilot(),
      payload = research();
    const send = (body = payload) =>
      app.inject({
        method: 'POST',
        url: '/api/contributions',
        headers: key.headers,
        payload: body,
      });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).json()).toMatchObject({ duplicate: true, status: 'review' });
    expect((await send({ ...payload, title: 'Geändert' })).statusCode).toBe(409);
    expect((await send(research())).statusCode).toBe(202);
    expect((await db.query('SELECT * FROM contributions')).rows).toHaveLength(2);
    expect(
      Number((await db.query('SELECT count FROM contribution_daily_quota')).rows[0].count),
    ).toBe(2);
  });
  it('erzwingt 30 Einreichungen je Schlüssel und UTC-Tag, erlaubt idempotente Wiederholung', async () => {
    const key = await pilot(),
      first = research();
    for (let i = 0; i < 30; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/contributions',
            headers: key.headers,
            payload: i ? research() : first,
          })
        ).statusCode,
      ).toBe(202);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload: research(),
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload: first,
        })
      ).statusCode,
    ).toBe(200);
    const second = await pilot();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: second.headers,
          payload: research(),
        })
      ).statusCode,
    ).toBe(202);
  });
  it('pausiert Einreichungen im Angriffsmodus', async () => {
    const key = await pilot();
    await db.query("UPDATE system_flags SET enabled=true WHERE name='attack_mode'");
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload: research(),
        })
      ).statusCode,
    ).toBe(503);
    expect((await db.query('SELECT * FROM contributions')).rows).toHaveLength(0);
  });
  it('erlaubt nur redaktionell bestätigte Übernahme mit vollständigem Kontext', async () => {
    const key = await pilot(),
      payload = research();
    await app.inject({ method: 'POST', url: '/api/contributions', headers: key.headers, payload });
    const adopt = { id: payload.submissionId, contextVerified: true, candidate, analysis };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/adopt',
          headers: agent,
          payload: adopt,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/adopt',
          headers: admin,
          payload: { ...adopt, contextVerified: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/adopt',
          headers: admin,
          payload: adopt,
        })
      ).json(),
    ).toMatchObject({ adopted: true, published: false });
    expect((await db.query('SELECT status FROM candidates')).rows[0].status).toBe('review');
    const another = research();
    await app.inject({
      method: 'POST',
      url: '/api/contributions',
      headers: key.headers,
      payload: another,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/adopt',
          headers: admin,
          payload: { ...adopt, id: another.submissionId },
        })
      ).statusCode,
    ).toBe(409);
    expect((await db.query('SELECT * FROM candidates')).rows).toHaveLength(1);
  });
  it('blockiert unvollständige Quellen und behandelt Ablehnung als endgültigen Prüfstatus', async () => {
    const key = await pilot(),
      payload = research({ contextComplete: false });
    await app.inject({ method: 'POST', url: '/api/contributions', headers: key.headers, payload });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/adopt',
          headers: admin,
          payload: { id: payload.submissionId, contextVerified: true, candidate, analysis },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/reject',
          headers: admin,
          payload: { id: payload.submissionId, note: 'Kontext fehlt' },
        })
      ).json(),
    ).toEqual({ rejected: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: key.headers,
          payload,
        })
      ).json(),
    ).toMatchObject({ status: 'rejected', duplicate: true });
  });
  it('löscht Einreichungen nach 30 Tagen im Wartungsworker', async () => {
    const key = await pilot();
    await app.inject({
      method: 'POST',
      url: '/api/contributions',
      headers: key.headers,
      payload: research(),
    });
    await db.query('UPDATE contributions SET created_at=$1', [
      new Date(Date.now() - 31 * 86400000),
    ]);
    await maintenance(db, config, check);
    expect((await db.query('SELECT * FROM contributions')).rows).toHaveLength(0);
  });
  it.skipIf(!process.env.POSTGRES_TEST_URL)(
    'serialisiert parallele Duplikate und Tageslimits über echte PostgreSQL-Verbindungen',
    async () => {
      const key = await pilot(),
        payload = research();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({ method: 'POST', url: '/api/contributions', headers: key.headers, payload }),
        ),
      );
      expect(responses.filter((r) => r.statusCode === 202)).toHaveLength(1);
      expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(4);
      await db.query('UPDATE contribution_daily_quota SET count=29 WHERE key_id=$1', [key.id]);
      const capped = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({
            method: 'POST',
            url: '/api/contributions',
            headers: key.headers,
            payload: research(),
          }),
        ),
      );
      expect(capped.filter((r) => r.statusCode === 202)).toHaveLength(1);
      expect(capped.filter((r) => r.statusCode === 429)).toHaveLength(4);
    },
  );
});
