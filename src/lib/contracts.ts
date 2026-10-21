import { z } from 'zod';
export const topics = {
  democracy: 'Demokratie',
  women: 'Frauenfeindlichkeit',
  minorities: 'Minderheitenfeindlichkeit',
} as const;
export const topicSchema = z.enum(['democracy', 'women', 'minorities']);
export const tones = ['factual', 'provocative', 'snarky', 'emotional', 'aggressive'] as const;
// Phase 2 contract only. V1 never selects or generates non-factual variants.
export const profilePreferencesSchema = z.object({
  topics: z.array(topicSchema),
  questionTone: z.enum(tones).default('factual'),
});
export type ProfilePreferences = z.infer<typeof profilePreferencesSchema>;
const text = (max: number) => z.string().trim().min(1).max(max);
export const questionSchema = text(350).refine(
  (s) => s.endsWith('?'),
  'Eine Frage muss mit ? enden.',
);
export const evidenceSchema = z.object({
  quote: text(600),
  startSeconds: z.number().int().nonnegative(),
  context: text(4000),
});
export const candidateSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: text(200),
  channel: text(150),
  channelId: z.string().regex(/^UC[\w-]{22}$/),
  transcript: text(120000),
  contextSource: z.enum(['authorized_transcript', 'editorial']),
  sourceReference: text(1000),
  language: z.literal('de'),
  evidence: evidenceSchema,
});
export type Candidate = z.infer<typeof candidateSchema>;
export const analysisSchema = z
  .object({
    suitable: z.boolean(),
    publicActor: z.boolean(),
    publicActorReason: text(600),
    topic: topicSchema,
    summary: text(700),
    reasoning: text(1500),
    contextComplete: z.boolean(),
    satireOrCounterSpeech: z.boolean(),
    evidenceQuote: text(600),
    questions: z.array(questionSchema).length(3),
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const importSchema = z
  .object({
    runId: z.uuid(),
    candidate: candidateSchema,
    analysis: analysisSchema,
    modelDigest: z.string().regex(/^[a-f0-9]{64}$/),
    promptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type AgentImport = z.infer<typeof importSchema>;
export const publicPostSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  title: z.string(),
  channel: z.string(),
  channelId: z.string().optional(),
  topic: topicSchema,
  summary: z.string(),
  evidence: evidenceSchema,
  questions: z.array(questionSchema).length(3),
  checkedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  demo: z.boolean().default(false),
});
export type PublicPost = z.infer<typeof publicPostSchema>;
export const catalogSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  demo: z.boolean(),
  posts: z.array(publicPostSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
export const eventSchema = z
  .object({ postId: z.uuid(), type: z.enum(['original_open', 'question_copy']) })
  .strict();
export function selectPost(
  posts: PublicPost[],
  selected: string[],
  seen: string[],
  random = Math.random,
  now = Date.now(),
) {
  const eligible = posts.filter(
    (p) => Date.parse(p.expiresAt) > now && (!selected.length || selected.includes(p.topic)),
  );
  const unseen = eligible.filter((p) => !seen.includes(p.id));
  const pool = unseen.length ? unseen : eligible;
  return pool.length ? pool[Math.floor(random() * pool.length)] : undefined;
}
export function resolveTone(
  variants: Partial<Record<(typeof tones)[number], string[]>>,
  tone: (typeof tones)[number],
) {
  return {
    questions: variants[tone] ?? variants.factual ?? [],
    fallback: !variants[tone] && tone !== 'factual',
  };
}
