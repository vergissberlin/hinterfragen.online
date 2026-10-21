import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { cacheAvatar } from '../server/avatars.ts';
afterEach(() => vi.unstubAllGlobals());
it('liefert ausschließlich geprüfte Rasterbilder über lokale Pfade und nutzt den Cache', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'hf-avatar-'));
  try {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await cacheAvatar('http://127.0.0.1/private', dir)).toBeUndefined();
    expect(await cacheAvatar('https://evil.example/avatar', dir)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    const path = await cacheAvatar('https://yt3.ggpht.com/avatar', dir);
    expect(path).toMatch(/^\/data\/avatars\/[a-f0-9]{32}\.png$/);
    expect(await readFile(resolve(dir, path!.replace('/data/', '')))).toEqual(png);
    expect(await cacheAvatar('https://yt3.ggpht.com/avatar', dir)).toBe(path);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('weist SVG und übergroße Bildantworten zurück', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'hf-avatar-'));
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('<svg onload="alert(1)"></svg>')),
    );
    expect(await cacheAvatar('https://yt3.ggpht.com/svg', dir)).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response('', { headers: { 'content-length': '9999999' } }),
        ),
    );
    expect(await cacheAvatar('https://yt3.ggpht.com/huge', dir)).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
