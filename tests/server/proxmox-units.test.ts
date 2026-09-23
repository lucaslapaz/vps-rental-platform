import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { imageProfile, sshdPolicy } from '../../src/server/integrations/proxmox/ImageProfile.ts';
import { encodeSshKeys, mbpsToRate } from '../../src/server/integrations/proxmox/QemuCloudInitProvider.ts';
import { SecretBox } from '../../src/server/utils/secretBox.ts';

describe('SecretBox (AES-256-GCM das senhas nos jobs)', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));

  it('cifra e decifra, com IV diferente a cada vez', () => {
    const a = box.seal('S3nha-do-cliente!');
    const b = box.seal('S3nha-do-cliente!');
    expect(a).not.toBe(b);
    expect(a).not.toContain('S3nha');
    expect(box.open(a)).toBe('S3nha-do-cliente!');
  });

  it('recusa texto adulterado ou cifrado com outra chave', () => {
    const sealed = box.seal('segredo');
    const [v, iv, tag, data] = sealed.split('.') as [string, string, string, string];
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => box.open([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).open(sealed)).toThrow();
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('conversões para a API do Proxmox', () => {
  it('banda em Mbps → rate em MB/s (net[n].rate, CLAUDE.md A7)', () => {
    expect(mbpsToRate(10)).toBe(1.25);
    expect(mbpsToRate(25)).toBe(3.125);
    expect(mbpsToRate(100)).toBe(12.5);
  });

  it('sshkeys URL-encoded, uma por linha, sem \\r (CLAUDE.md C4)', () => {
    expect(encodeSshKeys(['ssh-ed25519 AAAA a@b\r\n', 'ssh-rsa BBBB c@d'])).toBe('ssh-ed25519%20AAAA%20a%40b%0Assh-rsa%20BBBB%20c%40d');
  });
});

describe('ImageProfile e política de SSH', () => {
  it('o drop-in vem antes de 50-cloud-init.conf e 60-cloudimg-settings.conf (o primeiro valor vence no sshd)', () => {
    const file = imageProfile('ubuntu').sshdDropIn.split('/').at(-1) as string;
    expect([file, '50-cloud-init.conf', '60-cloudimg-settings.conf'].sort()[0]).toBe(file);
  });

  it('root nunca entra por SSH e o login por senha segue a escolha do cliente', () => {
    expect(sshdPolicy(true)).toMatch(/^PasswordAuthentication yes$/m);
    expect(sshdPolicy(false)).toMatch(/^PasswordAuthentication no$/m);
    for (const p of [sshdPolicy(true), sshdPolicy(false)]) {
      expect(p).toMatch(/^PermitRootLogin no$/m);
      expect(p).toMatch(/^KbdInteractiveAuthentication no$/m);
    }
  });

  it('cada família tem comandos fixos que validam a config antes de recarregar o sshd', () => {
    expect(imageProfile('alpine').reloadSshd.join(' ')).toContain('sshd -t && rc-service sshd reload');
    expect(imageProfile('debian').reloadSshd.join(' ')).toContain('sshd -t && systemctl try-reload-or-restart ssh');
    expect(() => imageProfile('windows')).toThrow();
  });
});
