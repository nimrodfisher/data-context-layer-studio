import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const e2eWorkspace = mkdtempSync(path.join(tmpdir(), 'context-layer-e2e-'));

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  expect: {
    timeout: 15_000,
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'corepack pnpm --filter @context-layer/web dev',
    reuseExistingServer: false,
    url: 'http://localhost:3000',
    env: {
      ...process.env,
      CONTEXT_LAYER_WORKSPACE: e2eWorkspace,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
