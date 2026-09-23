import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// O Vite roda dentro do servidor Express (middlewareMode) em dev; aqui fica só a configuração do cliente (plano §6).
export default defineConfig({
  root: fromRoot('./src/client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fromRoot('./src/client'),
      '@shared': fromRoot('./src/shared'),
    },
  },
  build: {
    outDir: fromRoot('./dist/client'),
    emptyOutDir: true,
    // Fontes nunca viram data: URI (subconjuntos pequenos cairiam no limite de 4 KiB): a CSP de produção é font-src 'self'.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
});
