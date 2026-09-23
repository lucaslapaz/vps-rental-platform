import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace.ts';

/** Violação de índice único (P2002): usada como trava otimista, por exemplo na escolha do VMID. */
export function isUniqueViolation(err: unknown) {
  return err instanceof PrismaClientKnownRequestError && err.code === 'P2002';
}
