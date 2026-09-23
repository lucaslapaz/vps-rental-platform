import { container } from 'tsyringe';
import { createApp } from '../../src/server/app.ts';
import { type Env, loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import type { Clock } from '../../src/server/utils/clock.ts';
import { createLogger } from '../../src/server/utils/logger.ts';

/** App Express isolado para testes: container filho, então cada teste pode trocar dependências sem vazar estado. */
export function createTestApp(overrides: { env?: Partial<Env>; clock?: Clock } = {}) {
  const env = { ...loadEnv(), ...overrides.env };
  const di = registerDependencies(
    { env, logger: createLogger(env), ...(overrides.clock ? { clock: overrides.clock } : {}) },
    container.createChildContainer(),
  );
  return { app: createApp(di), di, env };
}
