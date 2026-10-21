import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { research } from '../plugin-fixtures.ts';
test('Redaktion zeigt ungeprüfte Einreichungen als Text und verlangt eigene Kontextprüfung', async ({
  page,
}) => {
  const submitted = research({ title: '<img src=x onerror=alert(1)>', contextComplete: true });
  let adoption: Record<string, unknown> | undefined;
  await page.route('**/internal/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/internal/editor')
      return route.fulfill({
        contentType: 'text/html',
        body: await readFile('server/editor.html', 'utf8'),
      });
    if (path === '/internal/status')
      return route.fulfill({ json: { attackMode: false, publicationPaused: true } });
    if (path === '/internal/candidates') return route.fulfill({ json: [] });
    if (path === '/internal/contributions')
      return route.fulfill({
        json: {
          contributions: [
            {
              id: submitted.submissionId,
              video_id: submitted.videoId,
              status: 'review',
              body: submitted,
            },
          ],
        },
      });
    if (path === '/internal/contributions/adopt') {
      adoption = route.request().postDataJSON();
      return route.fulfill({ json: { adopted: true, published: false } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/internal/editor');
  await page.locator('#token').fill('synthetic-admin-key');
  await page.getByRole('button', { name: 'Verbinden / Aktualisieren' }).click();
  await expect(page.locator('#contributions h3')).toHaveText(submitted.title);
  await expect(page.locator('#contributions img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Prüfen', exact: true }).click();
  await page.getByRole('button', { name: 'Als Redaktionsentwurf übernehmen' }).click();
  expect(adoption).toBeUndefined();
  await expect(page.locator('#message')).toContainText('Quellenprüfung');
  await page.locator('#contribution-verified').check();
  await page.getByRole('button', { name: 'Als Redaktionsentwurf übernehmen' }).click();
  await expect(page.locator('#message')).toContainText('"published":false');
  expect(adoption).toMatchObject({
    id: submitted.submissionId,
    contextVerified: true,
    candidate: { contextSource: 'editorial', videoId: submitted.videoId },
  });
});
