# CLAUDE.md — Favo (VPS Rental Platform)

Contexto para o Claude implementar este projeto em conversas novas. **O plano completo e as decisões estão em
[docs/PLANO_DE_IMPLEMENTACAO.md](docs/PLANO_DE_IMPLEMENTACAO.md)** (revisão 18, 2026-09-24). Este arquivo resume o
que não dá para deduzir do código: regras combinadas com o usuário, estado do ambiente, armadilhas já encontradas
(com a solução) e comandos que já foram testados.

> Antes de agir no laboratório, **confira o estado real** (Proxmox, VirtualBox, MySQL): o que está aqui era
> verdade em 2026-09-23 e pode ter mudado.

## 1. O projeto em uma página

- Plataforma fictícia de aluguel de VPS chamada **Favo** (marca aprovada; identidade visual no plano, §14.6).
  Cadastro/login, pagamento **simulado**, criar/alterar/excluir VPS (VMs KVM reais no Proxmox), console noVNC,
  chat de suporte com fila e RBAC (uma role por usuário, verificação por permissão).
- Stack: **um servidor Node** (Express 5 + Vite em `middlewareMode`, `appType: 'custom'`) servindo API, Socket.IO,
  proxy do console e o React 19 (Vite 8, Tailwind 4, shadcn). TypeScript 7, tsyringe, Prisma 7 + MySQL 8.4, Biome.
- Fases (§17 do plano): 0 laboratório → 1 fundação → 2 banco → 3 auth/CSRF/RBAC → 4 Proxmox → 5 catálogo/pagamento →
  6 provisionamento → 7 página da VPS + console → 8 suporte → 9 qualidade → 10 extras.
- **Situação atual:** Fases 0 a 9 concluídas. Fase 0: laboratório (plano §2.7), scripts em `scripts/pve/`. Fase 1:
  fundação (servidor único Express+Vite, React com marca Favo, i18n, tema, Vitest, Biome). Fase 2: Prisma 7 + MySQL
  (schema, migration `init`, seeds idempotentes). Fase 3: sessão, CSRF, RBAC, conta, chaves SSH e administração de
  usuários. Fase 4: integração com o Proxmox (`src/server/integrations/proxmox/`, provider atrás da interface
  `VirtualizationProvider`, CLI `npm run pve`, suíte `npm run test:lab`). Fase 5: catálogo, capacidade, pedido (`POST /api/vps`), pagamento simulado e telas de criação,
  checkout e faturas. Fase 6: fila de jobs no MySQL + worker no próprio processo (`src/server/jobs/`), provisionamento real,
  ações de energia, troca de plano, exclusão, reconciliação a cada 60 s e Socket.IO autenticado (`src/server/realtime/`,
  cliente em `src/client/features/realtime/useRealtime.ts`). Fase 7: página da VPS (`src/client/features/vps/detail/`: abas
  Visão geral, Console, Métricas, Acesso, Configurações e Histórico), console noVNC por proxy `ws`
  (`src/server/realtime/consoleProxy.ts`, sessão de uso único em `ConsoleService`), acesso pelo guest agent
  (`VpsAccessService`), métricas/estado ao vivo (`VpsInsightsService`) e o roteiro `@lab` `tests/lab/lifecycle.lab.test.ts`.
  Fase 8: suporte (`/support` do cliente, `/agent` do técnico; `SupportService`, chat pelo Socket.IO com ack, fila na
  sala `agents`). Fase 9: E2E (`e2e/`, `npm run test:e2e`), cobertura, README, `docs/arquitetura.md` e
  `docs/seguranca.md`. Fase 10 (extras, na ordem do plano): 1 console de texto (xterm.js + termproxy), 2 firewall anti-spoofing por VPS e
  3 cobrança recorrente (`billing_cycle`, `Vps.paidUntil`, relógio acelerado `BILLING_TIME_SCALE`) feitos; o próximo é o 4
  (painel admin ampliado). **O banco de dev tem a VPS de demonstração da Ana** (ver §4, linha VMs).
- **Proxmox no código:** `ProxmoxClient` (undici + CA + servername, token, zod), `TaskWaiter` (UPID), `QemuCloudInitProvider`
  (clone, cloud-init, resize, energia, status, pendências, métricas, console, guest agent) e `ImageProfile` (comandos fixos por
  família). Os testes comuns usam `tests/helpers/FakeVirtualizationProvider.ts`; só o `npm run test:lab` (LAB=1) toca o Proxmox.
  `npm run pve -- status | capacity | list | show <vmid> | task <upid> | reconcile --dry-run`.
- **Autenticação (Fase 3):** cookies `sid` (HttpOnly), `psid` (pré-sessão, HttpOnly) e `csrf` (lido pelo JS e devolvido
  em `X-CSRF-Token`); HMAC com `CSRF_SECRET` (no `.env.*`). Ordem dos middlewares em `src/server/http/routes/index.ts`.
  Permissões verificadas com `requirePermission`/`req.user.can()` no servidor e `useCan()` no cliente. Textos de tela
  em namespaces (`src/client/locales/<idioma>/{common,auth,account,admin,errors}.json`); mensagens de validação do zod
  são **chaves** (`errors:validation.*`) e erros da API são traduzidos pelo `code` (`src/client/lib/errors.ts`).
- **Banco:** `npm run db:setup:dev` (migrate + seed) · `db:seed:dev` · `db:migrate:test` (reset do banco de teste: exige o
  consentimento do usuário, N20) · `db:seed:test`. Usuários de demonstração: `admin@`, `ana@`, `bruno@` (clientes),
  `carla@`, `diego@` (técnicos) `favo.local`, senha em `SEED_DEFAULT_PASSWORD` no `.env.development`. Pool de IPs das VPS:
  `.200–.228` (o `.229` fica para testes manuais). Permissões: `src/shared/constants/permissions.ts` (fonte da verdade).
- **Comandos:** `npm run dev` (porta 3000, HMR na mesma porta) · `npm run build && npm start` · `npm run typecheck` ·
  `npm run lint` · `npm test` · `npm run deps:stable -- <pkg>` · `npm run deps:check`.
- **Convenções do código:** servidor com imports relativos **com extensão `.ts`** (reescritos para `.js` no build; nada de
  alias no servidor). Cliente com aliases `@/` (src/client) e `@shared/` (src/shared). Textos de tela só em
  `src/client/locales/<idioma>/common.json` (o pt-BR é a fonte dos tipos; um teste confere que os 3 idiomas têm as mesmas chaves).
  Cores só por tokens (`src/client/styles/theme.css`; `text-link` para texto de destaque, **nunca** `text-primary` sobre fundo claro).

## 2. Regras combinadas com o usuário (obrigatórias)

1. **Responder em português (pt-BR).** Interface em pt-BR por padrão, com en-US e es-ES (i18next). Moedas BRL/USD/EUR
   **só na exibição do frontend**: cobrança, banco e VMs continuam em BRL/pt-BR.
2. **Fazer um commit ao fim de cada fase** (na `main`, sem criar branch, a menos que o usuário peça), com mensagem
   descritiva em português. Antes, conferir com `git status`/`git diff` que nenhum segredo entra (`.env*` e `certs/` estão
   no `.gitignore`). Depois do commit, entregar um resumo (arquivos, decisões, como testar). Nunca usar
   `--no-verify` nem reescrever o histórico (`push --force`, `reset --hard`, `rebase`) sem o usuário pedir.
   **Depois do resumo, começar a próxima fase automaticamente** (pedido do usuário em 2026-09-23). Parar e perguntar só quando algo exigir uma decisão dele.
3. **Dependências — só a maior versão ESTÁVEL** (sem `-rc`, `-beta`, `-dev`…). A tag `latest` do npm **não** é critério.
   - Conferir antes: `npm run deps:stable -- <pkg>` (`scripts/deps/stable-versions.mjs`; depois de CLIs que instalam pacotes, `npm run deps:check`).
   - **A versão instalada vem SEMPRE da saída do `deps:stable` rodado na hora**, nunca da memória do Claude nem da tabela
     do plano (que é só uma fotografia de 2026-09-23). Sem consulta prévia, não há `npm install`.
   - Instalar **sempre com versão exata**: `npm install <pkg>@<versão>` (`save-exact=true` no `.npmrc`).
   - **Nunca editar dependências do `package.json` à mão.** Só `npm install`/`npm uninstall`; outros campos com `npm pkg set`.
   - **Proibido `--force`/`--legacy-peer-deps`.** Em conflito de peer dependency, trocar de ferramenta ou perguntar ao usuário.
   - Depois de CLIs que instalam pacotes sozinhas (`shadcn init/add`), rodar `npm run deps:check`.
   - Não usar geradores que gravam versões fixas (`npm create vite`); começar com `npm init -y`.
4. **Proxmox: nunca de memória.** Consultar a doc oficial e o schema da API (`apidoc.js`, ver §7.2) e testar no laboratório.
5. **tsyringe: sempre `@inject(TOKEN)` explícito** em todo parâmetro de construtor (o `tsx`/esbuild não emite `design:paramtypes`).
6. **Segredos fora do git** (`.env*`, `certs/`). Senhas de VPS nunca em texto puro no banco (payload de job cifrado com
   AES-256-GCM e apagado após o uso). Nunca expor `agent/exec` ao cliente.
7. Todo texto de tela nasce como chave de tradução (`t('...')`). Cores e fontes só pelos tokens da marca.
8. Verificar telas com o **Playwright MCP**; testes contra o laboratório ficam marcados `@lab` (fora do CI).

## 3. Ambiente da máquina (Windows 11)

| Item | Valor |
|---|---|
| Hardware | i3-10100F (4c/8t), **8 GB RAM**. O Windows costuma ter só ~1,6 GB livres com o Proxmox desligado |
| Shells | Ferramenta Bash = **Git Bash** (use sintaxe POSIX) e PowerShell 5.1 |
| Node / npm | v24.12.0 / 11.6.2 |
| MySQL | Serviço `MySQL84` (8.4.6), porta 3306. Cliente fora do PATH: `"/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"` |
| VirtualBox | 7.2.12. `"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"`. VM do Proxmox: **`Segundo Proxmox`** (outras VMs: `coolify-ubuntu-server-2604-lts`, `alpine`, não mexer) |
| SSH | OpenSSH 10.3, chave `~/.ssh/id_ed25519` (instalada no root do Proxmox) |
| Arquivos temporários | Usar o **scratchpad** da sessão, nunca o `/tmp` (ver armadilha T2) |

## 4. Laboratório Proxmox (estado em 2026-09-23)

| Item | Valor |
|---|---|
| Proxmox VE | **9.2.2**, kernel 7.0.2-6-pve, nó **`primeiro`** (standalone) |
| Acesso | Web/API `https://192.168.56.10:8006` (certificado autoassinado) · `ssh root@192.168.56.10` (chave, sem senha) |
| Senha do root do Proxmox / MySQL | No §0/§0.2 do plano (fornecidas pelo usuário). Normalmente não são necessárias: use SSH com chave e o usuário `vps_app` |
| VM no VirtualBox | 2 vCPU, **3 GB**, **nested VT-x ligado**, Adaptador 1 = NAT (`nic0`), Adaptador 2 = Host-only com promíscuo `allow-all` (`nic1`) |
| Se o PC reiniciar | Ligar a VM: `VBoxManage startvm "Segundo Proxmox" --type headless` e esperar ~20 s pela porta 8006 |
| Rede | `vmbr0` = 10.0.2.15/24 sobre `nic0` (NAT, saída para a internet) · **`vmbr1` = 192.168.56.10/24 sobre `nic1`** + `MASQUERADE -s 192.168.56.0/24 -o vmbr0` |
| IPs | DHCP do host-only: `.101–.199`. **VPS: `.200–.228`** (IPAM no banco, tabela `ip_addresses`). `.229` = testes manuais. `.250` = build de templates. Windows = `.1` |
| DNS do nó | 45.5.96.96 (search `promox.teste`) |
| Storage | `local` (dir, `/var/lib/vz`, ~2,8 GB livres) · `local-lvm` (lvmthin `data`, **16,8 GB**; VDI aumentado para 30 GB na Fase 0) |
| RAM | O Proxmox usa ~1,3–1,4 GB; sobram **~1,5 GB para as VPS**. O Windows costuma ficar com só ~0,5 GB livres com o Proxmox ligado |
| VMs | VPS da plataforma a partir do VMID **2000** (pool `vps-platform`; hoje só a VPS de demonstração da Ana, `favo-demo`, Alpine Nano só com a chave do Windows, criada no fim da Fase 7). Templates **9000** `favo-tpl-alpine`, **9001** `favo-tpl-debian`, **9002** `favo-tpl-ubuntu`, **9003** `favo-tpl-alpine-desktop` (pool `vps-templates`). VMID **9199** = clone temporário do teste de aceite (IP `.229`) |
| Identidade da plataforma | Pools `vps-platform` e `vps-templates`, role `VPSPlatformVM`, usuário `vpsplatform@pve`, token `vpsplatform@pve!backend` (`privsep=1`). Secret e demais `PVE_*` no `.env.development`; CA em `certs/pve-root-ca.pem` |
| Imagens cloud (checksums conferidos) | `/var/lib/vz/import/`: `generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2`, `debian-13-genericcloud-amd64.qcow2`, `ubuntu-24.04-minimal-cloudimg-amd64.img` |
| Backup da rede | `/root/interfaces.bak-20260923020356` (antes da `vmbr1`) e `/root/interfaces.bak-20260923215318` (antes da zona de conntrack) |
| Firewall | **Ligado no datacenter** (`/etc/pve/firewall/cluster.fw`, políticas ACCEPT, IPSet `management`) só para o anti-spoofing das VPS; zona de conntrack do NAT na `vmbr1`. Ver `scripts/pve/firewall.sh` e P5 |
| MySQL | Bancos `vps_platform_{dev,test,prod,shadow}` + usuário **`vps_app`** (só nesses bancos, `caching_sha2_password`). `DATABASE_URL` em `.env.development`/`.env.test`, e `SHADOW_DATABASE_URL` em `.env.development` |

### Scripts do laboratório (Fase 0, rodam no Git Bash a partir da raiz do repositório)
- `scripts/pve/bootstrap.sh [--rotate-token]`: idempotente. Envia a si mesmo por SSH, copia a CA e grava os `PVE_*` no `.env.development`.
  O secret só aparece na criação do token: se o `.env` perdeu o secret, use `--rotate-token`.
- `scripts/pve/firewall.sh`: idempotente. Liga o firewall do datacenter (políticas ACCEPT) com rollback automático de 3 min
  até conferir SSH e 8006, e grava a zona de conntrack do NAT (Fase 10, extra 2).
- `scripts/pve/build-template.sh <alpine|debian|ubuntu|alpine-desktop|all> [--force] [--no-test]`: se o template já existir,
  não faz nada (a menos que receba `--force`, que falha se houver clones vinculados). Depois do build, roda o teste.
- `node scripts/pve/test-template.mjs <9000|9001|9002|9003> [--keep]`: aceite **só com o token** (clone → VPS de verdade →
  verificações → exclusão → 403 no `DELETE` do template). Salva a tela VGA em `test-results/pve/<vmid>-<imagem>-vga.png`
  (abra com a ferramenta Read). `--keep` mantém a VM 9199 e imprime a senha.

## 5. Armadilhas encontradas (e a solução)

### Windows / VirtualBox
- **V1. "KVM virtualisation configured, but not available"** ao criar VM no Proxmox: a VM do VirtualBox estava com
  `nested-hw-virt=off`. **Na interface do VirtualBox a caixa "Nested VT-x/AMD-V" fica acinzentada**, mas o
  `VBoxManage modifyvm "Segundo Proxmox" --nested-hw-virt=on` (com a VM desligada) funciona. Para validar: `NestedHWVirt = 1`
  em `%USERPROFILE%\VirtualBox VMs\Segundo Proxmox\Logs\VBox.log`, e `grep -c vmx /proc/cpuinfo` > 0 + `/dev/kvm` no Proxmox.
- **V2. Não ativar WSL2, Docker Desktop, Hyper-V nem "Integridade de Memória"** no Windows: o VirtualBox cai para o modo
  NEM (tartaruga) e a virtualização aninhada **para de funcionar**. Hoje estão todos desativados (há um `com.docker.service`
  instalado, inativo). O log deve mostrar `HM: HMR3Init: VT-x w/ nested paging…` e `UseNEMInstead = 0`.
  **Aconteceu em 2026-09-24:** o usuário ligou o Hyper-V para testar o WSL; o log passou a mostrar `Attempting fall back to
  NEM: VT-x is not available`, o Proxmox ficou sem `/dev/kvm` (nenhuma VPS liga) e uma VM com `kvm: 0` (emulação) levou o nó
  a carga 35 com *soft lockups*. Alternar sem desinstalar nada (PowerShell como administrador + reiniciar):
  `bcdedit /set hypervisorlaunchtype off` (laboratório) / `auto` (WSL2). **Antes de qualquer teste `@lab`, confira o VBox.log.**
- **V3. O modo "Placa em modo Bridge" não aparece no VirtualBox** porque o driver `VBoxNetLwf` não está vinculado a nenhuma
  placa. **Não é necessário:** a bridge das VPS é Linux, **dentro do Proxmox** (`vmbr1` sobre a host-only).
- **V4. Pouca RAM no Windows:** por isso o Proxmox tem 3 GB, e não 4. Planos e capacidade foram dimensionados para isso.
- **V5.** Para que os guests aninhados falem com o Windows, o Adaptador 2 precisa de `--nic-promisc2=allow-all`
  (doc *Proxmox VE inside VirtualBox*).

### Proxmox: rede e sistema
- **P1.** O `apt` do Proxmox falhava por causa do repositório enterprise. O usuário resolveu rodando o script da comunidade
  `post-pve-install` (community-scripts.org), que também desativou o cluster e o aviso de assinatura.
- **P2. Mudar a rede pode derrubar o acesso.** A técnica usada e que funcionou: fazer backup, agendar um rollback
  automático e só então aplicar:
  `systemd-run --unit=net-rollback --on-active=180 /bin/sh -c "cp /root/interfaces.rollback /etc/network/interfaces && ifreload -a"`,
  depois `systemd-run --unit=net-apply /bin/sh -c "sleep 2; ifreload -a"`. Se o acesso sobreviver: `systemctl stop net-rollback.timer`.
- **P3.** No PVE 9, as placas se chamam `nic0`/`nic1` (com *altnames* `enx…`), e não `enp0s3`.
- **P4.** `growpart`/`parted` **não vêm instalados** no Proxmox (para aumentar o disco: `apt install cloud-guest-utils`).
- **P5. Firewall + NAT:** com o firewall ligado nas VMs, a saída pelo MASQUERADE quebra (dentro da VPS: `wget: bad address`).
  Solução da doc ("Masquerading (NAT) with iptables"): `iptables -t raw -I PREROUTING -i fwbr+ -j CT --zone 1` (post-up/down da
  `vmbr1`). O `pve-firewall localnet` detecta como rede local a `10.0.2.0/24` (NAT), não a host-only: por isso as políticas do
  host ficam `ACCEPT` (com `DROP` o Windows perderia a GUI e o SSH). Mudar o `firewall=1` do `net0` com a VM ligada é
  aplicado na hora (sem pendência).

### Proxmox: API e permissões
- **A1.** Use **API token** (`Authorization: PVEAPIToken=user@realm!tokenid=uuid`): não precisa de `CSRFPreventionToken`
  e não expira em 2 h como o ticket `PVEAuthCookie`.
- **A2. `GET /pools/{poolid}` está deprecated** no PVE 9. Use `GET /pools?poolid=<id>`. Listar pools exige `Pool.Audit`.
- **A3.** Nomes de privilégios no PVE 9 (conferidos em `/access/roles`): `VM.GuestAgent.Audit`, `VM.GuestAgent.FileRead`,
  `VM.GuestAgent.FileWrite`, `VM.GuestAgent.Unrestricted`, `VM.Config.Cloudinit`, `VM.Config.HWType`, `SDN.Use` etc.
  O antigo `VM.Monitor` não aparece.
- **A4. Clone** exige `VM.Clone` no template + `VM.Allocate` no pool/novo VMID + `Datastore.AllocateSpace` + **`SDN.Use` na
  bridge** (ACL em `/sdn/zones/localnetwork/vmbr1`).
- **A5.** `agent/set-user-password` e `agent/exec` exigem `VM.GuestAgent.Unrestricted`. `agent/file-write` exige
  `FileWrite` ou `Unrestricted`. `agent/ping` exige `VM.GuestAgent.Audit`.
- **A6.** `vncproxy` retorna `cert, password, port, ticket, upid, user` (o `password` é a senha do protocolo VNC).
  O `vncwebsocket` exige `port` + `vncticket`, e os dois aceitam API token (`allowtoken=1`).
- **A7.** No `net[n]` do QEMU, `rate` é em **MB/s** ("megabytes per second"): 10 Mbps = 1,25.
- **A8.** Resize: *"Shrinking disk size is not supported"*. Com `+`, soma; sem `+`, é o tamanho absoluto.
- **A9. O certificado do Proxmox NÃO tem `192.168.56.10` no SAN** (só `10.0.2.15`, `primeiro`, `primeiro.promox.teste`, localhost).
  Solução adotada: conectar no IP e validar pelo nome do nó, com `servername: 'primeiro'` + `ca` (Node `https`/undici) ou
  `curl --cacert certs/pve-root-ca.pem --resolve primeiro:8006:192.168.56.10 https://primeiro:8006/...`. Não desligue a verificação.
- **A10.** O `DELETE` de um template com o token devolve `403 Permission check failed (/vms/9000, VM.Allocate)`: prova de que os
  templates estão protegidos. O token cria clones vinculados em ~1 s.
- **A11. ARP do Windows atrasa o primeiro contato com uma VPS nova.** Pingar a VM **a partir do Windows durante o boot** deixa a
  entrada ARP `Unreachable`/`Incomplete`, e o Windows só volta a tentar ~45 s depois (o teste media sempre 72 s; o Proxmox já
  pingava em ~26 s). O mesmo acontece com uma entrada `Stale` de um MAC antigo no mesmo IP. Soluções adotadas: (1) considerar a VM
  pronta pelo **`agent/ping`** (lado do Proxmox) e só então usar o Windows → start até o SSH em ~33 s; (2) **MAC derivado do IP**
  (`02:00:` + IPv4 em hex, ex. `.229` → `02:00:C0:A8:38:E5`) no `net0=virtio=<MAC>,…`, para que um IP reutilizado não deixe o
  MAC antigo no cache. Diagnóstico: `Get-NetNeighbor -IPAddress 192.168.56.229` no PowerShell.
- **A12. `reboot` é ACPI (desligar + ligar):** com o sistema ainda bootando (logo depois de ligar) o ACPI é ignorado e a task
  falha com `VM quit/powerdown failed - got timeout` (~63 s). O provider cai para `stop` + `start` (que também aplica as
  pendências). O `qmstart` como `root@pam` que aparece no log depois de um reboot é o próprio Proxmox religando a VM.
- **A14. Console de texto (`termproxy`, Fase 10):** `POST …/qemu/{vmid}/termproxy {serial: "serial0"}` devolve `port, ticket, user`
  (aceita token, `VM.Console`); o WebSocket é o mesmo `vncwebsocket?port&vncticket`. Protocolo (`pve-xtermjs` do nó): 1ª mensagem
  `<user>:<ticket>\n`, resposta `OK`, depois dados `0:<bytes UTF-8>:<texto>`, redimensionar `1:<cols>:<rows>:` e ping `2`. A
  serial não tem histórico: o cliente manda um Enter (`0:1:\r`) para o getty reimprimir o `login:`.
- **A15. Firewall da VM por API:** `…/firewall/ipset` e `…/firewall/options` exigem `VM.Config.Network` (leitura:
  `VM.Audit`); booleanos vão como `1`/`0`. Para VMs, o `ipfilter: 1` só libera os endereços do IPSet `ipfilter-net0` (e os
  link-local): **sem o IPSet, a VPS fica sem rede IPv4**. Contraprova do anti-spoofing: `ip addr add <outro IP>` + `ping -I`.
- **A13. noVNC do próprio Proxmox** (`/usr/share/novnc-pve/app.js`): `password = data.password ?? data.ticket`,
  `vncwebsocket?port=…&vncticket=…`, subprotocolo `binary`. O proxy da Favo faz o mesmo. `get-fsinfo` do agente devolve
  `result[].mountpoint/used-bytes/total-bytes` (aceita token, `VM.GuestAgent.Audit`). Pendência de memória aparece em
  `/pending` com `key: memory`.

### Imagens cloud e cloud-init
- **C1. O Proxmox gera `package_upgrade: true`** no user-data (veja com `qm cloudinit dump <vmid> user`). Isso faz a VM
  atualizar tudo no primeiro boot: mais de 4 min no Ubuntu, e falha no Alpine sem DNS. **Clonar com `ciupgrade=0`**
  (os templates são atualizados no build).
- **C2. Alpine sem DNS:** o cloud-init grava `dns-nameservers` em `/etc/network/interfaces`, mas o `ifupdown-ng` não gera o
  `/etc/resolv.conf`. **`apk add openresolv` NÃO resolve** (testado). O que resolve é o
  `/etc/cloud/cloud.cfg.d/99-vpsplatform.cfg` com `manage_resolv_conf: true` + `resolv_conf: {nameservers: ["1.1.1.1","8.8.8.8"]}`
  (vai no template 9000/9003). Debian e Ubuntu não têm esse problema.
- **C3. Nenhuma das imagens traz `qemu-guest-agent`:** ele é instalado nos templates (`apk add` + `rc-update add` / `apt-get install`).
- **C4. `sshkeys` fica URL-encoded** na config (`ssh-ed25519%20AAAA…`). Pela API, envie a chave já codificada
  (validar na Fase 4). Chaves lidas do Windows vêm com **`\r\n`**: normalize antes.
- **C5.** O hostname da VPS vem do **`name` da VM** (o Proxmox o coloca no user-data), então precisa ser um hostname válido.
- **C6. Discos mínimos das imagens:** Alpine 200 MiB, **Debian 3 GiB**, **Ubuntu 3,5 GiB** (não dá para reduzir).
- **C7. (Resolvido: não é bug.)** No Ubuntu, a raiz fica com 2,9 GB num disco de 4 GB porque o `/boot` (`sda16`, 913 MB) e a
  ESP (106 MB) ficam **antes** da raiz; o `growpart` leva o `sda1` até o fim do disco. No Alpine não há tabela de partições
  (a raiz é o próprio `/dev/sda`). O teste confere o espaço não alocado em `/proc/partitions`, não o `df`.
- **C8.** O Proxmox gera `user:` no cloud-config, o que o cloud-init 26 marca como *deprecated*. É só um aviso.
- **C9.** Use `--vga std` (**não** `--vga serial0`, como no exemplo da doc de Cloud-Init): o VGA mostra o `login:` no `tty1`
  (confirmado no Alpine e no Debian), e é isso que o noVNC exibe. Mantenha também `--serial0 socket`.
- **C10.** Tempos e RAM medidos (VM de teste, KVM ativo): Alpine ~63 s até o SSH, 34 MB usados; Debian ~73 s, 84 MB;
  Ubuntu ~72 s, ~160 MB. O processo `kvm` de uma VM de 256 MB ocupa ~225 MB no host. `qm shutdown` (ACPI) leva ~4 s no Alpine.
- **C11. Senha root pelo agente funciona:** `pvesh create /nodes/primeiro/qemu/<id>/agent/set-user-password --username root --password '…'`
  (o root passou de `L` para `P`, e `su root` funcionou), sem reboot.
- **C12. Alpine Desktop:** `BROWSER=xfce4-taskmanager setup-desktop xfce` (com argumento, roda sem perguntas; conferido no
  código-fonte do `alpine-conf`). Sem o `BROWSER`, o script instala o Firefox (`${BROWSER:-firefox}`; variável vazia não
  adianta). A wiki do Alpine devolve 403 para o WebFetch: use o código-fonte em
  `https://gitlab.alpinelinux.org/alpine/alpine-conf/-/raw/master/<script>.in`.
- **C13.** Usuários padrão: `alpine` (usa `doas`), `debian` e `ubuntu` (usam `sudo`, sem senha). Por padrão, o root fica
  bloqueado (`L`) no Debian.
- **C27. Alpine com conta só de chave fica travada** (`Permission denied (publickey…)`) se a VM for criada à mão sem
  `--cipassword`: a plataforma resolve com o `unlockForKeyLogin` do `ImageProfile`; em VMs de teste manuais, passe uma senha.
- **C14. Qualquer `ciuser` funciona** (testado com `favo`): no Debian/Ubuntu o `default_user` tem `sudo: ALL=(ALL) NOPASSWD:ALL`;
  no Alpine o cloud-init grava `permit nopass <usuário>` no `/etc/doas.conf`, e a imagem já tem `/etc/doas.d/wheel.conf`
  (`permit nopass :wheel`), com o usuário no grupo `wheel`. O Alpine tem `ssh_pwauth: false` no `cloud.cfg` (SSH por senha
  desligado de fábrica).
- **C15. Os templates não têm o usuário do build:** a limpeza (via `qm guest exec`, como root) faz `userdel -r`, apaga as regras
  de sudo/doas dele e roda `cloud-init clean --logs --seed --machine-id`. Senão, uma VPS com outro usuário ficaria com
  `alpine`/`debian`/`ubuntu` sobrando.
- **C16.** Tempos (A11): clone vinculado ~1 s; start → `agent/ping` ~30 s → SSH ~33 s (Alpine/Debian/Ubuntu). RAM após o boot:
  Alpine 58 MB, Debian 113 MB, Ubuntu 185 MB. O `apk upgrade` do build levou o kernel do Alpine para 6.18.53.
- **C18. Política de SSH pelo agente:** nas três imagens o `Include /etc/ssh/sshd_config.d/*.conf` vem ANTES das diretivas, e
  **no sshd o primeiro valor lido vence**. O Alpine traz `50-cloud-init.conf` e o Ubuntu `60-cloudimg-settings.conf` (os dois com
  `PasswordAuthentication no`); o Debian define no `sshd_config`. Por isso o arquivo da Favo é **`01-favo.conf`** (um `60-favo.conf`
  perderia). Alpine vem com `KbdInteractiveAuthentication yes` (desligado no drop-in). Reload: Alpine `rc-service sshd reload`;
  Debian/Ubuntu `systemctl try-reload-or-restart ssh` (no Ubuntu 24.04 o ssh é ativado por socket e o serviço pode estar
  parado), sempre depois de `sshd -t`. Testado com **login por senha de verdade** (SSH_ASKPASS) nas quatro imagens.
- **C19. `vncproxy` com token:** o `ticket` vem como **`<senha VNC de 8 caracteres>:PVEVNC:…`** (o prefixo é o próprio `password`
  da resposta), com caracteres especiais: use `encodeURIComponent` ao passar o `vncticket` na URL do `vncwebsocket` (Fase 7).
- **C20. Guest agent:** `agent/exec` recebe `command` como array (form-urlencoded com a chave repetida) e devolve `pid`; o
  resultado vem de `agent/exec-status?pid=` (`exited`, `exitcode`, `out-data`, `err-data`). `agent/file-write` codifica em
  base64 sozinho (`encode` padrão). Enquanto a VM boota, `agent/ping` devolve erro (o provider trata como "ainda não").
  O status de um VMID fora dos pools do token volta como "não existe" (o provider devolve `null`). Trocar memória com a VM
  ligada fica pendente (aparece em `/pending`); o `net0` com `rate` é aplicado na hora.
- **C17. Alpine Desktop:** o LightDM sobe com ~50 s de uptime; RAM 253 MB no greeter e ~350 MB com o XFCE aberto (VM de 1 GB).
  **Login gráfico com a senha do `cipassword` funciona** (testado digitando pelo monitor QEMU: `sendkey shift-f`, `minus`, `ret`…),
  sem precisar dos grupos `audio`/`video` (o `elogind` cuida do seat). O `default_user` do Alpine tinha `gecos: alpine Cloud User`,
  que aparecia no LightDM para qualquer usuário: o `99-vpsplatform.cfg` sobrescreve com `system_info.default_user.gecos: ""`
  (o merge dos `cloud.cfg.d` é recursivo; testado).
- **C21. Alpine: conta só com chave nasce BLOQUEADA e o SSH recusa até a chave.** Sem `cipassword`, o cloud-init grava `!` no
  `/etc/shadow`; o sshd do Alpine é compilado **sem PAM**, e o OpenSSH só checa conta bloqueada sem PAM (`auth.c`:
  `!options.use_pam && platform_locked_account`; no Linux, bloqueada = hash começando com `!`). Log: *"User ana not allowed because
  account is locked"*. Correção: `unlockForKeyLogin` no `ImageProfile` do Alpine troca `!` por `*` (sem senha válida, mas não
  bloqueada). Debian/Ubuntu usam PAM e não têm o problema. A `favo-demo` não tinha o problema porque a conta tinha senha.
- **C22. O guest agent responde ANTES de o cloud-init terminar** (usuário, `authorized_keys`). Sem esperar, a VPS chegava a
  `RUNNING` com o SSH ainda recusando a chave. O job roda `cloud-init status --wait` pelo agente depois do `agent/ping` (saída 0 = ok,
  **2 = concluído com avisos**, ex. o `user:` deprecated da C8; 1 = erro). Com isso, pagamento → `RUNNING` em ~34 s no Alpine e o SSH
  funciona no mesmo instante.
- **C23. Cloud-init congelado depois do 1º boot.** O `instance-id` é `sha1(user-data + rede)` (`/usr/share/perl5/PVE/QemuServer/Cloudinit.pm`)
  e o hostname do user-data vem do `name` da VM: renomear (ou mudar `cipassword`/`sshkeys`) faz o cloud-init rodar como **nova
  instância** no próximo boot, e ele **regenera as chaves de host SSH** (testado). Por isso o provisionamento termina com
  `touch /etc/cloud/cloud-init.disabled` (o systemd e os scripts OpenRC do Alpine respeitam), e renomear/aumentar o disco são
  feitos pelo agente (`SET_HOSTNAME`, `GROW_ROOT_FS` no `ImageProfile`). Testado nas três famílias: reboot depois disso mantém
  senha, chaves de host, rede e SSH. **Nunca** mude a config de cloud-init de uma VPS já criada esperando efeito.
- **C24. Ubuntu 24.04: `sshd -t` falha antes da 1ª conexão** ("Missing privilege separation directory: /run/sshd"): o SSH é
  ativado por socket e o `/run/sshd` é o `RuntimeDirectory` do `ssh.service`, que ainda não rodou. O recarregamento faz
  `install -d -m 0755 /run/sshd` antes. A 1ª Ubuntu da plataforma caiu em `ERROR` por isso (e o rollback funcionou).
- **C25. Capacidade usa `memory.available`, não `memory.free`** (`/nodes/{node}/status`): o `free` não conta o cache de disco
  reaproveitável (786 MB livres × 1.451 MB disponíveis com o nó vazio), e a Desktop de 1 GB nunca cabia.
- **C26. Crescer a raiz online:** no Ubuntu o `/proc/mounts` mostra `/dev/root`; use `findmnt -n -o SOURCE /` (com o
  `/proc/mounts` como reserva para o Alpine, cuja raiz é o próprio `/dev/sda`, sem partição). `growpart` sai com 1 quando não
  há o que crescer. ext4 cresce com a VM ligada (`resize2fs`).

### Stack Node / npm (situação em 2026-09-23)
- **N1. `prisma` `latest` = `8.0.0-rc.15`** (pré-release). A maior estável é a **7.10.0** (igual para `@prisma/client` e
  `@prisma/adapter-mariadb`). `npm install prisma` sem versão instala a pré-release.
- **N2. TypeScript 7.0.2 é estável**, mas o `typescript-eslint` 8.70.1 exige `typescript <6.1`. Por isso o projeto usa o
  **Biome** (2.5.14) em vez de ESLint + Prettier. O TS 7 não tem API programática (`ts-jest`, `ts-loader`, plugins que usam
  `createProgram` não funcionam), mas emite `emitDecoratorMetadata`.
- **N3.** O `tsx` (esbuild) **não emite metadata de decorators**, daí a regra de `@inject` explícito.
- **N4. Prisma 7:** config em `prisma.config.ts` (`schema`, `migrations.path`, `migrations.seed`, `datasource.url`). O **seed
  não roda sozinho** no `migrate dev`/`reset`, só com `prisma db seed`. Generator `provider = "prisma-client"` com `output`.
  O pool é o `connectionLimit` do `PrismaMariaDb`. Validar `caching_sha2_password` (MySQL 8.4) no adapter; talvez precise de
  `allowPublicKeyRetrieval` local. Conferir o nome da chave do shadow DB no `prisma.config.ts`.
- **N5. Express 5:** o curinga de rota é nomeado: `app.get('/{*splat}', …)`. Erros de handlers `async` já vão para o error handler.
- **N6. Vite em modo middleware:** `createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'custom' })`,
  `app.use(vite.middlewares)`, HTML com `vite.transformIndexHtml(url, html)`. Em produção, `express.static(..., { index: false })`,
  para o `index.html` sempre passar pelo handler que emite o cookie CSRF.
- **N7. Socket.IO/engine.io destrói em 1 s upgrades que não são dele** (`destroyUpgrade: true`, `destroyUpgradeTimeout: 1000`).
  Com o proxy do console (`ws`, `noServer`) no mesmo `http.Server`, configure **`destroyUpgrade: false`**.
- **N8.** `@novnc/novnc` 1.7.0, mas os tipos (`@types/novnc__novnc`) estão na 1.6.0.
- **N9.** `react-router` 8.4 exige Node >= 22.22. `react-i18next` 17.0.15 e `i18next` 26.4.2 aceitam TS `^7`.
- **N10.** `shadcn` CLI 4.21.0 (use `npx shadcn@4.21.0 …` com a versão explícita). Não interativo:
  `npx shadcn@4.21.0 init -t vite -b radix -p nova -y --no-monorepo` (presets: `nova, vega, maia, lyra, mira, luma, sera, rhea`;
  `radix-nova` é inválido) e `npx shadcn@4.21.0 add <comp…> -y < /dev/null`. O init instalou `cn` (pacote **legítimo** do shadcn,
  substitui `clsx` + `tailwind-merge`, que foram removidos), a fonte Geist (removida) e o próprio `shadcn` em `dependencies`
  (movido para `devDependencies`: só o CSS o usa no build). O botão gerado usava `text-primary` na variante `link` (trocado por `text-link`).
- **N11. `tsx` lê o `tsconfig.json` da raiz**, que não tem decorators: o `dev` usa `tsx watch --tsconfig tsconfig.server.json`
  (sem isso: *"Parameter decorators only work when experimental decorators are enabled"*).
- **N12. Vitest/Vite 8 transformam TS com o oxc**, não com o esbuild: decorators via `oxc: { decorator: { legacy: true } }` no
  `vitest.config.ts`. O `emitDecoratorMetadata` fica **desligado de propósito** (igual ao tsx), para um `@inject` esquecido quebrar os testes.
- **N13. CSP de produção × Vite:** o Vite embute como `data:` os arquivos < 4 KiB, inclusive subconjuntos de fontes → bloqueados por
  `font-src 'self'`. Solução: `build.assetsInlineLimit` com callback que devolve `false` para fontes. Em dev, o `@vite/client` cria
  um worker via `blob:` → `worker-src 'self' blob:` só em dev. Tema sem "flash": `public/theme-init.js` (arquivo externo, pois
  `script-src 'self'` proíbe script inline).
- **N14. TS 7 com `module: nodenext`:** importar JSON exige `with { type: 'json' }`. Os imports `.ts` do servidor usam
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`. `rootDir: src` → o build sai em `dist/server` e `dist/shared`.
- **N15.** `dotenv` 18 é só CJS e loga por padrão: `config({ path, quiet: true })`.
- **N16. Cache do npx corrompido** (`ECOMPROMISED` / `Cannot find module …\_npx\<hash>\…`): apague só
  `%LOCALAPPDATA%\npm-cache\_npx\<hash>` e rode de novo.
- **N18. MySQL do Windows com `lower_case_table_names=1`:** todas as tabelas usam `@@map("snake_case")` em minúsculas
  (nomes PascalCase causariam *drift* falso no `migrate dev`). Com isso, um segundo `migrate dev` diz "Already in sync".
- **N19. Prisma 7 + adapter MariaDB:** conexão com `caching_sha2_password` funcionou com `allowPublicKeyRetrieval: true`
  (só para 127.0.0.1/localhost). Com o MySQL **fora do ar**, uma consulta espera o `acquireTimeout` (configurado para 5 s)
  e o **`$disconnect()` trava** (o pool continua tentando): o `/api/health` usa um `Promise.race` de 2 s, e o shutdown tem
  timeout forçado. O client gerado (`src/server/generated/prisma/`, fora do git) usa imports `.js`; importe
  `../generated/prisma/client.ts`. Rode `npm run db:generate` depois de clonar ou de mudar o schema.
- **N20. O Prisma 7 detecta agentes de IA e BLOQUEIA comandos destrutivos** (`migrate reset --force`, e provavelmente
  `db push --force-reset`): exige `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<texto exato da mensagem do usuário
  autorizando>"`. **Nunca contorne:** pergunte ao usuário (AskUserQuestion) a cada vez. Em 2026-09-23 o usuário autorizou
  o reset **só do `vps_platform_test`**. Os testes não dependem de reset: o
  seed é idempotente e cada teste cria/limpa os próprios dados.
- **N21. `npm audit`** acusa avisos em dependências transitivas do Prisma 7.10.0 (`mariadb` 3.4.5 fixado pelo adapter,
  `mysql2` e `deepmerge-ts` da CLI). Não há correção dentro da regra (o "fix" é voltar ao Prisma 6 com `--force`). Avaliado:
  não se aplicam (MySQL local sem TLS, charset utf8mb4, config controlada por nós). Plano §19.
- **N22. `shadcn add` na 4.21:** o `sonner` instala `next-themes` (trocado pelo `@/lib/theme` no `components/ui/sonner.tsx`
  e desinstalado); componentes com dependências já existentes param numa pergunta de sobrescrita. Rode antes com
  `--dry-run`, depois com `-y -o`, e **reaplique a variante `link` do `button.tsx`** (`text-link`). O Biome não faz lint em
  `src/client/components/ui/**` (código do shadcn; override no `biome.json`), só formata.
- **N23. Cookies não isolam por porta:** uma página em `localhost:3001` lê o cookie `csrf` de `localhost:3000`, e o
  `SameSite=Strict` a trata como o **mesmo site** (os cookies vão junto). Testado no navegador: o POST simples chega e leva
  **403 ORIGIN_INVALID** (`originCheck`), e o POST com o token roubado no header nem sai (o *preflight* CORS não é
  autorizado). **Nunca habilite CORS com credenciais.** O `originCheck` aceita `APP_ORIGIN` ou a própria origem do host.
- **N24. Express 5:** `req.query` é só leitura; o middleware `validate` grava o resultado em `res.locals.valid` (leia com
  `valid(res, 'body', schema)`). O `express-rate-limit` 8 exige `ipKeyGenerator()` para chaves com IP; os limites ficam
  desligados em `NODE_ENV=test`.
- **N25. Testes de integração:** `tests/globalSetup.ts` roda o seed no banco de teste; `fileParallelism: false` (banco
  compartilhado); `tests/helpers/client.ts` imita o navegador (cookies + `X-CSRF-Token`) e gera chaves SSH válidas.
  O console do navegador mostra um `401` do `/api/auth/me` para visitantes: é o comportamento esperado.
- **N26. i18next tipado:** `t()` só aceita chaves conhecidas; chaves dinâmicas (código de erro, role) passam pelos helpers
  de `src/client/lib/errors.ts` (`errorMessage`, `validationMessage`, `roleLabel`). zod 4: `z.stringbool()` para
  booleanos do `.env` e `{ error: 'chave' }` nas mensagens.
- **N27. Prisma 7: `migrate dev` NÃO roda mais o `generate`.** Depois de mudar o schema, o client ficava sem a coluna nova e
  o `create` falhava com *"Unknown argument"* (500). Os scripts `postdb:migrate:dev`, `postdb:migrate:reset` e `postinstall`
  do package.json regeneram o client sozinhos. Aplique a migration também nos bancos de teste e de produção local:
  `npx cross-env NODE_ENV=test prisma migrate deploy` (e `NODE_ENV=production`).
- **N28. Pagamento:** `POST /api/invoices/:id/pay` trava a fatura com `SELECT … FOR UPDATE` dentro de uma transação interativa
  (timeout 20 s) enquanto o gateway simulado "cobra"; pagamentos simultâneos esperam e levam 409 (testado com 3 em paralelo).
  Aprovado → fatura PAID + VPS PROVISIONING + job `provision_vps` na MESMA transação (outbox). As senhas escolhidas na criação
  ficam cifradas em `vps.provisionSecrets` até o pagamento e depois só no payload do job (SecretBox, `v1.<iv>.<tag>.<dados>`).
  Recusado → 402 `PAYMENT_DECLINED` com `details.failureCode`, e a fatura continua em aberto.
- **N29. Moeda:** só exibição (`src/client/lib/currency.ts`, taxas fixas de demonstração, prefixo "≈"); o checkout destaca o BRL.
  O `ApiError.details` do cliente é `unknown`: lista de campos no `VALIDATION_ERROR`, objeto nos outros erros.
- **N30. Worker e Socket.IO (Fase 6):** o `main.ts` sobe o Socket.IO (`attachSocketIo`) no mesmo `http.Server` e o `JobWorker`
  (se `WORKER_ENABLED`, padrão `true`). Nos testes não há timers: `di.resolve(JobWorker).drain()` processa a fila na hora com o
  `FakeVirtualizationProvider` (use `VPS_WAIT_SSH: false` no `createTestApp`). Quem emite eventos usa o `RealtimeHub`
  (`TOKENS.Realtime`), que guarda os últimos 200 em `sent` (útil nos testes). `Vps.lastError` guarda só **códigos**
  (`VPS_ERROR_CODES` em `src/shared/constants/vps.ts`, traduzidos em `vps:lastError.*`); o detalhe técnico fica no `Job.lastError`.
  A tabela de transições (`VPS_TRANSITIONS`) é compartilhada entre servidor e cliente.
- **N31. noVNC 1.7 no Vite:** o pacote exporta `.` → `core/rfb.js`, mas os tipos 1.6 só declaram `@novnc/novnc/lib/rfb`
  (shim em `src/client/types/novnc.d.ts`). Usa *top-level await* (`core/util/browser.js`): o target padrão do Vite 8 aceita.
  Console e Métricas são `React.lazy` (noVNC + recharts tiravam o pacote inicial de 654 kB para 1,5 MB). No `StrictMode`
  (dev) o efeito do console monta duas vezes: a conexão é adiada um tick e numerada, senão abre 2 RFB e gasta as 2 sessões.
- **N32. `shadcn add chart` instala `recharts@3.8.0`** (versão fixa do registry), abaixo da maior estável: depois do `add`,
  `npm install recharts@<maior estável>` e `npm run deps:check`. O `chart` exige a peer `react-is` (instalada pelo npm).
- **N33. Testes `@lab` e o banco de teste:** o roteiro `lifecycle.lab.test.ts` usa o IP `.229` (entra no pool do banco de teste
  só durante o roteiro; os outros ficam `RESERVED`), porque o pool `.200–.228` do banco de teste é a MESMA rede das VPS de dev.
  Um `afterAll` que expira deixa sobras (IPs `RESERVED`, VPS `PROVISIONING`) que quebram o `npm test` depois: se isso
  acontecer, confira `select status,count(*) from vps where deletedAt is null group by status` no `vps_platform_test`.
  Um upgrade para `/ws/<caminho inválido>` ficava pendurado (sem resposta) e travava o `server.close()`: hoje recebe 404.
- **N34. Um socket só por aba:** o `RealtimeProvider` (em `AppLayout`) abre o Socket.IO e o expõe por `useSocket()`; as telas
  (chat, fila) registram os próprios eventos nele. O efeito dependia do `t` do i18next, que muda ao trocar de idioma: **trocar o
  idioma derrubava e reabria o socket**. Hoje o `t` fica numa ref. Eventos de chat vão para `user:<id>` (participantes lidos do banco).
- **N35. Testes intermitentes por falta de RAM:** cada cadastro/login faz um argon2id (64 MiB por hash). Com o Proxmox, VPS e
  navegadores do Playwright abertos, o Windows fica sem memória e um teste que leva <1 s passou dos 5 s padrão do Vitest (2 falhas
  de console na Fase 8 e 3 na Fase 6, sem reproduzir depois). O `vitest.config.ts` usa `testTimeout: 15_000`. **Rode a verificação
  final antes do commit com `&&`** (o commit da Fase 8 saiu com essas 2 falhas porque o comando usava `;`).
- **N36. Banco de teste compartilhado por 3 suítes** (`npm test`, E2E e `@lab`): cada uma usa um provider falso/real
  diferente, e as VPS que sobram de uma viram `ERROR` no reconcile da outra, segurando IPs do pool de teste (só 10,
  `10.99.0.10–19`). `tests/helpers/resetTestData.ts` limpa os dados transitórios (VPS, jobs, faturas, conversas, usuários
  com hífen no e-mail) no `globalSetup` do Vitest e antes/depois do E2E. Não rode `npm test` e `npm run test:e2e` ao mesmo tempo.
- **N37. E2E:** o `e2e/server.ts` usa `startServer()` (`src/server/server.ts`, o mesmo do `main.ts`) com o provider falso,
  porta 3100 e o `dist/client` (o `test:e2e` faz o build antes). O `globalSetup` do Playwright precisa definir
  `process.env.NODE_ENV = 'test'` ANTES de importar o `env.ts` (ele lê o NODE_ENV na importação). Imports do `e2e/`
  com extensão `.ts` (o Playwright aceita). Os navegadores do Playwright já estão em `%LOCALAPPDATA%\ms-playwright`.
- **N38. Cobrança recorrente nos testes:** para simular o tempo passando, mude o `paidUntil` da VPS no banco e enfileire um
  `billing_cycle` (`queue.enqueue('billing_cycle', {})` + `worker.drain()`). Avançar o `Clock` injetado também expiraria a
  sessão de login do cliente de teste. O pool de IPs de teste tem só 10 endereços: suítes que criam muitas VPS precisam
  liberar os IPs antes (ver o `beforeAll` da cobrança em `jobs.test.ts`).
- **N39. Consulta do Prisma é preguiçosa:** `db.x.create()` devolve uma *PrismaPromise* que só executa no `then`. Um
  `void audit.record(...)` sem `await` **nunca gravava** (o console aberto/fechado não aparecia na auditoria desde a Fase 7).
  O `AuditLogRepository.record` agora é `async` (executa na hora); em código novo, sempre `await` ou `.catch()`.
- **N40. Console: vagas presas e gerenciamento de conexões (2026-09-24).** No noVNC 1.7 o construtor do `RFB` já abre o
  WebSocket; uma exceção logo depois (no caso real, uma **extensão do navegador do usuário que interceptava WebSockets**)
  deixava um cliente órfão conectado, e o servidor contava a vaga até a aba fechar ("já tem 2 consoles abertos" sem nada
  funcionando). Hoje o `VncConsole` cria o próprio `WebSocket` e o entrega ao noVNC (fecha no `catch`), mostra o erro real
  na tela e no console do navegador, um pedido novo da mesma sessão para a mesma VPS substitui o que ainda não conectou, e o
  usuário vê e encerra as conexões em `GET/DELETE /api/consoles` (painel na aba Console; o proxy fecha com o código **4002**
  e já derruba o lado do Proxmox). Para diagnosticar: auditoria `vps.console_requested/opened/closed/terminated` (N39).
  Se o console falhar só no navegador de alguém, teste com o Edge instalado pelo Playwright (`chromium.launch({ channel:
  msedge })`, perfil limpo) antes de mexer no código.
- **N17.** `execFileSync('npm', …, { shell: true })` gera o aviso `DEP0190` no Node 24; os scripts de `scripts/deps/` usam
  `execSync` com o nome do pacote validado por regex.

### Ferramentas do Claude neste ambiente
- **T1.** Heredocs longos no Bash (Git Bash) falharam com `unexpected EOF while looking for matching '`. Para arquivos grandes,
  use a ferramenta **Write**.
- **T2.** O Node do Windows **não enxerga o `/tmp` do Git Bash** (vira `C:\tmp`). Use o scratchpad da sessão.
- **T3.** `printf '\n'` dentro de strings que vão virar JS gerou quebras de linha literais. Prefira `String.fromCharCode(10)` ou a ferramenta Write.
- **T4.** No Git Bash, `ping` é o do Windows: `ping -n 1 -w 1000 <ip>`.
- **T5.** Para usar senha no SSH uma única vez (sem `sshpass`): um script `askpass` temporário que imprime a senha +
  `SSH_ASKPASS=<script> SSH_ASKPASS_REQUIRE=force DISPLAY=:0 ssh …`. Apague o script depois.
- **T6.** VMs de teste reaproveitam o IP `.229`: use `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`.
- **T7.** Edição de documentos grandes: escrever as seções em arquivos no scratchpad e aplicar com um script Node que
  substitui entre títulos e **falha se não achar a âncora**. Testar numa cópia (`cmp`) antes de aplicar no arquivo real.
- **T8.** Wikis bloqueadas no WebFetch (403): vá ao código-fonte ou use `curl`.
- **T9.** O `curl` do Git Bash usa **schannel**: com `--cacert` de uma CA local, ele falha com *"the revocation status is unknown"*.
  Use `--ssl-no-revoke`.
- **T10.** No Windows, o Python é chamado pelo lançador **`py`** (3.12). Não existem `python`/`python3` no PATH, nem `jq`.
  Os scripts usam Node para JSON; o `python3` usado nas receitas é o **do Proxmox**.
- **T11.** Script enviado por `ssh host 'bash -s' < script`: qualquer comando interno que leia o stdin (outro `ssh`, por exemplo)
  **consome o resto do script**. Para scripts assim, copie com `scp` e execute (é o que o `build-template.sh` faz) ou use `ssh -n`.
- **T12.** `core.autocrlf=true` neste Windows: o `.gitattributes` força `*.sh` com LF (CRLF quebra o bash no Proxmox).
- **T13. Parar o `npm run dev`/`npm start` em segundo plano** (TaskStop) mata só o `npm`: o `node` filho **continua na porta
  3000**, e o **`tsx watch` pai também sobrevive** e sobe o servidor de novo quando algum arquivo muda (ex.: `db:generate`).
  Já houve 4 `tsx watch` órfãos ao mesmo tempo, e o curl respondia o servidor errado (confira `environment` no `/api/health`).
  Mate todos os `node` do projeto:
  `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'vps-rental-platform' } | % { Stop-Process -Id $_.ProcessId -Force }"`.
  `npm start` exige o `.env.production` (fora do git; aponta para `vps_platform_prod`, criado na Fase 2).
  **Com o worker (Fase 6), um órfão também PROCESSA A FILA:** um `tsx watch` esquecido recarregou o `main.ts` novo e
  provisionou a `favo-demo` sozinho. Antes de testar jobs, confira que não há `node` do projeto rodando.
- **T15. Captura do Playwright pode mostrar a tela atrasada:** uma captura tirada 20 s depois do evento ainda mostrava o estado
  antigo, embora o navegador já tivesse buscado os dados novos (causa provável, não confirmada: a janela sem foco atrasa os
  `setTimeout` com que o TanStack Query agenda o re-render). Para medir o tempo real, use um `MutationObserver` via `browser_evaluate` e leia o resultado depois.
- **T16. Script `.ts` avulso com `tsx`:** os pacotes são resolvidos a partir da pasta do ARQUIVO (no scratchpad não há
  `node_modules`), e `.ts` fora de um pacote `"type": "module"` vira CJS (sem top-level await). Crie como `.mts` na raiz do projeto,
  rode com `npx cross-env NODE_ENV=development tsx --tsconfig tsconfig.server.json <arq>.mts` e apague em seguida.
- **T14. Playwright MCP:** grava capturas e snapshots em `.playwright-mcp/` (no `.gitignore`). Salve capturas em `test-results/`.
  `browser_console_messages` com `all: true` mostra o histórico da sessão inteira, não só da página atual.

- **T17. Digitar no noVNC pelo Playwright:** `pressSequentially`/`type` mandam `C` e `!` sem segurar o Shift, e o QEMU gera
  `c`/`1` (senha "errada"). Para maiúsculas e símbolos use `page.keyboard.press('Shift+KeyC')`/`'Shift+Digit1'` (via
  `browser_run_code_unsafe`). Uma pessoa digitando não tem o problema.
- **T18. O `tsx watch` recarrega o servidor ao mudar arquivos do servidor**, inclusive no meio de um teste manual: jobs em
  andamento voltam para a fila e retomam (isso é o esperado), mas espere o `worker de jobs iniciado` no log antes de testar.
- **T19. Scratchpad com scripts `.ts`:** ver T16. Para medir tempo de atualização da tela, use `MutationObserver` (T15).
- **T20. Playwright MCP só lê arquivos do projeto** (`browser_run_code_unsafe` com `filename`): o scratchpad é recusado. Para
  roteiros que precisam da senha de demonstração, gere uma cópia em `.playwright-mcp/` (ignorado pelo git) com a senha lida do
  `.env.development` e apague logo depois. Vários usuários ao mesmo tempo: `page.context().browser().newContext()` por usuário.
- **T21. GIF e capturas do README:** quadros com o Playwright MCP (`page.screenshot` num laço) e montagem com o **Pillow**
  pelo `py` (já instalado; o ffmpeg do Playwright só tem VP8/webm). `print` com caracteres fora do cp1252 quebra no
  console do Windows. Imagens em `docs/images/` (PNG otimizado, ≤ 1280 px).

## 6. Decisões de arquitetura mais importantes (detalhes no plano)

- **VPS = VMs KVM** clonadas (linked clone) de templates "golden image" com cloud-init (§3.1, §3.6). Container/LXC foi descartado pelo usuário.
- Token da plataforma restrito aos pools `vps-platform` (VPS) e `vps-templates` (só clonar), §3.4.
- Rede das VPS: IP fixo do pool no banco → `ipconfig0=ip=…/24,gw=192.168.56.10` + `net0=virtio=<MAC do IP>,bridge=vmbr1,rate=…` (A11).
- TLS até o Proxmox: CA `certs/pve-root-ca.pem` + `servername` = nome do nó (A9).
- Jobs assíncronos numa fila no MySQL (`SELECT … FOR UPDATE SKIP LOCKED`), com retry e idempotência; `TaskWaiter` para UPIDs; reconciliação a cada 60 s.
- Pós-boot pelo guest agent: senha root, política de SSH (`sshd_config.d/01-favo.conf`, ver C18), redefinir senha. `ImageProfile` por imagem.
- **Cloud-init só no 1º boot** (congelado no fim do provisionamento, C23): renomear, expandir o disco, senhas e chaves depois
  da criação são feitos pelo guest agent, nunca mudando a config de cloud-init.
- Console: `POST /api/vps/:id/console` → `consoleId` de uso único (30 s) + senha VNC → WebSocket `/ws/console/:id` com proxy para o `vncwebsocket` do Proxmox.
- CSRF: *Signed Double-Submit Cookie* (HMAC ligado à sessão/pré-sessão, enviado no header `X-CSRF-Token`), **não** salvo no banco.
  A sessão fica no banco (só o hash SHA-256), com cookie `HttpOnly; SameSite=Strict`.
- RBAC: `User.roleId` (uma role), `Role` ↔ `Permission` (N:N), permissões como constantes no código, sincronizadas pelo seed.

## 7. Receitas testadas

### 7.1 Maior versão estável de pacotes (versão avulsa; no projeto use `npm run deps:stable`)
```js
// node stable.mjs <pkg> [<pkg>...]
import { execSync } from 'node:child_process';
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
for (const p of process.argv.slice(2)) {
  const j = JSON.parse(execSync(`npm view ${p} dist-tags versions time --json`, { encoding: 'utf8' }));
  const max = j.versions.filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort(cmp).at(-1);
  console.log(p, 'latest=' + j['dist-tags'].latest, 'maiorEstável=' + max, j['dist-tags'].latest === max ? 'OK' : '<< latest NÃO é estável');
}
```
Peer dependencies: `npm view <pkg>@<versão> peerDependencies engines --json`.

### 7.2 Consultar o schema oficial da API do Proxmox
```bash
curl -s -o apidoc.js https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js      # ~4,3 MB, no scratchpad
node -e 'const fs=require("fs");const s=fs.readFileSync("apidoc.js","utf8");const a=s.indexOf("[");
const e=s.indexOf("\n;",a)>0?s.indexOf("\n;",a):s.lastIndexOf("]")+1;let t;try{t=eval(s.slice(a,e))}catch{t=eval(s.slice(a,s.indexOf("];")+1))}
const m={};(function w(n){for(const c of n){m[c.path]=c.info;if(c.children)w(c.children)}})(t);fs.writeFileSync("api.json",JSON.stringify(m))'
# depois: const map=require("./api.json"); map["/nodes/{node}/qemu/{vmid}/clone"].POST → parameters, permissions, returns, allowtoken
```

### 7.3 Proxmox via SSH
```bash
ssh -o BatchMode=yes root@192.168.56.10 'qm list; free -m; pvesh get /nodes/primeiro/status --output-format json'
qm cloudinit dump <vmid> user            # ver o user-data gerado
qm agent <vmid> ping
```

### 7.4 VM de teste a partir de uma imagem (sem template)
```bash
ID=9101; IMG=/var/lib/vz/import/<imagem>
qm create $ID --name img-teste --memory 512 --cores 1 --ostype l26 --net0 virtio,bridge=vmbr1 \
  --scsihw virtio-scsi-pci --agent enabled=1 --vga std --serial0 socket
qm set $ID --scsi0 local-lvm:0,import-from=$IMG
qm set $ID --ide2 local-lvm:cloudinit --boot order=scsi0
qm set $ID --ciuser <usuario> --cipassword 'Teste@123' --sshkeys /root/.ssh/authorized_keys \
  --ipconfig0 ip=192.168.56.229/24,gw=192.168.56.10 --nameserver 1.1.1.1 --ciupgrade 0
qm resize $ID scsi0 <tamanho>; qm start $ID
# limpeza: qm stop $ID; qm destroy $ID --purge 1 --destroy-unreferenced-disks 1
```

### 7.5 Capturar a tela (VGA) de uma VM, para conferir o que o noVNC mostra
```bash
echo "screendump /tmp/vga.ppm" | qm monitor <vmid>
python3 - <<'EOF'
import zlib, struct
d=open("/tmp/vga.ppm","rb").read(); p=d.split(b"\n",3); w,h=map(int,p[1].split()); px=p[3]
raw=b"".join(b"\x00"+px[y*w*3:(y+1)*w*3] for y in range(h))
c=lambda t,b: struct.pack(">I",len(b))+t+b+struct.pack(">I",zlib.crc32(t+b)&0xffffffff)
open("/tmp/vga.png","wb").write(b"\x89PNG\r\n\x1a\n"+c(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+c(b"IDAT",zlib.compress(raw,9))+c(b"IEND",b""))
EOF
# depois: scp root@192.168.56.10:/tmp/vga.png <scratchpad>/ e abrir com a ferramenta Read
```

### 7.6 MySQL como usuário da aplicação
```bash
"/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe" -uvps_app -p"<senha do .env.development>" -h127.0.0.1 vps_platform_dev
```

## 8. Referências-chave
- Proxmox: API https://pve.proxmox.com/wiki/Proxmox_VE_API · API viewer https://pve.proxmox.com/pve-docs/api-viewer/ ·
  usuários/permissões https://pve.proxmox.com/pve-docs/chapter-pveum.html · Cloud-Init https://pve.proxmox.com/wiki/Cloud-Init_Support ·
  rede https://pve.proxmox.com/pve-docs/chapter-sysadmin.html · VirtualBox https://pve.proxmox.com/wiki/Proxmox_VE_inside_VirtualBox
- Imagens: Alpine https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/ · Debian https://cloud.debian.org/images/cloud/trixie/latest/ ·
  Ubuntu https://cloud-images.ubuntu.com/minimal/releases/noble/release/
- OWASP CSRF: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Vite SSR/middleware: https://vite.dev/guide/ssr · Prisma 7 MySQL/seeding: https://www.prisma.io/docs/orm/overview/databases/mysql
