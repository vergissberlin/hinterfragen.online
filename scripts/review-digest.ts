import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promptDigest } from './inference.ts';
const hash = createHash('sha256').update(promptDigest);
for (const path of [
  './review-source.ts',
  './review-contributions.ts',
  '../server/contribution-review.ts',
  '../server/policy.ts',
  '../server/youtube.ts',
  '../shared/contributions.ts',
])
  hash.update(await readFile(new URL(path, import.meta.url)));
export const reviewDigest = hash.digest('hex');
