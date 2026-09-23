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
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
