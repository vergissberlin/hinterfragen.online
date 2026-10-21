import { loadEnvFile } from 'node:process';
try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
if (process.env.LIVE_MODE === 'true') {
  for (const name of ['PUBLIC_OPERATOR_NAME', 'PUBLIC_OPERATOR_ADDRESS', 'PUBLIC_OPERATOR_EMAIL']) {
    if (!process.env[name]?.trim()) throw new Error(`Live-Build benötigt ${name}.`);
  }
  if (process.env.PUBLIC_DEMO_MODE === 'true')
    throw new Error('Live-Build darf keine Demo enthalten.');
}
