import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../server/app.ts';
import { migrate } from '../server/db.ts';
import { envSchema, type Config } from '../server/config.ts';
import { candidate, analysis, model, prompt, testCalibration } from './fixtures.ts';
import { digest } from '../server/policy.ts';
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
async function submit() {
  const key = await pilot(),
    body = research();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/contributions',
        headers: key.headers,
        payload: body,
      })
    ).statusCode,
  ).toBe(202);
  return { key, body };
}
async function unpause() {
  await db.query("UPDATE system_flags SET enabled=false WHERE name='publication_paused'");
}
function approval(key: Awaited<ReturnType<typeof pilot>>, id: string) {
  return app.inject({
    method: 'POST',
    url: '/api/contributions/approval',
    headers: key.headers,
    payload: { submissionId: id },
  });
}
describe('Bestätigung vor öffentlichem Angebot und persönlichem Versand', () => {
  it('bietet ungeprüfte Einreichungen und fremde Einreichungs-IDs nicht an', async () => {
    const { key, body } = await submit();
    await unpause();
    expect((await approval(key, body.submissionId)).json()).toEqual({
      approved: false,
      reason: 'review_pending',
    });
    const other = await pilot();
    expect((await approval(other, body.submissionId)).json().approved).toBe(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions/approval',
          payload: { submissionId: body.submissionId },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/internal/contributions/review-batch', headers: key.headers }))
        .statusCode,
    ).toBe(401);
  });
  it('erfordert nach redaktioneller Übernahme auch die ausdrückliche Veröffentlichung', async () => {
    const { key, body } = await submit();
    await unpause();
    const adopt = await app.inject({
      method: 'POST',
      url: '/internal/contributions/adopt',
      headers: admin,
      payload: { id: body.submissionId, contextVerified: true, candidate, analysis },
    });
    expect(adopt.statusCode).toBe(200);
    expect((await approval(key, body.submissionId)).json().approved).toBe(false);
    const id = adopt.json().candidateId;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/publish',
          headers: admin,
          payload: { id },
        })
      ).json(),
    ).toEqual({ published: true });
    const result = (await approval(key, body.submissionId)).json();
    expect(result).toMatchObject({
      approved: true,
      videoId: candidate.videoId,
      evidenceQuote: candidate.evidence.quote,
      questions: analysis.questions,
    });
    expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(30000);
    await app.inject({
      method: 'POST',
      url: '/internal/withdraw',
      headers: admin,
      payload: { id },
    });
    expect((await approval(key, body.submissionId)).json().approved).toBe(false);
  });
  it('sperrt abgelaufene, veränderte oder pausierte Inhalte auch nach einer Bestätigung', async () => {
    const { key, body } = await submit();
    await unpause();
    const adopted = (
      await app.inject({
        method: 'POST',
        url: '/internal/contributions/adopt',
        headers: admin,
        payload: { id: body.submissionId, contextVerified: true, candidate, analysis },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/internal/publish',
      headers: admin,
      payload: { id: adopted.candidateId },
    });
    await db.query("UPDATE system_flags SET enabled=true WHERE name='attack_mode'");
    expect((await approval(key, body.submissionId)).json().approved).toBe(false);
    await db.query("UPDATE system_flags SET enabled=false WHERE name='attack_mode'");
    await db.query('UPDATE candidates SET checked_at=$1', [new Date(Date.now() - 7201000)]);
    expect((await approval(key, body.submissionId)).json().approved).toBe(false);
    await db.query('UPDATE candidates SET checked_at=now(),body=$1', [
      { ...candidate, evidence: { ...candidate.evidence, quote: 'Eine andere Aussage' } },
    ]);
    expect((await approval(key, body.submissionId)).json().approved).toBe(false);
  });
  it('lässt den Prüfagenten nur lesen/prüfen und verweigert Selbstfreigabe mit Nutzersitzungen', async () => {
    const { key, body } = await submit();
    config.CONTRIBUTION_REVIEW_ENABLED = 'true';
    expect(
      (await app.inject({ url: '/internal/contributions/review-batch', headers: agent })).json()
        .contributions,
    ).toHaveLength(1);
    const result = {
      id: body.submissionId,
      bodyDigest: digest(body),
      modelDigest: model,
      promptDigest: prompt,
      outcome: 'deferred',
      reason: 'context_unverified',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: key.headers,
          payload: result,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload: result,
        })
      ).json().approved,
    ).toBe(false);
    expect((await db.query('SELECT status FROM contributions')).rows[0].status).toBe('review');
    expect((await db.query('SELECT * FROM candidates')).rows).toHaveLength(0);
  });
  it('bestätigt KI-Ergebnisse nur mit unabhängiger Quelle, Kalibrierung und offenen Betriebsflags', async () => {
    const { key, body } = await submit();
    config.CONTRIBUTION_REVIEW_ENABLED = 'true';
    config.CONTRIBUTION_REVIEW_PROMPT_SHA256 = prompt;
    config.REVIEW_SOURCE_ORIGINS = 'https://transcripts.example.org';
    config.CONTRIBUTION_REVIEW_CALIBRATION_PATH = resolve(dir, 'review-calibration.json');
    const url = 'https://transcripts.example.org/video.json';
    const reviewed = {
      ...candidate,
      contextSource: 'verified_public_source',
      sourceReference: url,
    };
    const payload = {
      id: body.submissionId,
      bodyDigest: digest(body),
      modelDigest: model,
      promptDigest: prompt,
      outcome: 'approved',
      reason: 'verified',
      candidate: reviewed,
      analysis,
      source: { url, textDigest: digest(candidate.transcript) },
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload: {
            ...payload,
            source: {
              url: 'https://attacker.example.org/video',
              textDigest: digest(candidate.transcript),
            },
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload,
        })
      ).json(),
    ).toEqual({ approved: false, reason: 'calibration_required' });
    expect((await db.query('SELECT * FROM candidates')).rows).toHaveLength(0);
    await writeFile(config.CONTRIBUTION_REVIEW_CALIBRATION_PATH, JSON.stringify(testCalibration()));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload,
        })
      ).statusCode,
    ).toBe(409);
    await unpause();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload,
        })
      ).json(),
    ).toEqual({ approved: true });
    expect((await approval(key, body.submissionId)).json().approved).toBe(true);
    expect(JSON.parse(await readFile(resolve(dir, 'catalog.json'), 'utf8')).posts).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/contributions/review-result',
          headers: agent,
          payload,
        })
      ).statusCode,
    ).toBe(409);
  });
});
