import { it, expect, vi } from 'vitest';
import { independentTranscript } from '../scripts/review-source.ts';
import { research } from './plugin-fixtures.ts';
it('ruft nur vom Betreiber erlaubte Quellen ab und ignoriert selbst behauptete Belege', async () => {
  const input = research(),
    fetcher = vi.fn<typeof fetch>();
  expect(await independentTranscript(input, [], fetcher)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});
it('verlangt Videozuordnung und exaktes Zitat im unabhängig abgerufenen Transkript', async () => {
  const input = research({
    sources: [{ url: 'https://transcripts.example.org/video.json', title: 'Autorisierte Quelle' }],
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        videoId: input.videoId,
        language: 'de',
        transcript: input.contextText,
        segments: [{ startSeconds: input.evidence.startSeconds, text: input.evidence.quote }],
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  expect(
    await independentTranscript(input, ['https://transcripts.example.org'], fetcher),
  ).toMatchObject({
    transcript: input.contextText,
    url: input.sources[0].url,
  });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        videoId: 'wrong-video',
        language: 'de',
        transcript: input.contextText,
        segments: [{ startSeconds: input.evidence.startSeconds, text: input.evidence.quote }],
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  expect(
    await independentTranscript(input, ['https://transcripts.example.org'], fetcher),
  ).toBeUndefined();
});
it('bestätigt keine fehlende, übergroße oder weitergeleitete Quelle', async () => {
  const input = research({
    sources: [{ url: 'https://transcripts.example.org/video.json', title: 'Quelle' }],
  });
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('redirect'));
  expect(
    await independentTranscript(input, ['https://transcripts.example.org'], fetcher),
  ).toBeUndefined();
  fetcher.mockResolvedValue(
    new Response('x'.repeat(512001), { headers: { 'content-type': 'application/json' } }),
  );
  expect(
    await independentTranscript(input, ['https://transcripts.example.org'], fetcher),
  ).toBeUndefined();
});

it('verwirft eine echte Aussage mit abweichender Zeitmarke', async () => {
  const input = research({
    sources: [{ url: 'https://transcripts.example.org/video.json', title: 'Quelle' }],
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        videoId: input.videoId,
        language: 'de',
        transcript: input.contextText,
        segments: [{ startSeconds: input.evidence.startSeconds + 30, text: input.evidence.quote }],
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  expect(
    await independentTranscript(input, ['https://transcripts.example.org'], fetcher),
  ).toBeUndefined();
});
