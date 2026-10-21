import { sourceAuthorSchema, type SourceAuthor, type PostTarget } from '../src/lib/contracts.ts';
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

export type Verification = {
  available: boolean;
  checkedAt?: string;
  video?: Video;
  target?: PostTarget;
  author?: SourceAuthor;
};
export async function checkSource(
  videoId: string,
  target: PostTarget | undefined,
  key: string,
): Promise<Verification> {
  const video = await checkVideo(videoId, key);
  if (!video.available || !video.video) return { available: false };
  if (target?.type === 'comment') {
    let response;
    try {
      response = await youtubeGet(
        'comments',
        { part: 'snippet', id: target.commentId, textFormat: 'plainText' },
        key,
      );
    } catch (error) {
      if (
        error instanceof YoutubeError &&
        ['commentNotFound', 'videoNotFound', 'forbidden'].includes(error.code)
      )
        return { available: false };
      throw error;
    }
    const item = response.items?.find((c: { id: string }) => c.id === target.commentId),
      snippet = item?.snippet;
    if (
      !snippet ||
      snippet.videoId !== videoId ||
      snippet.parentId ||
      typeof snippet.textOriginal !== 'string'
    )
      return { available: false };
    // Edited comments require a fresh analysis. Never publish a stale quote as a new statement.
    if (target.text !== undefined && target.text !== snippet.textOriginal)
      return { available: false };
    const channelId = snippet.authorChannelId?.value;
    const author = sourceAuthorSchema.parse({
      name: snippet.authorDisplayName || 'Name nicht verfügbar',
      ...(typeof channelId === 'string' && /^UC[\w-]{22}$/.test(channelId) ? { channelId } : {}),
      ...(typeof snippet.authorProfileImageUrl === 'string'
        ? { avatarSourceUrl: snippet.authorProfileImageUrl }
        : {}),
    });
    return {
      ...video,
      target: { type: 'comment', commentId: target.commentId, text: snippet.textOriginal, author },
      author,
    };
  }
  const response = await youtubeGet(
    'channels',
    { part: 'snippet', id: video.video.channelId },
    key,
  );
  const snippet = response.items?.[0]?.snippet;
  const author = sourceAuthorSchema.parse({
    name: snippet?.title || video.video.channel,
    channelId: video.video.channelId,
    ...(snippet?.thumbnails?.default?.url
      ? { avatarSourceUrl: snippet.thumbnails.default.url }
      : {}),
  });
  return { ...video, author };
}
