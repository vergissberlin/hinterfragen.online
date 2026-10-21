import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: 3,
  use: { baseURL: 'http://127.0.0.1:4325' },
  webServer: [
    {
      command: 'npm run dev:demo -- --ignore-lock --port 4325',
      url: 'http://127.0.0.1:4325',
      reuseExistingServer: false,
    },
    {
      command:
        'PUBLIC_DEMO_MODE=false PUBLIC_YOUTUBE_CLIENT_ID=test-client-id npm run dev -- --ignore-lock --port 4326',
      url: 'http://127.0.0.1:4326',
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'desktop',
      testIgnore: ['**/live.spec.ts', '**/native.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: ['**/live.spec.ts', '**/native.spec.ts'],
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'native-webmcp',
      testMatch: '**/native.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--enable-experimental-web-platform-features'] },
      },
    },
    {
      name: 'live',
      testMatch: '**/live.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4326' },
    },
  ],
});
