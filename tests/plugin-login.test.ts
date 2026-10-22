import { it, expect, vi } from 'vitest';
import { GoogleLogin } from '../plugins/tokens-gegen-rechts/src/google-login.ts';
it('führt Google-Rückleitung lokal aus, bindet PKCE und hält Sitzungstokens aus Toolausgaben heraus', async () => {
  const secret = 'tgs_' + 'a'.repeat(43),
    save = vi.fn(),
    open = vi.fn();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ googleEnabled: true })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: secret,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ),
    );
  const login = new GoogleLogin('https://hinterfragen.online', transport, save, open);
  try {
    const started = await login.start();
    const url = new URL(started.authorizationUrl!);
    expect(open).toHaveBeenCalledWith(url.href);
    expect(JSON.stringify(started)).not.toContain(secret);
    const local = new URL(url.searchParams.get('redirect_uri')!);
    local.searchParams.set('code', 'b'.repeat(43));
    local.searchParams.set('state', 'wrong');
    expect((await fetch(local)).status).toBe(400);
    local.searchParams.set('state', 'ä'.repeat(43));
    expect((await fetch(local)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    local.searchParams.set('state', url.searchParams.get('state')!);
    expect((await fetch(local)).status).toBe(200);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: secret }),
      expect.any(Function),
    );
    expect(JSON.stringify(login.status())).not.toContain(secret);
    const exchange = JSON.parse(String(transport.mock.calls[1][1]?.body));
    expect(exchange.code_verifier).toHaveLength(43);
    expect(started.authorizationUrl).not.toContain(exchange.code_verifier);
    expect(login.status()).toEqual({ loginStatus: 'connected' });
  } finally {
    login.close();
  }
});
it('öffnet keinen Browser, wenn Google serverseitig nicht eingerichtet ist', async () => {
  const open = vi.fn(),
    transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ googleEnabled: false })));
  const login = new GoogleLogin('https://hinterfragen.online', transport, vi.fn(), open);
  await expect(login.start()).rejects.toThrow('nicht eingerichtet');
  expect(open).not.toHaveBeenCalled();
});

it('speichert nach Abmelden keine verspätete Tokenantwort', async () => {
  let release!: (response: Response) => void;
  const save = vi.fn();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ googleEnabled: true })))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
  const login = new GoogleLogin('https://hinterfragen.online', transport, save, vi.fn());
  const start = await login.start();
  const authorization = new URL(start.authorizationUrl!);
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('code', 'b'.repeat(43));
  callback.searchParams.set('state', authorization.searchParams.get('state')!);
  const result = fetch(callback);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  login.close();
  release(
    new Response(
      JSON.stringify({
        accessToken: 'tgs_' + 'a'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    ),
  );
  expect((await result).status).toBe(401);
  expect(save).not.toHaveBeenCalled();
});
