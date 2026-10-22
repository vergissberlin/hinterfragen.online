import { z } from 'zod';
import {
  contributionSchema,
  publicSourceSchema,
  type Contribution,
} from '../shared/contributions.ts';
const transcriptSchema = z
  .object({
    videoId: z.string(),
    language: z.literal('de'),
    transcript: z.string().min(1).max(120000),
    segments: z
      .array(
        z
          .object({ startSeconds: z.number().nonnegative(), text: z.string().min(1).max(6000) })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();
/** Only operator-selected authoritative JSON transcript origins, never arbitrary submitted URLs. */
export async function independentTranscript(
  raw: Contribution,
  origins: string[],
  transport: typeof fetch = fetch,
) {
  const input = contributionSchema.parse(raw);
  for (const source of input.sources) {
    if (
      !publicSourceSchema.safeParse(source.url).success ||
      !origins.includes(new URL(source.url).origin)
    )
      continue;
    try {
      const response = await transport(source.url, {
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000),
      });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('application/json') ||
        !response.body
      )
        continue;
      const reader = response.body.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 512000) throw new Error('source_too_large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const transcript = transcriptSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (
        transcript.videoId !== input.videoId ||
        !transcript.transcript.includes(input.evidence.quote) ||
        !transcript.segments.some(
          (s) =>
            Math.floor(s.startSeconds) === input.evidence.startSeconds &&
            s.text.includes(input.evidence.quote),
        )
      )
        continue;
      // A self-asserted quotation or client-supplied transcript is never an independent source.
      return { transcript: transcript.transcript, url: source.url };
    } catch {
      /* Do not expose source text or URLs to public action logs. */
    }
  }
  return undefined;
}
