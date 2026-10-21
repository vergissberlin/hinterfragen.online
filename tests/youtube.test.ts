import { afterEach, describe, it, expect, vi } from 'vitest';
import { checkVideo, commentSample, discover, YoutubeError } from '../server/youtube.ts';
const id = 'abcdefghijk',
  snippet = {
    title: 'Synthetisches Testvideo',
    channelTitle: 'Test',
    channelId: 'UC' + 'x'.repeat(22),
  };
afterEach(() => vi.unstubAllGlobals());
describe('YouTube-Adapter', () => {
  it('prüft öffentliche Videos auch dann auf Kommentare, wenn noch keine existieren', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: [{ snippet, status: { privacyStatus: 'public' } }] }),
      )
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    expect(await checkVideo(id, 'test-key')).toMatchObject({
      available: true,
      video: { videoId: id },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('sperrt gelöschte/private Videos und deaktivierte Kommentare', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ items: [] })));
    expect(await checkVideo(id, 'test-key')).toEqual({ available: false });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ items: [{ snippet, status: { privacyStatus: 'private' } }] }),
        ),
    );
    expect(await checkVideo(id, 'test-key')).toEqual({ available: false });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ items: [{ snippet, status: { privacyStatus: 'public' } }] }),
        )
        .mockResolvedValueOnce(
          Response.json({ error: { errors: [{ reason: 'commentsDisabled' }] } }, { status: 403 }),
        ),
    );
    expect(await checkVideo(id, 'test-key')).toEqual({ available: false });
  });
  it('behandelt Quotenfehler als unbestätigte Verfügbarkeit und gibt keine Schlüssel aus', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }),
        ),
    );
    await expect(checkVideo(id, 'private-test-key')).rejects.toMatchObject({
      code: 'quotaExceeded',
      message: 'quotaExceeded',
    });
    await expect(checkVideo(id, '')).rejects.toBeInstanceOf(YoutubeError);
  });
  it('begrenzt Recherche und Kommentarstichprobe, ohne Nutzernamen zu übernehmen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ items: [{ id: { videoId: id }, snippet }] })),
    );
    expect(await discover('test-key', ['Thema'], 1)).toHaveLength(1);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json({
          items: Array.from({ length: 20 }, (_, i) => ({
            snippet: {
              topLevelComment: {
                snippet: {
                  textOriginal: String(i) + 'x'.repeat(1000),
                  authorDisplayName: 'DO NOT STORE',
                },
              },
            },
          })),
        }),
      ),
    );
    const sample = await commentSample(id, 'test-key');
    expect(sample.join('').length).toBeLessThanOrEqual(6000);
    expect(sample.join('')).not.toContain('DO NOT STORE');
  });
});
