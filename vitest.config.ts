import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Decorators legados do tsyringe. Sem emitDecoratorMetadata, de propósito: igual ao tsx em dev, então um
  // @inject(TOKEN) esquecido quebra os testes em vez de passar despercebido (plano §7).
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: false } },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
  test: {
    // Testes @lab (contra o Proxmox de verdade) só com LAB=1 (npm run test:lab); fora do npm test e do CI.
    include: process.env.LAB ? ['tests/lab/**/*.test.ts'] : ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: process.env.LAB ? [] : ['tests/lab/**', 'node_modules/**'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // Os testes de integração compartilham o banco de teste: arquivos em sequência evitam interferência.
    fileParallelism: false,
    // Cada cadastro/login faz um argon2id (64 MiB por hash). Com o Proxmox ligado o Windows fica com ~0,5 GB livres e,
    // sob pressão de memória, um teste de integração que levava <1 s passou de 5 s (padrão do Vitest). CLAUDE.md N35.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // npm run test:coverage: foco no servidor (regras de negócio, jobs, integrações). O cliente é coberto pelo E2E.
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/server/generated/**', 'src/server/main.ts'],
      reporter: ['text-summary', 'text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
