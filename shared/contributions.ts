import { z } from 'zod';
import { analysisSchema, evidenceSchema } from '../src/lib/contracts.ts';

export const videoIdSchema = z.string().regex(/^[\w-]{11}$/);
export const channelIdSchema = z.string().regex(/^UC[\w-]{22}$/);
// These URLs are displayed as references, never fetched by the receiving server.
export const publicSourceSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(url.hostname) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
    );
  }, 'Öffentliche HTTPS-Quelle ohne Zugangsdaten erforderlich.');
export const contributionAnalysisSchema = analysisSchema
  .extend({
    questions: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(350)
          .refine((q) => q.endsWith('?')),
      )
      .length(3),
  })
  .strict();
export const contributionSchema = z
  .object({
    version: z.literal(1),
    submissionId: z.uuid(),
    videoId: videoIdSchema,
    title: z.string().trim().min(1).max(200),
    sources: z
      .array(
        z.object({ url: publicSourceSchema, title: z.string().trim().min(1).max(200) }).strict(),
      )
      .min(1)
      .max(20),
    evidence: evidenceSchema.strict(),
    contextText: z.string().trim().min(1).max(120000),
    contextComplete: z.boolean(),
    analysis: contributionAnalysisSchema,
    pluginVersion: z.literal('0.1.0'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.contextText.includes(value.evidence.quote) ||
      value.analysis.evidenceQuote !== value.evidence.quote
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Wörtlicher Beleg fehlt im Kontext.',
        path: ['evidence'],
      });
    if (new Set(value.analysis.questions.map((q) => q.toLocaleLowerCase('de'))).size !== 3)
      ctx.addIssue({
        code: 'custom',
        message: 'Drei verschiedene Fragen erforderlich.',
        path: ['analysis', 'questions'],
      });
  });
export type Contribution = z.infer<typeof contributionSchema>;
export const contributionReceiptSchema = z
  .object({
    submissionId: z.uuid(),
    status: z.enum(['review', 'rejected', 'adopted']),
    duplicate: z.boolean(),
  })
  .strict();
