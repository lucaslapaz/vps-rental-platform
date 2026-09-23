# CLAUDE.md — Favo (VPS Rental Platform)

Contexto para o Claude implementar este projeto em conversas novas. **O plano completo e as decisões estão em
[docs/PLANO_DE_IMPLEMENTACAO.md](docs/PLANO_DE_IMPLEMENTACAO.md)** (revisão 8, 2026-09-23). Este arquivo resume o
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
- **Situação atual:** Fases 0 e 1 concluídas. Fase 0: laboratório (plano §2.7), scripts em `scripts/pve/`. Fase 1:
  fundação (servidor único Express+Vite, React com marca Favo, i18n, tema, Vitest, Biome). A próxima é a Fase 2 (banco).
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
3. **Dependências — só a maior versão ESTÁVEL** (sem `-rc`, `-beta`, `-dev`…). A tag `latest` do npm **não** é critério.
   - Conferir antes: `npm run deps:stable -- <pkg>` (`scripts/deps/stable-versions.mjs`; depois de CLIs que instalam pacotes, `npm run deps:check`).
   - Instalar **sempre com versão exata**: `npm install <pkg>@<versão>` (o projeto terá `save-exact=true` no `.npmrc`).
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
| IPs | DHCP do host-only: `.101–.199`. **VPS: `.200–.229`** (IPAM no banco). `.229` = testes manuais. `.250` = build de templates. Windows = `.1` |
| DNS do nó | 45.5.96.96 (search `promox.teste`) |
| Storage | `local` (dir, `/var/lib/vz`, ~2,8 GB livres) · `local-lvm` (lvmthin `data`, **16,8 GB**; VDI aumentado para 30 GB na Fase 0) |
| RAM | O Proxmox usa ~1,3–1,4 GB; sobram **~1,5 GB para as VPS**. O Windows costuma ficar com só ~0,5 GB livres com o Proxmox ligado |
| VMs | Só os templates **9000** `favo-tpl-alpine`, **9001** `favo-tpl-debian`, **9002** `favo-tpl-ubuntu`, **9003** `favo-tpl-alpine-desktop` (pool `vps-templates`). VMID **9199** = clone temporário do teste de aceite (IP `.229`) |
| Identidade da plataforma | Pools `vps-platform` e `vps-templates`, role `VPSPlatformVM`, usuário `vpsplatform@pve`, token `vpsplatform@pve!backend` (`privsep=1`). Secret e demais `PVE_*` no `.env.development`; CA em `certs/pve-root-ca.pem` |
| Imagens cloud (checksums conferidos) | `/var/lib/vz/import/`: `generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2`, `debian-13-genericcloud-amd64.qcow2`, `ubuntu-24.04-minimal-cloudimg-amd64.img` |
| Backup da rede | `/root/interfaces.bak-20260923020356` |
| MySQL | Bancos `vps_platform_{dev,test,prod,shadow}` + usuário **`vps_app`** (só nesses bancos, `caching_sha2_password`). `DATABASE_URL` em `.env.development`/`.env.test`, e `SHADOW_DATABASE_URL` em `.env.development` |

### Scripts do laboratório (Fase 0, rodam no Git Bash a partir da raiz do repositório)
- `scripts/pve/bootstrap.sh [--rotate-token]`: idempotente. Envia a si mesmo por SSH, copia a CA e grava os `PVE_*` no `.env.development`.
  O secret só aparece na criação do token: se o `.env` perdeu o secret, use `--rotate-token`.
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
- **C14. Qualquer `ciuser` funciona** (testado com `favo`): no Debian/Ubuntu o `default_user` tem `sudo: ALL=(ALL) NOPASSWD:ALL`;
  no Alpine o cloud-init grava `permit nopass <usuário>` no `/etc/doas.conf`, e a imagem já tem `/etc/doas.d/wheel.conf`
  (`permit nopass :wheel`), com o usuário no grupo `wheel`. O Alpine tem `ssh_pwauth: false` no `cloud.cfg` (SSH por senha
  desligado de fábrica).
- **C15. Os templates não têm o usuário do build:** a limpeza (via `qm guest exec`, como root) faz `userdel -r`, apaga as regras
  de sudo/doas dele e roda `cloud-init clean --logs --seed --machine-id`. Senão, uma VPS com outro usuário ficaria com
  `alpine`/`debian`/`ubuntu` sobrando.
- **C16.** Tempos (A11): clone vinculado ~1 s; start → `agent/ping` ~30 s → SSH ~33 s (Alpine/Debian/Ubuntu). RAM após o boot:
  Alpine 58 MB, Debian 113 MB, Ubuntu 185 MB. O `apk upgrade` do build levou o kernel do Alpine para 6.18.53.
- **C17. Alpine Desktop:** o LightDM sobe com ~50 s de uptime; RAM 253 MB no greeter e ~350 MB com o XFCE aberto (VM de 1 GB).
  **Login gráfico com a senha do `cipassword` funciona** (testado digitando pelo monitor QEMU: `sendkey shift-f`, `minus`, `ret`…),
  sem precisar dos grupos `audio`/`video` (o `elogind` cuida do seat). O `default_user` do Alpine tinha `gecos: alpine Cloud User`,
  que aparecia no LightDM para qualquer usuário: o `99-vpsplatform.cfg` sobrescreve com `system_info.default_user.gecos: ""`
  (o merge dos `cloud.cfg.d` é recursivo; testado).

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
- **T13. Parar o `npm run dev`/`npm start` em segundo plano** (TaskStop) mata o `npm`, mas o `node` filho **continua ouvindo na
  porta 3000** (o próximo start falha, e o curl responde o servidor antigo). Mate pela porta:
  `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }"`.
- **T14. Playwright MCP:** grava capturas e snapshots em `.playwright-mcp/` (no `.gitignore`). Salve capturas em `test-results/`.
  `browser_console_messages` com `all: true` mostra o histórico da sessão inteira, não só da página atual.

## 6. Decisões de arquitetura mais importantes (detalhes no plano)

- **VPS = VMs KVM** clonadas (linked clone) de templates "golden image" com cloud-init (§3.1, §3.6). Container/LXC foi descartado pelo usuário.
- Token da plataforma restrito aos pools `vps-platform` (VPS) e `vps-templates` (só clonar), §3.4.
- Rede das VPS: IP fixo do pool no banco → `ipconfig0=ip=…/24,gw=192.168.56.10` + `net0=virtio=<MAC do IP>,bridge=vmbr1,rate=…` (A11).
- TLS até o Proxmox: CA `certs/pve-root-ca.pem` + `servername` = nome do nó (A9).
- Jobs assíncronos numa fila no MySQL (`SELECT … FOR UPDATE SKIP LOCKED`), com retry e idempotência; `TaskWaiter` para UPIDs; reconciliação a cada 60 s.
- Pós-boot pelo guest agent: senha root, política de SSH (`sshd_config.d/60-favo.conf`), redefinir senha. `ImageProfile` por imagem.
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
