import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('plugins/tokens-gegen-rechts');
await mkdir(resolve(root, 'runtime'), { recursive: true });
const result = await build({
  entryPoints: [resolve(root, 'src/server.ts')],
  outfile: resolve(root, 'runtime/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.12',
  legalComments: 'eof',
  minify: true,
  metafile: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
await copyFile('LICENSE', resolve(root, 'LICENSE'));
const packages = new Set<string>();
for (const path of Object.keys(result.metafile!.inputs)) {
  const marker = path.lastIndexOf('node_modules/');
  if (marker < 0) continue;
  const parts = path.slice(marker + 13).split('/');
  packages.add(
    path.slice(0, marker + 13) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/'),
  );
}
const notices: string[] = [];
for (const path of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
  notices.push(`\n${metadata.name}@${metadata.version} (${metadata.license ?? 'see below'})\n`);
  const licenses = (await readdir(path)).filter((name) =>
    /^(license|copying|notice)(\.|$)/i.test(name),
  );
  if (!licenses.length) throw new Error(`Missing third-party license: ${metadata.name}`);
  for (const file of licenses) notices.push(await readFile(resolve(path, file), 'utf8'));
}
await writeFile(resolve(root, 'runtime/NOTICE.txt'), notices.join('\n'));
console.log('Eigenständiges Plugin gebaut.');
