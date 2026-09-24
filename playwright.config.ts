import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * E2E dos fluxos principais (plano §18) contra o `e2e/server.ts`: app completo com o provider falso e o banco de
 * teste. Rode com `npm run test:e2e` (faz o build do cliente antes). Não rode junto com o `npm test`: os dois usam o
 * banco de teste e o worker do E2E processaria os jobs dos testes de integração.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run e2e:server',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
