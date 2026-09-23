import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSshPublicKey } from '../../src/server/utils/sshKey.ts';
import { generateSshPublicKey } from '../helpers/client.ts';

const str = (b: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
};

/** Chave RSA no formato OpenSSH: string "ssh-rsa" + mpint e + mpint n. */
function rsaKey(bits: number) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  const jwk = publicKey.export({ format: 'jwk' });
  const mpint = (b64: string) => {
    const b = Buffer.from(b64, 'base64url');
    return b[0] !== undefined && b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b;
  };
  const blob = Buffer.concat([str(Buffer.from('ssh-rsa')), str(mpint(jwk.e as string)), str(mpint(jwk.n as string))]);
  return `ssh-rsa ${blob.toString('base64')} rsa@teste`;
}

describe('parseSshPublicKey', () => {
  it('aceita ed25519, normaliza \\r\\n e calcula o fingerprint como o ssh-keygen', () => {
    const parsed = parseSshPublicKey(`  ${generateSshPublicKey('eu@pc')}\r\n`);
    expect(parsed?.type).toBe('ssh-ed25519');
    expect(parsed?.line).toMatch(/^ssh-ed25519 \S+ eu@pc$/);
    expect(parsed?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('aceita RSA de 2048 bits e recusa RSA de 1024', () => {
    expect(parseSshPublicKey(rsaKey(2048))?.type).toBe('ssh-rsa');
    expect(parseSshPublicKey(rsaKey(1024))).toBeNull();
  });

  it('recusa blob truncado, com bytes sobrando ou com tipo diferente do declarado', () => {
    const [, b64] = generateSshPublicKey().split(' ');
    const blob = Buffer.from(b64 as string, 'base64');
    expect(parseSshPublicKey(`ssh-ed25519 ${blob.subarray(0, blob.length - 1).toString('base64')}`)).toBeNull();
    expect(parseSshPublicKey(`ssh-ed25519 ${Buffer.concat([blob, Buffer.from([0])]).toString('base64')}`)).toBeNull();
    expect(parseSshPublicKey(`ecdsa-sha2-nistp256 ${b64}`)).toBeNull();
    expect(parseSshPublicKey('ssh-dss AAAAB3NzaC1kc3MAAACBAP')).toBeNull();
  });
});
