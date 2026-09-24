/**
 * Servidor do E2E (plano §18): a aplicação inteira (API, Socket.IO, worker de jobs, SPA do `dist/client`) com o
 * PROVIDER FALSO no lugar do Proxmox e o banco de teste. Assim os fluxos de ponta a ponta (pedido → pagamento →
 * provisionamento → ações → chat) rodam em segundos e sem o laboratório. A integração real fica nos testes @lab.
 * Sobe pelo `webServer` do playwright.config.ts (NODE_ENV=test, porta 3100).
 */
import 'reflect-metadata';
import { loadEnv } from '../src/server/config/env.ts';
import { handleSignals, startServer } from '../src/server/server.ts';
import { FakeVirtualizationProvider } from '../tests/helpers/FakeVirtualizationProvider.ts';

const env = loadEnv();
if (env.NODE_ENV !== 'test' || !env.DATABASE_URL.includes('_test')) {
  throw new Error('O servidor do E2E só roda com NODE_ENV=test e o banco vps_platform_test');
}
const virtualization = new FakeVirtualizationProvider();
virtualization.memAvailableMb = 64 * 1024; // nó "grande": a capacidade não interfere nos roteiros
const { stop, logger } = await startServer({ env, virtualization, vite: false });
handleSignals(stop, logger);
