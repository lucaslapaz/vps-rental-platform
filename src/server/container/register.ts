import { container, type DependencyContainer } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { type Clock, systemClock } from '../utils/clock.ts';
import type { Logger } from '../utils/logger.ts';
import { TOKENS } from './tokens.ts';

export interface RegisterOptions {
  env: Env;
  logger: Logger;
  clock?: Clock;
}

/**
 * Registra as instâncias de infraestrutura. Recebe um container para permitir que os testes usem
 * `container.createChildContainer()` e troquem implementações.
 */
export function registerDependencies({ env, logger, clock = systemClock }: RegisterOptions, target: DependencyContainer = container) {
  target.registerInstance(TOKENS.Env, env);
  target.registerInstance(TOKENS.Logger, logger);
  target.registerInstance(TOKENS.Clock, clock);
  return target;
}
