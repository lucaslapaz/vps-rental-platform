import { inject, injectable } from 'tsyringe';
import type { createVpsSchema } from '../../shared/schemas/vps.ts';
import type { InvoiceDTO, VpsDTO } from '../../shared/types/catalog.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { CatalogRepository } from '../repositories/CatalogRepository.ts';
import { SshKeyRepository } from '../repositories/SshKeyRepository.ts';
import { toVpsDTO, VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';
import type { SecretBox } from '../utils/secretBox.ts';
import { parseSshPublicKey } from '../utils/sshKey.ts';
import { toInvoiceDTO } from './BillingService.ts';
import { CapacityService } from './CapacityService.ts';

type CreateVps = import('zod').output<typeof createVpsSchema>;

/** O que o job de provisionamento precisa e que não pode ficar em texto puro no banco (plano §10.6). */
export interface ProvisionSecrets {
  password?: string;
  rootPassword?: string;
  sshKeys: string[];
}

/** Campos de acesso comuns à criação e à reinstalação. */
type AccessInput = Pick<CreateVps, 'sshKeyIds' | 'newSshKey' | 'password' | 'rootPassword'>;

const invalid = (code: string, message: string, path?: string) =>
  new AppError(422, code, message, path ? [{ path, message: code }] : undefined);

@injectable()
export class OrderService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.SecretBox) private readonly secrets: SecretBox,
    @inject(CatalogRepository) private readonly catalog: CatalogRepository,
    @inject(SshKeyRepository) private readonly sshKeys: SshKeyRepository,
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(CapacityService) private readonly capacity: CapacityService,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  /**
   * Regras de acesso da imagem e as chaves SSH do pedido (as salvas precisam ser do usuário; a nova é validada de verdade
   * e, se pedido, salva na conta). Usado na criação e na reinstalação; devolve as chaves para o cloud-init.
   */
  async resolveAccess(
    userId: string,
    template: NonNullable<Awaited<ReturnType<CatalogRepository['findOsTemplate']>>>,
    input: AccessInput,
    keyName: string,
  ): Promise<string[]> {
    if (template.requiresPassword && !input.password) throw invalid('PASSWORD_REQUIRED', 'Esta imagem exige senha', 'password');
    if (input.rootPassword && !template.supportsRootPassword)
      throw invalid('ROOT_PASSWORD_NOT_SUPPORTED', 'Imagem sem senha root', 'rootPassword');

    // Chaves: as salvas precisam ser do usuário; a nova é validada de verdade (blob + fingerprint).
    const keys: string[] = [];
    if (input.sshKeyIds.length || input.newSshKey) {
      if (!template.supportsSshKeys) throw invalid('SSH_KEYS_NOT_SUPPORTED', 'Imagem sem chaves SSH', 'sshKeyIds');
      const saved = await this.sshKeys.listByUser(userId);
      for (const id of new Set(input.sshKeyIds)) {
        const key = saved.find((k) => k.id === id);
        if (!key) throw invalid('SSH_KEY_NOT_FOUND', 'Chave SSH não encontrada', 'sshKeyIds');
        keys.push(key.publicKey);
      }
      if (input.newSshKey) {
        const parsed = parseSshPublicKey(input.newSshKey.publicKey);
        if (!parsed) throw invalid('SSH_KEY_INVALID', 'Chave SSH inválida', 'newSshKey.publicKey');
        if (!keys.includes(parsed.line)) keys.push(parsed.line);
        if (input.newSshKey.save && !saved.some((k) => k.fingerprint === parsed.fingerprint)) {
          await this.sshKeys.create({
            userId,
            name: input.newSshKey.name || keyName,
            publicKey: parsed.line,
            fingerprint: parsed.fingerprint,
          });
        }
      }
    }

    return keys;
  }

  /**
   * POST /api/vps: valida o pedido (as mesmas regras da tela, plano §14.5), confere a capacidade e cria a VPS em
   * PENDING_PAYMENT com a fatura da primeira mensalidade. Nada é criado no Proxmox antes do pagamento.
   */
  async create(userId: string, input: CreateVps, ip: string | null): Promise<{ vps: VpsDTO; invoice: InvoiceDTO }> {
    const template = await this.catalog.findOsTemplate(input.osTemplate);
    if (!template) throw invalid('IMAGE_NOT_FOUND', 'Imagem inexistente', 'osTemplate');
    const plan = await this.catalog.findPlan(input.plan);
    if (!plan) throw invalid('PLAN_NOT_FOUND', 'Plano inexistente', 'plan');

    // Mínimos da imagem: o frontend desabilita o plano, mas o servidor é quem decide (plano §3.7).
    if (plan.memoryMb < template.minMemoryMb || plan.diskGb < template.minDiskGb) {
      throw new AppError(422, 'PLAN_BELOW_IMAGE_MINIMUM', `${template.name} requer ${template.minMemoryMb} MB e ${template.minDiskGb} GB`, {
        minMemoryMb: template.minMemoryMb,
        minDiskGb: template.minDiskGb,
      });
    }
    const keys = await this.resolveAccess(userId, template, input, `chave-${input.hostname}`);

    await this.capacity.assertCanAllocate(userId, plan);

    const sealed = this.secrets.seal(
      JSON.stringify({ password: input.password, rootPassword: input.rootPassword, sshKeys: keys } satisfies ProvisionSecrets),
    );
    const now = this.clock.now();
    const { vpsId } = await this.db.$transaction(async (tx) => {
      const vps = await tx.vps.create({
        data: {
          userId,
          planId: plan.id,
          osTemplateId: template.id,
          hostname: input.hostname,
          username: input.username,
          sshPasswordAuth: input.sshPasswordAuth,
          rootPasswordSet: Boolean(input.rootPassword),
          cores: plan.cores,
          memoryMb: plan.memoryMb,
          diskGb: plan.diskGb,
          bandwidthMbps: plan.bandwidthMbps,
          provisionSecrets: sealed,
        },
      });
      await tx.invoice.create({
        data: {
          userId,
          vpsId: vps.id,
          description: `VPS ${input.hostname} — plano ${plan.name} (${template.name}), 1º mês`,
          amountCents: plan.priceCents,
          dueAt: new Date(now.getTime() + this.env.INVOICE_DUE_HOURS * 3_600_000),
        },
      });
      await tx.vpsEvent.create({ data: { vpsId: vps.id, actorId: userId, action: 'create', status: 'requested' } });
      return { vpsId: vps.id };
    });
    await this.audit.record({
      action: 'vps.ordered',
      actorId: userId,
      targetType: 'vps',
      targetId: vpsId,
      metadata: { plan: plan.slug, image: template.slug },
      ip,
    });

    const vps = await this.vps.findOwned(vpsId, userId);
    const invoice = await this.db.invoice.findFirstOrThrow({ where: { vpsId }, include: { vps: true, payments: true } });
    if (!vps) throw new AppError(500, 'INTERNAL_ERROR', 'VPS recém-criada não encontrada');
    return { vps: toVpsDTO(vps), invoice: toInvoiceDTO(invoice) };
  }
}
