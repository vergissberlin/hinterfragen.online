import { test, expect } from '@playwright/test';
test('Fragen auswählen, bearbeiten und lokal filtern', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('#catalog-notice')).toContainText('erfunden');
  await expect(page.locator('#post-content')).toBeVisible();
  await page.getByRole('button', { name: 'Themen wählen' }).click();
  await page.getByLabel('Demokratie', { exact: true }).uncheck();
  await page.getByLabel('Minderheitenfeindlichkeit', { exact: true }).uncheck();
  await expect(page.locator('#post-topic')).toHaveText('Frauenfeindlichkeit');
  await page.reload();
  await expect(page.locator('#post-topic')).toHaveText('Frauenfeindlichkeit');
  await page.getByRole('button', { name: 'Das hinterfrage ich' }).click();
  await expect(page.locator('.question-option')).toHaveCount(3);
  await page.locator('#question-editor').fill('Welche Belege würden deine Meinung ändern?');
  await page.getByRole('button', { name: 'Frage kopieren' }).click();
  await expect(page.locator('#feedback')).toContainText('kopiert');
  await expect(page.locator('#local-count')).toHaveText('1');
  await expect(page.locator('#original-link')).toBeHidden();
  await expect(page.locator('#youtube-publish')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('Tastatur und nächste Karte', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#post-content')).toBeVisible();
  const title = await page.locator('#post-title').textContent();
  await page.locator('#beitrag').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#post-title')).not.toHaveText(title!);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#question-panel')).toBeVisible();
});
test('WebMCP ist progressiv und schreibt keine Kommentare', async ({ page }) => {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {};
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool(tool: { name: string }) {
          tools[tool.name] = tool;
        },
      },
    });
    Object.defineProperty(window, '__tools', { value: tools });
  });
  await page.goto('/');
  await expect(page.locator('#webmcp-status')).toContainText('verfügbar');
  await expect(page.locator('#post-content')).toBeVisible();
  const result = await page.evaluate(() => {
    const tools = (
      window as unknown as { __tools: Record<string, { execute: (input: unknown) => unknown }> }
    ).__tools;
    return tools.prepare_question.execute({ text: 'Wie kommst du zu dieser Einschätzung?' });
  });
  expect(result).toMatchObject({ status: 'draft', publicationRequiresUserApproval: true });
  await expect(page.locator('#question-editor')).toHaveValue(
    'Wie kommst du zu dieser Einschätzung?',
  );
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((r) => r.name.includes('accounts.google.com')),
    ),
  ).toBe(false);
});

test('native Touch-Gesten wechseln den Beitrag und öffnen Fragen', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#post-content')).toBeVisible();
  await page.locator('#beitrag').scrollIntoViewIfNeeded();
  const session = await context.newCDPSession(page);
  async function swipe(direction: 'left' | 'right') {
    const card = await page.locator('#beitrag').boundingBox();
    if (!card) throw new Error('Karte fehlt');
    const y = Math.max(50, card.y + 90);
    const from = card.x + card.width * (direction === 'left' ? 0.8 : 0.2);
    const to = card.x + card.width * (direction === 'left' ? 0.2 : 0.8);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: (from + to) / 2, y }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: to, y }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const before = await page.locator('#post-title').textContent();
  await swipe('left');
  await expect(page.locator('#post-title')).not.toHaveText(before!);
  await swipe('right');
  await expect(page.locator('#question-panel')).toBeVisible();
  await session.detach();
});
