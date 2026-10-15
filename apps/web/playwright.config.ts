import { defineConfig } from '@playwright/test';

const API = 4318;
const WEB = 5174;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers: 1, // one shared server and database
  use: { baseURL: `http://127.0.0.1:${WEB}`, trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @owl/server exec tsx e2e/server.ts', port: API, reuseExistingServer: false, env: { OWL_PORT: String(API) } },
    {
      command: 'pnpm exec vite',
      port: WEB,
      reuseExistingServer: false,
      env: { OWL_PORT: String(API), OWL_WEB_PORT: String(WEB) },
    },
  ],
});
