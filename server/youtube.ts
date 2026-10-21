import { z } from 'zod';
const snippetSchema = z.object({
  title: z.string(),
  channelTitle: z.string(),
  channelId: z.string(),
  defaultLanguage: z.string().optional(),
  defaultAudioLanguage: z.string().optional(),
});
export type Video = { videoId: string; title: string; channel: string; channelId: string };
export class YoutubeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function youtubeGet(path: string, parameters: Record<string, string>, apiKey: string) {
  if (!apiKey) throw new YoutubeError('notConfigured');
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...parameters, key: apiKey }).forEach(([k, v]) => url.searchParams.set(k, v));
  // Never log request URLs; API key is a query parameter required by YouTube.
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok)
    throw new YoutubeError(String(body.error?.errors?.[0]?.reason ?? 'upstreamFailure'));
  return body;
}
export async function checkVideo(
  videoId: string,
  key: string,
): Promise<{ available: boolean; checkedAt?: string; video?: Video }> {
  const body = await youtubeGet('videos', { part: 'snippet,status', id: videoId }, key);
  const item = body.items?.[0];
  if (!item || item.status?.privacyStatus !== 'public') return { available: false };
  const snippet = snippetSchema.parse(item.snippet);
  try {
    await youtubeGet('commentThreads', { part: 'id', videoId, maxResults: '1' }, key);
  } catch (error) {
    if (
      error instanceof YoutubeError &&
      ['commentsDisabled', 'videoNotFound', 'forbidden'].includes(error.code)
    )
      return { available: false };
    throw error;
  }
  return {
    available: true,
    checkedAt: new Date().toISOString(),
    video: {
      videoId,
      title: snippet.title,
      channel: snippet.channelTitle,
      channelId: snippet.channelId,
    },
  };
}
export async function discover(key: string, terms: string[], limit = 5): Promise<Video[]> {
  const videos = new Map<string, Video>();
  for (const term of terms) {
    const result = await youtubeGet(
      'search',
      {
        part: 'snippet',
        q: term,
        type: 'video',
        relevanceLanguage: 'de',
        regionCode: 'DE',
        order: 'date',
        maxResults: String(limit),
        publishedAfter: new Date(Date.now() - 7 * 86400000).toISOString(),
      },
      key,
    );
    for (const item of result.items ?? []) {
      if (!/^[\w-]{11}$/.test(item.id?.videoId ?? '')) continue;
      const snippet = snippetSchema.parse(item.snippet);
      videos.set(item.id.videoId, {
        videoId: item.id.videoId,
        title: snippet.title,
        channel: snippet.channelTitle,
        channelId: snippet.channelId,
      });
      if (videos.size >= limit) return [...videos.values()];
    }
  }
  return [...videos.values()];
}
export async function commentSample(videoId: string, key: string): Promise<string[]> {
  const texts: string[] = [];
  for (const order of ['time', 'relevance']) {
    const body = await youtubeGet(
      'commentThreads',
      { part: 'snippet', videoId, maxResults: '20', order, textFormat: 'plainText' },
      key,
    );
    for (const item of body.items ?? []) {
      const text = item.snippet?.topLevelComment?.snippet?.textOriginal;
      if (typeof text === 'string') texts.push(text.slice(0, 1500));
    }
  }
  const unique = [...new Set(texts)].slice(0, 30);
  let remaining = 6000;
  return unique
    .map((t) => {
      const excerpt = t.slice(0, Math.min(500, remaining));
      remaining -= excerpt.length;
      return excerpt;
    })
    .filter(Boolean);
}
