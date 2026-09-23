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
  },
});
