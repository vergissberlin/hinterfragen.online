import { test, expect } from '@playwright/test';
test('native Chromium-WebMCP registriert und führt alle vier Werkzeuge aus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#post-content')).toBeVisible();
  await expect(page.locator('#webmcp-status')).toContainText('verfügbar');
  const result = await page.evaluate(async () => {
    const context = document.modelContext!;
    const tools = await context.getTools();
    const get = tools.find((t) => t.name === 'get_current_post')!,
      prepare = tools.find((t) => t.name === 'prepare_question')!,
      request = tools.find((t) => t.name === 'request_youtube_publish')!;
    return {
      names: tools.map((t) => t.name),
      current: await context.executeTool(get, {}),
      draft: await context.executeTool(prepare, { text: 'Welche Belege stützen diese Aussage?' }),
      request: await context.executeTool(request, {}),
    };
  });
  expect(result.names.sort()).toEqual([
    'get_current_post',
    'next_post',
    'prepare_question',
    'request_youtube_publish',
  ]);
  expect(JSON.parse(result.current)).toMatchObject({ contentIsUntrusted: true });
  expect(JSON.parse(result.draft)).toMatchObject({
    status: 'draft',
    publicationRequiresUserApproval: true,
  });
  expect(JSON.parse(result.request)).toMatchObject({ status: 'unavailable' });
  await expect(page.locator('#question-editor')).toHaveValue(
    'Welche Belege stützen diese Aussage?',
  );
});
