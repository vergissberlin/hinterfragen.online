import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const hosts = new Set(['yt3.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com']);
export async function cacheAvatar(
  source: string | undefined,
  directory: string,
  now = Date.now(),
): Promise<string | undefined> {
  if (!source) return;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname)
  )
    return;
  const hash = createHash('sha256').update(url.href).digest('hex').slice(0, 32),
    folder = resolve(directory, 'avatars');
  for (const extension of ['jpg', 'png', 'webp']) {
    try {
      const file = await stat(resolve(folder, hash + '.' + extension));
      if (now - file.mtimeMs < 86400000) return '/data/avatars/' + hash + '.' + extension;
    } catch {}
  }
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4000) });
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length') || 0) > 131072
    )
      return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 131072) {
          await reader.cancel();
          return;
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const extension = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      ? 'jpg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          ? 'webp'
          : undefined;
    if (!extension) return;
    await mkdir(folder, { recursive: true });
    const file = resolve(folder, hash + '.' + extension),
      temp = file + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temp, bytes, { mode: 0o644 });
    await rename(temp, file);
    return '/data/avatars/' + hash + '.' + extension;
  } catch {
    return;
  }
}
export async function cleanAvatars(directory: string, now = Date.now()) {
  const folder = resolve(directory, 'avatars');
  let files: string[];
  try {
    files = await readdir(folder);
  } catch {
    return;
  }
  for (const file of files) {
    const path = resolve(folder, file);
    if ((await stat(path)).mtimeMs < now - 30 * 86400000) await unlink(path);
  }
}
