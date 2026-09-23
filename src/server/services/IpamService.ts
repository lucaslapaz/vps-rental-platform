import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import { AppError } from '../utils/errors.ts';

export interface ReservedIp {
  id: number;
  address: string;
  prefix: number;
  gateway: string;
  macAddress: string;
}

/**
 * Controle dos IPs das VPS no banco (plano §3.3): FREE → RESERVED (provisionando) → ASSIGNED; na exclusão, volta a FREE.
 * A reserva é atômica (SELECT … FOR UPDATE SKIP LOCKED): dois provisionamentos simultâneos nunca pegam o mesmo IP.
 */
@injectable()
export class IpamService {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  /** Reserva um IP para a VPS; se ela já tem um (nova tentativa do job), devolve o mesmo. */
  async reserveFor(vpsId: string): Promise<ReservedIp> {
    return this.db.$transaction(async (tx) => {
      const vps = await tx.vps.findUniqueOrThrow({ where: { id: vpsId }, select: { ipAddress: true } });
      if (vps.ipAddress) return vps.ipAddress;
      const [free] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM ip_addresses WHERE status = 'FREE' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!free) throw new AppError(409, 'NO_IP_AVAILABLE', 'Nenhum IP livre no pool');
      const ip = await tx.ipAddress.update({ where: { id: Number(free.id) }, data: { status: 'RESERVED' } });
      await tx.vps.update({ where: { id: vpsId }, data: { ipAddressId: ip.id } });
      return ip;
    });
  }

  assign(ipId: number) {
    return this.db.ipAddress.update({ where: { id: ipId }, data: { status: 'ASSIGNED' } });
  }

  /** Devolve o IP ao pool e desvincula da VPS. */
  async release(vpsId: string) {
    await this.db.$transaction(async (tx) => {
      const vps = await tx.vps.findUnique({ where: { id: vpsId }, select: { ipAddressId: true } });
      if (!vps?.ipAddressId) return;
      await tx.vps.update({ where: { id: vpsId }, data: { ipAddressId: null } });
      await tx.ipAddress.update({ where: { id: vps.ipAddressId }, data: { status: 'FREE' } });
    });
  }
}
