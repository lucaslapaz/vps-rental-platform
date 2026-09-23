import { container, type DependencyContainer, Lifecycle } from 'tsyringe';
import type { Env } from '../config/env.ts';
import type { Database } from '../db/prisma.ts';
import { FakePaymentGateway } from '../integrations/payment/FakePaymentGateway.ts';
import { ProxmoxClient } from '../integrations/proxmox/ProxmoxClient.ts';
import { QemuCloudInitProvider } from '../integrations/proxmox/QemuCloudInitProvider.ts';
import { TaskWaiter } from '../integrations/proxmox/TaskWaiter.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { RealtimeHub } from '../realtime/RealtimeEmitter.ts';
import { type Clock, systemClock } from '../utils/clock.ts';
import type { Logger } from '../utils/logger.ts';
import { SecretBox } from '../utils/secretBox.ts';
import { TOKENS } from './tokens.ts';

export interface RegisterOptions {
  env: Env;
  logger: Logger;
  prisma: Database;
  clock?: Clock;
  /** Os testes passam um provider falso; em produção é o Proxmox de verdade. */
  virtualization?: VirtualizationProvider;
}

/**
 * Registra as instâncias de infraestrutura (singletons do processo). Recebe um container para permitir que os testes
 * usem `container.createChildContainer()` e troquem implementações.
 */
export function registerDependencies(
  { env, logger, prisma, clock = systemClock, virtualization }: RegisterOptions,
  target: DependencyContainer = container,
) {
  target.registerInstance(TOKENS.Env, env);
  target.registerInstance(TOKENS.Logger, logger);
  target.registerInstance(TOKENS.Prisma, prisma);
  target.registerInstance(TOKENS.Clock, clock);
  target.registerInstance(TOKENS.SecretBox, new SecretBox(env.JOB_SECRET_KEY));
  target.registerInstance(TOKENS.Realtime, new RealtimeHub());
  // Pagamento SIMULADO (plano §12): um gateway real seria outra implementação da mesma interface.
  target.register(TOKENS.PaymentGateway, { useClass: FakePaymentGateway }, { lifecycle: Lifecycle.ContainerScoped });
  if (virtualization) {
    target.registerInstance(TOKENS.VirtualizationProvider, virtualization);
  } else {
    // Um único cliente (e um único pool de conexões TLS) até o Proxmox por processo.
    target.register(ProxmoxClient, { useClass: ProxmoxClient }, { lifecycle: Lifecycle.ContainerScoped });
    target.register(TaskWaiter, { useClass: TaskWaiter }, { lifecycle: Lifecycle.ContainerScoped });
    target.register(TOKENS.VirtualizationProvider, { useClass: QemuCloudInitProvider }, { lifecycle: Lifecycle.ContainerScoped });
  }
  return target;
}
