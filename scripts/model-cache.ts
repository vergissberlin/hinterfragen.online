import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { agentConfig, verifyModel } from './inference.ts';
export async function ensureModel(directory: string) {
  const path = resolve(directory, 'model.gguf');
  await mkdir(directory, { recursive: true });
  let downloaded = false;
  try {
    await stat(path);
  } catch {
    const c = agentConfig.model;
    const response = await fetch(
      `https://huggingface.co/${c.repository}/resolve/${c.revision}/${c.file}`,
      { signal: AbortSignal.timeout(300000) },
    );
    if (!response.ok || !response.body)
      throw new Error('Modell konnte nicht geladen werden. Lizenz/Zugriff prüfen.');
    try {
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(path + '.part'),
      );
      await verifyModel(path + '.part');
      await rename(path + '.part', path);
      downloaded = true;
    } finally {
      await rm(path + '.part', { force: true });
    }
  }
  await verifyModel(path);
  return { path, downloaded };
}
