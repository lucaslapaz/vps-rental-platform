# Plano de Implementação — VPS Rental Platform

> Documento vivo. Criado em **2026-09-23**. Todas as versões, endpoints e comandos citados foram
> conferidos nessa data na documentação oficial, no schema oficial da API do Proxmox (`apidoc.js`)
> e no próprio servidor Proxmox do laboratório. Nada relacionado ao Proxmox foi escrito de memória.

### Histórico de revisões

| Rev. | Data | Mudanças |
|---|---|---|
| 1 | 2026-09-23 | Versão inicial |
| 2 | 2026-09-23 | Adendos do usuário (§0.1): **política de dependências** (só a maior versão estável, sempre via comandos npm, §4.1); TypeScript passa a ser o **7.0.2** (estável) e ESLint + Prettier dão lugar ao **Biome**; **diagnóstico da aceleração** no PC, com a causa encontrada e a correção (§2.4, §3.2); **esclarecimento sobre "bridge"** (§3.3.1) |
| 3 | 2026-09-23 | Respostas às decisões pendentes (§0.2) e esclarecimento (§0.3). **Fase 0 executada** (§2.5): aceleração ligada, VM 100 removida, `vmbr1` + NAT, chave SSH, MySQL. **VPS passam a ser VMs KVM** (Alpine cloud-init, template "golden image", §3.1 e §3.6), com teste real de viabilidade e correção do DNS. **Idiomas e moedas no frontend** (§14.4). Sem commits por parte do Claude (§17) |
| 4 | 2026-09-23 | Respostas da revisão 4 (§0.4). **Marca fictícia Favo** e identidade visual (§14.6). **Três imagens** (Alpine, Debian 13, Ubuntu 24.04), **testadas** no laboratório (§2.6, §3.7). **Console noVNC** no núcleo (§10.5). **Senha root e SSH pelo guest agent** (§10.6). Tela de criação como nas plataformas reais (§14.5). **RBAC: uma role por usuário, verificação por permissão** (§9.7) |
| 5 | 2026-09-23 | Respostas da revisão 5 (§0.5): **marca Favo aprovada**; **imagem Alpine Desktop (XFCE)** entra no catálogo (template 9003, plano Medium de 1 GB); **`CLAUDE.md` criado** na raiz com o contexto e as lições aprendidas. Nenhuma decisão pendente (§20) |
| 6 | 2026-09-23 | Commits: o Claude passa a **commitar ao fim de cada fase** (substitui a decisão do §0.2). Ajustados o §1, o §17 e o `CLAUDE.md` |
| 12 | 2026-09-23 | **Fase 5 concluída** (§17): catálogo, capacidade, pedido, pagamento simulado com trava da fatura (`FOR UPDATE`), telas de criação/checkout/faturas e moeda de exibição. Mudança no schema: `vps.provisionSecrets` (senhas cifradas entre o pedido e o pagamento, §12) |
| 11 | 2026-09-23 | **Fase 4 concluída** (§17): cliente do Proxmox, provider real, agente, CLI `npm run pve` e suíte `@lab` 30/30 nas quatro imagens. Mudanças: drop-in do sshd **`01-favo.conf`** (§10.6) e formato do ticket do `vncproxy` (§10.5) |
| 10 | 2026-09-23 | **Fase 3 concluída** (§17): sessão, CSRF assinado, RBAC, conta, chaves SSH e administração de usuários. Detalhes da implementação em §9.8 (origem aceita, pré-sessão, validação real das chaves SSH, textos em namespaces) |
| 9 | 2026-09-23 | **Fase 2 concluída** (§17): Prisma 7.10.0 + adapter MariaDB, migration `init`, seeds idempotentes. Ajustes: tabelas com `@@map` em snake_case (MySQL do Windows com `lower_case_table_names=1`), `IpAddress.macAddress` (MAC derivado do IP), pool `.200–.228`, plano **Medium** no seed, proteção do Prisma contra agentes de IA em comandos destrutivos (§19) |
| 8 | 2026-09-23 | **Fase 1 concluída** (§17): fundação com servidor único, marca Favo, i18n e tema. Ajustes: `tsx --tsconfig tsconfig.server.json` (decorators), `oxc.decorator.legacy` no Vitest, pacote `cn` do shadcn no lugar de `clsx` + `tailwind-merge`, fontes nunca embutidas como `data:` (CSP), `worker-src blob:` só em dev, `tsconfig.base/server/client/test` |
| 7 | 2026-09-23 | **Fase 0 concluída** (§2.7): disco +10 GB, `bootstrap.sh`, templates 9000–9003 e aceite com o token. Decisões novas: **MAC derivado do IP** (§3.3), **TLS validado pelo nome do nó** porque o certificado não tem o IP no SAN (§3.5, §10.1), build com upgrade explícito e remoção do usuário do build (§3.6) |

## Sumário

0. [Pedido original](#0-pedido-original)
1. [Resumo executivo e decisões principais](#1-resumo-executivo-e-decisões-principais)
2. [Diagnóstico do ambiente (levantado em 2026-09-23)](#2-diagnóstico-do-ambiente-levantado-em-2026-09-23)
3. [Decisões de arquitetura do Proxmox](#3-decisões-de-arquitetura-do-proxmox)
4. [Stack e versões](#4-stack-e-versões) · [4.1 Política de dependências](#41-política-de-dependências-regra-do-projeto)
5. [Estrutura do projeto](#5-estrutura-do-projeto)
6. [Servidor único Express + Vite](#6-servidor-único-express--vite)
7. [Injeção de dependências com tsyringe](#7-injeção-de-dependências-com-tsyringe)
8. [Banco de dados, Prisma, migrations e seeds](#8-banco-de-dados-prisma-migrations-e-seeds)
9. [Segurança: CSRF, sessão e autorização](#9-segurança-csrf-sessão-e-autorização)
10. [Integração com o Proxmox](#10-integração-com-o-proxmox)
11. [Ciclo de vida das VPS e jobs assíncronos](#11-ciclo-de-vida-das-vps-e-jobs-assíncronos)
12. [Pagamento simulado](#12-pagamento-simulado)
13. [Suporte: chat e fila de atendimento](#13-suporte-chat-e-fila-de-atendimento)
14. [Frontend](#14-frontend)
15. [Referência da API HTTP e eventos em tempo real](#15-referência-da-api-http-e-eventos-em-tempo-real)
16. [Como o Claude vai interagir com cada parte (e a questão do MCP)](#16-como-o-claude-vai-interagir-com-cada-parte-e-a-questão-do-mcp)
17. [Fases de implementação](#17-fases-de-implementação)
18. [Estratégia de testes](#18-estratégia-de-testes)
19. [Riscos e mitigações](#19-riscos-e-mitigações)
20. [Decisões pendentes (preciso da sua resposta)](#20-decisões-pendentes-preciso-da-sua-resposta)
21. [Referências consultadas](#21-referências-consultadas)

---

## 0. Pedido original

As mensagens do usuário não são reproduzidas aqui: ficam só as decisões e onde cada uma foi aplicada.

### 0.1 Adendos (segunda mensagem)

Onde cada ponto foi tratado:

| Adendo | Onde |
|---|---|
| Só versões estáveis | §4 e §4.1 (política + script de verificação) |
| Dependências só via comandos npm | §4.1, §6 e Fase 1 (§17) |
| Aceleração | §2.4 (diagnóstico: **é possível ativar**) e §3.2 (como ativar) |
| "Bridge" | §3.3.1 (é uma bridge **Linux dentro do Proxmox**; nada muda nos adaptadores do VirtualBox) |

### 0.2 Respostas às decisões pendentes (terceira mensagem)

Como cada resposta foi aplicada:

| Resposta | Resultado |
|---|---|
| Excluir a VM 100 | ✅ Excluída na Fase 0 (§2.5) |
| Ligar a aceleração / 2 vCPU / 3–4 GB | ✅ **Funcionou pelo `VBoxManage`**, mesmo com a caixa acinzentada na interface. Usei **3 GB** porque o Windows estava com só 1,6 GB livres (§3.2) |
| Rede `192.168.56.200–229` | ✅ `vmbr1` criada e DHCP do VirtualBox reduzido (§3.3) |
| Chave SSH | ✅ Instalada. Acesso `ssh root@192.168.56.10` sem senha |
| MySQL | ✅ Bancos e usuário `vps_app` criados (§8.1) |
| LXC × VM | **VMs KVM de verdade** (decisão sua). Explicação do que é LXC e o teste de viabilidade em §3.1 |
| Idiomas e moedas | ✅ Vale a pena, **se entrar desde a Fase 1**. **Só no frontend** (esclarecimento no §0.3). Desenho em §14.4 |
| Commits | ~~Não faço commits~~ **Substituído na rev. 6:** o Claude commita ao fim de cada fase (§17) |

### 0.3 Esclarecimento (mensagem enviada durante a revisão 3)

Aplicado em §14.4 (idioma e moeda só na interface; cobrança e banco em BRL; nada muda nas VMs) e em
§3.2 (procedimento para aumentar o disco da VM do Proxmox em +10 GB, **só se** a capacidade apertar).

### 0.4 Respostas da revisão 4 (quarta mensagem)

Como cada ponto foi tratado:

| Pedido | Resultado |
|---|---|
| Nome e identidade visual | Marca fictícia **Favo** ("favo de mel": cada VPS é uma célula da colmeia). Nome, conceito, logo, paleta clara/escura e tipografia em §14.6 |
| Idiomas pt-BR/en-US/es-ES e moedas BRL/USD/EUR | ✅ Confirmado (§14.4) |
| Criação de VPS igual à de plataformas reais | Tela de criação no estilo DigitalOcean/Vultr/Hetzner, com **campos condicionais vindos da imagem escolhida** (§14.5) |
| Mais 2 imagens | **Debian 13** e **Ubuntu 24.04 LTS minimal**, além do Alpine 3.24. As três foram **testadas de verdade** no laboratório (§2.6, §3.7) |
| Usuário, senha, senha root, SSH | Todos os campos entram. A **senha root** usa o guest agent (`agent/set-user-password`), **testado com sucesso** (§2.6, §10.6) |
| Console gráfico (noVNC) | Entra no **núcleo** do projeto (antes era extra). O VGA das três imagens foi testado: mostra o console de texto (§10.5). Imagem com interface gráfica ficou como extra (§20) |
| Roles × permissões | **Cada usuário tem uma role; cada role tem permissões; o código verifica permissões.** Justificativa em §9.7 |

### 0.5 Respostas da revisão 5 (quinta mensagem)

| Resposta | Resultado |
|---|---|
| Marca Favo | ✅ Aprovada (§14.6) |
| Imagem com área de trabalho | ✅ Passa a fazer parte do catálogo: **Alpine 3.24 Desktop (XFCE)**, template 9003, com um plano próprio de 1 GB (§3.6, §3.7, §8.4) |
| `CLAUDE.md` | ✅ Criado na raiz do repositório com o contexto, as regras e as lições aprendidas até aqui, para uma nova conversa começar a implementação sem repetir as pesquisas |

---

## 1. Resumo executivo e decisões principais

A plataforma é um **servidor Node.js único** (Express 5 + Vite em modo middleware) que serve a API
REST, o WebSocket (Socket.IO) e o frontend React. Os dados ficam no **MySQL 8.4** via **Prisma 7**,
e o servidor se comunica com o **Proxmox VE 9.2** pela API REST, usando um **API token com
permissões restritas a um pool**.

O que foi mantido do seu desenho, o que foi ajustado e por quê:

| Tema | Seu pedido | Proposta | Motivo |
|---|---|---|---|
| Frontend | React + Vite + TS + shadcn | **Mantido** (React 19, Vite 8, Tailwind 4, shadcn) | — |
| Servidor único | Express + middleware do Vite | **Mantido**, com `server.middlewareMode` e `appType: 'custom'` (doc oficial do Vite) | `appType: 'custom'` deixa o Express servir o HTML e injetar o cookie CSRF, que é justamente o que o seu fluxo precisa |
| Variáveis nos scripts | cross-env | **Mantido** (cross-env 10) | — |
| Camadas | controllers / services / repositories / models / utils | **Mantido**, com mais `middlewares/`, `integrations/`, `jobs/` e `realtime/` | Proxmox, pagamento e Socket.IO não se encaixam bem em "service" puro |
| DI | tsyringe | **Mantido**, sempre com `@inject(TOKEN)` explícito | O `tsx` (esbuild) **não emite** `emitDecoratorMetadata`, então a injeção automática pelo tipo não funciona em dev (ver §7) |
| Dependências | Só a maior versão estável, sempre via comandos npm | **Adotado como regra** (§4.1): antes de instalar, um script lista a maior versão estável; a instalação é `npm install pkg@<versão exata>`; o `package.json` nunca é editado à mão nas dependências | `npm install pkg` sem versão instala a tag `latest`, que **nem sempre é estável** (caso real: `prisma`) |
| Banco | MySQL + Prisma + pool | **Mantido**: Prisma **7.10.0** + `@prisma/adapter-mariadb` com `connectionLimit` | No Prisma 7 o pool é configurado no adapter. **Atenção:** a tag `latest` do `prisma` aponta para `8.0.0-rc.15` (pré-release); a maior estável é a 7.10.0 |
| TypeScript e lint | TypeScript | **TypeScript 7.0.2** (maior estável) + **Biome** para lint e formatação | O `typescript-eslint` só aceita TypeScript < 6.1. Em vez de descer o TypeScript, troquei a ferramenta de lint por uma que não depende do pacote `typescript` |
| Migrations e seeds | Prisma, com scripts por ambiente | **Mantido**. Seed configurado em `prisma.config.ts`, arquivos `.env.<ambiente>` | No Prisma 7 o seed **não roda mais sozinho** no `migrate dev`/`reset`, só com `prisma db seed` |
| Token CSRF | Cookie; JWT ou token no banco? | **Nenhum dos dois.** Token **assinado com HMAC** e vinculado à sessão, enviado de volta num **header** (padrão OWASP "Signed Double-Submit Cookie") | Explicação completa em §9.1. Resumo: se o token só voltar no cookie, a proteção é nula, e guardá-lo no banco não traz nenhum ganho de segurança sobre o HMAC |
| Sessão de login | Token no banco, com validade, em cookie | **Mantido**, guardando só o **hash SHA-256** do token, com cookie `HttpOnly` + `SameSite=Strict` | Se o banco vazar, os hashes não servem para sequestrar sessões |
| `req.user` | Instância de uma classe User | **Mantido**: `AuthenticatedUser` em `models/`, com `can(permission)` | — |
| Ordem dos middlewares | CSRF → autenticação | **Mantido**, com uma checagem de `Origin`/`Sec-Fetch-Site` antes | Defesa em profundidade recomendada pela OWASP |
| **Tipo de "VPS"** | VMs Alpine (KVM) | **VMs KVM** com Alpine + cloud-init, clonadas de um template "golden image" | Decisão sua (§0.2). Com a aceleração ligada na Fase 0, uma VM de teste subiu em ~1 min, usou 34 MB de RAM e aceitou SSH (§2.5, §3.1) |
| Aceleração (KVM) | Sem aceleração (dava erro) | ✅ **Ativada na Fase 0** pelo `VBoxManage` (a caixa da interface estava acinzentada) | Seu PC tem VT-x + EPT ligados no BIOS, o Hyper-V/WSL estão desativados e o VirtualBox já usa VT-x nativo. Só faltava o "Nested VT-x" (§2.4, §3.2) |
| Rede das VPS | — | Bridge **Linux** `vmbr1` criada **dentro do Proxmox** sobre a placa host-only. Os adaptadores do VirtualBox continuam NAT + Host-only. IPs fixos `192.168.56.200–229` controlados pelo banco, NAT para a internet | As VPS ficam acessíveis direto do Windows (ssh/ping), como um IP "público" de verdade. Ver §3.3.1 |
| MCP do Proxmox | Existe? Vale criar um? | **Não é necessário agora.** Vou usar a API REST (já testada) + SSH com `pvesh`/`qm` + um CLI do próprio projeto. Um MCP próprio e somente leitura fica como extra opcional | Detalhes em §16 |
| Idiomas e moedas | Seletor na interface | **Só no frontend**: i18next (pt-BR padrão + en-US + es-ES) e conversão de moeda apenas para exibição. Cobrança sempre em BRL | Esclarecimento seu (§0.3). Desenho em §14.4 |
| Commits | Claude commita ao fim de cada fase (mudado na rev. 6) | **Um commit por fase** na `main`, com resumo para revisão | §17 |
| Nome e marca | Criar | **Favo** ("favo de mel": cada VPS é uma célula), com logo, paleta e tipografia. ✅ Aprovada | §14.6 |
| Imagens | + 2 opções, e uma com interface gráfica | **Alpine 3.24, Debian 13, Ubuntu 24.04 LTS minimal** e **Alpine 3.24 Desktop (XFCE)**, cada uma com requisitos mínimos | As três de servidor foram testadas no laboratório. A Desktop será validada no build do template (§2.6, §3.6, §3.7) |
| Criação da VPS | Igual às plataformas reais, com campos condicionais | Página única com resumo lateral; os campos variam conforme as capacidades da imagem | §14.5 |
| Senha root / SSH | Configuráveis na criação | Pelo **guest agent** (`set-user-password`, testado), sem reboot; o mesmo serve para redefinir depois | §10.6 |
| Console gráfico | noVNC | **No núcleo** (Fase 7), com proxy WebSocket no backend; o navegador nunca fala com o Proxmox | §10.5 |
| Roles e permissões | Roles com permissões, ou só roles? | **Uma role por usuário, permissões por role, o código verifica permissões** + tela de atribuição de roles | §9.7 |

---

## 2. Diagnóstico do ambiente (levantado em 2026-09-23)

Dados coletados agora, direto das máquinas, não de suposição.

> As §2.1–2.4 descrevem o estado **antes** da Fase 0. O estado atual e o teste das VMs estão em **§2.5**.

### 2.1 Máquina host (Windows 11 Pro)

| Item | Valor |
|---|---|
| CPU / RAM | Intel i3-10100F (4c/8t), **8 GB** de RAM |
| Node.js / npm | **v24.12.0** / 11.6.2 |
| MySQL | Serviço **`MySQL84` rodando** (MySQL Server 8.4), porta 3306 aberta. Cliente em `C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe` (fora do PATH) |
| VirtualBox | 7.2.12. VMs: `coolify-ubuntu-server-2604-lts`, `alpine`, **`Segundo Proxmox`** (em execução) |
| VBS / Hyper-V | VBS desligado (`VirtualizationBasedSecurityStatus = 0`); Hyper-V, WSL e "Plataforma de Máquina Virtual" **desativados**; nenhum hipervisor ativo no Windows. Ver §2.4 |
| Placas de rede | `Ethernet` (Intel I219-V), `Ethernet 2` (VirtualBox Host-Only), `Radmin VPN`. **Nenhuma** tem o driver "VirtualBox Bridged Networking" vinculado (por isso o modo Bridge não aparece no VirtualBox, ver §3.3.1) |
| SSH | OpenSSH 10.3 disponível, com chaves `id_ed25519` e `id_rsa` em `~/.ssh` |

### 2.2 VM "Segundo Proxmox" no VirtualBox

| Item | Valor atual | Problema |
|---|---|---|
| CPUs | **1** | Pouco para o Proxmox e os guests ao mesmo tempo |
| RAM | **2048 MB** (o Proxmox reporta ~1,75 GB em uso) | Não há espaço para novas VPS enquanto a VM 100 estiver ligada |
| `nested-hw-virt` | **off** | O Proxmox não enxerga `vmx`, então o KVM fica indisponível e as VMs rodam em emulação. **É a causa do erro que você viu** ao criar a VM com aceleração, e tem correção (§2.4) |
| NIC 1 | NAT (Intel 82540EM) → no Proxmox vira `nic0` / `vmbr0` (10.0.2.15) | NAT do VirtualBox não é adequado para vários guests expostos |
| NIC 2 | Host-only (Intel 82540EM), promíscuo = padrão (`deny`) → no Proxmox vira `nic1` (192.168.56.10) | Precisa de `allow-all` para que os guests sejam acessíveis a partir do Windows |
| DHCP do host-only | Ativo, faixa **192.168.56.101 – 192.168.56.254** | Pode conflitar com IPs fixos de VPS, então a faixa precisa ser reduzida |

### 2.3 Proxmox (via API, autenticado como `root@pam`)

| Item | Valor |
|---|---|
| Versão | `pve-manager/9.2.2`, kernel `7.0.2-6-pve` |
| Nó | **`primeiro`** (standalone, sem cluster) |
| CPU vista pelo Proxmox | 1 vCPU, flags **sem `vmx`** (tem `hypervisor`) |
| Storage `local` | `dir`, `/var/lib/vz`, conteúdo `iso,backup,import,vztmpl`. 9,2 GB no total, **3,8 GB livres** |
| Storage `local-lvm` | `lvmthin` (pool `data`), conteúdo `images,rootdir`. **7,3 GB** |
| Rede | `nic0` → `vmbr0` 10.0.2.15/24 gw 10.0.2.2 (NAT do VBox); `nic1` 192.168.56.10/24 (host-only, **sem bridge**) |
| SDN | Só a zona implícita `localnetwork` |
| Pools / usuários | Nenhum pool; só `root@pam` |
| Guests | **VM 100** "VM 100": Alpine ISO, 1 GB de RAM, disco de 32 GB em `local-lvm`, `cpu: x86-64-v2-AES`, **`kvm: 0`**, rodando |
| DNS do nó | `45.5.96.96`, search `promox.teste` |
| Templates LXC disponíveis (aplinfo) | `alpine-3.24-default_20260714_amd64.tar.xz`, `alpine-3.23-…`, `debian-13-standard_13.6-1_amd64.tar.zst`, `ubuntu-24.04-standard_24.04-2_amd64.tar.zst` |
| Acesso | API `https://192.168.56.10:8006` ✅ · SSH porta 22 aberta ✅ |

Conclusões:
1. A VM 100 comprova que KVM "funciona", mas sem aceleração (`kvm: 0`). Isso serve como teste, não para produto.
2. Com 2 GB de RAM e a VM 100 ligada, **não sobra memória** para provisionar VPS.
3. O disco é pequeno (7,3 GB em thin), então os planos precisam ser mínimos, com 1 a 4 GB de disco.

### 2.4 Diagnóstico da aceleração (KVM): dá para ativar

Você comentou que, ao criar uma VM no Proxmox com a aceleração (KVM) ligada, apareceu um erro dizendo
que ela não estava disponível, e que só funcionou depois de desativá-la. A investigação no seu PC:

| Verificação | Resultado | O que significa |
|---|---|---|
| CPU (`Win32_Processor`) | `VirtualizationFirmwareEnabled = True`, `VMMonitorModeExtensions = True`, `SecondLevelAddressTranslationExtensions = True` | O i3-10100F tem VT-x e EPT, e **o VT-x está ligado no BIOS** |
| Hipervisor no Windows (`HypervisorPresent`) | `False` | O Windows não está rodando sobre o Hyper-V |
| Recursos do Windows | Hyper-V, WSL, "Plataforma de Máquina Virtual" e "Plataforma do Hipervisor do Windows": **todos desativados** | O VirtualBox tem acesso direto ao VT-x |
| Log da VM (`VBox.log`) | `HM: HMR3Init: VT-x w/ nested paging and unrestricted guest execution hw support`, `UseNEMInstead = 0` | O VirtualBox **já usa VT-x nativo** (não está no modo lento "tartaruga", o NEM) |
| Log da VM (`VBox.log`) | `NestedHWVirt = 0` | **Esta é a única trava.** A VM do Proxmox não repassa o VT-x para dentro, então o Proxmox não vê `vmx` e o KVM falha |

**Conclusão:** o seu caso tem solução. Basta ligar o "Nested VT-x/AMD-V" na VM "Segundo Proxmox",
com ela desligada (comando em §3.2). Na interface do VirtualBox essa opção fica em
*Configurações → Sistema → Processador → "Habilitar VT-x/AMD-V Aninhado"*. Se a caixa estiver
acinzentada, o `VBoxManage` resolve.

**Cuidado para não perder isso depois:** se você ativar o **WSL2, o Docker Desktop, o Hyper-V ou a
"Integridade de Memória"** (Segurança do Windows → Isolamento de Núcleo), o Windows passa a rodar sobre
o Hyper-V. Aí o VirtualBox cai para o modo NEM (ícone de tartaruga), fica mais lento e **a
virtualização aninhada deixa de funcionar**. Existe um serviço `com.docker.service` instalado, mas hoje
o Docker não está ativando o Hyper-V.

### 2.5 Estado depois da Fase 0 (executada em 2026-09-23)

| Item | Antes | Depois |
|---|---|---|
| VM "Segundo Proxmox" | 1 vCPU, 2 GB, nested **off**, promíscuo `deny` | **2 vCPU, 3 GB, nested on**, promíscuo **`allow-all`** no Adaptador 2 |
| Aceleração no Proxmox | sem `vmx`, VMs com `kvm: 0` | `vmx` presente, `/dev/kvm` existe, **VMs com KVM ativo** |
| DHCP host-only | `.101–.254` | **`.101–.199`** (`.200–.254` livres para IPs fixos) |
| VM 100 | Rodando, 1 GB | **Excluída** (disco removido) |
| Rede do Proxmox | `nic1` com IP direto | **`vmbr1` (bridge sobre `nic1`) = 192.168.56.10/24** + NAT para `vmbr0`. Backup em `/root/interfaces.bak-20260923020356` |
| SSH | só senha | Chave `id_ed25519` instalada para `root` |
| MySQL | — | Bancos `vps_platform_{dev,test,prod,shadow}` + usuário `vps_app` (senha aleatória em `.env.development`/`.env.test`, fora do git) |
| Imagem Alpine cloud | — | `/var/lib/vz/import/generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2` (SHA-512 conferido) |
| RAM no Proxmox | — | ~1,3 GB usados pelo próprio Proxmox, **~1,6 GB livres** para as VPS |

**Teste de viabilidade das VPS em VM (feito e depois removido):** template criado a partir da imagem
cloud-init oficial do Alpine (seguindo a doc *Cloud-Init Support*) → clone vinculado → `ciuser`,
`cipassword`, `sshkeys`, `ipconfig0=192.168.56.229/24` → disco aumentado para 2 GB → boot.

| Medição | Resultado |
|---|---|
| Do `start` até responder ping no Windows | **~63 s** (primeiro boot, com cloud-init) |
| Login | `ssh alpine@192.168.56.229` com a chave ✅, `doas` (sudo do Alpine) ✅ |
| Disco | Partição **expandida sozinha** para 1,9 GB pelo cloud-init ✅ |
| RAM dentro da VM | 34 MB usados de 217 MB visíveis (VM de 256 MB) |
| RAM no host (processo `kvm`) | ~225 MB por VM de 256 MB → cabem ~6 VPS pequenas hoje |
| Internet pela NAT | `ping 1.1.1.1` ✅ |
| `qm shutdown` (ACPI) | Desligamento limpo em **4 s** ✅ |
| **DNS** | ❌ **Problema encontrado:** o cloud-init do Alpine grava `dns-nameservers` no `/etc/network/interfaces`, mas nada gera o `/etc/resolv.conf`. **Corrigido no teste** com o módulo `resolv_conf` do cloud-init (§3.6) |

### 2.6 Teste das imagens extras, do console e da senha root (revisão 4)

Feito com VMs temporárias (VGA padrão + serial, cloud-init, IP `.229`, 512 MB), removidas depois.
As imagens ficaram em `/var/lib/vz/import/` com checksum conferido (Debian: `SHA512SUMS`; Ubuntu: `SHA256SUMS`).

| Medição | Alpine 3.24 | Debian 13 (genericcloud) | Ubuntu 24.04 (minimal) |
|---|---|---|---|
| Download / disco virtual mínimo | 175 MiB / **200 MiB** | 325 MiB / **3 GiB** | 252 MiB / **3,5 GiB** |
| Do `start` até o SSH | ~63 s | ~73 s | ~72 s |
| RAM usada após o boot | 34 MB (de 256 MB) | 84 MB (de 512 MB) | ~160 MB (de 512 MB) |
| Usuário / privilégio | `alpine` / `doas` | `debian` / `sudo` | `ubuntu` / `sudo` |
| DNS pronto de fábrica | ❌ (correção no template, §3.6) | ✅ | ✅ |
| `qemu-guest-agent` de fábrica | ❌ | ❌ | ❌ |
| Console VGA (o que o noVNC mostra) | ✅ log de boot + `login:` no `tty1` | ✅ `login:` no `tty1` | (mesma família do Debian; será conferido no build do template) |

**Descobertas que mudam o desenho:**
1. **O Proxmox gera `package_upgrade: true` no user-data do cloud-init** (visto com `qm cloudinit dump <vmid> user`).
   Cada VPS nova faria upgrade de todos os pacotes no primeiro boot: no Ubuntu, o cloud-init ficou **mais de 4 minutos**
   rodando (24.04.4 → 24.04.5), e no Alpine o upgrade **falhou** por falta de DNS, derrubando o `cloud-final`.
   **Correção:** clonar com `ciupgrade=0` (parâmetro confirmado no schema). As imagens já são atualizadas no build do template.
2. **Senha root pelo guest agent funciona.** `POST /nodes/{node}/qemu/{vmid}/agent/set-user-password` com `username=root`
   mudou o status do root de `L` (bloqueado) para `P` (com senha), e `su root` funcionou, **sem reboot**. Isso resolve
   "senha root" na criação e "redefinir senha" depois (§10.6). Para isso, o `qemu-guest-agent` vai instalado em todos os templates.
3. O user-data do Proxmox **não define `ssh_pwauth`**, então o login SSH por senha depende do padrão de cada imagem. A plataforma
   passa a aplicar a escolha do cliente pelo guest agent (§10.6).
4. As imagens do Debian e do Ubuntu **não podem ter disco menor que 3 GiB / 3,5 GiB**, então os planos precisam respeitar mínimos por imagem (§3.7).

### 2.7 Fase 0 concluída (revisão 7)

| Item | Resultado |
|---|---|
| Disco da VM do Proxmox | VDI de 20 → **30 GB**; `sgdisk -e` + `growpart /dev/sda 3` + `pvresize` + `lvextend -l +100%FREE pve/data`. O `local-lvm` passou de 6,8 para **16,8 GB**. O `growpart` atualizou a tabela no kernel sem reboot |
| `scripts/pve/bootstrap.sh` | Pools, role `VPSPlatformVM`, `vpsplatform@pve`, token `!backend` (`privsep=1`), ACLs e CA em `certs/`. Idempotente (rodado duas vezes). Secret no `.env.development` |
| `scripts/pve/build-template.sh` | Templates **9000** (Alpine, 1 GB), **9001** (Debian 13, 3 GB), **9002** (Ubuntu 24.04, 3,5 GB) e **9003** (Alpine Desktop, 3 GB) no pool `vps-templates`, todos com `ciupgrade: 0` herdado pelos clones |
| Aceite (`scripts/pve/test-template.mjs`, só com o token) | Os quatro aprovados: clone vinculado (~1 s), ping do Windows, SSH com a chave, DNS, `sudo`/`doas` com um usuário **diferente do padrão** (`favo`), raiz expandida, hostname, `agent/ping`, `agent/set-user-password` (root), `vncproxy`, `login:` no VGA, desligamento ACPI e exclusão. `DELETE` do template → **403** (`VM.Allocate`) |
| Tempo do start até o SSH | Clone ~1 s; start → `agent/ping` ~30 s → SSH ~33 s. Pingar do Windows durante o boot atrasava o primeiro contato para ~72 s (cache ARP, §3.3) |
| RAM após o boot | Alpine 58 MB · Debian 113 MB · Ubuntu 185 MB · Desktop 253 MB no greeter e ~350 MB com o XFCE aberto |
| Alpine Desktop | **Login gráfico no LightDM com a senha do cliente funciona** e abre o XFCE (testado digitando pelo monitor QEMU). Não precisa dos grupos `audio`/`video` (o `elogind` cuida do seat). VGA em 1280×800 |

**Descobertas:**
1. **Certificado do Proxmox sem o IP no SAN** (tem `10.0.2.15`, `primeiro` e `primeiro.promox.teste`): a validação TLS é feita com a CA
   **e o nome `primeiro`** (`servername`), em vez de desligar a verificação (§3.5).
2. **Cache ARP do Windows:** pingar a VM a partir do Windows enquanto ela ainda bootava (ou com uma entrada ARP antiga, de outro MAC,
   no mesmo IP) deixava o Windows ~45 s sem alcançá-la, embora o Proxmox já alcançasse. Decisões: a plataforma considera a VM pronta
   pelo **`agent/ping`** (§11.3, já era o plano) e usa **MAC derivado do IP** (§3.3).
5. **`gecos` do Alpine:** o `default_user` do Alpine tem `gecos: alpine Cloud User`, que aparecia no LightDM para qualquer usuário. O
   `99-vpsplatform.cfg` dos templates Alpine sobrescreve com `system_info.default_user.gecos: ""`.
3. **Ubuntu: a raiz de 2,9 GB num disco de 4 GB não é falha do `growpart`** (armadilha C7): a partição raiz vai até o fim do disco,
   mas o `/boot` (913 MB) e a ESP (106 MB) ocupam ~1 GiB.
4. **Alpine e `doas`:** o cloud-init grava `permit nopass <usuário>` no `/etc/doas.conf`, e a imagem já traz `/etc/doas.d/wheel.conf`
   (`permit nopass :wheel`), com o usuário padrão no grupo `wheel`. Por isso qualquer nome de usuário escolhido pelo cliente tem `doas`.

---

## 3. Decisões de arquitetura do Proxmox

### 3.1 VMs KVM (Alpine + cloud-init) como backend das VPS

**Decisão (sua, §0.2):** as VPS são **máquinas virtuais de verdade** (KVM), e não containers.

> **O que era o LXC, para registro:** o LXC é um container "de sistema": ele roda um Linux completo
> (init, SSH, usuários), mas **compartilhando o kernel do Proxmox**, sem virtualizar hardware. É
> parecido com o Docker na tecnologia, mas diferente no uso: o Docker empacota **uma aplicação**, e o
> LXC imita **uma máquina inteira**. Eu tinha sugerido LXC porque, sem aceleração, VMs ficam ~10x mais
> lentas (doc [Nested Virtualization](https://pve.proxmox.com/wiki/Nested_Virtualization)). **Com a
> aceleração ligada na Fase 0, esse motivo deixou de existir**, e o teste real (§2.5) mostrou VMs
> leves e rápidas o bastante para o objetivo.

**Como as VPS são criadas:**
1. **Template "golden image"** (VMID 9000, fora do pool das VPS): feito uma única vez pelo script
   `scripts/pve/build-template.sh` (§3.6), a partir da **imagem cloud-init oficial do Alpine**
   `generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2` (200 MiB, SHA-512 conferido).
2. **Cada VPS é um *linked clone*** do template (`POST /nodes/{node}/qemu/9000/clone`). No `lvmthin`, o
   clone vinculado é criado em segundos e só ocupa o que difere do template.
3. **O cloud-init aplica a identidade da VPS no primeiro boot:** usuário, senha e/ou chave SSH,
   IP/gateway, DNS e hostname (o Proxmox usa o **nome da VM** como hostname). O disco é aumentado antes
   do boot (`resize`), e o cloud-init expande a partição sozinho (comprovado no teste).

**Por que cloud-init e não a ISO que você usou:** a ISO `alpine-standard` exige instalação interativa
(`setup-alpine`), que não dá para automatizar pela API. A imagem cloud-init já vem instalada e é
configurada por parâmetros da API (`ciuser`, `cipassword`, `sshkeys`, `ipconfig0`, `nameserver`).
Isso segue a doc oficial [Cloud-Init Support](https://pve.proxmox.com/wiki/Cloud-Init_Support).

**Como fica no código:** a interface `VirtualizationProvider` continua existindo, com a implementação
`QemuCloudInitProvider`. Os services, jobs e controllers não sabem os detalhes do Proxmox. Isso
facilita os testes (um provider falso) e mantém aberta a porta para outros backends no futuro.

### 3.2 Ajustes no laboratório (VirtualBox) ✅ feitos na Fase 0

A caixa "Nested VT-x/AMD-V" aparecia **acinzentada** na interface do VirtualBox, mas o `VBoxManage`
aceitou a configuração normalmente com a VM desligada. Comandos executados (sintaxe conferida no
`VBoxManage modifyvm --help` da 7.2.12):

```powershell
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
& $vb modifyvm "Segundo Proxmox" --nested-hw-virt=on --cpus=2 --memory=3072 --nic-promisc2=allow-all
& $vb dhcpserver modify --network="HostInterfaceNetworking-VirtualBox Host-Only Ethernet Adapter" --upper-ip=192.168.56.199
& $vb startvm "Segundo Proxmox" --type headless     # sem janela; "Mostrar" no VirtualBox abre o console
```

- **Memória: 3 GB, e não 4.** Com o Proxmox desligado, o Windows estava com só **1,6 GB livres de
  8 GB**. Com 4 GB para o Proxmox, o Windows passaria a usar arquivo de paginação o tempo todo. Se no
  futuro você fechar outros programas pesados, dá para subir para 4 GB (VM desligada:
  `modifyvm --memory=4096`).
- **Validação feita:** `NestedHWVirt = 1` no `VBox.log`; no Proxmox, `vmx` no `/proc/cpuinfo` e
  `/dev/kvm` presente; uma VM de teste com KVM ativo bootou normalmente (§2.5).
- **Cuidado para não perder a aceleração:** ativar WSL2, Docker Desktop, Hyper-V ou "Integridade de
  Memória" no Windows faz o VirtualBox cair para o modo NEM (lento) e desliga a virtualização
  aninhada (§2.4).

**Aumentar o disco da VM do Proxmox (+10 GB)** — ✅ **feito na revisão 7** (§2.7); a receita abaixo funcionou como está. O VDI tinha 20 GB
(o padrão), divididos em `root` 8,8 GB, `swap` 1,9 GB e o pool `data` (onde ficam as VPS) com
6,8 GB. Os clones vinculados ocupam pouco, então isso deve bastar para o laboratório. Se faltar:

```powershell
# Windows, com o Proxmox desligado de forma limpa
& $vb modifymedium disk "C:\Users\Lapaz\VirtualBox VMs\Segundo Proxmox\Segundo Proxmox.vdi" --resize 30720
```
```bash
# Proxmox, depois de ligar (growpart/parted não vêm instalados; conferido)
apt install -y cloud-guest-utils        # fornece o growpart
sgdisk -e /dev/sda                      # move o cabeçalho GPT de backup para o novo fim do disco
growpart /dev/sda 3                     # expande a partição do LVM
pvresize /dev/sda3                      # o volume físico passa a enxergar o espaço novo
lvextend -l +100%FREE pve/data          # tudo para o thin pool das VPS
```
(Os comandos serão conferidos nas man pages do próprio servidor antes de executar.)

### 3.3 Rede das VPS

> ✅ **Aplicada na Fase 0** por SSH, com um rollback automático de segurança: um `systemd-run --on-active=180`
> restauraria o arquivo antigo e rodaria `ifreload -a` se a nova rede derrubasse o acesso. Com a rede validada (SSH, interface web,
> internet e NAT), o timer foi cancelado. Isso dispensou o console do VirtualBox. Backup: `/root/interfaces.bak-20260923020356`.

**Topologia escolhida:** transformar `nic1` (host-only) numa bridge `vmbr1`. O IP de gerência
`192.168.56.10` passa para a bridge. As VPS recebem IPs fixos `192.168.56.200–229` com gateway
`192.168.56.10`, e o Proxmox faz **NAT (masquerading)** delas para a internet pela `vmbr0`.

```
 Windows (192.168.56.1) ──host-only──┐
                                     │  vmbr1 = 192.168.56.10/24 (bridge-ports nic1)
                                     ├── VM 2000  192.168.56.200  gw .10
                                     ├── VM 2001  192.168.56.201  gw .10
                                     │
 Internet ◄── NAT VBox ◄── vmbr0 (10.0.2.15) ◄── MASQUERADE -s 192.168.56.0/24 -o vmbr0
```

Vantagens: cada VPS tem um IP alcançável do PC (`ssh root@192.168.56.200`), como um IP público
num provedor real, e não é preciso criar rotas no Windows.

#### 3.3.1 Esclarecimento: qual "bridge"?

Sim, estou falando de uma bridge **dentro do Proxmox**, para as VPS. Não é o modo de rede "Placa em
modo Bridge" do VirtualBox. São duas coisas diferentes com o mesmo nome:

| | "Placa em modo Bridge" do VirtualBox | Bridge Linux do Proxmox (`vmbr0`, `vmbr1`) |
|---|---|---|
| Onde é configurada | Nas configurações da VM no VirtualBox | Dentro do Proxmox (`/etc/network/interfaces` ou *Sistema → Rede* na interface web) |
| O que faz | Coloca a VM do Proxmox direto na rede física da sua casa (roteador) | Funciona como um "switch virtual" dentro do Proxmox, ligando as VPS a uma das placas do Proxmox |
| Vamos usar? | **Não** | **Sim** |

**Nos adaptadores do VirtualBox, nada muda:** o Adaptador 1 continua NAT e o Adaptador 2 continua
Host-only, exatamente como você configurou. A única alteração no VirtualBox é o **modo promíscuo
"Permitir Tudo"** no Adaptador 2 (§3.2), para que a placa host-only aceite tráfego dos vários
endereços MAC das VPS, e não só do próprio Proxmox.

O Proxmox **já usa uma bridge Linux hoje**: a `vmbr0` foi criada na instalação sobre a `nic0` (a placa
NAT), e é nela que a sua VM 100 está conectada. O plano cria uma segunda, a `vmbr1`, sobre a `nic1` (a
placa host-only):

```
 Camada 1: Windows / VirtualBox        Camada 2: dentro do Proxmox             Camada 3: VPS
 ───────────────────────────────       ──────────────────────────────────       ─────────────────
 Adaptador 1: NAT        ──────────►  nic0 ──► vmbr0 (10.0.2.15)  ──► internet (saída NAT das VPS)
 Adaptador 2: Host-only  ──────────►  nic1 ──► vmbr1 (192.168.56.10) ─┬─► VM 2000 (192.168.56.200)
   (promíscuo: Permitir Tudo)                                        └─► VM 2001 (192.168.56.201)
```

**Sobre o modo Bridge não aparecer no seu VirtualBox:** o diagnóstico (§2.1) mostrou que o driver
"VirtualBox NDIS6 Bridged Networking Driver" não está vinculado a nenhuma placa de rede do Windows.
Ele pode ser recuperado reinstalando o VirtualBox com o recurso "Bridged Networking" marcado, mas
**não é necessário**. A host-only é até melhor para o laboratório: a faixa de IPs é fixa, não
depende do roteador nem do Wi-Fi e funciona sem internet.

`/etc/network/interfaces` (trecho). O padrão de masquerading segue a seção *Masquerading (NAT) with
iptables* do [Admin Guide](https://pve.proxmox.com/pve-docs/chapter-sysadmin.html):

```
auto nic1
iface nic1 inet manual

auto vmbr1
iface vmbr1 inet static
        address 192.168.56.10/24
        bridge-ports nic1
        bridge-stp off
        bridge-fd 0
        post-up   echo 1 > /proc/sys/net/ipv4/ip_forward
        post-up   iptables -t nat -A POSTROUTING -s '192.168.56.0/24' -o vmbr0 -j MASQUERADE
        post-down iptables -t nat -D POSTROUTING -s '192.168.56.0/24' -o vmbr0 -j MASQUERADE
```

- As mudanças são aplicadas com `ifreload -a` (ifupdown2, padrão desde o PVE 7). Faça isso **pelo console da janela do
  VirtualBox**, não por SSH ou pela web: o SSH usa a própria `nic1` e cai durante a troca. Antes, faça backup:
  `cp /etc/network/interfaces /root/interfaces.bak`.
- Se o firewall do Proxmox for ativado nas VMs (Fase 10), a doc indica regras extras de
  *conntrack zone* para o masquerading. Elas serão conferidas na doc no momento de ativar.
- **Alternativa**, caso a bridge na host-only dê problema: `vmbr1` interna (`10.10.10.0/24`, `bridge-ports none`)
  com NAT e uma rota persistente no Windows (`route -p add 10.10.10.0 mask 255.255.255.0 192.168.56.10`).
  Funciona sem modo promíscuo, mas exige a rota (admin) no Windows.

**IPAM (controle dos IPs):** fica **no banco** (tabela `IpAddress`), e não no Proxmox. A reserva é
feita com um `UPDATE … WHERE status='FREE'` atômico, e o IP é passado ao Proxmox em
`ipconfig0=ip=192.168.56.200/24,gw=192.168.56.10` (cloud-init) e `net0=virtio,bridge=vmbr1,rate=<MB/s>`.
O campo `rate` (limite de banda, confirmado no schema do `net[n]` de QEMU: "megabytes per second") implementa a "banda" do plano.

**MAC derivado do IP (revisão 7):** `net0=virtio=<MAC>,bridge=vmbr1,rate=…`, com `MAC = 02:00:` + os 4 octetos do IPv4 em
hexadecimal (ex.: `192.168.56.200` → `02:00:C0:A8:38:C8`). `02` é o bit de "administrado localmente" (unicast), que não
colide com o OUI `BC:24:11` dos MACs aleatórios do Proxmox. Motivo, medido na Fase 0: quando um IP é reutilizado por uma VPS
nova com outro MAC, o Windows continua com a entrada ARP antiga (`Stale`) e pode levar ~45 s para alcançar a VM, que o Proxmox já
alcança. Com o MAC fixo por IP, a entrada continua válida. É também o que provedores reais fazem (MAC e IP amarrados, base para o
`macfilter`/`ipfilter` do firewall na Fase 10).

### 3.4 Identidade da plataforma no Proxmox (menor privilégio)

A plataforma **não usa root**. Ela usa um usuário e token dedicados, com escopo limitado a **pools**:

| Objeto | Valor |
|---|---|
| Pool das VPS | `vps-platform`: todas as VPS são clonadas com `pool=vps-platform` |
| Pool dos templates | `vps-templates`: templates 9000 (Alpine), 9001 (Debian), 9002 (Ubuntu), 9003 (Alpine Desktop). O token **só pode clonar**, não pode alterar nem apagar |
| Usuário | `vpsplatform@pve` (realm interno do Proxmox) |
| Token | `vpsplatform@pve!backend`, com `privsep=1` (a permissão efetiva é a interseção entre usuário e token) |
| Role customizada | `VPSPlatformVM` = `VM.Allocate, VM.Audit, VM.Config.CPU, VM.Config.Memory, VM.Config.Disk, VM.Config.Network, VM.Config.Options, VM.Config.Cloudinit, VM.PowerMgmt, VM.Console, VM.GuestAgent.Audit, VM.GuestAgent.Unrestricted, Pool.Audit` |
| ACLs (usuário **e** token) | `/pool/vps-platform` → `VPSPlatformVM` · `/pool/vps-templates` → `PVETemplateUser` (`VM.Audit, VM.Clone`) · `/storage/local-lvm` → `PVEDatastoreUser` · `/sdn/zones/localnetwork/vmbr1` → `PVESDNUser` · `/nodes/primeiro` → `PVEAuditor` (capacidade e logs de tasks) |

Permissões conferidas no schema oficial (`apidoc.js`):
- **clone:** *"VM.Clone on /vms/{vmid}, and VM.Allocate on /vms/{newid} (or on the VM pool /pool/{pool}). You also
  need Datastore.AllocateSpace on any used storage and SDN.Use on any used bridge/vnet"*.
- **config:** qualquer um dos `VM.Config.*` relevantes (inclusive `VM.Config.Cloudinit` para `ciuser`/`sshkeys`/`ipconfig0`/`ciupgrade`).
- **resize:** `VM.Config.Disk`. **agent/ping** e **agent/network-get-interfaces:** `VM.GuestAgent.Audit`.
- **agent/set-user-password** e **agent/exec:** `VM.GuestAgent.Unrestricted` (§10.6).
- **vncproxy/vncwebsocket** (console noVNC, §10.5): `VM.Console`, e aceitam API token.

> **Sobre o `VM.GuestAgent.Unrestricted`:** ele permite executar comandos dentro da VM. É um privilégio forte,
> mas vale **só para as VMs do pool** `vps-platform`, que a plataforma opera. O backend expõe apenas ações
> fechadas (definir senha e ajustar o SSH), **nunca** um "executar comando" genérico para o usuário.

Nomes de privilégios e roles conferidos na lista real de `/access/roles` do servidor (PVE 9.2).

**Efeito colateral útil:** o token **não enxerga nem mexe** em nada fora dos pools, nem pode alterar os templates.
Um bug na plataforma não consegue apagar VMs que não são dela.

Tokens de API **não precisam de CSRFPreventionToken** e não expiram em 2 horas como o ticket
(`PVEAuthCookie`) (doc [Proxmox VE API](https://pve.proxmox.com/wiki/Proxmox_VE_API)). Header:
`Authorization: PVEAPIToken=vpsplatform@pve!backend=<uuid>`.

### 3.5 Bootstrap do Proxmox como script versionado

`scripts/pve/bootstrap.sh`: idempotente, roda via `ssh root@192.168.56.10 'bash -s' < scripts/pve/bootstrap.sh`
(a chave SSH já está instalada):

```bash
pvesh create /pools --poolid vps-platform
pvesh create /pools --poolid vps-templates
pveum role add VPSPlatformVM --privs "VM.Allocate,VM.Audit,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.PowerMgmt,VM.Console,VM.GuestAgent.Audit,VM.GuestAgent.Unrestricted,Pool.Audit"
pveum user add vpsplatform@pve --comment "VPS Rental Platform backend"
pveum user token add vpsplatform@pve backend --privsep 1          # imprime o secret UMA vez
for who in "--users vpsplatform@pve" "--tokens vpsplatform@pve!backend"; do
  pveum acl modify /pool/vps-platform              $who --roles VPSPlatformVM
  pveum acl modify /pool/vps-templates             $who --roles PVETemplateUser
  pveum acl modify /storage/local-lvm              $who --roles PVEDatastoreUser
  pveum acl modify /sdn/zones/localnetwork/vmbr1   $who --roles PVESDNUser
  pveum acl modify /nodes/primeiro                 $who --roles PVEAuditor
done
```
(Cada comando é protegido por verificações de existência, para ser idempotente. As flags exatas do
`pveum acl modify` serão conferidas com `pveum help acl modify` no próprio servidor ao executar.)

O secret do token vai para o `.env.development` (fora do git).

TLS: o certificado do Proxmox é autoassinado. O script também copia `/etc/pve/pve-root-ca.pem` para
`certs/pve-root-ca.pem` (fora do git), e o cliente HTTP do backend confia **nessa CA**, em vez de
desligar a verificação.

**Implementado na revisão 7:** o script roda na máquina de desenvolvimento e envia a si mesmo por SSH (`bash -s -- --remote`).
O certificado do nó **não tem `192.168.56.10` no SAN** (só `127.0.0.1`, `::1`, `localhost`, `10.0.2.15`, `primeiro`,
`primeiro.promox.teste`, porque foi gerado quando o IP de gerência era o da NAT). Em vez de regenerar o certificado (mexer no
`/etc/hosts` do nó afeta o `pve-cluster`) ou desligar a verificação, a conexão vai para o IP e **valida o certificado pelo nome
do nó**: `PVE_TLS_SERVERNAME=primeiro` (no Node, `servername` no `https`/`undici`; no curl, `--resolve primeiro:8006:192.168.56.10`
e a URL `https://primeiro:8006`). O `PVE_TLS_INSECURE` deixa de ser necessário. Variáveis gravadas pelo script:
`PVE_URL`, `PVE_NODE`, `PVE_TLS_SERVERNAME`, `PVE_CA_FILE`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET`.

### 3.6 Golden images: templates 9000–9003 (`scripts/pve/build-template.sh <imagem>`)

Um template por imagem, construído por script (idempotente; recria só com `--force`), a partir da
imagem cloud oficial já baixada e conferida em `/var/lib/vz/import/`.

**Configuração da VM do template (as três imagens):**
`--memory <mínimo da imagem> --cores 1 --ostype l26 --net0 virtio,bridge=vmbr1 --scsihw virtio-scsi-pci --agent enabled=1 --vga std --serial0 socket --ide2 local-lvm:cloudinit --boot order=scsi0 --pool vps-templates`

- `--vga std` (e **não** `--vga serial0`, como está no exemplo da doc de Cloud-Init): é o que o noVNC mostra.
  O teste (§2.6) mostrou o console de texto no VGA. O `--serial0 socket` fica disponível para um console xterm.js opcional.

**Passos do build:**
1. Cria a VM 900X e importa o disco: `--scsi0 local-lvm:0,import-from=/var/lib/vz/import/<imagem>`.
2. Configuração **temporária** de build: usuário padrão da imagem, a chave SSH do root do Proxmox,
   `ipconfig0=ip=192.168.56.250/24,gw=192.168.56.10` (IP `.250` reservado para builds: fora do DHCP e do pool) e `ciupgrade=1`
   (aqui o upgrade é desejado: o template já sai atualizado).
3. `qm start` → espera o SSH → dentro da VM, conforme a imagem:

   | Passo | Alpine 3.24 | Debian 13 | Ubuntu 24.04 minimal |
   |---|---|---|---|
   | Instalar o agente | `apk add qemu-guest-agent` + `rc-update add qemu-guest-agent` | `apt-get install -y qemu-guest-agent` | `apt-get install -y qemu-guest-agent` |
   | Correção de DNS | `/etc/cloud/cloud.cfg.d/99-vpsplatform.cfg` com `manage_resolv_conf: true` + `resolv_conf.nameservers` (testado, §2.5) | — (não precisa) | — (não precisa) |
   | Conferir o console | `getty` no `tty1` (visto no teste) | idem | conferir no build |

4. Limpeza para que cada clone gere a sua identidade: `cloud-init clean --logs --seed` (opções conferidas no
   `cloud-init clean --help` da imagem), remoção das chaves SSH do host, do `authorized_keys` do build e do histórico.
5. `qm shutdown` → `qm set 900X --delete ciuser,sshkeys,ipconfig0` → `qm template 900X`.
6. **Teste automático** com o **token da plataforma**: clone temporário com IP `.229` e `ciupgrade=0` → ping, SSH,
   DNS (`getent hosts`), `qm agent ping`, `agent/set-user-password` em root, captura do VGA (`screendump` pelo
   monitor QEMU) → destrói o clone.

**Como ficou na implementação (revisão 7)**, `scripts/pve/build-template.sh <alpine|debian|ubuntu|alpine-desktop|all> [--force] [--no-test]`:
- Roda na máquina de desenvolvimento: copia a si mesmo para `/root/favo/` no Proxmox (por `scp`, e não por `ssh … bash -s`, porque
  os `ssh` internos consumiriam o resto do script pelo stdin) e executa lá o modo `--remote`. Depois roda o teste de aceite
  `scripts/pve/test-template.mjs <vmid>` com o **token**.
- **`ciupgrade=0` também no build**, com o upgrade feito explicitamente pelo script (`apk upgrade` / `apt-get full-upgrade`): no
  Alpine o upgrade do cloud-init falharia sem DNS, e assim o log fica visível. O template sai com `ciupgrade: 0`, que os clones herdam.
- Disco do template = menor VPS possível da imagem (Alpine 1 GB, Debian 3 GB, Ubuntu 3,5 GB, Desktop 3 GB); os clones só aumentam.
- **Limpeza pelo guest agent como root** (`qm guest exec`), depois de encerrada a sessão SSH: remove o **usuário do build**
  (`userdel -r`) e as regras de `sudo`/`doas` dele, `cloud-init clean --logs --seed --machine-id` (opção conferida no
  `--help` do cloud-init 26.1), chaves de host SSH e históricos. Sem isso, um cliente que escolhesse outro nome de usuário
  ficaria com um usuário `alpine`/`debian`/`ubuntu` sobrando na VPS.
- Nome das VMs: `favo-tpl-<imagem>` (sem pontos, porque o nome vira hostname, armadilha C5).

**Template 9003: Alpine 3.24 Desktop (XFCE).** Parte do template Alpine (mesma imagem, mesma correção de DNS e mesmo
agente) e, no passo 3 do build, instala a área de trabalho com o script oficial do Alpine. Conferido no código-fonte do
`setup-desktop` (repositório `alpine-conf`): ele aceita o ambiente como argumento e, **com argumento, roda sem perguntas**.

```sh
BROWSER=xfce4-taskmanager setup-desktop xfce
# o script instala: setup-xorg-base xfce4 ${BROWSER:-firefox} elogind gvfs lightdm lightdm-gtk-greeter
#                   polkit-elogind xfce4-screensaver xfce4-terminal font-dejavu  +  rc-update add lightdm
```

- `BROWSER=...`: o script instala o **Firefox** por padrão (`${BROWSER:-firefox}`), o que é pesado demais para o laboratório.
  Passar um pacote leve já esperado no desktop evita isso. Deixar a variável vazia **não** funciona, porque `:-` também
  trata o vazio como ausente.
- O login gráfico é pelo **LightDM** com o usuário e a senha do cliente, visto pelo noVNC. Por isso essa imagem
  **exige senha** (`requiresPassword`): só chave SSH não serve para a tela de login.
- A wiki do Alpine (páginas *Xfce* e *Setup-desktop*) bloqueou o acesso automatizado (HTTP 403). A fonte usada foi o próprio script.
- ✅ **Validado no build (revisão 7):** ~350 MB em uso com o XFCE aberto (253 MB no greeter), então 1 GB tem folga; VGA em
  1280×800; o login gráfico com a senha do cliente funciona **sem** os grupos `audio,video` (o `elogind` gerencia o seat). O
  `setup-xorg-base` já habilita o repositório `community` e troca o `mdev` pelo `udev` sozinho.

### 3.7 Catálogo de imagens (e requisitos mínimos)

| Imagem | Template | Usuário padrão | Privilégio | Disco mín. | RAM mín. | Observações |
|---|---|---|---|---|---|---|
| **Alpine Linux 3.24** | 9000 | `alpine` | `doas` | 2 GB | 256 MB | A mais leve (34 MB em uso). Ideal para demonstração |
| **Debian 13 "trixie"** | 9001 | `debian` | `sudo` | 3 GB | 512 MB | A imagem `genericcloud` já é enxuta (84 MB em uso) |
| **Ubuntu 24.04 LTS (minimal)** | 9002 | `ubuntu` | `sudo` | 4 GB | 512 MB | A mais pesada das três (~160 MB em uso) |
| **Alpine 3.24 Desktop (XFCE)** | 9003 | `alpine` | `doas` | 4 GB | 1 GB | Interface gráfica (XFCE + LightDM) vista pelo noVNC. **Exige senha** (login gráfico). Pesada para o laboratório: cabe uma de cada vez |

Os mínimos ficam no banco (`OsTemplate`) e controlam:
- quais planos aparecem habilitados na tela de criação (§14.5);
- a validação no servidor, que recusa com `422 PLAN_BELOW_IMAGE_MINIMUM` mesmo que o frontend seja burlado.

As imagens de servidor mostram o console de texto no noVNC; a Desktop mostra a tela de login gráfica do LightDM e,
depois do login, a área de trabalho XFCE. Os mínimos da Desktop são estimativas conservadoras, a confirmar no build (§3.6).

---

## 4. Stack e versões

**Fotografia de 2026-09-23**, gerada pelo script de verificação de §4.1: a coluna "Maior estável" é a
maior versão **sem sufixo de pré-release** (`-rc`, `-beta`, `-dev`…). Na hora de instalar, o script
roda de novo e **vale a versão que ele indicar naquele momento**, não esta tabela.

| Pacote | Tag `latest` | Maior estável | Uso |
|---|---|---|---|
| Node.js | — | 24.12.0 (instalado) | Atende o `engines` de todos os pacotes abaixo (o mais exigente é o `react-router`: `>=22.22.0`) |
| typescript | 7.0.2 | **7.0.2** | Compilador nativo (Go). Suporta `experimentalDecorators` + `emitDecoratorMetadata` (necessários no build do tsyringe) |
| express | 5.2.1 | 5.2.1 | Erros de handlers `async` vão direto para o error handler. Curinga de rota é nomeado (`/{*splat}`) |
| vite | 8.3.0 | 8.3.0 | `createServer({ server: { middlewareMode: true }, appType: 'custom' })` |
| @vitejs/plugin-react | 6.1.1 | 6.1.1 | |
| react / react-dom | 19.3.0 | 19.3.0 | |
| react-router | 8.4.0 | 8.4.0 | |
| @tanstack/react-query | 5.103.2 | 5.103.2 | Cache do estado do servidor (`/auth/me`, VPS, faturas) |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 4.3.3 | |
| shadcn (CLI) | 4.21.0 | 4.21.0 | `npx shadcn@4.21.0 init` / `add …` (versão explícita também no `npx`) |
| lucide-react · cn · class-variance-authority · tw-animate-css · radix-ui | 1.47.0 · 0.4.0 · 0.7.1 · 1.4.0 · 1.6.7 | iguais | Dependências que o shadcn instala. **Conferidas depois** com `deps:check`. Rev. 8: a CLI 4.21 usa o pacote `cn` (do próprio shadcn) no lugar de `clsx` + `tailwind-merge`, que foram removidos |
| recharts · sonner | 3.10.1 · 2.0.8 | iguais | Gráficos (componente `chart` do shadcn) e toasts |
| react-hook-form / @hookform/resolvers | 7.88.0 / 5.9.1 | iguais | Formulários com validação zod |
| zod | 4.6.5 | 4.6.5 | Schemas compartilhados entre cliente e servidor |
| **prisma** | **8.0.0-rc.15** ⚠️ | **7.10.0** | A tag `latest` é um *release candidate*. `npm install prisma` **sem versão instalaria a pré-release**. Instalar `prisma@7.10.0` |
| @prisma/client / @prisma/adapter-mariadb | 7.10.0 | 7.10.0 | Mesma versão do `prisma` (as três precisam andar juntas) |
| tsyringe / reflect-metadata | 4.10.0 / 0.2.2 | iguais | Última release do tsyringe foi em abr/2025. Estável, mas pouco ativo (§19) |
| socket.io / socket.io-client | 4.8.3 | 4.8.3 | Chat e eventos de status das VPS |
| argon2 | 0.45.1 | 0.45.1 | Hash de senha (argon2id) |
| cookie-parser | 1.4.7 | 1.4.7 | |
| helmet | 8.3.0 | 8.3.0 | Headers de segurança e CSP |
| express-rate-limit | 8.7.0 | 8.7.0 | Login, registro e pagamento |
| pino / pino-http / pino-pretty | 10.3.1 / 11.0.0 / 13.1.3 | iguais | Logs estruturados, com cookies e Authorization ocultados (`pino-pretty` só em dev) |
| undici | 8.11.0 | 8.11.0 | `Agent` com CA customizada para o `fetch` até o Proxmox |
| dotenv | 18.0.3 | 18.0.3 | Usado pelo `prisma.config.ts` e pelo `config/env.ts` |
| cross-env | 10.1.0 | 10.1.0 | |
| tsx | 4.23.15 | 4.23.15 | Execução e watch do servidor em dev |
| @types/node · @types/express · @types/cookie-parser · @types/react · @types/react-dom · @types/supertest | 26.6.2 · 5.0.6 · 1.4.10 · 19.3.0 · 19.3.0 · 7.2.1 | iguais | |
| vitest / supertest | 5.0.1 / 7.3.0 | iguais | Testes unitários e de integração |
| @playwright/test | 1.63.0 | 1.63.0 | E2E, incluindo o chat com 2 navegadores |
| **@biomejs/biome** | 2.5.14 | 2.5.14 | **Lint + formatação** (substitui ESLint + typescript-eslint + Prettier, ver abaixo) |
| @xterm/xterm | 6.0.0 | 6.0.0 | (Fase 10) console web |
| @modelcontextprotocol/sdk | 1.30.0 | 1.30.0 | (Fase 10, opcional) MCP próprio |
| i18next / react-i18next / i18next-browser-languagedetector | 26.4.2 / 17.0.15 / 8.2.1 | iguais | Idiomas no frontend (§14.4). Peer `typescript` aceita `^7` |
| @novnc/novnc / @types/novnc__novnc | 1.7.0 / 1.6.0 | iguais | Console gráfico (§10.5). Os tipos estão uma versão atrás |
| ws / @types/ws | 8.21.3 / 8.18.1 | iguais | Proxy WebSocket do console no backend (§10.5) |
| @fontsource-variable/bricolage-grotesque · manrope · jetbrains-mono | 5.3.0 | iguais | Fontes da marca, auto-hospedadas (§14.6) |

**Por que Biome em vez de ESLint:** pela regra das versões estáveis, o TypeScript precisa ser o
**7.0.2**. O `typescript-eslint` 8.70.1 (a maior estável) declara `peerDependencies.typescript:
">=4.8.4 <6.1.0"`, então os dois não podem ser instalados juntos sem `--force`/`--legacy-peer-deps`, e
isso está proibido pela §4.1. Conferi a peer dependency de `typescript` em todos os pacotes da tabela,
e **o `typescript-eslint` é o único que conflita** (Prisma pede `>=5.4.0`; os demais não declaram).
O Biome faz lint e formatação sem depender do pacote `typescript`, com regras próprias para React
(hooks, JSX) e acessibilidade.

### 4.1 Política de dependências (regra do projeto)

1. **Só a maior versão estável.** Estável = versão publicada sem sufixo de pré-release. A tag
   `latest` do npm **não** é critério, porque pode apontar para uma pré-release (caso do `prisma`).
2. **Antes de instalar, verificar:** `npm run deps:stable -- <pacote> [<pacote>…]` imprime, para cada
   pacote, a tag `latest`, a maior versão estável e se as duas batem. É o mesmo script que gerou a tabela acima.
3. **Instalar sempre com a versão exata** vinda do passo 2:
   `npm install <pacote>@<versão>` (ou `npm install -D …`). Com `save-exact` ligado no projeto, o
   `package.json` recebe a versão exata (sem `^`), e o `package-lock.json` trava a árvore inteira.
4. **Nunca editar dependências no `package.json` à mão.** Instalar, atualizar e remover só com
   comandos npm: `npm install`, `npm install <pacote>@<versão>`, `npm uninstall <pacote>`.
   Os outros campos (`scripts`, `type`, `engines`…) também são alterados por comando
   (`npm pkg set scripts.dev="…"`), para manter tudo rastreável.
5. **Nada de `--force` ou `--legacy-peer-deps`.** Se a maior estável de A não for compatível com a
   maior estável de B, a solução é trocar de ferramenta (como Biome no lugar do ESLint) ou, se não
   houver alternativa razoável, **perguntar a você** antes de usar uma versão estável mais antiga,
   deixando o motivo registrado.
6. **Geradores de projeto que gravam versões fixas no `package.json`** (ex.: `npm create vite`, que
   usa as versões do template) **não serão usados**. O projeto começa com `npm init -y`, e cada pacote
   entra via passo 3.
7. **CLIs que instalam pacotes sozinhas** (`shadcn init/add`): elas instalam via npm, mas escolhem a
   versão por conta própria. Depois de cada uso, roda-se `npm run deps:check`, que confere **todas** as
   dependências diretas do `package.json` contra a maior estável e **falha** se alguma for pré-release ou
   estiver atrás da maior estável. O que estiver fora é corrigido com `npm install <pacote>@<versão>`.
8. **Execuções via `npx`** também levam a versão explícita (`npx shadcn@4.21.0 …`), e os binários do
   projeto (prisma, tsx, vitest, biome) são sempre os instalados localmente.

Scripts de apoio (em `scripts/deps/`, Node puro, sem dependências):
- `stable-versions.mjs`: para cada pacote, consulta `npm view <pkg> dist-tags versions time --json`,
  filtra as versões `^\d+\.\d+\.\d+$` e mostra a maior, com a data de publicação.
- `check-installed.mjs`: lê o `package.json`, obtém a versão instalada de cada dependência
  (`npm ls --depth=0 --json`), compara com a maior estável e sai com código 1 se houver divergência.
- Configuração inicial: `npm config set save-exact=true --location=project` (cria o `.npmrc` do projeto via comando).

---

## 5. Estrutura do projeto

Um único `package.json` (não é monorepo). Cliente e servidor compartilham `src/shared`.

```
vps-rental-platform/
├─ package.json · package-lock.json
├─ CLAUDE.md                     # contexto, regras e lições aprendidas para o Claude (criado na rev. 5)
├─ .npmrc                        # save-exact=true (criado por `npm config set … --location=project`)
├─ biome.json                    # lint + formatação
├─ tsconfig.json                 # base (strict) + references
├─ tsconfig.server.json          # include src/server, src/shared → outDir dist/server
├─ tsconfig.client.json          # include src/client, src/shared (noEmit; o Vite compila)
├─ vite.config.ts                # root: src/client, build.outDir: dist/client, alias @ e @shared
├─ components.json               # shadcn
├─ prisma.config.ts              # schema, migrations.path, migrations.seed, datasource.url por ambiente
├─ .env.example · .env.development · .env.test · .env.production   (.env.* fora do git, menos .example)
├─ certs/                        # pve-root-ca.pem (fora do git)
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/                # geradas pelo prisma migrate (versionadas)
│  └─ seed/
│     ├─ index.ts                # entrypoint: decide o que semear conforme NODE_ENV
│     ├─ permissions.ts · roles.ts · users.ts · plans.ts · os-templates.ts · ip-pool.ts
├─ scripts/
│  ├─ pve/bootstrap.sh           # setup idempotente do Proxmox (via SSH)
│  ├─ pve/build-template.sh     # golden images 9000–9003: cloud-init + DNS (Alpine) + qemu-guest-agent (§3.6)
│  ├─ pve/test-template.mjs     # aceite de um template com o token da plataforma (Node puro)
│  ├─ pve/cli.ts                 # CLI de desenvolvimento: npm run pve -- <comando>
│  ├─ db/create-databases.sql    # cria bancos dev/test/prod-local e o usuário vps_app
│  ├─ deps/stable-versions.mjs   # maior versão estável de cada pacote (§4.1)
│  └─ deps/check-installed.mjs   # confere as dependências instaladas contra a maior estável (§4.1)
├─ src/
│  ├─ shared/                    # usado pelo client e pelo server
│  │  ├─ schemas/                # zod: auth, vps, billing, support
│  │  ├─ types/                  # DTOs públicos (PublicUser, VpsDTO, …)
│  │  └─ constants/              # permissões, status, eventos socket
│  ├─ server/
│  │  ├─ main.ts                 # import 'reflect-metadata'; bootstrap http + socket + vite/static
│  │  ├─ app.ts                  # monta o express (middlewares globais + rotas)
│  │  ├─ config/env.ts           # leitura e validação (zod) das variáveis de ambiente
│  │  ├─ container/tokens.ts     # Symbols de DI (interfaces)
│  │  ├─ container/register.ts   # registro de singletons/instâncias
│  │  ├─ http/
│  │  │  ├─ routes/              # auth.routes.ts, vps.routes.ts, …
│  │  │  ├─ middlewares/         # originCheck, csrf, authenticate, requirePermission, validate, rateLimit, errorHandler
│  │  │  └─ spa.ts               # serve index.html (dev: via Vite; prod: dist) + cookie CSRF
│  │  ├─ controllers/
│  │  ├─ services/
│  │  ├─ repositories/
│  │  ├─ models/                 # AuthenticatedUser, entidades de domínio, enums, erros de domínio
│  │  ├─ integrations/
│  │  │  ├─ proxmox/             # ProxmoxClient, QemuCloudInitProvider, ImageProfile (alpine/debian/ubuntu), TaskWaiter
│  │  │  └─ payment/             # PaymentGateway (interface) + FakePaymentGateway
│  │  ├─ jobs/                   # JobQueue (MySQL), Worker, handlers: provisionVps, deleteVps, reconcile, cleanup
│  │  ├─ realtime/               # socket.ts (auth handshake), support.handlers.ts, rooms, consoleProxy.ts (noVNC ↔ Proxmox)
│  │  ├─ utils/                  # crypto (hash/HMAC), cookies, errors (AppError), logger, clock
│  │  ├─ types/express.d.ts      # augmentation: req.user, req.sessionId
│  │  └─ generated/prisma/       # saída do prisma generate (fora do git)
│  └─ client/
│     ├─ index.html
│     ├─ main.tsx · App.tsx · router.tsx
│     ├─ lib/api.ts              # fetch wrapper (credentials, X-CSRF-Token, retry de CSRF, 401)
│     ├─ lib/socket.ts
│     ├─ lib/currency/rates.ts   # taxas fixas de demonstração (exibição apenas, §14.4)
│     ├─ lib/i18n.ts             # configuração do i18next
│     ├─ locales/<idioma>/*.json # pt-BR (padrão), en-US, es-ES
│     ├─ assets/brand/           # logo.svg, logo-mark.svg, favicon.svg (§14.6)
│     ├─ styles/theme.css        # tokens da marca Favo (claro/escuro) mapeados no tema do shadcn
│     ├─ components/ui/          # shadcn
│     ├─ components/             # layout, loaders, guards
│     └─ features/
│        ├─ auth/ · vps/ · billing/ · support/ · agent/ · account/
└─ docs/
   ├─ PLANO_DE_IMPLEMENTACAO.md  # este arquivo
   └─ arquitetura.md             # diagramas finais (Fase 9)
```

---

## 6. Servidor único Express + Vite

Baseado na seção "Setting Up the Dev Server" do [guia SSR do Vite](https://vite.dev/guide/ssr).

```ts
// src/server/main.ts (esboço)
import 'reflect-metadata';
const app = createApp();                       // helmet, json, cookie-parser, pino-http, /api/*
const httpServer = http.createServer(app);

if (env.NODE_ENV === 'development') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } }, // HMR na mesma porta
    appType: 'custom',
  });
  app.use(vite.middlewares);                   // módulos, /@vite/client, assets
  app.get('/{*splat}', spaHandler(async (url) =>
    vite.transformIndexHtml(url, await readFile('src/client/index.html', 'utf8'))));
} else {
  app.use(express.static('dist/client', { index: false, maxAge: '1y', immutable: true }));
  const html = await readFile('dist/client/index.html', 'utf8');   // em memória
  app.get('/{*splat}', spaHandler(async () => html));
}
attachSocketIo(httpServer);                    // path /socket.io, não conflita com o HMR
httpServer.listen(env.PORT);
```

Pontos importantes:
- **Ordem:** `/api/*` (com 404 em JSON próprio) → Vite/estáticos → fallback SPA. Assim a API nunca devolve HTML por engano.
- `index: false` no `express.static` é intencional: o `index.html` **sempre** passa pelo `spaHandler`,
  que emite o cookie CSRF e define `Cache-Control: no-store`.
- `import('vite')` dinâmico: em produção o Vite não é carregado (pode ficar em `devDependencies`).
- O `tsx watch` só reinicia quando mudam arquivos importados pelo servidor. Arquivos `.tsx` do cliente
  são atualizados pelo HMR do Vite, sem reiniciar o Node.
- Helmet/CSP: em dev a CSP é afrouxada para o HMR (`ws:` e inline do React Refresh). Em prod fica estrita (`script-src 'self'`).

### Scripts do `package.json`

Os scripts são gravados com `npm pkg set` (§4.1, item 4), por exemplo
`npm pkg set scripts.dev="cross-env NODE_ENV=development tsx watch --clear-screen=false src/server/main.ts"`.
Resultado esperado:

```jsonc
{
  "scripts": {
    "dev":               "cross-env NODE_ENV=development tsx watch --clear-screen=false --tsconfig tsconfig.server.json --exclude \"src/client/**\" src/server/main.ts",
    "build":             "npm run build:client && npm run build:server",
    "build:client":      "cross-env NODE_ENV=production vite build",
    "build:server":      "tsc -p tsconfig.server.json",
    "start":             "cross-env NODE_ENV=production node dist/server/main.js",
    "typecheck":         "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "lint":              "biome check .",
    "lint:fix":          "biome check --write .",
    "format":            "biome format --write .",

    "deps:stable":       "node scripts/deps/stable-versions.mjs",
    "deps:check":        "node scripts/deps/check-installed.mjs",

    "db:generate":       "prisma generate",
    "db:migrate:dev":    "cross-env NODE_ENV=development prisma migrate dev",
    "db:migrate:create": "cross-env NODE_ENV=development prisma migrate dev --create-only",
    "db:migrate:reset":  "cross-env NODE_ENV=development prisma migrate reset",
    "db:migrate:deploy": "cross-env NODE_ENV=production prisma migrate deploy",
    "db:migrate:test":   "cross-env NODE_ENV=test prisma migrate reset --force",
    "db:seed:dev":       "cross-env NODE_ENV=development prisma db seed",
    "db:seed:test":      "cross-env NODE_ENV=test prisma db seed",
    "db:seed:prod":      "cross-env NODE_ENV=production prisma db seed",
    "db:setup:dev":      "npm run db:migrate:dev && npm run db:seed:dev",
    "db:studio":         "cross-env NODE_ENV=development prisma studio",

    "pve":               "cross-env NODE_ENV=development tsx scripts/pve/cli.ts",
    "test":              "cross-env NODE_ENV=test vitest run",
    "test:watch":        "cross-env NODE_ENV=test vitest",
    "test:e2e":          "cross-env NODE_ENV=test playwright test"
  }
}
```

---

## 7. Injeção de dependências com tsyringe

**Problema técnico verificado:** o `tsx` usa esbuild, que **não emite `design:paramtypes`**
(`emitDecoratorMetadata`). Sem essa metadata, o tsyringe não descobre sozinho o tipo dos parâmetros
do construtor. Em dev, a resolução automática quebraria. Em produção, o `tsc` emitiria a metadata, e
o comportamento ficaria **diferente entre os ambientes**, o que é a pior combinação possível.

**Solução adotada:** **sempre `@inject(...)` explícito** em todo parâmetro de construtor. Funciona igual
em `tsx`, `tsc` e vitest.

```ts
// container/tokens.ts
export const TOKENS = {
  Prisma:                Symbol('Prisma'),
  VirtualizationProvider: Symbol('VirtualizationProvider'),
  PaymentGateway:        Symbol('PaymentGateway'),
  Clock:                 Symbol('Clock'),
  Env:                   Symbol('Env'),
} as const;

// services/VpsService.ts
@singleton()
export class VpsService {
  constructor(
    @inject(VpsRepository) private readonly vpsRepo: VpsRepository,            // classe como token
    @inject(TOKENS.VirtualizationProvider) private readonly vp: VirtualizationProvider, // interface → Symbol
    @inject(JobQueue) private readonly jobs: JobQueue,
  ) {}
}

// container/register.ts
container.registerInstance(TOKENS.Env, env);
container.registerInstance(TOKENS.Prisma, prisma);
container.register(TOKENS.VirtualizationProvider, { useClass: QemuCloudInitProvider }, { lifecycle: Lifecycle.Singleton });
container.register(TOKENS.PaymentGateway, { useClass: FakePaymentGateway }, { lifecycle: Lifecycle.Singleton });
```

- `tsconfig`: `experimentalDecorators: true`, `emitDecoratorMetadata: true` (útil no build com tsc, mas o código não depende disso).
- `import 'reflect-metadata'` é a **primeira linha** do `main.ts`, do `seed/index.ts` e do setup do vitest.
- Controllers são resolvidos pelo container (`container.resolve(AuthController)`) e seus métodos são ligados às rotas.
- Nos testes, `container.createChildContainer()` permite trocar `TOKENS.VirtualizationProvider` por um fake.

---

## 8. Banco de dados, Prisma, migrations e seeds

### 8.1 Bancos e usuário

`scripts/db/create-databases.sql` (executado uma vez com o root do MySQL):
- Bancos: `vps_platform_dev`, `vps_platform_test`, `vps_platform_prod` (produção simulada local) e `vps_platform_shadow` (shadow DB do `migrate dev`).
- Usuário **`vps_app`** (não root) com `ALL` só nesses bancos. O `shadowDatabaseUrl` aponta para o banco
  shadow pré-criado, então o usuário não precisa de `CREATE DATABASE` global.

### 8.2 Prisma 7

`prisma.config.ts` carrega `.env.${NODE_ENV}`. Por isso o cross-env nos scripts decide o banco:

```ts
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
config({ path: `.env.${process.env.NODE_ENV ?? 'development'}` });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed/index.ts' },
  datasource: { url: env('DATABASE_URL') /* + shadowDatabaseUrl em dev, conferir o nome da chave na F2 */ },
});
```

Cliente com pool explícito (adapter MariaDB, que é o adapter indicado para MySQL na doc do Prisma 7):

```ts
const adapter = new PrismaMariaDb({ host, port, user, password, database, connectionLimit: env.DB_POOL_LIMIT });
export const prisma = new PrismaClient({ adapter });   // um único singleton, registrado no container
```

> O pool é criado **uma vez** no boot e compartilhado. Isso atende ao seu requisito de não abrir uma
> conexão por requisição. Encerramento gracioso: `SIGINT`/`SIGTERM` → parar o worker → `io.close()` → `server.close()` → `prisma.$disconnect()`.

### 8.3 Schema (rascunho da primeira migration)

> **Implementado na revisão 9** em `prisma/schema.prisma` (migration `20260923072111_init`), com estas diferenças: todas as
> tabelas têm `@@map` em minúsculas/snake_case (`users`, `role_permissions`, `ip_addresses`…), porque o MySQL do Windows roda
> com `lower_case_table_names=1`; `IpAddress.macAddress` (único, derivado do IP, §3.3); `OsTemplate.pveTemplateVmid` único;
> índices nas chaves estrangeiras que não tinham (`users.roleId`, `vps.planId`…). O rascunho abaixo fica como referência.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/server/generated/prisma"
}

datasource db {
  provider = "mysql"
}

// ───────────── Identidade e RBAC ─────────────
model User {
  id           String    @id @default(uuid()) @db.Char(36)
  email        String    @unique @db.VarChar(254)
  name         String    @db.VarChar(120)
  passwordHash String    @db.VarChar(255)
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  roleId       Int
  role         Role      @relation(fields: [roleId], references: [id])
  sessions     Session[]
  sshKeys      SshKey[]
  vpsList      Vps[]
  invoices     Invoice[]
  customerConversations SupportConversation[] @relation("CustomerConversations")
  agentConversations    SupportConversation[] @relation("AgentConversations")
  messages     SupportMessage[]
}

model Role {
  id          Int      @id @default(autoincrement())
  key         String   @unique @db.VarChar(50)     // customer | support_agent | admin
  name        String   @db.VarChar(100)
  description String?  @db.VarChar(255)
  isSystem    Boolean  @default(false)             // roles do seed não podem ser apagadas
  permissions RolePermission[]
  users       User[]
}

model Permission {
  id          Int      @id @default(autoincrement())
  key         String   @unique @db.VarChar(100)    // ex.: "vps:create"
  description String   @db.VarChar(255)
  roles       RolePermission[]
}

model RolePermission {
  roleId       Int
  permissionId Int
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
}

model Session {
  id                String    @id @default(uuid()) @db.Char(36)
  tokenHash         String    @unique @db.Char(64)   // SHA-256 (hex) do token do cookie
  userId            String    @db.Char(36)
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt         DateTime  @default(now())
  lastSeenAt        DateTime  @default(now())
  expiresAt         DateTime                          // expiração por inatividade (deslizante)
  absoluteExpiresAt DateTime                          // teto absoluto
  revokedAt         DateTime?
  ip                String?   @db.VarChar(45)
  userAgent         String?   @db.VarChar(512)
  @@index([userId])
  @@index([expiresAt])
}

model SshKey {
  id          Int      @id @default(autoincrement())
  userId      String   @db.Char(36)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String   @db.VarChar(80)
  publicKey   String   @db.Text
  fingerprint String   @db.VarChar(100)
  createdAt   DateTime @default(now())
  @@unique([userId, fingerprint])
}

// ───────────── Catálogo ─────────────
model Plan {
  id            Int     @id @default(autoincrement())
  slug          String  @unique @db.VarChar(40)       // nano | micro | small
  name          String  @db.VarChar(80)
  cores         Int
  memoryMb      Int
  diskGb        Int
  bandwidthMbps Int                                    // vira net0.rate (MB/s = Mbps/8)
  priceCents    Int                                    // mensal, BRL
  isActive      Boolean @default(true)
  sortOrder     Int     @default(0)
  vpsList       Vps[]
}

model OsTemplate {
  id       Int     @id @default(autoincrement())
  slug     String  @unique @db.VarChar(40)            // alpine-3.24
  name     String  @db.VarChar(80)                    // "Alpine Linux 3.24"
  pveTemplateVmid Int                                  // 9000 (golden image, §3.6)
  defaultUser     String @db.VarChar(32)               // alpine
  family          String @db.VarChar(20)               // alpine | debian | ubuntu (define o ImageProfile)
  version         String @db.VarChar(20)               // 3.24 | 13 | 24.04
  sudoCommand     String @db.VarChar(10)               // doas | sudo
  minMemoryMb     Int
  minDiskGb       Int
  supportsRootPassword Boolean @default(true)
  supportsSshKeys      Boolean @default(true)
  requiresPassword     Boolean @default(false)       // true na Desktop: o login gráfico exige senha
  hasGui               Boolean @default(false)
  sortOrder       Int     @default(0)
  isActive Boolean @default(true)
  vpsList  Vps[]
}

// ───────────── Infraestrutura ─────────────
enum IpStatus { FREE RESERVED ASSIGNED }

model IpAddress {
  id        Int      @id @default(autoincrement())
  address   String   @unique @db.VarChar(45)
  prefix    Int                                        // 24
  gateway   String   @db.VarChar(45)
  status    IpStatus @default(FREE)
  vps       Vps?
  updatedAt DateTime @updatedAt
  @@index([status])
}

enum VpsStatus {
  PENDING_PAYMENT PROVISIONING RUNNING STOPPED STARTING STOPPING REBOOTING
  UPDATING DELETING DELETED SUSPENDED ERROR
}

model Vps {
  id           String     @id @default(uuid()) @db.Char(36)
  userId       String     @db.Char(36)
  user         User       @relation(fields: [userId], references: [id])
  planId       Int
  plan         Plan       @relation(fields: [planId], references: [id])
  osTemplateId Int
  osTemplate   OsTemplate @relation(fields: [osTemplateId], references: [id])
  hostname     String     @db.VarChar(63)
  username     String     @db.VarChar(32)             // usuário criado pelo cloud-init (ciuser)
  sshPasswordAuth Boolean  @default(false)            // escolha do cliente, aplicada pelo guest agent
  rootPasswordSet Boolean  @default(false)            // só o indicador; senhas nunca são guardadas
  status       VpsStatus  @default(PENDING_PAYMENT)
  // cópia dos recursos no momento da contratação (o plano pode mudar depois)
  cores        Int
  memoryMb     Int
  diskGb       Int
  bandwidthMbps Int
  pveNode      String?    @db.VarChar(64)
  pveVmid      Int?       @unique
  ipAddressId  Int?       @unique
  ipAddress    IpAddress? @relation(fields: [ipAddressId], references: [id])
  lastError    String?    @db.Text
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  deletedAt    DateTime?
  invoices     Invoice[]
  events       VpsEvent[]
  @@index([userId, status])
}

model VpsEvent {                                        // histórico visível para o cliente
  id        Int      @id @default(autoincrement())
  vpsId     String   @db.Char(36)
  vps       Vps      @relation(fields: [vpsId], references: [id], onDelete: Cascade)
  actorId   String?  @db.Char(36)
  action    String   @db.VarChar(40)                   // create | start | stop | resize | delete …
  status    String   @db.VarChar(20)                   // requested | succeeded | failed
  pveUpid   String?  @db.VarChar(255)
  message   String?  @db.Text
  createdAt DateTime @default(now())
  @@index([vpsId, createdAt])
}

// ───────────── Cobrança (simulada) ─────────────
enum InvoiceStatus { PENDING PAID FAILED CANCELED }
enum PaymentStatus { APPROVED DECLINED }

model Invoice {
  id          String        @id @default(uuid()) @db.Char(36)
  number      Int           @unique @default(autoincrement())
  userId      String        @db.Char(36)
  user        User          @relation(fields: [userId], references: [id])
  vpsId       String?       @db.Char(36)
  vps         Vps?          @relation(fields: [vpsId], references: [id])
  description String        @db.VarChar(255)
  amountCents Int
  currency    String        @default("BRL") @db.Char(3)
  status      InvoiceStatus @default(PENDING)
  periodStart DateTime?
  periodEnd   DateTime?
  dueAt       DateTime
  paidAt      DateTime?
  createdAt   DateTime      @default(now())
  payments    Payment[]
  @@index([userId, status])
}

model Payment {
  id               String        @id @default(uuid()) @db.Char(36)
  invoiceId        String        @db.Char(36)
  invoice          Invoice       @relation(fields: [invoiceId], references: [id])
  status           PaymentStatus
  amountCents      Int
  cardBrand        String        @db.VarChar(20)
  cardLast4        String        @db.Char(4)           // nunca PAN completo nem CVV
  gatewayReference String        @db.VarChar(64)
  failureCode      String?       @db.VarChar(40)
  createdAt        DateTime      @default(now())
}

// ───────────── Jobs assíncronos (fila no MySQL) ─────────────
enum JobStatus { QUEUED RUNNING SUCCEEDED FAILED }

model Job {
  id          Int       @id @default(autoincrement())
  type        String    @db.VarChar(50)                // provision_vps | delete_vps | vps_action | reconcile
  payload     Json
  status      JobStatus @default(QUEUED)
  attempts    Int       @default(0)
  maxAttempts Int       @default(5)
  runAt       DateTime  @default(now())
  lockedAt    DateTime?
  lockedBy    String?   @db.VarChar(64)
  lastError   String?   @db.Text
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([status, runAt])
}

// ───────────── Suporte ─────────────
enum ConversationStatus { WAITING ACTIVE CLOSED }

model SupportConversation {
  id         String             @id @default(uuid()) @db.Char(36)
  customerId String             @db.Char(36)
  customer   User               @relation("CustomerConversations", fields: [customerId], references: [id])
  agentId    String?            @db.Char(36)
  agent      User?              @relation("AgentConversations", fields: [agentId], references: [id])
  subject    String             @db.VarChar(150)
  status     ConversationStatus @default(WAITING)
  createdAt  DateTime           @default(now())
  claimedAt  DateTime?
  closedAt   DateTime?
  messages   SupportMessage[]
  @@index([status, createdAt])
  @@index([customerId, status])
  @@index([agentId, status])
}

model SupportMessage {
  id             Int                 @id @default(autoincrement())
  conversationId String              @db.Char(36)
  conversation   SupportConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String?             @db.Char(36)     // null = mensagem do sistema ("Técnico X entrou")
  sender         User?               @relation(fields: [senderId], references: [id])
  body           String              @db.Text
  createdAt      DateTime            @default(now())
  @@index([conversationId, id])
}

model AuditLog {
  id         Int      @id @default(autoincrement())
  actorId    String?  @db.Char(36)
  action     String   @db.VarChar(60)                  // auth.login_failed, vps.delete, invoice.paid …
  targetType String?  @db.VarChar(40)
  targetId   String?  @db.VarChar(64)
  metadata   Json?
  ip         String?  @db.VarChar(45)
  createdAt  DateTime @default(now())
  @@index([action, createdAt])
}
```

### 8.4 Seeds

> **Implementado na revisão 9** em `prisma/seed/` (`run.ts` orquestra `rbac.ts`, `catalog-seed.ts` e `users.ts`; `index.ts` é o
> entrypoint do `prisma db seed`). Usuários de demonstração: `admin@`, `ana@`, `bruno@`, `carla@` e `diego@favo.local`. O seed
> **não altera usuários existentes** (nunca desfaz uma troca de role feita pela administração) e nunca muda o `status` dos IPs.
> Pool de IPs: `.200–.228` em dev (o `.229` fica para testes manuais) e `10.99.0.10–.19` em test.

Idempotentes (`upsert` por chave natural), **sem VMs**, como você pediu. O conteúdo depende do `NODE_ENV`:

| Dado | dev | test | prod |
|---|---|---|---|
| Permissões (lista abaixo, espelhando as constantes do código) | ✅ | ✅ | ✅ |
| Roles + vínculos role↔permissão | ✅ | ✅ | ✅ |
| Planos (Nano/Micro/Small) | ✅ | ✅ | ✅ |
| Imagens (Alpine 9000, Debian 9001, Ubuntu 9002, Alpine Desktop 9003) com mínimos e capacidades | ✅ | ✅ | ✅ |
| Pool de IPs `IP_POOL_START..END` | ✅ | ✅ (faixa fictícia) | ✅ |
| Admin | `admin@favo.local` | fixo | **`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` obrigatórios** |
| Usuários de demonstração | 2 clientes + 2 técnicos, senha `SEED_DEFAULT_PASSWORD` | fixos | ❌ nunca |

**Permissões** (cada usuário tem **uma** role; o modelo está em §9.7):

| Chave | customer | support_agent | admin |
|---|:-:|:-:|:-:|
| `account:manage:own` | ✅ | ✅ | ✅ |
| `vps:read:own` · `vps:create` · `vps:manage:own` · `vps:delete:own` · `vps:console:own` | ✅ | | |
| `sshkey:manage:own` | ✅ | | |
| `billing:read:own` · `billing:pay:own` | ✅ | | |
| `support:conversation:create` · `support:conversation:read:own` | ✅ | | |
| `support:queue:read` · `support:conversation:claim` · `support:conversation:reply` · `support:conversation:close` | | ✅ | ✅ |
| `admin:overview:read` · `admin:users:read` · `admin:users:assign-role` · `admin:vps:read` | | | ✅ |
| `admin:roles:manage` (editar as permissões de cada role; tela na Fase 10) | | | ✅ |

O técnico **não tem nenhuma permissão `vps:*`, `billing:*` nem `sshkey:*`**. Isso garante, no servidor, a sua regra
de que o suporte só tem o chat. O admin não tem `vps:*:own` porque não é cliente. A visão administrativa das VPS
usa `admin:vps:read`, que é **somente leitura** e **não inclui o console**.

**Planos** (dimensionados para o laboratório; o disco em `lvmthin` é alocado sob demanda):

| Plano | vCPU | RAM | Disco | Banda | Preço/mês | Imagens compatíveis |
|---|---|---|---|---|---|---|
| Nano | 1 | 256 MB | 2 GB | 10 Mbps | R$ 9,90 | Alpine |
| Micro | 1 | 512 MB | 4 GB | 25 Mbps | R$ 19,90 | Alpine, Debian, Ubuntu |
| Small | 2 | 768 MB | 6 GB | 50 Mbps | R$ 34,90 | Alpine, Debian, Ubuntu |
| Medium | 2 | 1 GB | 8 GB | 100 Mbps | R$ 49,90 | Todas (única compatível com a Alpine Desktop) |

---

## 9. Segurança: CSRF, sessão e autorização

### 9.1 Análise da sua proposta de CSRF (e a resposta à pergunta "JWT ou banco?")

**O que está certo:** como o HTML é estático, o token realmente precisa chegar por cookie, e faz
sentido entregá-lo junto com a página. Proteger login e registro também está certo, porque existe
*login CSRF*, em que o atacante loga a vítima na conta dele (a OWASP recomenda exatamente isso, com
"pré-sessões").

**O ponto que precisa de ajuste:** se o token for *enviado de volta só pelo cookie*, a proteção é
**nula**, porque o navegador anexa cookies automaticamente também nas requisições forjadas por
outros sites. O que protege é o **JavaScript da sua página ler o cookie e reenviá-lo num header
customizado** (`X-CSRF-Token`). Um site de terceiro não consegue ler cookies da sua origem nem
definir headers customizados em requisições cross-site. Esse é o padrão *cookie-to-header* que a
OWASP indica para SPAs. Por isso, o cookie CSRF é **não-HttpOnly** (o JS precisa lê-lo), enquanto o
cookie de sessão é **HttpOnly** (o JS nunca o vê).

**JWT, banco ou HMAC?**
- **JWT:** desnecessário. JWT é um formato para transportar *claims* (dados). O token CSRF não precisa carregar nada.
- **Banco:** funciona, mas cria uma escrita no banco **a cada página aberta por visitante anônimo**.
  Bots ou crawlers enchem a tabela, é preciso uma limpeza periódica, e isso não traz nenhuma
  segurança a mais do que a assinatura, porque o token já morre junto com a sessão (ver abaixo).
- **HMAC vinculado à sessão (escolhido):** é o **Signed Double-Submit Cookie** que a OWASP recomenda:
  "sempre vincule o token CSRF explicitamente a dados da sessão" e "HMAC é preferível a hash simples".
  É stateless (nenhuma escrita no banco) e não pode ser forjado sem o segredo do servidor.

O **banco fica para o que realmente precisa ser revogável e listável: a sessão de login** (logout,
"encerrar outras sessões", expiração). Nisso a sua proposta foi mantida.

### 9.2 Construção do token CSRF

```
binding   = sessionTokenHash            (se existir cookie de sessão)
          | preSessionId                (cookie HttpOnly aleatório "psid" para visitantes; sem banco)
payload   = base64url(nonce 16 bytes) + "." + exp (unix, ex.: +12h)
csrfToken = payload + "." + base64url( HMAC-SHA256(CSRF_SECRET, binding + "|" + payload) )
```

Validação (middleware `csrf`, só em `POST/PUT/PATCH/DELETE`):
1. Header `X-CSRF-Token` presente e **igual** ao cookie `csrf` (`timingSafeEqual`).
2. `exp` no futuro.
3. HMAC recalculado com o **binding atual** confere (`timingSafeEqual`).
4. Qualquer falha → `403 { error: { code: 'CSRF_INVALID' } }`.

Consequências automáticas:
- **Login:** a sessão muda, então o binding muda. A resposta do login já grava um novo cookie `csrf`
  (e o token antigo, da pré-sessão, deixa de valer). Isso também previne *session fixation*.
- **Logout:** a sessão é revogada, um novo `psid` e um novo `csrf` são emitidos, e os tokens antigos morrem.
- `GET /api/auth/csrf` reemite o token (usado quando ele expira com a aba aberta).
  O cliente, ao receber `CSRF_INVALID`, chama esse endpoint e **repete a requisição uma vez**.

### 9.3 Camadas extras (defesa em profundidade)

| Camada | Detalhe |
|---|---|
| `originCheck` | Em métodos não seguros: rejeita `Sec-Fetch-Site: cross-site` e `Origin` diferente de `APP_ORIGIN` (Fetch Metadata / verificação de origem da OWASP) |
| Cookie de sessão | `HttpOnly; SameSite=Strict; Path=/`, com `Secure` e prefixo `__Host-` quando houver HTTPS. `Strict` não atrapalha aqui: a checagem de login é feita por `fetch` same-origin, então um link externo para a plataforma continua funcionando |
| GETs sem efeito colateral | Nenhuma rota `GET` altera estado (o `SameSite` e o CSRF não cobrem GETs) |
| WebSocket | Socket.IO valida `Origin` no handshake (`allowRequest`) e autentica pelo cookie de sessão. Isso evita *Cross-Site WebSocket Hijacking*, porque WebSocket não passa por CORS |
| Rate limit | Login (por IP e por e-mail), registro, pagamento e abertura de conversa |
| Senhas | argon2id. Mensagem genérica "e-mail ou senha inválidos". Quando o usuário não existe, o servidor verifica contra um hash fictício para equalizar o tempo de resposta (anti-enumeração) |
| Helmet | CSP estrita em produção, `frame-ancestors 'none'`, `Referrer-Policy`, etc. |
| Logs | pino com `redact` de `cookie`, `authorization`, `password`, `card*` |

Cookies: `sid` (sessão), `psid` (pré-sessão) e `csrf` (lido pelo JS). Em produção com HTTPS viram
`__Host-sid`, `__Host-psid` e `__Host-csrf` (flag de configuração `COOKIE_SECURE`).

### 9.4 Sessão de login

- Token = 32 bytes aleatórios (base64url) → cookie. No banco fica **só** o `SHA-256(token)`.
- Expiração deslizante (`SESSION_IDLE_TTL_HOURS=24`) com teto absoluto (`SESSION_ABSOLUTE_TTL_DAYS=7`).
  A renovação do `lastSeenAt`/`expiresAt` é *throttled* (no máximo a cada 5 min) para não gerar uma escrita por requisição.
- Tela "Minha conta → Sessões ativas": lista e revoga sessões (dispositivo, IP, último acesso).
- Um job periódico apaga sessões expiradas ou revogadas há mais de 30 dias.

### 9.5 Middlewares e `req.user`

```ts
// models/AuthenticatedUser.ts
export class AuthenticatedUser {
  constructor(
    readonly id: string, readonly email: string, readonly name: string,
    readonly role: RoleKey, private readonly permissions: ReadonlySet<Permission>,
    readonly sessionId: string,
  ) {}
  can(permission: Permission): boolean { return this.permissions.has(permission); }
  is(role: RoleKey): boolean { return this.role === role; }   // uso raro: o código verifica permissões (§9.7)
  toPublic(): PublicUser { return { id: this.id, email: this.email, name: this.name, role: this.role, permissions: [...this.permissions] }; }
}

// types/express.d.ts
declare global { namespace Express { interface Request { user?: AuthenticatedUser } } }
```

| Middleware | Função |
|---|---|
| `originCheck` | Ver §9.3 |
| `csrf` | Valida o token (§9.2). Lê o binding a partir do hash do cookie `sid` ou do `psid`, **sem consultar o banco**, por isso pode rodar antes da autenticação, como você pediu |
| `authenticate` | Cookie `sid` → hash → sessão + usuário + role + permissões (uma query) → `req.user = new AuthenticatedUser(…)`. Sem sessão válida → `401 UNAUTHENTICATED` |
| `optionalAuthenticate` | Igual, mas segue sem `req.user` (ex.: catálogo público) |
| `requirePermission(...perms)` | `403 FORBIDDEN` se `!req.user.can(p)` |
| `validate({ body, params, query })` | Schemas zod de `src/shared/schemas` → `400 VALIDATION_ERROR` |
| `errorHandler` | Converte `AppError` para `{ error: { code, message, details? } }` e loga o resto como 500 sem vazar a stack |

Ordem numa rota protegida que altera dados:
`originCheck → csrf → authenticate → requirePermission → validate → controller`.

Além disso, **verificação de propriedade** no service: `vps.userId === req.user.id`. Se a VPS for de outro usuário, a resposta é `404`
(e não 403), para não revelar que ela existe.

### 9.6 Fluxos completos

**Abrir qualquer página:**
1. `GET /qualquer-rota` → `spaHandler` → se não houver `csrf` válido, cria `psid` + `csrf` → devolve o HTML (`no-store`).
2. O React carrega e mostra o *loader* de tela cheia → `GET /api/auth/me`.
3. `200 { user }` → guarda no `AuthContext` (via TanStack Query) → renderiza a rota. `401` → `/login?next=<rota>`.

**Login:**
1. `POST /api/auth/login` com `X-CSRF-Token` → `originCheck → rateLimit → csrf → validate`.
2. Busca o usuário, compara com argon2, cria a `Session`, grava `Set-Cookie: sid=…` e um novo `csrf`.
3. `200 { user }` → o frontend faz `window.location.assign(next ?? '/')`. É o reload que você descreveu:
   o app recomeça do zero, já com os cookies novos.

**Registro:** `POST /api/auth/register` → cria o usuário com a role `customer` → faz login automático (mesma resposta do login).

**Logout:** `POST /api/auth/logout` → revoga a sessão → limpa `sid` → novos `psid`/`csrf` → desconecta os sockets daquela sessão.

### 9.7 Roles e permissões: o que faz sentido para o escopo

**Decisão:** **cada usuário tem exatamente uma role, cada role tem várias permissões, e o código verifica
permissões** (nunca o nome da role). É o que você descreveu, e continua simples o suficiente para o projeto.

**Por que não "só roles" (`if (user.role === 'admin')`):**
- Com checagem por role, o nome da role fica espalhado pelo código. Criar uma role nova (ex.: "financeiro",
  que só vê faturas) obrigaria a caçar e alterar todos os `if`.
- Com checagem por permissão (`requirePermission('billing:read:any')`), criar uma role nova é **só dado**:
  um registro no banco e a marcação das permissões que ela tem, sem mexer em código.
- O custo extra é pequeno: duas tabelas (`Permission`, `RolePermission`), e a lista de permissões do usuário já
  vem na mesma consulta que valida a sessão.

**Por que não algo mais sofisticado** (várias roles por usuário, permissões por recurso, hierarquia de roles, ABAC completo):
nenhum requisito do projeto pede isso, e aumentaria a complexidade sem ganho visível. O `UserRole` muitos-para-muitos
da revisão 1 **foi trocado por `User.roleId`**.

**Como funciona:**
- **Fonte da verdade das permissões:** uma constante no código (`src/shared/constants/permissions.ts`,
  com um tipo union gerado a partir dela). O seed sincroniza a tabela `Permission` com essa lista, e o TypeScript impede
  usar uma permissão que não existe.
- **Roles são dados:** `customer`, `support_agent` e `admin` vêm do seed (marcadas `isSystem`, não podem ser apagadas).
  O vínculo role↔permissão fica no banco.
- **Verificação em duas camadas:**
  1. **Permissão** (middleware `requirePermission`): "este usuário pode fazer este tipo de ação?".
  2. **Propriedade** (no service): "este recurso é dele?" (ex.: `vps.userId === req.user.id`). As permissões `:own`
     sempre vêm acompanhadas dessa checagem.
- **Frontend:** o `/api/auth/me` devolve a role e a lista de permissões. O hook `useCan('vps:create')` esconde botões e
  rotas. É só experiência de uso: quem decide é o servidor.
- **Atribuição de role:** o admin tem a tela **Administração → Usuários** (lista, busca, troca de role), protegida por
  `admin:users:assign-role`. Um admin não pode rebaixar a si mesmo, e trocar a role **revoga as sessões** do usuário
  afetado, para as novas permissões valerem na hora. Tudo vai para o `AuditLog`.
- **Editor de roles** (criar roles e marcar permissões numa grade): extra da Fase 10, protegido por `admin:roles:manage`.

### 9.8 Como ficou na implementação (revisão 10)

- **Origem aceita:** o `originCheck` aceita `APP_ORIGIN` **ou a própria origem do servidor** (`protocolo://Host`), para funcionar
  tanto em `localhost` quanto em `127.0.0.1`. Requisições sem `Origin` nem `Sec-Fetch-Site` (curl, testes) passam por ele, mas
  continuam precisando do token CSRF.
- **Por que o `originCheck` importa aqui:** cookies não isolam por porta. Uma página em `localhost:3001` lê o cookie `csrf` de
  `localhost:3000`, e o `SameSite=Strict` a trata como mesmo site. No teste com o navegador, o POST simples chegou ao servidor com
  os cookies e levou **403 ORIGIN_INVALID**; o POST com o token roubado no header nem saiu (preflight CORS não autorizado). Por isso
  o servidor **não habilita CORS**.
- **Cookies:** o `sid` expira no teto absoluto da sessão (o servidor controla a inatividade); o `psid` é cookie de sessão do
  navegador; o login apaga o `psid` e emite um `csrf` amarrado à sessão nova; o logout emite `psid` + `csrf` novos.
- **Sessões:** `DELETE /api/account/sessions/:id` não encerra a sessão atual (`400 USE_LOGOUT`: para isso existe o logout).
- **Chaves SSH:** além do formato, o servidor valida a **estrutura do blob** (ed25519 com 32 bytes, curva e ponto do ECDSA, RSA
  ≥ 2048 bits, sem bytes sobrando) e calcula o fingerprint no formato do `ssh-keygen` (conferido com uma chave real). Limite de 10
  por usuário; a de outro usuário responde 404.
- **Validação:** os schemas zod ficam em `src/shared/schemas`; as mensagens são chaves de tradução (`errors:validation.*`) e o
  `400 VALIDATION_ERROR` devolve `details: [{ path, message }]`, que o formulário aplica aos campos.
- **Textos:** um arquivo por área (`common`, `auth`, `account`, `admin`, `errors`) em cada idioma; um teste confere chaves e
  interpolações iguais nos três.

---

## 10. Integração com o Proxmox

### 10.1 Cliente HTTP próprio (em vez de biblioteca)

Avaliação: o pacote `proxmox-api` do npm teve a última atualização em **set/2024** (antes do PVE 9).
A plataforma usa cerca de 15 endpoints. Um cliente próprio e fino, com as respostas validadas por zod, é mais
confiável, mais fácil de testar e mostra mais no portfólio.

```ts
@singleton()
export class ProxmoxClient {
  // fetch + undici.Agent({ connect: { ca: pveRootCa, servername: env.PVE_TLS_SERVERNAME } })  ·  timeout via AbortSignal.timeout
  // (o certificado não tem o IP no SAN; valida pelo nome do nó, §3.5)
  // Authorization: PVEAPIToken=<id>=<secret>   (sem CSRF, sem expiração de 2h)
  get<T>(path: string, schema: ZodType<T>, query?: Params): Promise<T>
  post<T>(path: string, schema: ZodType<T>, body?: Params): Promise<T>  // form-urlencoded
  put / delete …
  // Erros → ProxmoxApiError { status, message, errors (por parâmetro) }; log com o path e sem o token
}
```

### 10.2 Endpoints usados (conferidos no `apidoc.js` oficial)

| Operação | Endpoint | Obrigatórios | Permissão (schema) | Retorno |
|---|---|---|---|---|
| Próximo VMID livre / checar | `GET /cluster/nextid[?vmid=N]` | — | qualquer usuário | int |
| Clonar do template | `POST /nodes/{node}/qemu/9000/clone` | `newid` | `VM.Clone` no template + `VM.Allocate` no pool + `Datastore.AllocateSpace` + `SDN.Use` | UPID |
| Configurar (CPU, RAM, cloud-init, rede) | `POST /nodes/{node}/qemu/{vmid}/config` (assíncrono) | — | `VM.Config.*` | UPID |
| Aumentar disco | `PUT /nodes/{node}/qemu/{vmid}/resize` | `disk, size` | `VM.Config.Disk` | UPID. *"Shrinking disk size is not supported"* |
| Status | `GET /nodes/{node}/qemu/{vmid}/status/current` | — | `VM.Audit` | `status, cpu, mem, maxmem, disk, netin, netout, uptime…` |
| Ligar / desligar (ACPI) / parar (forçado) / reiniciar / reset | `POST …/status/start` · `…/shutdown` · `…/stop` · `…/reboot` · `…/reset` | — | `VM.PowerMgmt` | UPID |
| Mudanças pendentes | `GET /nodes/{node}/qemu/{vmid}/pending` | — | `VM.Audit` | config atual + pendente |
| Excluir | `DELETE /nodes/{node}/qemu/{vmid}?purge=1&destroy-unreferenced-disks=1` | — | `VM.Allocate` | UPID |
| IPs reais (via agente) | `GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces` | — | `VM.GuestAgent.Audit` | interfaces |
| Métricas | `GET /nodes/{node}/qemu/{vmid}/rrddata?timeframe=hour\|day\|week\|month\|year&cf=AVERAGE\|MAX` | `timeframe` | `VM.Audit` | séries |
| Status de task | `GET /nodes/{node}/tasks/{upid}/status` | — | dono da task ou `Sys.Audit` | `status: running\|stopped`, `exitstatus` |
| Log de task | `GET /nodes/{node}/tasks/{upid}/log?start=N` | — | idem | linhas `{n, t}` |
| Membros do pool (reconciliação) | `GET /pools?poolid=vps-platform` (o `GET /pools/{poolid}` está deprecated no PVE 9) | — | `Pool.Audit` em `/pool/{pool}` | membros |
| Capacidade do nó | `GET /nodes/{node}/status` · `GET /nodes/{node}/storage/{storage}/status` | — | `Sys.Audit` / `Datastore.Audit` | mem/disk |
| Console serial (Fase 10) | `POST …/qemu/{vmid}/termproxy?serial=serial0` → `GET …/vncwebsocket?port&vncticket` | — | `VM.Console` (aceita API token) | port + ticket |

**Sequência de criação** (validada manualmente com `qm` na Fase 0; os parâmetros são os mesmos da API):

```
POST /nodes/primeiro/qemu/9000/clone
  newid=2000  name=<hostname>  pool=vps-platform  full=0          # linked clone
  description=vps:<uuid-da-vps>                                  # vínculo reverso para a reconciliação
→ esperar UPID

POST /nodes/primeiro/qemu/2000/config
  cores=1  memory=256
  ciuser=<usuário escolhido, padrão "alpine">
  cipassword=<senha do cliente>          # e/ou:
  sshkeys=<chave(s) pública(s)>          # ver observação sobre codificação abaixo
  ipconfig0=ip=192.168.56.200/24,gw=192.168.56.10
  net0=virtio=02:00:C0:A8:38:C8,bridge=vmbr1,rate=1.25   # MAC derivado do IP (§3.3); rate em MB/s (10 Mbps = 1,25 MB/s)
  tags=vpsplatform  onboot=1
→ esperar UPID

PUT  /nodes/primeiro/qemu/2000/resize   disk=scsi0  size=2G     → esperar UPID
POST /nodes/primeiro/qemu/2000/status/start                     → esperar UPID
```

**Observações do teste real:**
- O Proxmox guarda `sshkeys` **URL-encoded** (visto na saída do `qm set`: `ssh-ed25519%20AAAA…`). Pela
  API, a chave precisa ser enviada já codificada (`encodeURIComponent`, e depois o form-urlencoded normal).
  ✅ **Validado na Fase 0** pelo `test-template.mjs`: o login com a chave funcionou nas quatro imagens.
- A chave pública lida do Windows veio com **`\r\n`** (`%0D%0A`). O login funcionou mesmo assim, mas o
  backend deve normalizar as chaves (remover `\r`, espaços extras e linhas vazias) e validar o formato
  antes de enviar.
- O hostname da VM vem do **nome da VM** (`name`), então esse campo precisa ser um hostname válido
  (letras minúsculas, dígitos e hífen, até 63 caracteres).

### 10.3 Tasks assíncronas (UPID)

Toda operação que altera algo retorna um **UPID**. O `TaskWaiter` consulta
`/tasks/{upid}/status` com backoff (1s → 2s → 3s, com teto), até `status=stopped`. `exitstatus === "OK"`
significa sucesso. Qualquer outro valor é falha, e as últimas linhas de `/tasks/{upid}/log` vão para `VpsEvent.message`.
O cliente nunca espera isso numa requisição HTTP: tudo roda no worker (§11).

### 10.4 Particularidades das VMs (e como tratá-las)

| Particularidade | Tratamento |
|---|---|
| Diminuir disco não é suportado | Downgrade de plano só se `diskGb` for igual ou menor. Senão, erro de validação com explicação |
| Mudar CPU/RAM com a VM ligada fica **pendente** até reiniciar (sem hotplug) | Após o `config`, o backend consulta `/pending`. Se houver pendências, a UI mostra "aplicado no próximo reinício" e oferece o botão "Reiniciar agora" |
| Aumentar o disco com a VM ligada | O `resize` é aplicado na hora, e o cloud-init (`growpart`) expande a partição no próximo boot. A UI avisa |
| Primeiro boot leva ~1 min (cloud-init) | O status só vira `RUNNING` quando a VM responde (agente `qemu-guest-agent` ou, sem agente, após o `start` + tempo mínimo). A UI mostra "Inicializando…" |
| Redefinir senha / chave SSH | Pelo guest agent, **sem reboot** (§10.6). Testado na revisão 4 (§2.6) |
| Reinstalar | Excluir e clonar de novo, mantendo o mesmo IP (Fase 10) |
| Template compartilhado por clones vinculados | O template 9000 **não pode ser apagado** enquanto houver clones. Atualizar a imagem = criar um template novo (ex.: 9001) e passar a clonar dele |

### 10.5 Console gráfico (noVNC)

**O que o usuário vê:** na página da VPS, o botão **"Console"** abre a tela da máquina no navegador. Nas imagens
de servidor, é o console de texto (log de boot + `login:`, confirmado no teste §2.6). Na **Alpine Desktop**, é a tela
de login gráfica do LightDM e depois a área de trabalho XFCE: o mecanismo é o mesmo (VNC da placa de vídeo virtual).

**Por que o navegador não fala direto com o Proxmox:** o Proxmox fica numa rede interna, tem certificado
autoassinado, e a autenticação usa o token da plataforma, que nunca pode ir para o navegador. Por isso o
backend faz um **proxy de WebSocket**:

```
Navegador (noVNC)                       Servidor Favo (Node)                          Proxmox
─────────────────                       ─────────────────────                         ───────
1. POST /api/vps/:id/console   ──────►  valida sessão, CSRF, permissão
                                        vps:console:own, dono, status RUNNING
                                        POST /nodes/primeiro/qemu/{vmid}/vncproxy ──►  { port, ticket, password, … }
                               ◄──────  { consoleId (uso único, 30 s), password }
2. new RFB(el, "wss://…/ws/console/<consoleId>", { credentials: { password } })
   WebSocket (mesma origem) ──────────► upgrade: confere Origin + cookie de sessão
                                        + consome o consoleId (1 vez, mesmo usuário)
                                        abre wss://192.168.56.10:8006/api2/json/nodes/
                                        primeiro/qemu/{vmid}/vncwebsocket?port&vncticket
                                        (Authorization: PVEAPIToken…, CA do Proxmox) ──► VNC da VM
   ◄═══════════ frames binários repassados nos dois sentidos ═══════════►
```

- **Endpoints conferidos no schema:** o `vncproxy` retorna `cert, password, port, ticket, upid, user`
  (o campo `password` é *"Password used for authentication within the VNC protocol"*). O `vncwebsocket` exige
  `port` + `vncticket`, com a permissão `VM.Console`, e aceita API token.
- **Biblioteca do navegador:** `@novnc/novnc` 1.7.0 (maior estável). Os tipos (`@types/novnc__novnc`) estão na 1.6.0,
  uma versão atrás (anotado em §19).
- **Servidor WebSocket:** `ws` 8.21.3 com `noServer: true`, tratando o evento `upgrade` do mesmo `http.Server`, só para
  `/ws/console/*`. Três serviços dividem esse servidor: o HMR do Vite (em dev), o Socket.IO (`/socket.io/`) e o console.
  **Cuidado verificado na doc do engine.io:** por padrão, o Socket.IO **destrói em 1 s** upgrades que não são dele
  (`destroyUpgrade: true`, `destroyUpgradeTimeout: 1000`). É preciso configurar `destroyUpgrade: false`.
- **Segurança:** o `consoleId` é aleatório, de **uso único**, vale 30 s e fica preso ao usuário que o pediu. O upgrade confere
  `Origin` e a sessão (proteção contra *Cross-Site WebSocket Hijacking*). Há um limite de 2 consoles simultâneos por usuário,
  encerramento após 15 min sem tráfego, e registro no `AuditLog` ao abrir e fechar. **Técnicos e admins não têm console**
  (a regra do suporte continua valendo).
- **Barra de ferramentas:** tela cheia, ajustar à janela (`scaleViewport`), Ctrl+Alt+Del (`sendCtrlAltDel`), reconectar,
  indicador de conexão. "Colar texto" (digitar o conteúdo da área de transferência) é um extra.
- **Conferido na Fase 4 (rev. 11):** com o API token, o `ticket` do `vncproxy` vem como `<senha VNC de 8 caracteres>:PVEVNC:…`
  (o prefixo é o próprio `password` da resposta) e tem caracteres especiais: vai com `encodeURIComponent` na URL do `vncwebsocket`.
- **A verificar na implementação:** como a interface web do próprio Proxmox passa as credenciais ao noVNC
  (código do `pve-manager`), para confirmar o uso do `password` retornado pelo `vncproxy`.

### 10.6 Ações dentro da VM pelo guest agent

O `qemu-guest-agent` (instalado nos templates) permite ações que o cloud-init do Proxmox não cobre, **sem
reiniciar a VM**:

| Ação | Como | Permissão |
|---|---|---|
| Esperar a VM ficar pronta | `POST …/agent/ping` até responder (com timeout) | `VM.GuestAgent.Audit` |
| **Definir a senha root** (criação) e **redefinir senhas** (usuário ou root, depois) | `POST …/agent/set-user-password` `username`, `password` (**testado**, §2.6) | `VM.GuestAgent.Unrestricted` |
| **Login SSH por senha** (liga/desliga) | `POST …/agent/file-write` de `/etc/ssh/sshd_config.d/01-favo.conf` (`PasswordAuthentication yes\|no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`) + `agent/exec` com `sshd -t` e o reload da imagem. **Rev. 11:** `01-` e não `60-`: no sshd o primeiro valor lido vence, e o Alpine traz `50-cloud-init.conf` e o Ubuntu `60-cloudimg-settings.conf` (ambos com `PasswordAuthentication no`) | `VM.GuestAgent.FileWrite` / `Unrestricted` |
| IPs reais da VM | `GET …/agent/network-get-interfaces` | `VM.GuestAgent.Audit` |

- **Comandos por imagem:** cada imagem tem um `ImageProfile` no backend (padrão Strategy), com os comandos próprios
  dela. Exemplos: recarregar o sshd é `rc-service sshd reload` no Alpine e `systemctl reload ssh` no Debian e no Ubuntu.
  Conferir no build do template se o `sshd_config` de cada imagem faz o `Include` de `sshd_config.d/*.conf`; se não fizer,
  o template já sai com essa linha.
- **O `agent/exec` nunca fica exposto ao cliente.** Só o backend chama, com comandos fixos do `ImageProfile`.
- **Senhas nunca ficam em texto puro no banco.** Entre o pedido e a execução do job, a senha fica no payload do job
  **cifrada com AES-256-GCM** (chave `JOB_SECRET_KEY` do `.env`), e o campo é apagado assim que é usado. Ela trafega até
  o Proxmox só por TLS.

---

## 11. Ciclo de vida das VPS e jobs assíncronos

### 11.1 Máquina de estados

```
PENDING_PAYMENT ──pagamento aprovado──► PROVISIONING ──task OK──► RUNNING
      │                                      │ falha (após retries)
      └─ cancelar/expirar ─► DELETED         └──────────► ERROR ──(admin/retry)──► PROVISIONING

RUNNING ──stop/shutdown──► STOPPING ──► STOPPED ──start──► STARTING ──► RUNNING
RUNNING ──reboot──► REBOOTING ──► RUNNING
RUNNING|STOPPED ──resize──► UPDATING ──► (estado anterior)
RUNNING|STOPPED|ERROR ──delete──► DELETING ──► DELETED  (IP liberado; soft delete com deletedAt)
```

**Uma operação por vez por VPS:** a transição é feita com `updateMany({ where: { id, status: { in: permitidos } }, data: { status: transitório } })`.
Se `count === 0`, a resposta é `409 VPS_BUSY`. Isso funciona como lock otimista, sem transação longa.

### 11.2 Fila de jobs no MySQL (sem Redis)

Por que no MySQL: evita outra dependência no PC, é persistente (sobrevive a restart) e é suficiente para a escala do projeto.

- **Enfileirar:** `INSERT Job` na **mesma transação** da mudança de status (padrão outbox: nunca fica "VPS PROVISIONING sem job").
- **Consumir:** um worker no próprio processo (`setInterval` de 1s, com concorrência 2) reivindica jobs de forma atômica:
  `SELECT … FOR UPDATE SKIP LOCKED` (suportado no MySQL 8) via `$queryRaw` numa transação curta → `status=RUNNING, lockedBy, lockedAt`.
- **Retry:** backoff exponencial (`runAt = now + 2^attempts s`) até `maxAttempts`. Depois disso, `FAILED` e a VPS vai para `ERROR`.
- **Idempotência:** cada handler grava o progresso no `payload` (`vmid` escolhido, `upid` em andamento) e,
  numa nova tentativa, **verifica o estado real no Proxmox antes de agir** (ex.: se a VM já existe, não clona de novo).
- **Locks órfãos:** jobs `RUNNING` com `lockedAt` mais antigo que 10 min voltam para `QUEUED` (o servidor pode ter caído no meio).

### 11.3 Handler `provision_vps`

1. Reserva o IP (`FREE → RESERVED`, atômico) e escolhe o VMID (`VPS_VMID_START` + checagem em `/cluster/nextid?vmid=`).
2. Grava `pveVmid`/`ipAddressId` na VPS e no payload do job.
3. `clone` do template da imagem escolhida (9000/9001/9002) → `config` (CPU, RAM, `ciuser`, `cipassword` se houver,
   `sshkeys`, `ipconfig0`, `nameserver`, **`ciupgrade=0`**, `net0` com `rate`) → `resize` → `start` (§10.2),
   cada passo com `TaskWaiter`. O progresso fica no payload, e numa nova tentativa **o handler verifica o estado real no
   Proxmox antes de repetir cada passo** (ex.: se a VM já existe, não clona de novo).
4. Espera o `agent/ping` responder (a VM bootou e o agente subiu; ~1 min medido).
5. **Pós-boot pelo guest agent (§10.6):** define a senha root (se o cliente escolheu), aplica a política de SSH
   (login por senha sim/não, root sem SSH) e apaga do payload a senha cifrada.
6. Confirma `running`. O IP vira `ASSIGNED`, a VPS vira `RUNNING` e um `VpsEvent` é registrado.
7. Socket.IO emite `vps:status` para a sala `user:<id>`, e a UI atualiza sem refresh.
8. Em falha definitiva: tenta `DELETE` da VM parcial, libera o IP, marca `ERROR` com `lastError`.

### 11.4 Outras operações

| Ação | Implementação |
|---|---|
| start/shutdown/stop/reboot/reset | Job `vps_action` → endpoint de status → TaskWaiter → status final. `shutdown` (ACPI, 4 s no teste) tem timeout e cai para `stop` |
| resize (troca de plano) | Valida (sem diminuir disco; respeita o mínimo da imagem) → `config` (cores/memory, `net0` com o novo `rate`) → `resize` se o disco aumentou → se houver pendências, avisa que precisa reiniciar → fatura proporcional (simulada) |
| renomear | `config name=<novo hostname>`. Aplicado no próximo boot (o hostname vem do cloud-init) |
| redefinir senha (usuário ou root) | `agent/set-user-password`, **sem reboot** (§10.6). Exige a VM ligada e com o agente respondendo |
| ligar/desligar login SSH por senha | `agent/file-write` + recarregar o sshd (§10.6) |
| adicionar chave SSH | `agent/file-write` no `authorized_keys` do usuário (e `config sshkeys` para manter o cloud-init coerente) |
| console | Sessão noVNC de uso único (§10.5). Não é um job; é síncrono |
| reinstalar | destroy + clone com o mesmo IP e um novo VMID (Fase 10) |
| excluir | Job `delete_vps` → `stop` se estiver rodando → `DELETE ?purge=1&destroy-unreferenced-disks=1` → IP `FREE` → faturas pendentes `CANCELED` → `DELETED` |
| métricas | Leitura síncrona de `rrddata` com cache em memória de 30 s por VPS |

### 11.5 Reconciliação e capacidade

- **Job `reconcile` a cada 60s:** lista os membros do pool `vps-platform` e compara com o banco.
  Corrige `RUNNING/STOPPED` (se alguém mexeu pela interface web do Proxmox), marca `ERROR` se a VM sumiu e **registra**
  (sem apagar) VMs órfãs que existem no pool mas não no banco.
- **Controle de capacidade** antes de aceitar um pedido: soma dos recursos alocados + plano pedido,
  comparada com os limites configurados (`CAPACITY_MAX_MEMORY_MB`, `CAPACITY_MAX_DISK_GB`) e com a memória e o storage
  livres reais do nó. Se não couber: `409 NO_CAPACITY` ("Sem estoque no momento"). Também há um limite de **VPS por cliente** (`MAX_VPS_PER_USER=2`).

---

## 12. Pagamento simulado

- Interface `PaymentGateway { charge(input): Promise<ChargeResult> }`, registrada no container com `FakePaymentGateway`.
  Trocar por um gateway real (Stripe/Mercado Pago em modo teste) seria uma nova implementação, sem mexer nos services.
- **Cartões de teste** (mostrados na própria tela de checkout):

| Número | Resultado |
|---|---|
| `4242 4242 4242 4242` | Aprovado |
| `4000 0000 0000 0002` | Recusado (`card_declined`) |
| `4000 0000 0000 9995` | Saldo insuficiente (`insufficient_funds`) |
| Qualquer outro com Luhn válido | Aprovado |

- Latência artificial de 1–2s, validação de Luhn e validade, e **só `brand` + `last4` são persistidos**
  (PAN e CVV nunca são gravados nem logados).
- **Fluxo:** `POST /api/vps` → VPS `PENDING_PAYMENT` + `Invoice PENDING` (vence em 24h) → `/checkout/:invoiceId`
  → `POST /api/invoices/:id/pay` (idempotente: fatura já paga → `409`) → aprovado → `PAID` + job `provision_vps`
  na mesma transação.
- Job `expire_pending`: faturas de criação não pagas em 24h → `CANCELED` e VPS `DELETED` (sem nada no Proxmox).
- **Renovação mensal, suspensão por inadimplência e "relógio acelerado" para demonstração:** Fase 10.
- A UI deixa claro, em vários pontos, que é **ambiente de demonstração, sem cobrança real**.
- **Implementação (rev. 12):** as senhas escolhidas na criação ficam **cifradas** (AES-256-GCM) em `vps.provisionSecrets` entre o
  pedido e o pagamento; no pagamento aprovado vão para o payload do job `provision_vps` e a coluna é apagada. A fatura é travada com
  `SELECT … FOR UPDATE` durante a cobrança (pagamentos simultâneos → exatamente um aprova, os outros 409). Recusa → `402
  PAYMENT_DECLINED` e a fatura continua em aberto. Capacidade (§11.5): limite por cliente, tetos `CAPACITY_MAX_*` e a memória/disco
  livres do nó, descontando as VPS pagas que ainda não existem no Proxmox; Proxmox fora → `503 PROXMOX_UNAVAILABLE`.

---

## 13. Suporte: chat e fila de atendimento

### 13.1 Regras

- O cliente tem **no máximo 1 conversa não encerrada** (`WAITING` ou `ACTIVE`), verificado no service.
- A conversa nasce `WAITING` e entra na fila, ordenada por `createdAt`. O cliente vê a **posição na fila**.
- O técnico vê a fila em tempo real e clica em **"Iniciar atendimento"**. A atribuição é atômica:
  `updateMany({ where: { id, status: 'WAITING' }, data: { status: 'ACTIVE', agentId, claimedAt } })`.
  Se dois técnicos clicarem ao mesmo tempo, **só um vence** e o outro recebe `409 ALREADY_CLAIMED`.
- Limite de atendimentos simultâneos por técnico (`SUPPORT_MAX_ACTIVE_PER_AGENT=3`).
- Qualquer um dos lados pode **encerrar**. O técnico também pode **devolver para a fila** (opcional).
- O técnico só vê o nome e o e-mail do cliente e as mensagens. **Nenhum acesso a VPS, faturas ou dados de conta.**
- Mensagens do sistema (`senderId = null`): "Você está na posição 3", "Fulano iniciou o atendimento", "Conversa encerrada".

### 13.2 Tempo real (Socket.IO)

- **Handshake:** `allowRequest` confere o `Origin`, depois `io.use()` lê o cookie `sid` e valida a sessão (mesmo service do HTTP),
  preenchendo `socket.data.user`. Sem sessão, a conexão é recusada.
- **Salas:** `user:<id>` (tudo do usuário, inclusive `vps:status`), `session:<id>` (para derrubar no logout),
  `agents` (técnicos online), `conversation:<id>` (participantes).
- **Envio de mensagem:** via evento socket **com ack** (baixa latência). O servidor valida a participação e o tamanho (1–2000 chars),
  persiste e emite `support:message:new` para a sala. O ack devolve o `id` persistido, e a UI troca a mensagem otimista pela real.
- **Reconexão:** ao conectar, o servidor coloca o socket nas salas conforme o estado do banco. O cliente busca por REST
  as mensagens com `id >` último recebido (não perde nada que chegou durante a queda).
- **Por que o CSRF não se aplica ao socket:** a proteção equivalente é a checagem de `Origin` + cookie `SameSite=Strict`.
  As ações "de estado" do chat (criar, assumir e encerrar conversa) ficam em **REST com CSRF**, e o socket carrega só mensagens.

---

## 14. Frontend

### 14.1 Rotas

| Rota | Acesso | Conteúdo |
|---|---|---|
| `/login`, `/register` | só deslogado | Formulários (react-hook-form + zod compartilhado) |
| `/` | logado | Dashboard: resumo de VPS, faturas pendentes, atalho para o suporte (técnicos vão para `/agent`) |
| `/vps` | `vps:read:own` | Lista com status ao vivo |
| `/vps/new` | `vps:create` | Tela de criação no estilo das plataformas reais, com campos condicionais por imagem (§14.5) |
| `/vps/:id` | dono | Página da VPS com as abas Visão geral, Console (noVNC), Métricas, Acesso, Configurações e Histórico (§14.5) |
| `/billing`, `/checkout/:invoiceId` | `billing:*` | Faturas e checkout simulado |
| `/support` | `support:conversation:create` | Abrir conversa, fila, chat |
| `/agent`, `/agent/conversations/:id` | `support:queue:read` | Fila ao vivo, meus atendimentos, chat |
| `/account` | logado | Perfil, senha, chaves SSH, sessões ativas |
| `/admin/users` · `/admin` | `admin:*` | Usuários e troca de role (Fase 3); visão geral e editor de roles (Fase 10) |
| `*` | — | 404 |

### 14.2 Autenticação no cliente

- `AuthProvider`: `useQuery(['me'], GET /api/auth/me, { retry: false, staleTime: ∞ })`.
- `<RequireAuth>`: enquanto `isPending`, mostra o **loader de tela cheia**. Se `401`, faz `<Navigate to="/login?next=…">`.
- `<RequirePermission perm="…">`: esconde ou bloqueia a UI. **É só UX**, porque quem decide é o servidor.
- `lib/api.ts`: `fetch` com `credentials: 'same-origin'`, lê o cookie `csrf` **a cada requisição** e o envia em `X-CSRF-Token`.
  Em `403 CSRF_INVALID` → `GET /api/auth/csrf` → repete uma vez. Em `401` fora do `/me` → limpa o cache e redireciona para o login.
- Socket: conecta só depois de o `me` resolver. Os eventos `vps:status` invalidam as queries de VPS, e os eventos de suporte atualizam o chat.

### 14.3 Componentes shadcn previstos

`button, input, label, form, card, badge, table, dialog, alert-dialog, dropdown-menu, sheet, sidebar,
tabs, select, radio-group, separator, skeleton, sonner (toasts), tooltip, avatar, scroll-area, chart, progress`.

### 14.4 Idiomas e moedas (só no frontend)

Conforme o seu esclarecimento (§0.3), é um recurso **apenas da interface**. O backend, o banco, as
faturas e as VMs não mudam: **tudo continua em pt-BR/BRL do lado do servidor**, e as VMs não são afetadas.

**Vale a pena?** Sim, com uma condição: a estrutura precisa entrar **na Fase 1**, antes de existirem
telas. Se todo texto nascer como chave de tradução (`t('vps.actions.start')`), adicionar idiomas
depois é só criar arquivos. Traduzir telas prontas é bem mais caro. No portfólio, isso também mostra
cuidado com internacionalização.

**Idiomas:**
- Bibliotecas (maior estável conferida em 2026-09-23, compatíveis com TypeScript 7 e React 19):
  `i18next` 26.4.2, `react-i18next` 17.0.15 e `i18next-browser-languagedetector` 8.2.1.
- Idiomas: **pt-BR (padrão, completo)**, en-US e es-ES (a lista final está em §20).
- Arquivos em `src/client/locales/<idioma>/<área>.json` (`common`, `auth`, `vps`, `billing`,
  `support`, `errors`). As chaves são tipadas, então um texto sem tradução gera erro de compilação.
- **Erros da API:** o servidor já responde com um `code` (ex.: `VPS_BUSY`, `CSRF_INVALID`), e o
  frontend traduz com `errors.<code>`. O servidor nunca precisa saber o idioma.
- **Validação de formulários:** os schemas zod compartilhados geram códigos de erro, e o frontend
  mostra a mensagem no idioma atual (as mensagens embutidas do zod por idioma serão conferidas na doc
  do zod na Fase 1).
- Datas e números com `Intl.DateTimeFormat`/`Intl.NumberFormat` no idioma escolhido. `<html lang>` é atualizado.
- O que **não** é traduzido: dados vindos do servidor que são conteúdo (mensagens do chat, hostnames)
  e nomes técnicos (ex.: "Alpine Linux 3.24").

**Moedas:**
- O servidor continua mandando os valores em **centavos de BRL**, e a cobrança simulada é sempre em BRL.
- O frontend converte **só para exibição**, com taxas fixas de demonstração em
  `src/client/lib/currency/rates.ts` (ex.: BRL, USD, EUR). Valores convertidos aparecem com "≈" e uma
  dica "cobrado em BRL".
- No checkout, o valor real em BRL aparece em destaque e o convertido aparece como referência, para
  não haver dúvida sobre o que é cobrado.

**Preferência do usuário:** seletor de idioma e moeda no cabeçalho, inclusive nas telas de login e
cadastro. A escolha fica no `localStorage` do navegador. Na primeira visita, o idioma vem do
navegador, e a moeda padrão é BRL. Como é só frontend, a preferência vale por navegador e não
acompanha a conta.

### 14.5 Criar VPS e página da VPS (como nas plataformas reais)

**Referência:** o fluxo de criação de DigitalOcean, Vultr e Hetzner. É **uma página só**, com seções empilhadas e um
**resumo fixo** ao lado (imagem, plano, preço na moeda escolhida e botão "Criar e pagar"). Não há um passo a passo
com "próximo/voltar".

**Os campos condicionais fazem sentido?** Sim, na medida certa. Nas quatro imagens atuais (todas Linux), a maioria dos
campos é igual. O que muda conforme a imagem é **dado**, vindo do `OsTemplate`: usuário padrão, `sudo` × `doas`, planos
compatíveis, se tem interface gráfica e se aceita senha root. Com esse desenho, uma imagem futura muito diferente
(ex.: Windows, com "senha de Administrator" e RDP no lugar de SSH) entraria **sem reescrever a tela**, só com as
capacidades dela declaradas.

| Seção | Campos | Condições e regras |
|---|---|---|
| 1. Localização | "Laboratório — nó `primeiro`" (única opção, exibida como card) | Mostra o conceito de região sem inventar infraestrutura |
| 2. Imagem | Cards: Alpine 3.24, Debian 13, Ubuntu 24.04 LTS, Alpine Desktop (logo, versão, selos "leve"/"popular"/"interface gráfica") | Ao trocar de imagem: preenche o usuário padrão, reavalia os planos e mostra as notas da imagem |
| 3. Plano | Cards Nano / Micro / Small (vCPU, RAM, disco, banda, preço) | Planos abaixo do mínimo da imagem ficam **desabilitados**, com o motivo ("Debian requer 512 MB e 3 GB") |
| 4. Autenticação | **Método:** chave SSH (recomendado) · senha · ambos | Pelo menos um método é obrigatório |
| | **Nome de usuário** | Padrão da imagem (`alpine`/`debian`/`ubuntu`), editável. Regex `^[a-z_][a-z0-9_-]{0,31}$`, sem `root` nem nomes reservados |
| | **Chaves SSH** | Escolher entre as chaves salvas na conta e/ou colar uma nova (validada: tipo, base64, *fingerprint*; `\r\n` normalizado) com opção "salvar na conta" |
| | **Senha do usuário** | Aparece se o método inclui senha. **Na Alpine Desktop é obrigatória** (`requiresPassword`), com o aviso "necessária para o login gráfico". Medidor de força, confirmação, mínimo de 10 caracteres |
| | **Permitir login SSH com senha** | Aparece se há senha. Padrão: ligado se o método for só senha, desligado se houver chave |
| | **Definir senha root** | Interruptor, visível se a imagem aceitar (`supportsRootPassword`). Texto explicando: "para o console e `su`; o login SSH como root fica sempre desativado" |
| | Nota sobre privilégio | "Seu usuário terá acesso administrativo via `doas`" (Alpine) ou "`sudo`" (Debian/Ubuntu) |
| 5. Detalhes | **Hostname** | Sugestão automática (`favo-alpine-7k2q`), editável, validado como hostname |
| Resumo | Imagem, plano, preço mensal (BRL + conversão "≈" se outra moeda estiver selecionada), total | "Criar e pagar" → cria o pedido → checkout simulado (§12) |

**Depois de pagar:** a página da VPS abre com uma **linha do tempo de criação** ao vivo (evento `vps:progress` via
Socket.IO): *Pagamento confirmado → Clonando imagem → Aplicando configuração → Iniciando → Configurando acesso → Pronta*.

**Página da VPS** (`/vps/:id`), no estilo de um painel de provedor:
- **Cabeçalho:** hostname, status (badge com ponto e texto), IP com botão de copiar, imagem, plano, ações rápidas
  (Console, Ligar/Desligar, Reiniciar, menu com "Forçar parada" e "Reset").
- **Aba Visão geral:** uso de CPU, RAM e disco ao vivo, uptime, data de criação, comando pronto
  `ssh <usuário>@<ip>` para copiar, e o resumo de acesso (métodos ativos, senha root definida ou não, SSH por senha
  ligado/desligado).
- **Aba Console:** noVNC (§10.5), com a barra de ferramentas.
- **Aba Métricas:** gráficos de CPU, RAM e rede (hora/dia/semana).
- **Aba Acesso:** redefinir a senha do usuário ou do root, ligar/desligar SSH por senha, adicionar chave SSH (§10.6).
- **Aba Configurações:** trocar de plano (sem reduzir o disco), renomear.
- **Aba Histórico:** eventos (`VpsEvent`).
- **Zona de perigo:** excluir, com confirmação digitando o hostname (como no GitHub/DigitalOcean).

### 14.6 Identidade visual: Favo (marca fictícia)

**Nome:** **Favo**, de "favo de mel". Cada VPS é uma **célula** da colmeia: pequena, isolada, igual às outras e pronta
para uso. O nome é curto, fácil de pronunciar em português, inglês e espanhol, e combina com o foco do produto em
servidores leves. Uma busca não encontrou provedor de VPS com esse nome (§21). O rodapé deixa claro: *"Favo é uma marca
fictícia. Projeto de demonstração, sem cobranças reais."*

**Assinatura (tagline):**
- pt-BR: *"Servidores leves, prontos em um minuto."*
- en-US: *"Lightweight servers, ready in a minute."*
- es-ES: *"Servidores ligeros, listos en un minuto."*

O "um minuto" é real: foi o tempo medido nos testes (§2.6).

**Logo:**
- **Símbolo:** um hexágono de cantos arredondados com um cursor de terminal `>_` vazado no centro (célula + servidor).
- **Logotipo:** "favo" em minúsculas, em Bricolage Grotesque ExtraBold, com espaçamento levemente fechado.
- **Favicon:** só o símbolo. Versões para fundo claro e escuro.
- Arquivos em SVG em `src/client/assets/brand/` (`logo.svg`, `logo-mark.svg`, `favicon.svg`), feitos à mão no código.

**Paleta** (tokens CSS mapeados para as variáveis do tema do shadcn, com modo claro e escuro):

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--background` | `#FAF8F3` | `#111214` | Fundo (branco quente / grafite) |
| `--foreground` | `#1C1A17` | `#EDEAE3` | Texto principal |
| `--card` | `#FFFFFF` | `#1A1B1F` | Cartões e painéis |
| `--muted` / `--muted-foreground` | `#F1EEE6` / `#6B665C` | `#202227` / `#A19C92` | Fundos e textos secundários |
| `--border` | `#E6E1D6` | `#2B2D33` | Bordas |
| `--primary` ("mel") | `#F2A516` | `#F5B83D` | Botões principais, destaques |
| `--primary-foreground` | `#1A1300` | `#1A1300` | Texto sobre o "mel" |
| `--link` ("mel escuro") | `#9A5B00` | `#F7C35F` | Links e textos de destaque |
| Status `running` | `#1F9D55` | `#3DC47A` | Ligada |
| Status `provisioning`/`pending` | `#C98300` | `#F5B83D` | Criando / aguardando |
| Status `stopped` | `#6B7280` | `#9CA3AF` | Desligada |
| Status `error` / `--destructive` | `#C8372D` | `#F06A5F` | Erro / ações destrutivas |
| Status `suspended` | `#6D4AC9` | `#A08BF0` | Suspensa |

Contraste conferido (WCAG AA): texto `#1A1300` sobre `#F2A516` ≈ 8,9:1; link `#9A5B00` sobre `#FAF8F3` ≈ 5,1:1;
texto secundário `#6B665C` sobre `#FAF8F3` ≈ 5,4:1; link escuro `#F7C35F` sobre `#111214` ≈ 11:1. **O amarelo "mel" nunca é
usado como cor de texto sobre fundo claro** (contraste insuficiente). Status sempre com **ponto + texto**, nunca só com cor.

**Tipografia** (auto-hospedada via `@fontsource-variable/*` 5.3.0, então a CSP continua `'self'` e não há requisição a terceiros):
- **Títulos:** Bricolage Grotesque, com personalidade, sem exagero.
- **Texto e interface:** Manrope, que tem ótima leitura em tamanhos pequenos.
- **Dados técnicos:** JetBrains Mono para IPs, hostnames, comandos, *fingerprints* e IDs.

**Elementos visuais:** o hexágono aparece com moderação: no logo, nos estados vazios ("nenhuma VPS ainda: sua primeira
célula está a um clique"), num padrão de colmeia sutil (4–6% de opacidade) na tela de login, e no indicador de
carregamento (uma célula pulsando). Ícones do `lucide-react`. Raio de borda de 10 px. Modo escuro completo desde a Fase 1.

**Tom de voz:** direto e técnico, mas acolhedor. Trata o usuário por "você", explica termos quando é a primeira vez
que aparecem ("chave SSH: um jeito mais seguro que senha de entrar no servidor") e dá mensagens de erro que dizem
o que fazer em seguida.

---

## 15. Referência da API HTTP e eventos em tempo real

Legenda de middlewares: **O** originCheck · **C** csrf · **A** authenticate · **P** requirePermission · **R** rateLimit

| Método | Rota | MW | Descrição |
|---|---|---|---|
| GET | `/api/health` | — | Status do app, do banco e do Proxmox |
| GET | `/api/auth/csrf` | — | Reemite o cookie CSRF |
| GET | `/api/auth/me` | A | Usuário atual (ou 401) |
| POST | `/api/auth/register` | O R C | Cadastro + login |
| POST | `/api/auth/login` | O R C | Login |
| POST | `/api/auth/logout` | O C A | Logout |
| GET | `/api/account/sessions` | A | Sessões ativas |
| DELETE | `/api/account/sessions/:id` | O C A | Revoga uma sessão |
| PUT | `/api/account/password` | O R C A | Troca a senha (revoga as outras sessões) |
| GET/POST/DELETE | `/api/account/ssh-keys[/:id]` | (O C) A | Chaves SSH |
| POST | `/api/vps/:id/console` | O C A P | Cria a sessão de console de uso único → `{ consoleId, password }` (§10.5) |
| WS | `/ws/console/:consoleId` | Origin + A | Proxy noVNC ↔ Proxmox (upgrade de WebSocket) |
| POST | `/api/vps/:id/access/password` | O C A P R | Redefine a senha do usuário ou do root (guest agent) → `202` |
| POST | `/api/vps/:id/access/ssh-password-auth` | O C A P | Liga/desliga o login SSH por senha → `202` |
| POST | `/api/vps/:id/access/ssh-keys` | O C A P | Adiciona uma chave SSH na VPS → `202` |
| GET | `/api/admin/users?query=` | A P | Lista usuários com a role (admin) |
| PATCH | `/api/admin/users/:id/role` | O C A P | Troca a role (revoga as sessões do usuário afetado) |
| GET | `/api/admin/roles` | A P | Roles e permissões (para a tela de administração) |
| GET | `/api/plans` · `/api/os-templates` | — | Catálogo. As imagens trazem as capacidades e os mínimos que controlam a tela de criação |
| GET | `/api/vps` | A P | Lista as minhas VPS |
| POST | `/api/vps` | O C A P R | Cria o pedido (capacidade + fatura) |
| GET | `/api/vps/:id` | A P | Detalhe (+ status ao vivo) |
| PATCH | `/api/vps/:id` | O C A P | Renomear |
| POST | `/api/vps/:id/actions/:action` | O C A P | `start\|shutdown\|stop\|reboot\|reset` → `202` |
| POST | `/api/vps/:id/resize` | O C A P | Troca de plano → `202` |
| DELETE | `/api/vps/:id` | O C A P | Exclusão → `202` |
| GET | `/api/vps/:id/metrics?timeframe=hour` | A P | rrddata |
| GET | `/api/vps/:id/events` | A P | Histórico |
| GET | `/api/invoices` · `/api/invoices/:id` | A P | Faturas |
| POST | `/api/invoices/:id/pay` | O R C A P | Pagamento simulado |
| POST | `/api/support/conversations` | O R C A P | Abre a conversa (entra na fila) |
| GET | `/api/support/conversations/current` | A P | Conversa aberta do cliente + posição |
| GET | `/api/support/conversations/:id/messages?after=&before=` | A | Histórico (só participantes) |
| POST | `/api/support/conversations/:id/close` | O C A | Encerrar |
| GET | `/api/support/queue` | A P | Fila (técnico) |
| POST | `/api/support/conversations/:id/claim` | O C A P | Assumir (atômico, 409 se já assumida) |
| POST | `/api/support/conversations/:id/release` | O C A P | Devolver à fila |
| GET | `/api/support/my-conversations` | A P | Atendimentos do técnico |

**Eventos Socket.IO**

| Direção | Evento | Payload |
|---|---|---|
| C → S | `support:message:send` (ack) | `{ conversationId, body }` → ack `{ ok, message }` |
| C → S | `support:typing` | `{ conversationId }` |
| S → C | `support:message:new` | `SupportMessageDTO` |
| S → C | `support:conversation:updated` | `{ id, status, agent?, queuePosition? }` |
| S → C (sala `agents`) | `support:queue:updated` | `{ waiting: QueueItemDTO[] }` |
| S → C | `support:typing` | `{ conversationId, userName }` |
| S → C | `vps:status` | `{ vpsId, status, lastError? }` |
| S → C | `vps:progress` | `{ vpsId, step, at }` (linha do tempo da criação, §14.5) |
| S → C | `session:revoked` | — (o cliente redireciona para o login) |

Formato de erro padrão: `{ "error": { "code": "VPS_BUSY", "message": "…", "details": … } }`.

---

## 16. Como o Claude vai interagir com cada parte (e a questão do MCP)

### 16.1 Canais disponíveis (testados nesta sessão)

| Alvo | Canal | Estado |
|---|---|---|
| Código, git, npm | Ferramentas nativas (arquivos, shell) | ✅ |
| **Frontend** | **Playwright MCP** (já instalado nesta sessão): navegar, preencher, snapshot de acessibilidade, screenshots, console, rede | ✅ disponível |
| Frontend com 2 usuários (chat) | O Playwright MCP compartilha cookies entre as abas, então para cliente + técnico ao mesmo tempo: `browser_run_code_unsafe` criando um segundo `browserContext`, ou testes `@playwright/test` com 2 contexts | ✅ |
| MySQL | `mysql.exe` pelo caminho completo + Prisma (`migrate`, `studio`, `db execute`) | ✅ bancos e usuário `vps_app` criados (Fase 0) |
| **Proxmox: API** | `curl` com ticket (testado: versão, nó, storage, rede, VMs, templates, roles) e, depois do bootstrap, com o **API token restrito** | ✅ |
| **Proxmox: shell** | SSH `root@192.168.56.10` (porta aberta) → `pvesh` (CLI oficial que espelha a API), `qm`, `pveum`, `ifreload` | ✅ chave instalada (Fase 0) |
| Schema da API | `apidoc.js` oficial (4,3 MB) convertido para JSON: consulto parâmetros, formatos e permissões de qualquer endpoint | ✅ usado neste plano |

### 16.2 Existe MCP para Proxmox?

Sim, vários da comunidade. Os dois mais relevantes que avaliei:

| Projeto | Stack | Pontos | Ressalvas |
|---|---|---|---|
| [gilby125/mcp-proxmox](https://github.com/gilby125/mcp-proxmox) | Node 20+, SDK MCP oficial | Somente leitura por padrão, ações destrutivas só com `PROXMOX_ALLOW_ELEVATED=true`, allowlist de nós e VMIDs, suporte a LXC | Projeto pequeno (~52★, 31 commits). TLS desligado por padrão. Pede um token com privilégios amplos para o modo elevado |
| [trac3r00/proxmox-mcp](https://github.com/trac3r00/proxmox-mcp) | TypeScript/Bun | Genérico (`proxmox_get`/`proxmox_request`) + **busca e descrição de endpoints** a partir do schema. Testado até o PVE 9.1.6. Redação de credenciais | Exige Bun. `proxmox_request` genérico = mesmo poder de um curl, sem trava de leitura |

### 16.3 Veredito

**Não vale instalar um MCP de terceiros nem desenvolver um agora.** Motivos:
1. Tudo o que eles oferecem eu já faço com **curl na API + SSH/`pvesh`**, que são canais oficiais e já testados.
   O `pvesh` cobre inclusive o que a API por token não cobre (rede, importação de imagens, criação do usuário e do token).
2. Um MCP de terceiros exigiria dar a ele um token com **privilégios amplos**, rodando código externo, o que é um risco desnecessário.
3. A descoberta de endpoints (o diferencial do trac3r00) eu já faço consultando o `apidoc.js` oficial.

**O que farei no lugar (e que também fica no portfólio):**
- **`npm run pve -- <comando>`** (`scripts/pve/cli.ts`): um CLI de desenvolvimento que **reutiliza o `ProxmoxClient` do backend**
  com o token restrito ao pool. Comandos: `status`, `list`, `show <vmid>`, `task <upid>`, `capacity`, `reconcile --dry-run`.
  Ele serve como ferramenta minha **e** como teste do código real de integração.
- **Opcional (Fase 10):** um MCP **próprio e somente leitura**, de ~150 linhas com `@modelcontextprotocol/sdk` 1.30, expondo
  essas mesmas funções do CLI (`pve_list_instances`, `pve_instance_status`, `pve_task_log`, `pve_capacity`,
  `platform_reconcile_report`). Só vale se você quiser o item "integração com agentes de IA" no portfólio. Tecnicamente não é necessário.

---

## 17. Fases de implementação

Cada fase termina com **critérios de aceite verificáveis** e com `typecheck` + `lint` + testes verdes.
**Ao fim de cada fase, o Claude faz um commit** na `main` (decisão da rev. 6, que substitui a do §0.2), depois de conferir
que nenhum segredo entra, e entrega um resumo das mudanças (arquivos, decisões e como testar).

### Fase 0: Preparação do laboratório — ✅ concluída em 2026-09-23 (resultados em §2.7)
- [x] Responder às decisões pendentes (§0.2).
- [x] VirtualBox: nested VT-x, 2 vCPU, 3 GB, promíscuo `allow-all` no Adaptador 2, DHCP até `.199` (§3.2).
- [x] Validar a aceleração: `NestedHWVirt = 1`, `vmx` no `/proc/cpuinfo`, `/dev/kvm` presente.
- [x] VM 100 excluída.
- [x] Chave SSH (`id_ed25519.pub`) instalada no `root@192.168.56.10`.
- [x] Rede: `vmbr1` na `nic1` + masquerading (§3.3), aplicada por SSH com rollback automático de segurança (cancelado depois da validação).
- [x] MySQL: bancos + usuário `vps_app` (§8.1). `DATABASE_URL` em `.env.development`/`.env.test`, e `.gitignore` criado.
- [x] Teste de viabilidade das VPS em VM (§2.5), que revelou o problema do DNS.
- [x] Teste das imagens Debian 13 e Ubuntu 24.04, do console VGA e da senha root pelo guest agent (§2.6). Imagens baixadas e conferidas.
- [x] **Aumentar o disco da VM do Proxmox em +10 GB** (§3.2): `local-lvm` de 6,8 para 16,8 GB.
- [x] `scripts/pve/bootstrap.sh`: pools `vps-platform` e `vps-templates`, role, usuário, token, ACLs, CA (§3.4–3.5). Secret do token no `.env.development`.
- [x] `scripts/pve/build-template.sh`: templates 9000 (Alpine), 9001 (Debian), 9002 (Ubuntu) e 9003 (Alpine Desktop, §3.6), com agente, correção de DNS (Alpine), VGA padrão e teste automático (§3.6).
- [x] Aceite dos quatro templates com o token (`scripts/pve/test-template.mjs`, Node puro com `node:https` no lugar do curl, porque o
  Windows não tem `jq` para ler o JSON). Resultado em §2.7.

**Aceite:** para **cada** template, uma VM clonada **com o token da plataforma** (não root), via API, com
`ipconfig0=ip=192.168.56.229/24,gw=192.168.56.10` e `ciupgrade=0`: responde a `ping` a partir do Windows, aceita SSH, resolve
nomes, responde ao `agent/ping`, aceita `agent/set-user-password` para root, mostra o `login:` no VGA e é excluída com sucesso.
Com o mesmo token, `DELETE /nodes/primeiro/qemu/9000` retorna **403** (os templates estão protegidos).

### Fase 1: Fundação do projeto — ✅ concluída em 2026-09-23
- [x] `npm init -y` + `npm config set save-exact=true --location=project` + campos via `npm pkg set` (`type`, `engines`, `private`).
- [x] `scripts/deps/stable-versions.mjs` e `check-installed.mjs` **antes de qualquer instalação** (§4.1).
- [x] Instalar cada grupo de pacotes com `npm install <pkg>@<maior estável>`, depois de conferir com `npm run deps:stable`.
- [x] TypeScript 7.0.2 (strict), Biome (`biome.json`), `.editorconfig`, `.env.example` (o `.gitignore` já existe).
- [x] Manter o `CLAUDE.md` (já criado na rev. 5) atualizado com as convenções que surgirem.
- [x] `config/env.ts` com zod (falha no boot se faltar alguma variável).
- [x] Express 5 + Vite middleware + fallback SPA + estáticos de produção (§6).
- [x] pino, errorHandler, `AppError`, helmet (CSP por ambiente), `GET /api/health`.
- [x] tsyringe (tokens, register), `reflect-metadata`.
- [x] Cliente: React 19 + Tailwind 4 + `shadcn init` + React Router + TanStack Query + layout base.
- [x] **i18n desde o início** (§14.4): i18next + react-i18next + detector, `locales/pt-BR`, chaves tipadas, seletor de idioma no layout.
- [x] **Marca Favo** (§14.6): tokens de cor (claro/escuro) no tema do shadcn, fontes auto-hospedadas, logo e favicon em SVG, alternância de tema, rodapé de "marca fictícia".
- [x] Vitest configurado com um teste de exemplo.

**Aceite:** `npm run dev` → **uma porta**, página React com HMR funcionando + `/api/health` 200.
`npm run build && npm start` → mesma página servida a partir de `dist/`. Verificado com o Playwright MCP.
Trocar o idioma no seletor altera os textos sem recarregar a página. O layout aparece com a marca Favo nos modos claro e escuro. `npm run deps:check` passa, e o `git diff` do
`package.json` só mostra mudanças feitas por comandos npm.

**Resultado (rev. 8):** aceite verificado com o Playwright MCP: dev numa porta só com HMR (alteração aplicada sem recarregar),
`/api/health` 200, 404 em JSON para `/api/*` e 404 da SPA nas outras rotas, produção a partir de `dist/` com CSP estrita e
**console sem nenhum erro**, idioma trocado sem recarregar (pt-BR → en-US → es-ES, com `<html lang>`), tema claro/escuro/automático
sem "flash" e layout conferido em 390 px. `typecheck`, `lint` (Biome), 7 testes (Vitest + supertest) e `deps:check` (42 dependências) verdes.
Diferenças em relação ao plano: o logo é um componente React (`components/brand/Logo.tsx`, herda as cores do tema) em vez de
`assets/brand/*.svg`; o favicon está em `src/client/public/favicon.svg`; o seletor de **moeda** fica para a Fase 5, junto com os preços.

### Fase 2: Banco de dados — ✅ concluída em 2026-09-23
- [x] Prisma 7 + adapter MariaDB + `prisma.config.ts` por ambiente (os bancos já existem).
- [x] Schema §8.3 → `db:migrate:dev` (migration `init`).
- [x] Seeds §8.4 (idempotentes, com comportamento por ambiente).
- [x] Repositories base + singleton do Prisma no container + shutdown gracioso.

**Aceite:** `db:setup:dev` roda do zero. Rodar `db:seed:dev` **duas vezes** não duplica nada.
`db:seed:prod` sem `SEED_ADMIN_*` falha com uma mensagem clara. `db:migrate:test` recria o banco de teste.
Conexão com o MySQL 8.4 (`caching_sha2_password`) validada pelo adapter.

**Resultado (rev. 9):** migration `init` aplicada no `vps_platform_dev` (um segundo `migrate dev` diz "Already in sync");
`db:seed:dev` rodado duas vezes sem duplicar (20 permissões, 3 roles, 26 vínculos, 4 planos, 4 imagens, 29 IPs, 5 usuários);
`db:seed:prod` sem `SEED_ADMIN_*` falha listando as duas variáveis; `db:migrate:test` recriou o `vps_platform_test` (com o
consentimento do usuário exigido pelo Prisma, §19); o adapter conectou com `caching_sha2_password` (`allowPublicKeyRetrieval`
só em localhost). `/api/health` passou a checar o banco (503 se ele cair). Repositórios `UserRepository` e `HealthRepository`
via container; encerramento gracioso fecha o HTTP, o Vite e o pool. 14 testes (inclusive seed idempotente e técnico sem
nenhuma permissão `vps:*`/`billing:*`/`sshkey:*` no banco de teste).

### Fase 3: Autenticação, CSRF e RBAC — ✅ concluída em 2026-09-23
- [x] Utils de crypto (token aleatório, SHA-256, HMAC, `timingSafeEqual`), cookies.
- [x] Middlewares `originCheck`, `csrf`, `authenticate`, `optionalAuthenticate`, `requirePermission`, `validate`, `rateLimit`.
- [x] `AuthenticatedUser`, `SessionService`, `AuthService`, `AuthController`, rotas §15 (auth + account).
- [x] RBAC (§9.7): constante de permissões + tipo, sincronização no seed, `requirePermission`, hook `useCan` no frontend.
- [x] **Administração → Usuários:** listar, buscar e trocar a role (`admin:users:assign-role`), com revogação das sessões do usuário afetado e `AuditLog`.
- [x] `spaHandler` emitindo `psid`/`csrf`.
- [x] Frontend: `lib/api.ts`, `AuthProvider`, `RequireAuth` com loader, `RequirePermission`, telas de login, registro e conta (senha, sessões).
- [x] Testes: unitários (token CSRF: válido, expirado, binding errado, header ausente) e integração com supertest
  (login sem CSRF → 403; login com Origin estranho → 403; `me` sem cookie → 401; logout invalida a sessão; senha errada → mensagem genérica).

**Aceite:** fluxo completo no navegador (Playwright): acessar `/vps` deslogado → loader → login → volta para `/vps`.
Um `fetch` a partir de outra origem (página de teste em outra porta) com cookies é **rejeitado**. Um técnico
que recebe a role `admin` pela tela de administração é deslogado e, ao entrar de novo, vê o menu de administração.

**Resultado (rev. 10):** os três critérios verificados no navegador com o Playwright MCP: (1) `/vps` deslogado → `/login?next=%2Fvps`
→ login → volta para `/vps`; (2) página em `localhost:3001` com `fetch` + cookies: o POST simples levou **403 ORIGIN_INVALID** e o
POST com o token roubado nem saiu (preflight CORS); a sessão continuou ativa; (3) a técnica Carla, promovida a admin pela tela, perdeu
a sessão aberta em outro "dispositivo" (401) e, ao entrar de novo, viu o menu **Administração** (depois voltou a ser técnica).
Também conferido: chave SSH real do Windows (com `
`) aceita com o mesmo fingerprint do `ssh-keygen`. 47 testes (CSRF,
origem, login/logout, cadastro, RBAC, troca de role com revogação e AuditLog, troca de senha, chaves SSH, traduções). Fora do plano
original e adicionados: chaves SSH na conta (`/api/account/ssh-keys`, §15) e o painel do usuário logado em `/`.

### Fase 4: Integração com o Proxmox — ✅ concluída em 2026-09-23
- [x] `ProxmoxClient` (undici + CA, token, zod, erros tipados, timeout).
- [x] `VirtualizationProvider` + `QemuCloudInitProvider` (clone, config com `ciupgrade=0`, resize, status, power, pending, delete, rrddata).
- [x] Ações pelo guest agent (§10.6): `ping`, `set-user-password`, `file-write` + recarregar o sshd, com um `ImageProfile` por imagem.
- [x] Cifragem AES-256-GCM das senhas no payload dos jobs (`JOB_SECRET_KEY`).
- [x] `TaskWaiter` (UPID).
- [x] Normalização e validação de chaves SSH, e codificação correta do `sshkeys` (§10.2).
- [x] `npm run pve` (CLI §16.3).
- [x] Testes de integração **contra o laboratório** (marcados com `@lab`, fora do CI), **para as quatro imagens**: clonar → configurar →
  ligar → agente → senha root → SSH por senha liga/desliga → SSH → resize → desligar → excluir.

**Aceite:** a suíte `@lab` passa. `npm run pve -- capacity` mostra memória e disco reais.

**Resultado (rev. 11):** `npm run test:lab` passou **30/30** com o token da plataforma (≈3,5 min): para as quatro imagens,
clone vinculado → cloud-init (usuário `cliente`, senha, chave, IP `.229`, MAC do IP, banda) → resize → start → agente em ~30 s →
SSH com a chave e `sudo`/`doas` → senha root pelo agente → **login SSH por senha liga/desliga provado com login de verdade**
(SSH_ASKPASS) e root sempre recusado → chave extra pelo agente funcionando → memória nova pendente até reiniciar → métricas →
`vncproxy` → shutdown ACPI → exclusão idempotente. `npm run pve -- capacity` mostra memória e disco reais do nó.
Descobertas que mudaram o desenho: o drop-in do sshd passou a ser **`01-favo.conf`** (§10.6) e o `ticket` do `vncproxy` vem
prefixado com a senha VNC (§10.5). Implementação: `src/server/integrations/proxmox/` (`ProxmoxClient`, `TaskWaiter`,
`QemuCloudInitProvider`, `ImageProfile`), interface `VirtualizationProvider`, `SecretBox` (AES-256-GCM, `JOB_SECRET_KEY`),
provider falso para os testes comuns e o `/api/health` com o estado do Proxmox.

### Fase 5: Catálogo, pedido e pagamento simulado — ✅ concluída em 2026-09-23
- [x] `PlanService`, `OsTemplateService`, rotas de catálogo.
- [x] `CapacityService` (limites + nó real).
- [x] `PaymentGateway` + `FakePaymentGateway`, `InvoiceService`, `POST /api/vps` (cria o pedido), `POST /api/invoices/:id/pay`.
- [x] Frontend: **tela de criação de VPS** (§14.5) com campos condicionais vindos da imagem, `/checkout/:id`, `/billing`,
  **seletor de moeda** e formatação de valores (§14.4).
- [x] Validação no servidor espelhando a tela (mínimos da imagem, regras de usuário, senha e chave).

**Aceite:** cartão `…0002` recusa e permite tentar de novo; `…4242` aprova e gera o job `provision_vps` (visível no banco);
pagar a mesma fatura duas vezes → 409. Escolher Debian desabilita o plano Nano, e forçar pela API retorna `422 PLAN_BELOW_IMAGE_MINIMUM`. Com USD selecionado, os preços aparecem convertidos com "≈", e o checkout mostra o valor em BRL.

**Resultado (rev. 12):** verificado no navegador (Playwright MCP) com a Ana: Debian desabilita o Nano ("Debian 13 requer 512 MB e 3 GB")
e escolhe o Micro; com USD os preços aparecem como "≈ US$ 3,58" e o resumo avisa "Cobrado em reais: R$ 19,90"; pedido Alpine Nano
(chave salva + senha) → checkout com **R$ 9,90** em destaque e a conversão como referência; cartão `…0002` recusado com mensagem e
nova tentativa; `…4242` aprovado → VPS "Criando" e job `provision_vps` no banco (senhas cifradas, nenhuma em claro); pagar de novo
→ **409 INVOICE_NOT_PAYABLE**. 72 testes (catálogo, validações do pedido, limites, capacidade, Proxmox fora, pagamento
recusado/aprovado, 3 pagamentos simultâneos → 1 aprovação, cartão inválido, fatura de outro cliente → 404, Luhn, moeda).

### Fase 6: Provisionamento e ciclo de vida
- [ ] `JobQueue` + `Worker` (SKIP LOCKED, retry, locks órfãos), handlers §11.
- [ ] IPAM atômico, máquina de estados com lock otimista.
- [ ] `vps_action`, `resize`, `delete`, `reconcile`, `expire_pending`, limpeza de sessões.
- [ ] Socket.IO base (handshake autenticado, salas `user:*`, `destroyUpgrade: false`) + eventos `vps:status` e `vps:progress`.

**Aceite:** do pagamento até `RUNNING` sem refresh na tela, e `ssh <usuário>@<ip>` funciona a partir do Windows. Matar o servidor
no meio do provisionamento e subir de novo → o job retoma e termina sem duplicar a VM. Desligar a VM pela interface web do Proxmox
→ em até 60 s a plataforma mostra `STOPPED`.

### Fase 7: Página da VPS e console
- [ ] Lista, página da VPS com as abas de §14.5, ações com confirmação (`alert-dialog`), badges de status, toasts.
- [ ] **Console noVNC** (§10.5): endpoint da sessão de uso único, proxy `ws` no `upgrade`, cliente `@novnc/novnc`, barra de ferramentas.
- [ ] Aba Acesso: redefinir senhas, SSH por senha liga/desliga, adicionar chave (§10.6).
- [ ] Linha do tempo de criação ao vivo (`vps:progress`).
- [ ] Aviso de "alterações pendentes até reiniciar" (§10.4).
- [ ] Gráficos de CPU, RAM e rede (shadcn `chart` + rrddata).
- [ ] Histórico de eventos. Estados vazios, de carregamento e de erro caprichados.

**Aceite:** roteiro E2E manual e automatizado: criar (cada imagem), ligar, desligar, reiniciar, aumentar plano, renomear e excluir.
O console abre e mostra o `login:` (ou o LightDM, na Desktop), e dá para entrar com a senha definida na criação. Um `consoleId` reutilizado ou vindo de
outro usuário é recusado.

### Fase 8: Suporte (chat + fila)
- [ ] `SupportService` (regras §13.1), rotas REST, handlers de socket, salas.
- [ ] UI do cliente (`/support`): abrir conversa, posição na fila, chat.
- [ ] UI do técnico (`/agent`): fila ao vivo, "Iniciar atendimento", abas de atendimentos, encerrar e devolver.
- [ ] Testes: claim concorrente (2 técnicos → exatamente 1 sucesso), técnico sem acesso a `/api/vps` (403), mensagens de não participante (rejeitadas).

**Aceite:** E2E com **2 contextos** (cliente + técnico): o cliente abre, o técnico vê na fila **sem refresh**, assume, e
os dois trocam mensagens em tempo real. Um segundo técnico que tenta assumir recebe o aviso "já assumida".

### Fase 9: Qualidade e apresentação
- [ ] Traduções completas de en-US e es-ES (ou a lista final de §20) + verificação de chaves faltando.
- [ ] Cobertura dos services críticos, E2E dos fluxos principais (em pt-BR e em um segundo idioma).
- [ ] README de portfólio: arquitetura (diagramas), decisões (este plano resumido), como rodar, screenshots e GIF.
- [ ] `docs/arquitetura.md`.
- [ ] Revisão de segurança (checklist OWASP deste plano).

### Fase 10: Extras (opcionais, por prioridade sugerida)
1. **Console em texto (xterm.js)** como alternativa ao noVNC: `termproxy` com `serial=serial0`, com o mesmo proxy de §10.5.
   O protocolo do termproxy será conferido no código-fonte do `pve-xtermjs` antes de implementar.
2. **Firewall por VPS:** `PUT …/qemu/{vmid}/firewall/options enable=1, ipfilter=1, macfilter=1` (impede o cliente de trocar o IP
   dentro da VM para roubar outro). Exige ativar o firewall do datacenter com cuidado, e as regras de conntrack da doc para o NAT.
3. **Cobrança recorrente:** renovação mensal, suspensão (stop) por inadimplência, exclusão após carência, "relógio acelerado" de demonstração.
4. **Painel admin ampliado:** todas as VPS (somente leitura), capacidade do nó, fila de jobs, e o **editor de roles**
   (criar roles e marcar permissões numa grade, `admin:roles:manage`).
5. **Reinstalar VPS** (destroy + clone com o mesmo IP).
6. **MCP próprio somente leitura** (§16.3).
7. Docker Compose (app + MySQL) e CI com GitHub Actions (lint, typecheck, testes sem `@lab`).

---

## 18. Estratégia de testes

| Nível | Ferramenta | Alvo |
|---|---|---|
| Unitário | vitest | crypto/CSRF, `AuthenticatedUser`, máquina de estados, cálculo de capacidade, `FakePaymentGateway`, parsing das respostas do Proxmox (fixtures reais capturadas do laboratório) |
| Integração HTTP | vitest + supertest + banco `vps_platform_test` | Middlewares em cadeia, rotas, permissões, concorrência (claim, pagamento duplo) |
| Integração Proxmox | vitest `@lab` | `QemuCloudInitProvider` real contra o laboratório (fora do CI) |
| Provider fake | `FakeVirtualizationProvider` via child container | Worker e jobs sem precisar do Proxmox |
| E2E | @playwright/test (+ Playwright MCP para verificação exploratória) | Login, wizard + checkout + provisionamento, ações, chat com 2 contextos |

---

## 19. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| RAM do laboratório (Proxmox com 3 GB, ~1,6 GB livres para VPS; Windows com pouca folga) | Provisionamento falha ou o PC fica lento | Planos pequenos (256–768 MB), mínimos por imagem, `CapacityService` recusando pedidos sem espaço, limite de VPS por cliente. Na prática, cabem ~3 VPS Debian/Ubuntu de 512 MB **ou** ~6 Alpine de 256 MB **ou** uma Alpine Desktop de 1 GB com pouca folga. Subir para 4 GB se o Windows tiver folga |
| Disco do pool `data` (6,8 GB) com quatro templates (~2,5–3 GB) | Clones sem espaço | +10 GB recomendado na Fase 0 (§3.2, autorizado por você). Clones vinculados + checagem de storage no `CapacityService` |
| Aceleração deixar de funcionar (ex.: ativar WSL2, Docker Desktop, Hyper-V ou "Integridade de Memória" no Windows) | VMs ficam ~10x mais lentas ou nem iniciam com KVM | §2.4 explica como evitar. O `npm run pve -- status` verifica `/dev/kvm` |
| DNS nas VMs Alpine (cloud-init não gera `resolv.conf`) | VPS sem resolução de nomes | Corrigido na golden image (§3.6) e coberto pelo teste automático do template |
| Codificação do `sshkeys` pela API; chaves com `\r\n` vindas do Windows | Chave não instalada na VPS | Normalização + teste `@lab` na Fase 4 (§10.2) |
| Guest agent não responder (VM travada, agente parado pelo cliente) | Não dá para definir ou redefinir senhas nem ajustar o SSH | Timeout com mensagem clara. Na criação, a senha do usuário também vai pelo `cipassword` (cloud-init), então o acesso básico não depende do agente |
| `VM.GuestAgent.Unrestricted` é um privilégio forte | Um bug poderia executar comandos nas VMs | Vale só no pool `vps-platform`. O backend só roda comandos fixos do `ImageProfile`, nunca texto vindo do usuário, e há testes para isso |
| Socket.IO destruindo upgrades de outros WebSockets (`destroyUpgrade: true` por padrão) | O console noVNC cai em 1 s | `destroyUpgrade: false` + teste E2E do console (§10.5) |
| Tipos do noVNC (`@types/novnc__novnc` 1.6.0) atrás da biblioteca (1.7.0) | Tipos incompletos | Um `d.ts` local complementar, se faltar algo |
| Upgrade automático no primeiro boot (`package_upgrade` gerado pelo Proxmox) | Criação lenta (4+ min no Ubuntu) ou falha (Alpine sem DNS) | `ciupgrade=0` nos clones. Templates atualizados no build e reconstruídos periodicamente |
| Senhas trafegando pelos jobs | Vazamento pelo banco | AES-256-GCM no payload, apagado após o uso. Nunca logadas (`redact` do pino) |
| Mudança de rede derrubar o acesso ao Proxmox | Laboratório inacessível | Já aplicada com sucesso. Backup em `/root/interfaces.bak-20260923020356`. Técnica de rollback automático documentada (§3.3) |
| `npm audit`: avisos em dependências transitivas do Prisma 7.10.0 (`mariadb` 3.4.5 fixado pelo adapter, `mysql2` e `deepmerge-ts` da CLI) | Vulnerabilidades conhecidas | Sem correção dentro da regra de versões (o "fix" é voltar ao Prisma 6 com `--force`). Avaliadas na rev. 9: exigem TLS com MitM, servidor malicioso, charsets asiáticos ou config não confiável; nada disso se aplica (MySQL local, utf8mb4). Reavaliar a cada atualização do Prisma |
| Prisma 7 bloqueia comandos destrutivos (`migrate reset --force`) quando detecta um agente de IA | O Claude não consegue recriar bancos sozinho | Proteção correta: o Claude pede o consentimento do usuário a cada vez (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`). Os testes não dependem de reset (seed idempotente) |
| Tag `latest` apontando para pré-release (hoje: `prisma` → 8.0.0-rc.15) | Instalar versão instável sem perceber | Política §4.1: `deps:stable` antes de instalar, versão exata no `npm install`, `deps:check` depois |
| TypeScript 7 incompatível com `typescript-eslint` | Lint não instala | Biome no lugar do ESLint (§4). Ferramentas que dependem da API programática do TypeScript (ex.: `ts-jest`, `ts-loader`) ficam fora do projeto |
| CLIs (shadcn) instalando versões por conta própria | Dependência fora da regra | `npm run deps:check` depois de cada uso, com correção via `npm install <pkg>@<versão>` |
| tsyringe pouco ativo; esbuild sem metadata | DI falha em dev | `@inject` explícito sempre. Se o projeto for abandonado, a troca é localizada (container/register) |
| MySQL 8.4 + adapter MariaDB (`caching_sha2_password`, confirmado no usuário `vps_app`) | Falha de conexão | Validar na F2. Se necessário: `allowPublicKeyRetrieval` no adapter (só local) ou trocar o plugin de autenticação do `vps_app` |
| Express 5: sintaxe de curinga | Fallback SPA não casa | Usar `/{*splat}` (path-to-regexp v8) |
| Certificado autoassinado do Proxmox, sem o IP no SAN | Fetch falha | Confiar na `pve-root-ca.pem` e validar pelo nome do nó (`PVE_TLS_SERVERNAME=primeiro`, §3.5) |
| Condições de corrida (IP, VMID, claim, pagamento) | Duplicidade | Atualizações condicionais atômicas + índices únicos + testes de concorrência |
| Senhas (Proxmox e MySQL) no §0 deste arquivo, num repositório público | Exposição | Trocar as senhas ou removê-las do §0/§0.2 antes de publicar. `.env*` e `certs/` já estão no `.gitignore` |
| Desalinhamento banco ↔ Proxmox | Status errado | Job `reconcile`, tags e `description` com o UUID da VPS, pool isolado |

---

## 20. Decisões pendentes

Nenhuma. Todas foram respondidas: VM 100, aceleração, rede, SSH, MySQL, VM × LXC, idioma/moeda e commits (§0.2);
nome e marca, idiomas e moedas, criação de VPS, imagens, console e RBAC (§0.4); aprovação da marca e imagem Desktop (§0.5).

Decisões novas que surgirem durante a implementação serão registradas aqui e no `CLAUDE.md`.

---

## 21. Referências consultadas

**Proxmox (oficial)**
- Proxmox VE API (autenticação, ticket, CSRFPreventionToken, API tokens, UPID): https://pve.proxmox.com/wiki/Proxmox_VE_API
- API Viewer / schema `apidoc.js` (fonte dos endpoints, parâmetros e permissões da §10): https://pve.proxmox.com/pve-docs/api-viewer/
- User Management (realms, roles, privilégios, ACLs, pools, tokens): https://pve.proxmox.com/pve-docs/chapter-pveum.html
- Proxmox Container Toolkit (pct, templates, rootfs, net, limites): https://pve.proxmox.com/pve-docs/chapter-pct.html
- Admin Guide: rede (ifupdown2, masquerading) e repositórios PVE 9: https://pve.proxmox.com/pve-docs/chapter-sysadmin.html
- Cloud-Init Support: https://pve.proxmox.com/wiki/Cloud-Init_Support
- Nested Virtualization: https://pve.proxmox.com/wiki/Nested_Virtualization
- Proxmox VE inside VirtualBox: https://pve.proxmox.com/wiki/Proxmox_VE_inside_VirtualBox

**Laboratório e SO**
- VirtualBox Manual: Virtual Networking (NAT, host-only, modo promíscuo): https://www.virtualbox.org/manual/ch06.html
- Alpine cloud images: https://alpinelinux.org/cloud/ · https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/

**Stack**
- Vite SSR / middleware mode: https://vite.dev/guide/ssr
- shadcn + Vite: https://ui.shadcn.com/docs/installation/vite
- Prisma 7 + MySQL: https://www.prisma.io/docs/orm/overview/databases/mysql
- Prisma 7 seeding: https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding
- TypeScript 7 e decorators: https://github.com/microsoft/typescript-go/pull/2343
- esbuild e `emitDecoratorMetadata`: https://github.com/evanw/esbuild/issues/3680
- Registro do npm (`npm view <pkg> dist-tags versions time peerDependencies engines`): base da tabela de §4, do conflito `typescript-eslint` × TypeScript 7 e da tag `latest` pré-release do `prisma`

**Diagnóstico do PC (rev. 2)**
- `VBox.log` da VM "Segundo Proxmox" (`HM: HMR3Init: VT-x w/ nested paging…`, `NestedHWVirt = 0`, `UseNEMInstead = 0`)
- `Win32_Processor` (VT-x/EPT no firmware), `Win32_ComputerSystem.HypervisorPresent`, `Win32_OptionalFeature` (Hyper-V/WSL desativados), `Get-NetAdapterBinding` (driver de bridge do VirtualBox ausente)

**Segurança**
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

**Revisão 4**
- Debian cloud images (trixie): https://cloud.debian.org/images/cloud/trixie/latest/ (imagem `genericcloud` + `SHA512SUMS`)
- Ubuntu minimal cloud images (noble): https://cloud-images.ubuntu.com/minimal/releases/noble/release/ (imagem + `SHA256SUMS`)
- Opções do engine.io (`destroyUpgrade`, `destroyUpgradeTimeout`): https://github.com/socketio/engine.io (README) · opções do servidor Socket.IO: https://socket.io/docs/v4/server-options/
- Schema do Proxmox (`apidoc.js`): `vncproxy`, `vncwebsocket`, `agent/set-user-password`, `agent/file-write`, `agent/exec`, `agent/ping`
- noVNC: https://github.com/novnc/noVNC · registro do npm (`@novnc/novnc`, `ws`, `@fontsource-variable/*`, `i18next`)
- Busca de conflito de nome "Favo" como provedor de VPS: nenhum resultado relevante (só o software "Faveo Helpdesk")
- Script oficial `setup-desktop` do Alpine (a wiki bloqueou o acesso automatizado): https://gitlab.alpinelinux.org/alpine/alpine-conf/-/raw/master/setup-desktop.in

**MCP (avaliação)**
- https://github.com/gilby125/mcp-proxmox
- https://github.com/trac3r00/proxmox-mcp
