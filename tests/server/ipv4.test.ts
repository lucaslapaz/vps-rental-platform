import { describe, expect, it } from 'vitest';
import { ipRange, ipToInt, macFromIp } from '../../src/server/utils/ipv4.ts';

describe('ipv4', () => {
  it('gera a faixa inclusive, atravessando octetos', () => {
    expect(ipRange('10.0.0.254', '10.0.1.1')).toEqual(['10.0.0.254', '10.0.0.255', '10.0.1.0', '10.0.1.1']);
  });

  it('recusa IPs inválidos e faixas invertidas', () => {
    expect(() => ipToInt('192.168.56.256')).toThrow();
    expect(() => ipRange('10.0.0.5', '10.0.0.1')).toThrow();
  });

  it('deriva o MAC do IP (02:00 + IPv4 em hex), o mesmo usado no teste dos templates', () => {
    expect(macFromIp('192.168.56.200')).toBe('02:00:C0:A8:38:C8');
    expect(macFromIp('192.168.56.229')).toBe('02:00:C0:A8:38:E5');
  });
});
