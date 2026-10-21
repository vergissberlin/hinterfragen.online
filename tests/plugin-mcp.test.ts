import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, cp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('startet das ausgelieferte Paket ohne Repository, node_modules oder Modellschlüssel per echtem STDIO', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tgr-package-'));
  const packageRoot = join(dir, 'plugin');
  await cp(resolve('plugins/tokens-gegen-rechts'), packageRoot, {
    recursive: true,
    filter: (source) => !source.endsWith('/src'),
  });
  await mkdir(join(dir, 'home'));
  const client = new Client({ name: 'package-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, 'runtime/server.mjs')],
    cwd: dir,
    env: { HOME: join(dir, 'home'), PATH: process.env.PATH ?? '' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(9);
    const settings = await client.callTool({ name: 'tgr_get_settings', arguments: {} });
    expect(settings.isError).not.toBe(true);
    expect(settings.structuredContent).toMatchObject({
      result: { submitResults: true, publicationMode: 'approve' },
    });
    const patch = await client.callTool({
      name: 'tgr_update_settings',
      arguments: { submitResults: false },
    });
    expect(patch.isError).not.toBe(true);
    expect(
      await readFile(join(dir, 'home/.config/tokens-gegen-rechts/settings.json'), 'utf8'),
    ).toContain('"submitResults":false');
    const run = await client.callTool({
      name: 'tgr_start_run',
      arguments: { input: 'Thema', browserAvailable: false },
    });
    expect(run.isError).toBe(true);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
