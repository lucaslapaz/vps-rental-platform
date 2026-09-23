import { inject, injectable } from 'tsyringe';
import type { OsTemplateDTO, PlanDTO } from '../../shared/types/catalog.ts';
import { CatalogRepository } from '../repositories/CatalogRepository.ts';

@injectable()
export class CatalogService {
  constructor(@inject(CatalogRepository) private readonly catalog: CatalogRepository) {}

  async plans(): Promise<PlanDTO[]> {
    return (await this.catalog.listPlans()).map(({ slug, name, cores, memoryMb, diskGb, bandwidthMbps, priceCents }) => ({
      slug,
      name,
      cores,
      memoryMb,
      diskGb,
      bandwidthMbps,
      priceCents,
    }));
  }

  /** As imagens trazem as capacidades e os mínimos que controlam a tela de criação (plano §14.5). */
  async osTemplates(): Promise<OsTemplateDTO[]> {
    return (await this.catalog.listOsTemplates()).map((t) => ({
      slug: t.slug,
      name: t.name,
      family: t.family,
      version: t.version,
      defaultUser: t.defaultUser,
      sudoCommand: t.sudoCommand,
      minMemoryMb: t.minMemoryMb,
      minDiskGb: t.minDiskGb,
      supportsRootPassword: t.supportsRootPassword,
      supportsSshKeys: t.supportsSshKeys,
      requiresPassword: t.requiresPassword,
      hasGui: t.hasGui,
    }));
  }
}
