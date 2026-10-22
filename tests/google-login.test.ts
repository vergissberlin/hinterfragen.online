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
import { candidate, model, prompt } from './fixtures.ts';
let app: Awaited<ReturnType<typeof buildApp>>, db: pg.Pool, config: Config, dir: string;
let root: pg.Pool | undefined, schema: string | undefined;
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

import { challenge, randomSecret } from '../server/google-login.ts';
import { research } from './plugin-fixtures.ts';
async function begin() {
  const verifier = randomSecret(),
    state = randomSecret(),
    redirectUri = 'http://127.0.0.1:45678/callback';
  const start = await app.inject({
    url:
      '/api/auth/authorize?' +
      new URLSearchParams({
        redirect_uri: redirectUri,
        code_challenge: challenge(verifier),
        state,
      }),
  });
  expect(start.statusCode).toBe(302);
  const google = new URL(String(start.headers.location));
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  return { verifier, state, redirectUri, google, cookie };
}
async function callback(flow: Awaited<ReturnType<typeof begin>>, cookie = flow.cookie) {
  return app.inject({
    url:
      '/api/auth/google/callback?' +
      new URLSearchParams({ state: flow.google.searchParams.get('state')!, code: 'google-code' }),
    headers: { cookie },
  });
}
async function token() {
  const flow = await begin(),
    returned = await callback(flow);
  expect(returned.statusCode).toBe(302);
  const local = new URL(String(returned.headers.location));
  expect(local.searchParams.get('state')).toBe(flow.state);
  const payload = {
    code: local.searchParams.get('code')!,
    code_verifier: flow.verifier,
    redirect_uri: flow.redirectUri,
  };
  const response = await app.inject({ method: 'POST', url: '/api/auth/token', payload });
  expect(response.statusCode).toBe(200);
  return { flow, payload, session: response.json() as { accessToken: string; expiresAt: string } };
}
describe('Google-Anmeldung ist keine Social-Media-Autorisierung', () => {
  it('verwendet nur openid/email, PKCE und eine feste Google-Rückleitung', async () => {
    const flow = await begin();
    expect(flow.google.origin).toBe('https://accounts.google.com');
    expect(flow.google.searchParams.get('scope')).toBe('openid email');
    expect(flow.google.searchParams.get('redirect_uri')).toBe(
      config.PUBLIC_ORIGIN + '/api/auth/google/callback',
    );
    expect(flow.google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.google.searchParams.has('nonce')).toBe(true);
    expect(flow.google.href).not.toContain(config.GOOGLE_OAUTH_CLIENT_SECRET);
    expect((await callback(flow, '')).statusCode).toBe(400);
  });
  it('verhindert fremde Rückleitungen und abgelaufene oder wiederholte Callbacks', async () => {
    const query = new URLSearchParams({
      redirect_uri: 'https://evil.example/callback',
      state: randomSecret(),
      code_challenge: randomSecret(),
    });
    expect((await app.inject('/api/auth/authorize?' + query)).statusCode).toBe(400);
    const flow = await begin();
    await db.query('UPDATE login_flows SET expires_at=$1', [new Date(Date.now() - 1000)]);
    expect((await callback(flow)).statusCode).toBe(400);
    const fresh = await begin();
    expect((await callback(fresh)).statusCode).toBe(302);
    expect((await callback(fresh)).statusCode).toBe(400);
  });
  it('tauscht einen Code nur einmal und nur mit passendem Plugin-Verifier', async () => {
    const result = await token();
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/token', payload: result.payload }))
        .statusCode,
    ).toBe(400);
    const flow = await begin(),
      returned = await callback(flow);
    const code = new URL(String(returned.headers.location)).searchParams.get('code');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/token',
          payload: { code, code_verifier: randomSecret(), redirect_uri: flow.redirectUri },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('persistiert keine Google-Tokens oder Klartext-App-Sitzungen und erlaubt Einreichungen', async () => {
    const result = await token();
    const rows = (await db.query('SELECT * FROM login_sessions')).rows;
    expect(JSON.stringify(rows)).not.toContain(result.session.accessToken);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: { authorization: 'Bearer ' + result.session.accessToken },
          payload: research(),
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await app.inject({
          url: '/internal/contributions',
          headers: { authorization: 'Bearer ' + result.session.accessToken },
        })
      ).statusCode,
    ).toBe(401);
    expect((await db.query('SELECT * FROM candidates')).rows).toHaveLength(0);
  });
  it('behält Konto und Tageslimit beim erneuten Anmelden und auf anderen Geräten', async () => {
    const first = await token();
    const headers = { authorization: 'Bearer ' + first.session.accessToken };
    await app.inject({ method: 'POST', url: '/api/contributions', headers, payload: research() });
    const second = await token();
    expect(first.session.accessToken).not.toBe(second.session.accessToken);
    expect((await db.query('SELECT * FROM login_identities')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM contribution_keys')).rows).toHaveLength(1);
    await db.query('UPDATE contribution_daily_quota SET count=30');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: { authorization: 'Bearer ' + second.session.accessToken },
          payload: research(),
        })
      ).statusCode,
    ).toBe(429);
  });
  it('widerruft einzelne Sitzungen und blockiert abgelaufene oder gesperrte Konten', async () => {
    const first = await token();
    const headers = { authorization: 'Bearer ' + first.session.accessToken };
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers })).json()).toEqual(
      { signedOut: true },
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers,
          payload: research(),
        })
      ).statusCode,
    ).toBe(401);
    const second = await token();
    await db.query('UPDATE login_sessions SET expires_at=$1', [new Date(Date.now() - 1000)]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/contributions',
          headers: { authorization: 'Bearer ' + second.session.accessToken },
          payload: research(),
        })
      ).statusCode,
    ).toBe(401);
    await db.query('UPDATE contribution_keys SET revoked_at=now()');
    const flow = await begin();
    expect((await callback(flow)).statusCode).toBe(403);
  });
  it.each(['nonce', 'email', 'verification'])(
    'blockiert falsche Google-Identität: %s',
    async (kind) => {
      await app.close();
      app = await buildApp(db, config, check, async () => ({
        sub: 'attacker',
        email: kind === 'email' ? 'stranger@example.org' : 'pilot@example.org',
        emailVerified: kind !== 'verification',
        nonce:
          kind === 'nonce'
            ? 'wrong'
            : (await db.query('SELECT nonce FROM login_flows')).rows[0].nonce,
      }));
      const flow = await begin();
      expect((await callback(flow)).statusCode).toBe(403);
      expect((await db.query('SELECT * FROM login_sessions')).rows).toHaveLength(0);
    },
  );
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
  config.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  config.GOOGLE_OAUTH_CLIENT_SECRET = 'test-only-secret';
  config.GOOGLE_PILOT_EMAILS = 'pilot@example.org';
  app = await buildApp(db, config, check, async () => {
    const flow = (await db.query('SELECT nonce FROM login_flows ORDER BY expires_at DESC LIMIT 1'))
      .rows[0];
    return {
      sub: 'google-subject-123',
      email: 'pilot@example.org',
      emailVerified: true,
      nonce: flow.nonce,
    };
  });
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
