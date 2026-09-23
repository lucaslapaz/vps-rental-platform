/** Utilitários de IPv4 para o IPAM (plano §3.3). */

export function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`IPv4 inválido: ${ip}`);
  }
  return parts.reduce((acc, p) => acc * 256 + p, 0);
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.');
}

/** Todos os IPs de `start` a `end`, inclusive. */
export function ipRange(start: string, end: string): string[] {
  const a = ipToInt(start);
  const b = ipToInt(end);
  if (b < a) throw new Error(`faixa de IPs invertida: ${start} > ${end}`);
  return Array.from({ length: b - a + 1 }, (_, i) => intToIp(a + i));
}

/**
 * MAC derivado do IP: `02:00:` + os 4 octetos em hexadecimal (ex.: 192.168.56.200 → 02:00:C0:A8:38:C8).
 * `02` = unicast administrado localmente. Quem reutiliza o IP herda o MAC, e o cache ARP do Windows continua válido
 * (plano §3.3, CLAUDE.md A11).
 */
export function macFromIp(ip: string): string {
  ipToInt(ip); // valida
  return ['02', '00', ...ip.split('.').map((o) => Number(o).toString(16).padStart(2, '0'))].join(':').toUpperCase();
}
