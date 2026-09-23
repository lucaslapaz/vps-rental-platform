import helmet from 'helmet';
import type { Env } from '../config/env.ts';

/**
 * Headers de segurança (plano §6 e §9.3). Em produção a CSP é estrita (`script-src 'self'`). Em desenvolvimento ela
 * aceita o que o Vite precisa: o script inline do React Refresh e o WebSocket do HMR.
 * `style-src 'unsafe-inline'`: componentes (ex.: toasts do sonner) injetam <style> em tempo de execução.
 */
export function securityHeaders(env: Env) {
  const dev = env.NODE_ENV === 'development';
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: dev ? ["'self'", 'ws:'] : ["'self'"],
        workerSrc: dev ? ["'self'", 'blob:'] : ["'self'"], // o cliente do Vite cria um worker via blob: em dev
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null, // o laboratório roda em HTTP
      },
    },
    strictTransportSecurity: false, // idem: sem HTTPS local
  });
}
