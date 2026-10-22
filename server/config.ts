import { loadEnvFile } from 'node:process';
try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
import { z } from 'zod';
export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(32),
  AGENT_TOKEN: z.string().min(32),
  PUBLIC_ORIGIN: z
    .url()
    .refine(
      (value) => new URL(value).origin === value,
      'Origin ohne Pfad oder abschließenden Slash erforderlich',
    )
    .default('http://localhost:4321'),
  DATA_DIR: z.string().default('.runtime/data'),
  YOUTUBE_API_KEY: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GOOGLE_PILOT_EMAILS: z.string().default(''),
  CONTRIBUTION_REVIEW_ENABLED: z.enum(['true', 'false']).default('false'),
  CONTRIBUTION_REVIEW_PROMPT_SHA256: z.string().default(''),
  CONTRIBUTION_REVIEW_CALIBRATION_PATH: z.string().default('config/contribution-calibration.json'),
  REVIEW_SOURCE_ORIGINS: z.string().default(''),
  AUTO_PUBLISH: z.enum(['true', 'false']).default('false'),
  CALIBRATION_PATH: z.string().default('config/calibration.json'),
  MODEL_SHA256: z.string().default(''),
  PROMPT_SHA256: z.string().default(''),
  CLOUDFLARE_ZONE_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
  LIVE_MODE: z.enum(['true', 'false']).default('false'),
});
export type Config = z.infer<typeof envSchema>;
export function getConfig() {
  const config = envSchema.parse(process.env);
  if (config.ADMIN_TOKEN === config.AGENT_TOKEN)
    throw new Error('Admin- und Agent-Token müssen verschieden sein.');
  if (
    config.LIVE_MODE === 'true' &&
    (!config.CLOUDFLARE_ZONE_ID ||
      !config.CLOUDFLARE_API_TOKEN ||
      !config.YOUTUBE_API_KEY ||
      !config.PUBLIC_ORIGIN.startsWith('https://'))
  )
    throw new Error('Livebetrieb benötigt HTTPS, YouTube und CDN-Invalidierung.');
  return config;
}
