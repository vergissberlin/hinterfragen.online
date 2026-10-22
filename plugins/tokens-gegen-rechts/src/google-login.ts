import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';

export const sessionSchema = z
  .object({
    accessToken: z.string().regex(/^tgs_[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;
const random = () => randomBytes(32).toString('base64url');
export function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}
/** Loopback receiver holds the verifier in memory; no credentials ever enter a tool result. */
export class GoogleLogin {
  private server?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private authorizationUrl?: string;
  private outcome = 'disconnected';
  private generation = 0;
  constructor(
    private readonly origin: string,
    private readonly transport: typeof fetch,
    private readonly save: (session: Session, isCurrent: () => boolean) => Promise<void>,
    private readonly open = openBrowser,
  ) {}
  status() {
    return { loginStatus: this.outcome };
  }
  close() {
    this.generation++;
    clearTimeout(this.timer);
    this.server?.close();
    this.server = undefined;
    this.authorizationUrl = undefined;
    if (this.outcome === 'pending') this.outcome = 'cancelled';
  }
  async start() {
    if (this.authorizationUrl)
      return { loginStatus: 'pending', authorizationUrl: this.authorizationUrl };
    const generation = this.generation;
    const response = await this.transport(this.origin + '/api/auth/config', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !((await response.json()) as { googleEnabled?: boolean }).googleEnabled)
      throw new Error(
        'Google-Anmeldung ist beim Betreiber noch nicht eingerichtet. Lokale Recherche bleibt verfügbar.',
      );
    if (generation !== this.generation) throw new Error('Anmeldung abgebrochen.');
    const verifier = random(),
      state = random();
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    let redirectUri = '',
      busy = false;
    const server = createServer(async (request, reply) => {
      reply.setHeader('Content-Type', 'text/plain; charset=utf-8');
      reply.setHeader('Cache-Control', 'no-store');
      reply.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      reply.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(request.url ?? '/', redirectUri);
      const received = url.searchParams.get('state') ?? '';
      if (
        request.method !== 'GET' ||
        request.headers.host !== new URL(redirectUri).host ||
        url.pathname !== '/callback' ||
        !/^[A-Za-z0-9_-]{43}$/.test(received) ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(state)) ||
        busy
      ) {
        reply.writeHead(400);
        reply.end('Ungültige Rückleitung. Anmeldung im ursprünglichen Browser abschließen.');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
        reply.writeHead(400);
        reply.end('Ungültige Anmeldung.');
        return;
      }
      busy = true;
      try {
        const token = await this.transport(this.origin + '/api/auth/token', {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
          signal: AbortSignal.timeout(15000),
        });
        if (!token.ok) throw new Error();
        const session = sessionSchema.parse(await token.json());
        if (Date.parse(session.expiresAt) <= Date.now()) throw new Error();
        if (generation !== this.generation) throw new Error();
        await this.save(session, () => generation === this.generation);
        this.outcome = 'connected';
        reply.end(
          'Mit hinterfragen.online verbunden. Du kannst dieses Fenster schließen und zu Codex zurückkehren. YouTube-Veröffentlichungen wurden damit nicht autorisiert.',
        );
      } catch {
        this.outcome = 'failed';
        reply.writeHead(401);
        reply.end('Anmeldung konnte nicht abgeschlossen werden. In Codex erneut verbinden.');
      } finally {
        this.close();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    server.unref();
    redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const url = new URL(this.origin + '/api/auth/authorize');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('state', state);
    this.authorizationUrl = url.href;
    this.outcome = 'pending';
    this.timer = setTimeout(() => {
      this.close();
      this.outcome = 'expired';
    }, 600000);
    this.timer.unref();
    this.open(url.href);
    return {
      loginStatus: 'pending',
      authorizationUrl: url.href,
      note: 'Im normalen Browser mit Google anmelden. Danach tgr_get_auth_status aufrufen. Zugangsdaten niemals in den Chat kopieren.',
    };
  }
}
