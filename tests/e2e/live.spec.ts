import { test, expect, type Page } from '@playwright/test';
import { demoCatalog } from '../../src/lib/demo.ts';
const post = {
  ...demoCatalog.posts[0],
  id: '7fc54a41-b7d0-4b77-a15c-cc81c5070d02',
  demo: false,
  videoId: 'abcdefghijk',
  channelId: 'UC' + 'x'.repeat(22),
  checkedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7200000).toISOString(),
};
async function mockPost(page: Page) {
  await page.route('**/api/commenting-status?*', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        videoId: post.videoId,
        evidenceQuote: post.evidence.quote,
        targetKey: 'video:' + post.videoId,
      },
    }),
  );
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({
      json: { version: 1, generatedAt: new Date().toISOString(), demo: false, posts: [post] },
    }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({ status: 202, json: { accepted: true } }),
  );
}
async function connect(page: Page) {
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'fake-test-token',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.force-ssl'})}),hasGrantedAllScopes:()=>true,revoke:(_token,cb)=>cb()}}};`,
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Das hinterfrage ich' }).click();
  await page.locator('#question-editor').fill('Welche Belege gibt es dafür?');
  await page.getByRole('button', { name: 'Mit YouTube veröffentlichen' }).click();
  await expect(page.locator('#publish-preview')).toHaveText('Welche Belege gibt es dafür?');
  await page.getByRole('button', { name: 'YouTube verbinden', exact: true }).click();
  await expect(page.locator('#publish-state')).toContainText('Google geladen');
  await page.getByRole('button', { name: 'YouTube verbinden', exact: true }).click();
  await expect(page.locator('#publish-approve')).toBeEnabled();
}
test('Katalogausfall erhält Erklärung und Drucklinks', async ({ page }) => {
  await page.route('**/data/catalog.json', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#empty-message')).toContainText('nicht erreichbar');
  await expect(page.locator('#retry-catalog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'A4 · 6 Karten' })).toBeVisible();
});
test('leerer Katalog und abgelaufene Beiträge werden nicht angeboten', async ({ page }) => {
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        generatedAt: new Date().toISOString(),
        demo: false,
        posts: [{ ...post, expiresAt: '2020-01-01T00:00:00.000Z' }],
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('#empty-message')).toContainText('kein geprüfter Beitrag');
  await expect(page.locator('#post-content')).toBeHidden();
});
test('Trackingausfall blockiert Original-Link nicht', async ({ page }) => {
  await mockPost(page);
  await page.route('**/api/events', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Das hinterfrage ich' }).click();
  await expect(page.locator('#original-link')).toHaveAttribute(
    'href',
    /youtube.com\/watch\?v=abcdefghijk/,
  );
  await expect(page.locator('#original-link')).toHaveAttribute('target', '_blank');
});
test('veröffentlicht erst nach Kontoautorisierung und persönlichem Klick, ohne Tokens zu speichern', async ({
  page,
}) => {
  await mockPost(page);
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  const sent: unknown[] = [];
  await page.route('https://www.googleapis.com/youtube/v3/commentThreads?*', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 'fake-comment' } });
  });
  await connect(page);
  expect(sent).toHaveLength(0);
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('angenommen');
  expect(sent).toEqual([
    {
      snippet: {
        channelId: post.channelId,
        videoId: post.videoId,
        topLevelComment: { snippet: { textOriginal: 'Welche Belege gibt es dafür?' } },
      },
    },
  ]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fake-test-token');
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Mit YouTube veröffentlichen' }).click();
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('bereits versucht');
  expect(sent).toHaveLength(1);
});
test('Angriffsmodus und widerrufener Beitrag verhindern API-Versand', async ({ page }) => {
  await mockPost(page);
  let sent = 0;
  await page.route('https://www.googleapis.com/youtube/v3/commentThreads?*', (route) => {
    sent++;
    return route.fulfill({ json: { id: 'not-expected' } });
  });
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: false, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  await connect(page);
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('pausiert');
  expect(sent).toBe(0);
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({
      json: { version: 1, generatedAt: new Date().toISOString(), demo: false, posts: [] },
    }),
  );
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('nicht mehr aktuell');
  expect(sent).toBe(0);
});
test('unsicherer Versand wird nicht automatisch wiederholt', async ({ page }) => {
  await mockPost(page);
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  let attempts = 0;
  await page.route('https://www.googleapis.com/youtube/v3/commentThreads?*', (route) => {
    attempts++;
    return route.abort();
  });
  await connect(page);
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('unklar');
  expect(attempts).toBe(1);
});

test('Backendausfall verhindert direkten YouTube-Versand', async ({ page }) => {
  await mockPost(page);
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  await page.route('**/api/commenting-status?*', (route) =>
    route.fulfill({ status: 503, json: { enabled: false } }),
  );
  let attempts = 0;
  await page.route('https://www.googleapis.com/youtube/v3/commentThreads?*', (route) => {
    attempts++;
    return route.fulfill({ json: { id: 'unexpected' } });
  });
  await connect(page);
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('Es wurde nichts gesendet');
  expect(attempts).toBe(0);
});

test('Beitrag ist vor der Frageauswahl über Titel und Original-Link erreichbar', async ({
  page,
}) => {
  await mockPost(page);
  await page.goto('/');
  await expect(page.locator('#post-content')).toBeVisible();
  await expect(page.locator('#question-panel')).toBeHidden();
  for (const id of ['post-title-link', 'post-original']) {
    await expect(page.locator('#' + id)).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abcdefghijk&t=42s',
    );
    await expect(page.locator('#' + id)).toHaveAttribute('target', '_blank');
  }
});

test('zeigt Kommentarautor und verlinkt sowie beantwortet genau den ausgewählten Kommentar', async ({
  page,
}) => {
  await mockPost(page);
  const reply = {
    ...post,
    target: { type: 'comment', commentId: 'comment-12345' },
    author: {
      name: 'Kommentarautorin',
      avatarUrl: '/avatars/demo-person.svg',
      profileUrl: 'https://www.youtube.com/channel/UC' + 'z'.repeat(22),
    },
  };
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({
      json: { version: 1, generatedAt: new Date().toISOString(), demo: false, posts: [reply] },
    }),
  );
  await page.route('**/api/commenting-status?*', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        videoId: post.videoId,
        evidenceQuote: post.evidence.quote,
        targetKey: 'comment:comment-12345',
      },
    }),
  );
  await page.route('**/data/runtime.json', (route) =>
    route.fulfill({
      json: { commentingEnabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() },
    }),
  );
  const sent: unknown[] = [];
  await page.route('https://www.googleapis.com/youtube/v3/comments?*', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 'test-reply' } });
  });
  await connect(page);
  await expect(page.locator('#post-author-label')).toHaveText('Kommentar von');
  await expect(page.locator('#post-author-name')).toHaveText('Kommentarautorin');
  await expect(page.locator('#post-author-avatar')).toHaveAttribute(
    'src',
    '/avatars/demo-person.svg',
  );
  await expect(page.locator('#post-original')).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=abcdefghijk&lc=comment-12345',
  );
  await expect(page.locator('#publish-target')).toContainText(
    'Antwort auf einen Kommentar von Kommentarautorin',
  );
  await page.locator('#publish-approve').click();
  await expect(page.locator('#publish-state')).toContainText('angenommen');
  expect(sent).toEqual([
    { snippet: { parentId: 'comment-12345', textOriginal: 'Welche Belege gibt es dafür?' } },
  ]);
});
test('Avatar-Ausfall behält den Namen und zeigt ein lokales Ersatzbild', async ({ page }) => {
  await mockPost(page);
  const withMissingAvatar = {
    ...post,
    author: { name: 'Kanalname', avatarUrl: '/data/avatars/' + 'a'.repeat(32) + '.jpg' },
  };
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        generatedAt: new Date().toISOString(),
        demo: false,
        posts: [withMissingAvatar],
      },
    }),
  );
  await page.route('**/data/avatars/*', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.locator('#post-author-name')).toHaveText('Kanalname');
  await expect(page.locator('#post-author-avatar')).toHaveAttribute(
    'src',
    '/avatars/placeholder.svg',
  );
});
