// Teste de aceite de um template (plano §3.6 passo 6 e §17 Fase 0), usando o TOKEN da plataforma, nunca o root.
//
//   node scripts/pve/test-template.mjs <vmid-do-template> [--keep]
//
// Clona o template com o token → configura como uma VPS (usuário "favo", senha, chave SSH, IP .229, ciupgrade=0,
// limite de banda) → aumenta o disco → liga → confere ping (Windows), SSH, DNS, sudo/doas, tamanho do disco, guest
// agent, senha root pelo agente e vncproxy → captura a tela VGA → desliga e exclui. Por fim confere que o mesmo token
// recebe 403 ao tentar excluir o template.
//
// Só a captura da tela VGA usa SSH como root (o monitor QEMU não é exposto na API); é diagnóstico, não operação.
// Node puro, sem dependências: roda antes de existir package.json.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TEST_VMID = 9199;
const TEST_IP = '192.168.56.229';
const GATEWAY = '192.168.56.10';
const TEST_USER = 'favo';

// Menor plano compatível com cada imagem (plano §8.4).
const PROFILES = {
  9000: { image: 'alpine', memory: 256, disk: '2G', rateMBs: 1.25, su: 'doas', dnsName: 'dl-cdn.alpinelinux.org' },
  9001: { image: 'debian', memory: 512, disk: '4G', rateMBs: 3.125, su: 'sudo', dnsName: 'deb.debian.org' },
  9002: { image: 'ubuntu', memory: 512, disk: '4G', rateMBs: 3.125, su: 'sudo', dnsName: 'archive.ubuntu.com' },
  9003: { image: 'alpine-desktop', memory: 1024, disk: '8G', rateMBs: 12.5, su: 'doas', dnsName: 'dl-cdn.alpinelinux.org', desktop: true },
};

const templateId = Number(process.argv[2]);
const keep = process.argv.includes('--keep');
const profile = PROFILES[templateId];
if (!profile) {
  console.error(`uso: node scripts/pve/test-template.mjs <${Object.keys(PROFILES).join('|')}> [--keep]`);
  process.exit(2);
}

// ─── .env.development (parser mínimo: KEY=valor por linha) ───
const env = Object.fromEntries(
  readFileSync('.env.development', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
for (const k of ['PVE_URL', 'PVE_NODE', 'PVE_TOKEN_ID', 'PVE_TOKEN_SECRET', 'PVE_CA_FILE', 'PVE_TLS_SERVERNAME']) {
  if (!env[k]) throw new Error(`${k} ausente no .env.development (rode scripts/pve/bootstrap.sh)`);
}
const base = new URL(env.PVE_URL);
const node = env.PVE_NODE;
const ca = readFileSync(env.PVE_CA_FILE);
const pveHost = base.hostname;

// ─── Cliente mínimo da API com o token (TLS validado pela CA do Proxmox + nome do certificado) ───
function api(method, path, params) {
  const body = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : undefined;
  const query = method === 'GET' || method === 'DELETE' ? (body ? `?${body}` : '') : '';
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: base.hostname,
        port: base.port || 8006,
        servername: env.PVE_TLS_SERVERNAME, // o certificado não tem o IP 192.168.56.10 no SAN; valida pelo nome do nó
        ca,
        method,
        path: `/api2/json${path}${query}`,
        headers: {
          Authorization: `PVEAPIToken=${env.PVE_TOKEN_ID}=${env.PVE_TOKEN_SECRET}`,
          ...(body && !query ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: 30_000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, message: res.statusMessage, data: json?.data, errors: json?.errors, raw });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body && !query) req.write(body);
    req.end();
  });
}

async function ok(method, path, params) {
  const r = await api(method, path, params);
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${r.message} ${JSON.stringify(r.errors ?? r.raw)}`);
  return r.data;
}

// 02 = unicast "administrado localmente" (não colide com o OUI BC:24:11 que o Proxmox usa nos MACs aleatórios).
const macFromIp = (ip) => ['02', '00', ...ip.split('.').map((o) => Number(o).toString(16).padStart(2, '0'))].join(':').toUpperCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTask(upid, what, limitMs = 300_000) {
  if (typeof upid !== 'string' || !upid.startsWith('UPID:')) return; // operação síncrona
  const start = Date.now();
  for (;;) {
    const s = await ok('GET', `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
    if (s.status === 'stopped') {
      if (s.exitstatus !== 'OK') throw new Error(`task ${what} terminou com: ${s.exitstatus}`);
      return;
    }
    if (Date.now() - start > limitMs) throw new Error(`task ${what}: tempo esgotado`);
    await sleep(1000);
  }
}

async function waitFor(what, limitMs, fn) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) {
        const s = Math.round((Date.now() - start) / 1000);
        step(`${what}: ok em ${s}s`);
        return v;
      }
    } catch {}
    if (Date.now() - start > limitMs) throw new Error(`${what}: tempo esgotado (${limitMs / 1000}s)`);
    await sleep(2000);
  }
}

const results = [];
function step(msg) { console.log(`[teste ${new Date().toTimeString().slice(0, 8)}] ${msg}`); }
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, timeout: 120_000 });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR'];
const sshVps = (command) => run('ssh', [...SSH_OPTS, '-i', join(homedir(), '.ssh', 'id_ed25519'), `${TEST_USER}@${TEST_IP}`, command]);
const sshRoot = (command, input) => run('ssh', ['-o', 'BatchMode=yes', `root@${pveHost}`, command], input);

async function destroyTestVm() {
  const st = await api('GET', `/nodes/${node}/qemu/${TEST_VMID}/status/current`);
  if (st.status !== 200) return;
  if (st.data?.status === 'running') await waitTask(await ok('POST', `/nodes/${node}/qemu/${TEST_VMID}/status/stop`), 'stop');
  await waitTask(await ok('DELETE', `/nodes/${node}/qemu/${TEST_VMID}`, { purge: 1, 'destroy-unreferenced-disks': 1 }), 'destroy');
}

async function main() {
  step(`template ${templateId} (${profile.image}) → clone ${TEST_VMID} com o token ${env.PVE_TOKEN_ID}`);
  await destroyTestVm(); // sobra de uma execução interrompida

  const password = `Fv-${randomBytes(9).toString('base64url')}`;
  const rootPassword = `Rt-${randomBytes(9).toString('base64url')}`;
  const pubkey = readFileSync(join(homedir(), '.ssh', 'id_ed25519.pub'), 'utf8').replace(/\r\n/g, '\n').trim(); // armadilha C4

  const t0 = Date.now();
  await waitTask(
    await ok('POST', `/nodes/${node}/qemu/${templateId}/clone`, { newid: TEST_VMID, name: `favo-test-${profile.image}`, pool: 'vps-platform', full: 0 }),
    'clone',
  );
  check('clone vinculado com o token', true, `${Math.round((Date.now() - t0) / 1000)}s`);

  await ok('PUT', `/nodes/${node}/qemu/${TEST_VMID}/config`, {
    memory: profile.memory,
    cores: 1,
    ciuser: TEST_USER,
    cipassword: password,
    sshkeys: encodeURIComponent(pubkey), // a API espera o valor já codificado (armadilha C4)
    ipconfig0: `ip=${TEST_IP}/24,gw=${GATEWAY}`,
    nameserver: '1.1.1.1 8.8.8.8',
    ciupgrade: 0,
    // MAC derivado do IP (02:00 + IPv4 em hexadecimal): quem reutiliza o IP herda o MAC, e o cache ARP do Windows
    // continua válido. Com MAC aleatório, o Windows levava ~45 s a mais para alcançar o clone.
    net0: `virtio=${macFromIp(TEST_IP)},bridge=vmbr1,rate=${profile.rateMBs}`,
  });
  await waitTask(await ok('PUT', `/nodes/${node}/qemu/${TEST_VMID}/resize`, { disk: 'scsi0', size: profile.disk }), 'resize');
  check('config (cloud-init, rede com limite) + resize', true, `${profile.memory} MB, disco ${profile.disk}`);

  const tStart = Date.now();
  await waitTask(await ok('POST', `/nodes/${node}/qemu/${TEST_VMID}/status/start`), 'start');

  // Como a plataforma fará: a VM está pronta quando o agente responde (lado do Proxmox). Só depois o Windows é usado.
  // Pingar do Windows durante o boot deixa a entrada ARP "Unreachable" e atrasava o primeiro contato em ~45 s.
  await waitFor('agent/ping (VM pronta)', 240_000, async () => (await api('POST', `/nodes/${node}/qemu/${TEST_VMID}/agent/ping`)).status === 200);
  await waitFor('ping a partir do Windows', 240_000, async () => /TTL=/i.test(run('ping', ['-n', '1', '-w', '1000', TEST_IP]).out));
  await waitFor('SSH com a chave', 240_000, async () => sshVps('true').code === 0);
  const uptime = Number.parseFloat(sshVps('cat /proc/uptime').out);
  check('boot até o SSH', true, `${Math.round((Date.now() - tStart) / 1000)}s desde o start (uptime do kernel: ${Math.round(uptime)}s)`);

  const info = sshVps(
    [
      'cloud-init status --wait >/dev/null 2>&1; cloud-init status',
      `getent hosts ${profile.dnsName} >/dev/null && echo DNS_OK`,
      `${profile.su} -n true 2>/dev/null && echo SU_OK || ${profile.su} true && echo SU_OK`,
      "df -m / | awk 'NR==2{print \"ROOT_MB=\" $2}'",
      // /proc/partitions (KiB): tamanho do disco, da maior partição (a raiz) e espaço não alocado. No Alpine não há
      // tabela de partições (a raiz é o próprio /dev/sda); no Ubuntu, /boot e ESP ocupam ~1 GiB.
      "awk '$4==\"sda\"{d=$3} $4~/^sda[0-9]+$/{s+=$3; if($3>m)m=$3} END{if(!m)m=d; print \"PART_MB=\" int(m/1024) \" UNALLOC_MB=\" int((d-s*(s>0))/1024*(s>0))}' /proc/partitions",
      "free -m | awk '/^Mem:/{print \"MEM_USED=\" $3 \" MEM_TOTAL=\" $2}'",
      'hostname',
    ].join('; '),
  ).out;
  check('cloud-init terminou sem erro', /status: done/.test(info), info.match(/status: \w+/)?.[0]);
  check('DNS resolve nomes', info.includes('DNS_OK'), profile.dnsName);
  check(`${profile.su} sem senha para o usuário "${TEST_USER}"`, info.includes('SU_OK'));
  const rootMb = Number(info.match(/ROOT_MB=(\d+)/)?.[1] ?? 0);
  const partMb = Number(info.match(/PART_MB=(\d+)/)?.[1] ?? 0);
  const unallocMb = Number(info.match(/UNALLOC_MB=(\d+)/)?.[1] ?? -1);
  const diskMb = Number.parseInt(profile.disk, 10) * 1024;
  check(
    'raiz expandida até o fim do disco',
    unallocMb >= 0 && unallocMb < 32 && rootMb > partMb * 0.85,
    `sistema de arquivos ${rootMb} MB, partição ${partMb} MB, não alocado ${unallocMb} MB, disco ${diskMb} MB`,
  );
  check('hostname = nome da VM', info.includes(`favo-test-${profile.image}`));
  const mem = info.match(/MEM_USED=(\d+) MEM_TOTAL=(\d+)/);
  if (mem) step(`RAM em uso dentro da VM: ${mem[1]} MB de ${mem[2]} MB`);

  check('guest agent responde (agent/ping)', (await api('POST', `/nodes/${node}/qemu/${TEST_VMID}/agent/ping`)).status === 200);

  await ok('POST', `/nodes/${node}/qemu/${TEST_VMID}/agent/set-user-password`, { username: 'root', password: rootPassword });
  const shadow = sshVps(`${profile.su} grep '^root:' /etc/shadow | cut -d: -f2 | cut -c1-3`).out.trim();
  check('senha root pelo agente (agent/set-user-password)', /^\$\w+\$?/.test(shadow), `hash começa com "${shadow}"`);

  const vnc = await api('POST', `/nodes/${node}/qemu/${TEST_VMID}/vncproxy`, { websocket: 1 });
  check('vncproxy com o token (console noVNC)', vnc.status === 200 && Boolean(vnc.data?.ticket && vnc.data?.port), `status ${vnc.status}`);

  if (profile.desktop) {
    const lightdm = sshVps(`${profile.su} rc-service lightdm status`).out.trim();
    check('LightDM ativo', /started/.test(lightdm), lightdm);
    await sleep(15_000); // dá tempo de o greeter desenhar a tela
  }

  // Captura do VGA (o que o noVNC mostra), via monitor QEMU como root: só diagnóstico (receita 7.5 do CLAUDE.md).
  const dir = join('test-results', 'pve');
  mkdirSync(dir, { recursive: true });
  const png = join(dir, `${templateId}-${profile.image}-vga.png`);
  const toPng = [
    'import zlib, struct',
    'd=open("/tmp/favo-vga.ppm","rb").read(); p=d.split(b"\\n",3); w,h=map(int,p[1].split()); px=p[3]',
    'raw=b"".join(b"\\x00"+px[y*w*3:(y+1)*w*3] for y in range(h))',
    'c=lambda t,b: struct.pack(">I",len(b))+t+b+struct.pack(">I",zlib.crc32(t+b)&0xffffffff)',
    'open("/tmp/favo-vga.png","wb").write(b"\\x89PNG\\r\\n\\x1a\\n"+c(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+c(b"IDAT",zlib.compress(raw,9))+c(b"IEND",b""))',
    'print(w, h)',
  ].join('\n');
  const dump = sshRoot(`echo "screendump /tmp/favo-vga.ppm" | qm monitor ${TEST_VMID} >/dev/null && python3 -`, toPng);
  const scp = run('scp', ['-q', '-o', 'BatchMode=yes', `root@${pveHost}:/tmp/favo-vga.png`, png]);
  check('captura da tela VGA', dump.code === 0 && scp.code === 0, `${png} (${dump.out.trim()}) — conferir o login na imagem`);

  if (keep) {
    step(`--keep: VM ${TEST_VMID} mantida (${TEST_USER}@${TEST_IP}, senha ${password})`);
  } else {
    const tStop = Date.now();
    await waitTask(await ok('POST', `/nodes/${node}/qemu/${TEST_VMID}/status/shutdown`, { timeout: 60, forceStop: 1 }), 'shutdown', 120_000);
    check('desligamento (ACPI) com o token', true, `${Math.round((Date.now() - tStop) / 1000)}s`);
    await waitTask(await ok('DELETE', `/nodes/${node}/qemu/${TEST_VMID}`, { purge: 1, 'destroy-unreferenced-disks': 1 }), 'destroy');
    check('exclusão com o token', (await api('GET', `/nodes/${node}/qemu/${TEST_VMID}/status/current`)).status !== 200);
  }

  const del = await api('DELETE', `/nodes/${node}/qemu/${templateId}`);
  check('template protegido: DELETE com o token → 403', del.status === 403, `${del.status} ${del.message}`);
}

try {
  await main();
} catch (err) {
  check('execução', false, err.message);
  if (!keep) await destroyTestVm().catch((e) => console.error('falha ao limpar a VM de teste:', e.message));
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n❌ ${failed.length} verificação(ões) falharam` : `\n✅ template ${templateId} aprovado`);
process.exit(failed.length ? 1 : 0);
