import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { keyHash } from './contributions.ts';

export const randomSecret = () => randomBytes(32).toString('base64url');
export const challenge = (value: string) => createHash('sha256').update(value).digest('base64url');
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const loopback = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    Number(url.port) >= 1024 &&
    Number(url.port) <= 65535 &&
    url.pathname === '/callback' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}, 'Lokale Plugin-Rückleitung erforderlich.');
type Identity = { sub: string; email: string; emailVerified: boolean; nonce: string };
export type GoogleVerifier = (
  code: string,
  verifier: string,
  redirectUri: string,
) => Promise<Identity>;

export function googleVerifier(config: Config): GoogleVerifier {
  return async (code, verifier, redirectUri) => {
    const client = new OAuth2Client({
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri,
      transporterOptions: { timeout: 10000, retry: false },
    });
    const { tokens } = await client.getToken({
      code,
      codeVerifier: verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens.id_token) throw new Error('ID-Token fehlt.');
    // Google's library verifies signature, issuer, audience and expiry. No Google token is persisted.
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error('Identität fehlt.');
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      nonce: String(payload.nonce ?? ''),
    };
  };
}

export async function registerGoogleLogin(
  app: FastifyInstance,
  db: Db,
  config: Config,
  verify = googleVerifier(config),
) {
  const enabled =
    !!config.GOOGLE_OAUTH_CLIENT_ID &&
    !!config.GOOGLE_OAUTH_CLIENT_SECRET &&
    !!config.GOOGLE_PILOT_EMAILS.trim();
  const callback = config.PUBLIC_ORIGIN + '/api/auth/google/callback';
  const cookieName = config.PUBLIC_ORIGIN.startsWith('https:') ? '__Host-tgr-login' : 'tgr-login';
  const cookie = (value: string, expire = false) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : 600}${config.PUBLIC_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
  const page = (message: string) =>
    '<!doctype html><html lang="de"><meta charset="utf-8"><title>hinterfragen · Anmeldung</title><h1>' +
    message +
    '</h1><p>Du kannst dieses Fenster schließen und zu Codex zurückkehren.</p></html>';
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/auth/')) return;
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
  });
  app.get('/api/auth/config', async () => ({ googleEnabled: enabled }));
  app.get(
    '/api/auth/authorize',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!enabled)
        return reply
          .code(503)
          .type('text/html')
          .send(page('Google-Anmeldung ist noch nicht eingerichtet.'));
      const input = z
        .object({ redirect_uri: loopback, code_challenge: secret, state: secret })
        .strict()
        .parse(request.query);
      const state = randomSecret(),
        binding = randomSecret(),
        nonce = randomSecret(),
        verifier = randomSecret();
      await db.query(
        `INSERT INTO login_flows(id,state_hash,browser_hash,nonce,google_verifier,redirect_uri,client_state,challenge,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          keyHash(state),
          keyHash(binding),
          nonce,
          verifier,
          input.redirect_uri,
          input.state,
          input.code_challenge,
          new Date(Date.now() + 600000),
        ],
      );
      const client = new OAuth2Client(
        config.GOOGLE_OAUTH_CLIENT_ID,
        config.GOOGLE_OAUTH_CLIENT_SECRET,
        callback,
      );
      const url = client.generateAuthUrl({
        scope: ['openid', 'email'],
        access_type: 'online',
        prompt: 'select_account',
        state,
        nonce,
        code_challenge: challenge(verifier),
        code_challenge_method: 'S256' as import('google-auth-library').CodeChallengeMethod,
      });
      return reply.header('Set-Cookie', cookie(binding)).redirect(url);
    },
  );
  app.get('/api/auth/google/callback', async (request, reply) => {
    if (!enabled)
      return reply.code(503).type('text/html').send(page('Anmeldung derzeit nicht verfügbar.'));
    const parsed = z
      .looseObject({
        state: secret,
        code: z.string().min(1).max(4096).optional(),
        error: z.string().max(200).optional(),
      })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).type('text/html').send(page('Anmeldung ungültig oder abgelaufen.'));
    const binding =
      String(request.headers.cookie ?? '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1) ?? '';
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const flow = (
        await connection.query('SELECT * FROM login_flows WHERE state_hash=$1 FOR UPDATE', [
          keyHash(parsed.data.state),
        ])
      ).rows[0];
      if (
        !flow ||
        flow.status !== 'pending' ||
        new Date(flow.expires_at).getTime() <= Date.now() ||
        !equal(flow.browser_hash, keyHash(binding))
      ) {
        await connection.query('ROLLBACK');
        return reply.code(400).type('text/html').send(page('Anmeldung ungültig oder abgelaufen.'));
      }
      // Consume the Google callback before its code is exchanged. Never retry a failed callback.
      await connection.query(
        "UPDATE login_flows SET status='failed',google_verifier=NULL WHERE id=$1",
        [flow.id],
      );
      if (parsed.data.error || !parsed.data.code) {
        await connection.query('COMMIT');
        return reply
          .header('Set-Cookie', cookie('', true))
          .type('text/html')
          .send(page('Anmeldung abgebrochen.'));
      }
      let identity: Identity;
      try {
        identity = await verify(parsed.data.code, flow.google_verifier, callback);
      } catch {
        await connection.query('COMMIT');
        return reply
          .code(401)
          .type('text/html')
          .send(page('Google-Anmeldung konnte nicht bestätigt werden.'));
      }
      const allowed = config.GOOGLE_PILOT_EMAILS.split(',').map((s) => s.trim().toLowerCase());
      if (
        !identity.emailVerified ||
        !equal(identity.nonce, flow.nonce) ||
        !allowed.includes(identity.email.toLowerCase())
      ) {
        await connection.query('COMMIT');
        return reply
          .code(403)
          .type('text/html')
          .send(page('Dieses Google-Konto ist für den Pilot nicht freigeschaltet.'));
      }
      // Identity/quota survives sign-out and new devices: never mint a fresh daily allowance on login.
      const keyId = randomUUID();
      await connection.query('INSERT INTO contribution_keys(id,label,key_hash) VALUES($1,$2,$3)', [
        keyId,
        'Google-Pilot',
        keyHash(randomSecret()),
      ]);
      await connection.query(
        "INSERT INTO login_identities(provider,subject,key_id) VALUES('google',$1,$2) ON CONFLICT(provider,subject) DO NOTHING",
        [identity.sub, keyId],
      );
      const accountId = (
        await connection.query(
          "SELECT key_id FROM login_identities WHERE provider='google' AND subject=$1",
          [identity.sub],
        )
      ).rows[0].key_id;
      if (accountId !== keyId)
        await connection.query('DELETE FROM contribution_keys WHERE id=$1', [keyId]);
      const account = (
        await connection.query('SELECT revoked_at FROM contribution_keys WHERE id=$1 FOR UPDATE', [
          accountId,
        ])
      ).rows[0];
      if (!account || account.revoked_at) {
        await connection.query('COMMIT');
        return reply.code(403).type('text/html').send(page('Pilotzugang gesperrt.'));
      }
      const appCode = randomSecret();
      await connection.query(
        "UPDATE login_flows SET status='authorized',code_hash=$1,key_id=$2,expires_at=$3 WHERE id=$4",
        [keyHash(appCode), accountId, new Date(Date.now() + 120000), flow.id],
      );
      await connection.query('COMMIT');
      const target = new URL(flow.redirect_uri);
      target.searchParams.set('code', appCode);
      target.searchParams.set('state', flow.client_state);
      return reply.header('Set-Cookie', cookie('', true)).redirect(target.href);
    } catch {
      await connection.query('ROLLBACK');
      return reply
        .code(503)
        .type('text/html')
        .send(page('Anmeldung derzeit nicht verfügbar. Bitte neu verbinden.'));
    } finally {
      connection.release();
    }
  });
  app.post(
    '/api/auth/token',
    { bodyLimit: 4096, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = z
        .object({ code: secret, code_verifier: secret, redirect_uri: loopback })
        .strict()
        .parse(request.body);
      const connection = await db.connect();
      try {
        await connection.query('BEGIN');
        const flow = (
          await connection.query('SELECT * FROM login_flows WHERE code_hash=$1 FOR UPDATE', [
            keyHash(input.code),
          ])
        ).rows[0];
        if (
          !flow ||
          flow.status !== 'authorized' ||
          new Date(flow.expires_at).getTime() <= Date.now() ||
          flow.redirect_uri !== input.redirect_uri ||
          !equal(flow.challenge, challenge(input.code_verifier))
        ) {
          await connection.query('ROLLBACK');
          return reply
            .code(400)
            .send({ error: 'Anmeldung ungültig oder abgelaufen. Neu verbinden.' });
        }
        const key = (
          await connection.query(
            'SELECT revoked_at FROM contribution_keys WHERE id=$1 FOR UPDATE',
            [flow.key_id],
          )
        ).rows[0];
        if (!key || key.revoked_at) {
          await connection.query('ROLLBACK');
          return reply.code(403).send({ error: 'Pilotzugang gesperrt.' });
        }
        const accessToken = 'tgs_' + randomSecret(),
          expiresAt = new Date(Date.now() + 30 * 86400000);
        await connection.query(
          'INSERT INTO login_sessions(token_hash,key_id,expires_at) VALUES($1,$2,$3)',
          [keyHash(accessToken), flow.key_id, expiresAt],
        );
        await connection.query(
          "UPDATE login_flows SET status='consumed',code_hash=NULL WHERE id=$1",
          [flow.id],
        );
        await connection.query('COMMIT');
        return { accessToken, expiresAt: expiresAt.toISOString() };
      } catch {
        await connection.query('ROLLBACK');
        return reply.code(503).send({ error: 'Anmeldung derzeit nicht verfügbar.' });
      } finally {
        connection.release();
      }
    },
  );
  app.post('/api/auth/logout', async (request, reply) => {
    const token = /^Bearer (tgs_[A-Za-z0-9_-]{43})$/.exec(
      String(request.headers.authorization ?? ''),
    );
    if (!token) return reply.code(401).send({ error: 'Anmeldung erforderlich.' });
    await db.query('DELETE FROM login_sessions WHERE token_hash=$1', [keyHash(token[1])]);
    return { signedOut: true };
  });
}
