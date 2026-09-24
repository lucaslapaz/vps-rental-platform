/**
 * @lab — QemuCloudInitProvider contra o laboratório Proxmox de verdade, com o TOKEN da plataforma (plano §17, Fase 4).
 * Fora do `npm test` e do CI: rode com `npm run test:lab` (leva ~10 min; uma VM por vez por causa da RAM do lab).
 *
 * Para cada imagem: clonar → configurar (cloud-init) → aumentar o disco → ligar → agente → senha root → login SSH por
 * senha liga/desliga (provado com login de verdade) → adicionar chave pelo agente → troca de recursos pendente →
 * métricas → console → desligar → excluir.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { TOKENS } from '../../src/server/container/tokens.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';
import { macFromIp } from '../../src/server/utils/ipv4.ts';
import { createLogger } from '../../src/server/utils/logger.ts';
import { closeTestPrisma, testPrisma } from '../helpers/app.ts';
import { LAB_IP, myPublicKey, randomPassword, sshKey, sshPassword, tempKeyPair } from './helpers.ts';

const IMAGES = [
  { template: 9000, family: 'alpine', su: 'doas', memoryMb: 256, diskGb: 2, bandwidthMbps: 10 },
  { template: 9001, family: 'debian', su: 'sudo', memoryMb: 512, diskGb: 4, bandwidthMbps: 25 },
  { template: 9002, family: 'ubuntu', su: 'sudo', memoryMb: 512, diskGb: 4, bandwidthMbps: 25 },
  { template: 9003, family: 'alpine', su: 'doas', memoryMb: 1024, diskGb: 8, bandwidthMbps: 100, desktop: true },
] as const;

const USER = 'cliente';
let provider: VirtualizationProvider;

beforeAll(() => {
  const env = loadEnv();
  const di = registerDependencies({ env, logger: createLogger(env), prisma: testPrisma() }, container.createChildContainer());
  provider = di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider);
});
afterAll(closeTestPrisma);

describe('@lab laboratório', () => {
  it('a API responde e a capacidade real do nó é lida com o token', async () => {
    expect(await provider.ping()).toBe(true);
    const cap = await provider.capacity();
    expect(cap.memTotalBytes).toBeGreaterThan(2 * 1024 ** 3);
    expect(cap.storageAvailBytes).toBeGreaterThan(1024 ** 3);
    expect(cap.pveVersion).toMatch(/pve-manager\/9/);
  });

  it('o token não enxerga nem mexe em VMs fora dos pools (status de um VMID alheio = null)', async () => {
    expect(await provider.status(100)).toBeNull();
  });
});

describe.each(IMAGES)('@lab ciclo de vida: template $template ($family)', (img) => {
  const password = randomPassword('Favo');
  const rootPassword = randomPassword('Root');
  let vmid = 0;

  afterAll(async () => {
    if (vmid) await provider.destroy(vmid).catch(() => {});
  });

  it('cria, configura e liga a VPS; o agente responde', async () => {
    vmid = await provider.nextFreeVmid(9190);
    expect(await provider.exists(vmid)).toBe(false);
    await provider.cloneFromTemplate({ templateVmid: img.template, vmid, name: `favo-lab-${img.family}`, description: 'favo:@lab' });
    await provider.configure(
      vmid,
      { cores: 1, memoryMb: img.memoryMb, bandwidthMbps: img.bandwidthMbps },
      {
        user: USER,
        password,
        sshKeys: [myPublicKey()],
        ip: LAB_IP,
        prefix: 24,
        gateway: '192.168.56.10',
        macAddress: macFromIp(LAB_IP),
        nameservers: ['1.1.1.1'],
      },
      { tags: ['favo', 'lab'] },
    );
    await provider.applyNetworkFirewall(vmid, LAB_IP); // anti-spoofing, como no provisionamento (Fase 10)
    await provider.resizeDisk(vmid, img.diskGb);
    await provider.power(vmid, 'start');
    await provider.waitForAgent(vmid);
    const st = await provider.status(vmid);
    expect(st?.status).toBe('running');
    expect(st?.diskMaxBytes).toBe(img.diskGb * 1024 ** 3);
    expect(st?.memMaxBytes).toBe(img.memoryMb * 1024 ** 2);
  }, 300_000);

  it('SSH com a chave do cloud-init e privilégio de administrador', async () => {
    let r = sshKey(USER, 'id -un');
    for (let i = 0; i < 20 && r.code !== 0; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      r = sshKey(USER, 'id -un');
    }
    expect(r.out).toBe(USER);
    expect(sshKey(USER, `${img.su} true && echo SU_OK`).out).toContain('SU_OK');
  }, 120_000);

  it('define a senha root pelo guest agent, sem reboot', async () => {
    await provider.setUserPassword(vmid, 'root', rootPassword);
    const hash = sshKey(USER, `${img.su} grep '^root:' /etc/shadow | cut -d: -f2 | cut -c1-3`).out;
    expect(hash).toMatch(/^\$(6|y)\$/);
  }, 60_000);

  it('login SSH por senha: liga (senha funciona) e desliga (senha recusada); root nunca entra por SSH', async () => {
    await provider.setSshPasswordAuth(vmid, img.family, true);
    expect(sshKey(USER, `${img.su} sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '`).out).toMatch(
      /passwordauthentication yes[\s\S]*permitrootlogin no|permitrootlogin no[\s\S]*passwordauthentication yes/,
    );
    const ok = sshPassword(USER, password, 'echo LOGIN_POR_SENHA');
    expect(ok.out).toContain('LOGIN_POR_SENHA');
    expect(sshPassword('root', rootPassword).code).not.toBe(0);

    await provider.setSshPasswordAuth(vmid, img.family, false);
    expect(sshKey(USER, `${img.su} sshd -T | grep '^passwordauthentication '`).out).toBe('passwordauthentication no');
    expect(sshPassword(USER, password).code).not.toBe(0);
  }, 120_000);

  it('adiciona uma chave SSH pelo agente, e ela passa a funcionar', async () => {
    const pair = tempKeyPair();
    try {
      await provider.addAuthorizedKey(vmid, USER, pair.publicKey);
      expect(sshKey(USER, 'echo NOVA_CHAVE', pair.privateKeyFile).out).toContain('NOVA_CHAVE');
    } finally {
      pair.cleanup();
    }
  }, 60_000);

  it('troca de recursos com a VM ligada fica pendente; métricas e console respondem', async () => {
    await provider.updateResources(vmid, { cores: 1, memoryMb: img.memoryMb + 256, bandwidthMbps: img.bandwidthMbps }, macFromIp(LAB_IP));
    const pending = await provider.pendingChanges(vmid);
    expect(pending.map((p) => p.key)).toContain('memory');
    expect((await provider.metrics(vmid, 'hour')).length).toBeGreaterThan(0);
    const consoleTicket = await provider.openConsole(vmid);
    expect(consoleTicket.port).toBeGreaterThan(0);
    // Descoberta (rev. 11): o ticket vem como "<senha VNC>:PVEVNC:…", com caracteres especiais (precisa de
    // encodeURIComponent na URL do vncwebsocket).
    expect(consoleTicket.password).toHaveLength(8);
    expect(consoleTicket.ticket.startsWith(`${consoleTicket.password}:PVEVNC:`)).toBe(true);
  }, 60_000);

  it('console de texto (termproxy na serial0): "OK" no handshake e o getty mostra o login (Fase 10)', async () => {
    const term = await provider.openTerminal(vmid);
    const ws = provider.connectConsole(vmid, term);
    const received: Buffer[] = [];
    const text = () => Buffer.concat(received).toString();
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('message', (d) => received.push(Buffer.from(d as Buffer)));
    ws.send(`${term.user}:${term.ticket}\n`);
    const deadline = Date.now() + 20_000;
    while (!text().startsWith('OK') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(text().startsWith('OK')).toBe(true);
    ws.send('0:1:\r'); // Enter: o getty reimprime o prompt
    while (!/login:/.test(text()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
    ws.close();
    expect(text()).toMatch(/login:/);
  }, 60_000);

  // Exige o firewall do datacenter ligado (scripts/pve/firewall.sh). Só no Alpine: o busybox tem ip e ping -I.
  it.runIf(img.template === 9000)(
    'anti-spoofing (Fase 10): com um IP que não é dela a VM não fala com a rede; com o dela, fala e sai para a internet',
    async () => {
      const spoofed = '192.168.56.228';
      sshKey(USER, `doas ip addr add ${spoofed}/24 dev eth0`);
      try {
        const spoof = sshKey(
          USER,
          `ping -c 2 -W 2 -I ${spoofed} 192.168.56.10 >/dev/null 2>&1 && echo SPOOF_PASSOU || echo SPOOF_BLOQUEADO`,
        );
        expect(spoof.out).toContain('SPOOF_BLOQUEADO');
      } finally {
        sshKey(USER, `doas ip addr del ${spoofed}/24 dev eth0`);
      }
      expect(sshKey(USER, 'ping -c 2 -W 2 192.168.56.10 >/dev/null && echo PROPRIO_OK').out).toContain('PROPRIO_OK');
      // DNS + saída pelo NAT do nó (MASQUERADE em vmbr0) continuam funcionando com o firewall ligado.
      expect(sshKey(USER, 'wget -q -T 10 -O /dev/null http://dl-cdn.alpinelinux.org/alpine/ && echo INTERNET_OK').out).toContain(
        'INTERNET_OK',
      );
    },
    60_000,
  );

  it('desliga (ACPI) e exclui; excluir de novo não falha (idempotente)', async () => {
    await provider.power(vmid, 'shutdown');
    expect((await provider.status(vmid))?.status).toBe('stopped');
    await provider.destroy(vmid);
    expect(await provider.exists(vmid)).toBe(false);
    await provider.destroy(vmid);
    vmid = 0;
  }, 180_000);
});
