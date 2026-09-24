import { inject, injectable } from 'tsyringe';
import { BUSY_STATUSES, type PowerActionName, VPS_TRANSITIONS, type VpsOperation } from '../../shared/constants/vps.ts';
import type { reinstallVpsSchema } from '../../shared/schemas/vps.ts';
import type { VpsDTO, VpsEventDTO, VpsStatusDTO } from '../../shared/types/catalog.ts';

type ReinstallInput = import('zod').output<typeof reinstallVpsSchema>;

import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { InputJsonValue } from '../generated/prisma/internal/prismaNamespace.ts';
import { JobQueue, type JobType } from '../jobs/JobQueue.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { CatalogRepository } from '../repositories/CatalogRepository.ts';
import { toVpsDTO, VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';
import type { SecretBox } from '../utils/secretBox.ts';
import { billingDurations } from './billingPeriods.ts';
import { CapacityService } from './CapacityService.ts';
import { OrderService, type ProvisionSecrets } from './OrderService.ts';
import { VpsNotifier } from './VpsNotifier.ts';

/**
 * Operações sobre uma VPS existente (plano §11.1 e §11.4). Cada uma faz a transição de estado com `updateMany`
 * (lock otimista: uma operação por vez) e enfileira o job NA MESMA TRANSAÇÃO (outbox). A resposta é 202: o resultado
 * chega pelo Socket.IO (`vps:status`).
 */
@injectable()
export class VpsService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(JobQueue) private readonly queue: JobQueue,
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(CatalogRepository) private readonly catalog: CatalogRepository,
    @inject(CapacityService) private readonly capacity: CapacityService,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(OrderService) private readonly orders: OrderService,
    @inject(TOKENS.SecretBox) private readonly secretBox: SecretBox,
  ) {}

  private async owned(userId: string, vpsId: string) {
    const found = await this.vps.findOwned(vpsId, userId);
    if (!found || found.status === 'DELETED') throw AppError.notFound('VPS não encontrada');
    return found;
  }

  private rejectTransition(status: string): never {
    if ((BUSY_STATUSES as readonly string[]).includes(status))
      throw new AppError(409, 'VPS_BUSY', 'Já existe uma operação em andamento nesta VPS', { status });
    throw new AppError(409, 'VPS_INVALID_STATE', 'Esta operação não é possível no estado atual da VPS', { status });
  }

  /** Transição + job + evento, tudo na mesma transação. */
  private async transition(
    userId: string,
    vpsId: string,
    operation: VpsOperation,
    job: { type: JobType; payload: InputJsonValue; maxAttempts?: number },
    extra: { eventAction?: string } = {},
  ) {
    const { from, via } = VPS_TRANSITIONS[operation];
    const moved = await this.db.$transaction(async (tx) => {
      const r = await tx.vps.updateMany({
        where: { id: vpsId, userId, deletedAt: null, status: { in: [...from] } },
        data: { status: via },
      });
      if (!r.count) return false;
      await this.queue.enqueue(job.type, job.payload, { tx, ...(job.maxAttempts ? { maxAttempts: job.maxAttempts } : {}) });
      await tx.vpsEvent.create({ data: { vpsId, actorId: userId, action: extra.eventAction ?? operation, status: 'requested' } });
      return true;
    });
    if (!moved) this.rejectTransition((await this.owned(userId, vpsId)).status);
    this.notify.status({ id: vpsId, userId }, via as VpsStatusDTO, null);
  }

  private async dto(userId: string, vpsId: string): Promise<VpsDTO> {
    const found = await this.vps.findOwned(vpsId, userId);
    if (!found) throw AppError.notFound('VPS não encontrada');
    return toVpsDTO(found);
  }

  /** POST /api/vps/:id/actions/:action */
  async powerAction(userId: string, vpsId: string, action: PowerActionName, ip: string | null) {
    await this.owned(userId, vpsId);
    await this.transition(userId, vpsId, action, { type: 'vps_action', payload: { vpsId, action, actorId: userId }, maxAttempts: 3 });
    await this.audit.record({ action: `vps.${action}`, actorId: userId, targetType: 'vps', targetId: vpsId, ip });
    return this.dto(userId, vpsId);
  }

  /**
   * DELETE /api/vps/:id. Aguardando pagamento: nada existe no Proxmox, então a exclusão é imediata (fatura cancelada).
   * Nos outros estados: DELETING + job delete_vps.
   */
  async remove(userId: string, vpsId: string, ip: string | null) {
    const current = await this.owned(userId, vpsId);
    if (current.status === 'PENDING_PAYMENT') {
      const now = this.clock.now();
      const done = await this.db.$transaction(async (tx) => {
        const r = await tx.vps.updateMany({
          where: { id: vpsId, userId, status: 'PENDING_PAYMENT' },
          data: { status: 'DELETED', deletedAt: now, provisionSecrets: null },
        });
        if (!r.count) return false;
        await tx.invoice.updateMany({ where: { vpsId, status: 'PENDING' }, data: { status: 'CANCELED' } });
        await tx.vpsEvent.create({ data: { vpsId, actorId: userId, action: 'delete', status: 'succeeded' } });
        return true;
      });
      if (!done) this.rejectTransition((await this.owned(userId, vpsId)).status);
      this.notify.status({ id: vpsId, userId }, 'DELETED', null);
      await this.audit.record({ action: 'vps.delete', actorId: userId, targetType: 'vps', targetId: vpsId, ip });
      // Já tem deletedAt (o findOwned não a devolve mais).
      return { ...toVpsDTO(current), status: 'DELETED' as const, pendingInvoice: null };
    } else {
      await this.transition(userId, vpsId, 'delete', { type: 'delete_vps', payload: { vpsId, actorId: userId } });
    }
    await this.audit.record({ action: 'vps.delete', actorId: userId, targetType: 'vps', targetId: vpsId, ip });
    return this.dto(userId, vpsId);
  }

  /**
   * POST /api/vps/:id/resize (plano §11.4): outro plano, sem diminuir o disco e respeitando o mínimo da imagem. Se o
   * novo plano custa mais, gera uma fatura com a diferença proporcional aos dias que faltam no período (simulada).
   */
  async resize(userId: string, vpsId: string, planSlug: string, ip: string | null) {
    const current = await this.owned(userId, vpsId);
    const plan = await this.catalog.findPlan(planSlug);
    if (!plan) throw new AppError(422, 'PLAN_NOT_FOUND', 'Plano inexistente', [{ path: 'plan', message: 'PLAN_NOT_FOUND' }]);
    if (plan.slug === current.plan.slug) throw new AppError(422, 'SAME_PLAN', 'A VPS já está neste plano');
    if (plan.diskGb < current.diskGb)
      throw new AppError(422, 'DISK_SHRINK_NOT_SUPPORTED', 'Não é possível diminuir o disco', { currentDiskGb: current.diskGb });
    const template = await this.db.osTemplate.findUniqueOrThrow({ where: { id: current.osTemplateId } });
    if (plan.memoryMb < template.minMemoryMb || plan.diskGb < template.minDiskGb) {
      throw new AppError(422, 'PLAN_BELOW_IMAGE_MINIMUM', `${template.name} requer ${template.minMemoryMb} MB e ${template.minDiskGb} GB`, {
        minMemoryMb: template.minMemoryMb,
        minDiskGb: template.minDiskGb,
      });
    }
    if (!(VPS_TRANSITIONS.resize.from as readonly string[]).includes(current.status)) this.rejectTransition(current.status);
    await this.capacity.assertCanGrow({ memoryMb: plan.memoryMb - current.memoryMb, diskGb: plan.diskGb - current.diskGb });

    const oldPlan = await this.db.plan.findUniqueOrThrow({ where: { id: current.planId } });
    // Cobra só o que falta do período já pago (até o paidUntil, Fase 10); a renovação seguinte já sai no preço novo.
    const { periodMs } = billingDurations(this.env);
    const left = current.paidUntil ? current.paidUntil.getTime() - this.clock.now().getTime() : periodMs;
    const remaining = Math.min(1, Math.max(0, left / periodMs));
    const amountCents = Math.max(0, Math.round((plan.priceCents - oldPlan.priceCents) * remaining));

    await this.transition(userId, vpsId, 'resize', {
      type: 'resize_vps',
      payload: {
        vpsId,
        actorId: userId,
        planId: plan.id,
        cores: plan.cores,
        memoryMb: plan.memoryMb,
        diskGb: plan.diskGb,
        bandwidthMbps: plan.bandwidthMbps,
        previousStatus: current.status,
        amountCents,
        description: `VPS ${current.hostname} — troca do plano ${oldPlan.name} para ${plan.name} (proporcional)`,
      },
      maxAttempts: 3,
    });
    await this.audit.record({
      action: 'vps.resize',
      actorId: userId,
      targetType: 'vps',
      targetId: vpsId,
      metadata: { from: oldPlan.slug, to: plan.slug, amountCents },
      ip,
    });
    return this.dto(userId, vpsId);
  }

  /**
   * POST /api/vps/:id/reinstall (plano §17, Fase 10): apaga a VM e cria de novo com a imagem e o acesso escolhidos. Mantém
   * IP, MAC, VMID, hostname, plano e período pago; o disco é apagado. Confirmação pelo hostname atual. As senhas vão
   * cifradas só no payload do job (como na criação, §10.6) e as regras de acesso são as mesmas da criação.
   */
  async reinstall(userId: string, vpsId: string, input: ReinstallInput, ip: string | null) {
    const current = await this.owned(userId, vpsId);
    if (input.confirmHostname.trim() !== current.hostname) {
      throw new AppError(422, 'CONFIRMATION_MISMATCH', 'Digite o hostname atual para confirmar', [
        { path: 'confirmHostname', message: 'confirmHostname' },
      ]);
    }
    const template = await this.catalog.findOsTemplate(input.osTemplate);
    if (!template) throw new AppError(422, 'IMAGE_NOT_FOUND', 'Imagem inexistente', [{ path: 'osTemplate', message: 'IMAGE_NOT_FOUND' }]);
    if (current.memoryMb < template.minMemoryMb || current.diskGb < template.minDiskGb) {
      throw new AppError(422, 'PLAN_BELOW_IMAGE_MINIMUM', `${template.name} requer ${template.minMemoryMb} MB e ${template.minDiskGb} GB`, {
        minMemoryMb: template.minMemoryMb,
        minDiskGb: template.minDiskGb,
      });
    }
    if (!(VPS_TRANSITIONS.reinstall.from as readonly string[]).includes(current.status)) this.rejectTransition(current.status);
    const keys = await this.orders.resolveAccess(userId, template, input, `chave-${current.hostname}`);
    const secrets = this.secretBox.seal(
      JSON.stringify({ password: input.password, rootPassword: input.rootPassword, sshKeys: keys } satisfies ProvisionSecrets),
    );

    const moved = await this.db.$transaction(async (tx) => {
      const r = await tx.vps.updateMany({
        where: { id: vpsId, userId, deletedAt: null, status: { in: [...VPS_TRANSITIONS.reinstall.from] } },
        data: {
          status: 'PROVISIONING',
          osTemplateId: template.id,
          username: input.username,
          sshPasswordAuth: input.sshPasswordAuth,
          rootPasswordSet: Boolean(input.rootPassword),
          diskGrowPending: false,
          lastError: null,
        },
      });
      if (!r.count) return false;
      await this.queue.enqueue('reinstall_vps', { vpsId, secrets }, { tx, maxAttempts: 3 });
      await tx.vpsEvent.create({ data: { vpsId, actorId: userId, action: 'reinstall', status: 'requested', message: template.slug } });
      return true;
    });
    if (!moved) this.rejectTransition((await this.owned(userId, vpsId)).status);
    this.notify.status({ id: vpsId, userId }, 'PROVISIONING', null);
    await this.audit.record({
      action: 'vps.reinstall',
      actorId: userId,
      targetType: 'vps',
      targetId: vpsId,
      metadata: { from: current.osTemplate.slug, to: template.slug },
      ip,
    });
    return this.dto(userId, vpsId);
  }

  /** GET /api/vps/:id/events: histórico da VPS (inclui as etapas da criação, para a linha do tempo). */
  async events(userId: string, vpsId: string): Promise<VpsEventDTO[]> {
    await this.owned(userId, vpsId);
    const rows = await this.db.vpsEvent.findMany({ where: { vpsId }, orderBy: { id: 'asc' }, take: 200 });
    return rows.map((e) => ({ id: e.id, action: e.action, status: e.status, message: e.message, createdAt: e.createdAt.toISOString() }));
  }
}
