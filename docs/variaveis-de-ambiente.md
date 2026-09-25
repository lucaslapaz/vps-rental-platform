# Variáveis de ambiente

A Favo lê a configuração de um arquivo por ambiente. Os três ficam **fora do git**:

| Arquivo | Usado por | Banco |
|---|---|---|
| `.env.development` | `npm run dev`, `npm run pve`, `npm run mcp`, `npm run db:*:dev`, scripts do laboratório | `vps_platform_dev` (e `vps_platform_shadow`) |
| `.env.test` | `npm test`, `npm run test:e2e`, `npm run test:lab` | `vps_platform_test` |
| `.env.production` | `npm start`, `npm run db:migrate:deploy`, `npm run db:seed:prod` | `vps_platform_prod` |

O `NODE_ENV` de cada script do `package.json` escolhe o arquivo. Uma variável definida no próprio processo (por exemplo,
`PORT=3001 npm run dev`) tem prioridade sobre o arquivo. Se faltar algo obrigatório ou um valor estiver fora do
formato, o servidor não sobe e lista o problema: `Variáveis de ambiente inválidas (.env.development): …`.

O [.env.example](../.env.example) é o modelo comentado com **todas** as variáveis. Não é preciso copiá-lo: os
comandos abaixo criam os arquivos.

## Comandos que geram os valores

| Comando | O que faz |
|---|---|
| `npm run env:setup` | **Assistente:** pergunta no console só o que é escolha sua (MySQL, senha de demonstração, porta, cobrança acelerada e, se quiser, o admin de produção), testa a conexão com o MySQL, mostra um resumo e grava o `.env.development` e o `.env.test`. Os segredos são gerados sozinhos. **Nunca troca um valor que já existe**, e rodar de novo só pergunta o que falta. Também copia as `PVE_*` do `.env.development` para os outros arquivos, e essas ele sempre atualiza. As perguntas estão no [guia, passo C4](instalacao.md#c4-arquivos-de-configuração-env) |
| `npm run env:setup -- --production` | O mesmo, criando também o `.env.production` sem perguntar se deve |
| `DB_PASSWORD=<senha> npm run env:setup -- --yes` | Sem perguntas (para automatizar): aceita todos os padrões e gera as senhas |
| `npm run env:secret` | Lista os segredos que dá para gerar, com o formato de cada um |
| `npm run env:secret -- <VARIÁVEL>` | Imprime `VARIÁVEL=<valor novo>`, sem gravar nada. Serve para copiar e colar |
| `npm run env:secret -- <VARIÁVEL> --write <development\|test\|production>` | Gera e **grava** no arquivo do ambiente, substituindo o valor atual, e avisa o que a troca afeta |
| `npm run env:secret -- all --write <ambiente>` | Gera de novo todos os segredos que valem para aquele ambiente |
| `scripts/pve/bootstrap.sh` (Git Bash) | Cria o token da plataforma no Proxmox e grava as `PVE_*` no `.env.development` (depois rode `npm run env:setup` para levá-las aos outros arquivos) |
| `scripts/pve/bootstrap.sh --rotate-token` (Git Bash) | Apaga o token e cria outro. O secret antigo deixa de valer na hora |

Os scripts `.sh` rodam no **Git Bash**, não pelo `npm run`. No Windows, um script npm que chama `bash` pode cair no bash
do WSL, que fica em `C:\Windows\System32`, em vez do Git Bash.

Senha do MySQL com caracteres especiais: não há problema. O assistente pergunta a senha, em vez de recebê-la como
argumento, onde o PowerShell e o cmd interpretariam alguns caracteres, e já a codifica dentro da URL (`@` vira `%40`,
por exemplo).

Depois de mudar um `.env`, reinicie o servidor: ele só lê o arquivo quando sobe.

## Variáveis obrigatórias

### Banco de dados

| Variável | Formato | Como gerar | Observações |
|---|---|---|---|
| `DATABASE_URL` | `mysql://vps_app:<senha>@127.0.0.1:3306/<banco>` | `npm run env:setup` (pergunta endereço, usuário e senha) | Um banco por ambiente. Caracteres especiais da senha vão codificados (`encodeURIComponent`). O `npm test` e o E2E se recusam a rodar se o nome do banco não tiver `_test` |
| `SHADOW_DATABASE_URL` | Igual, apontando para `vps_platform_shadow` | `npm run env:setup` | Só no `.env.development`. O `prisma migrate dev` usa esse banco vazio para comparar o schema |

O usuário e os bancos são criados uma vez, com o SQL do [guia de instalação, passo C3](instalacao.md#c3-mysql-bancos-e-usuário).
Outro host ou porta: responda à pergunta *MySQL: endereço* do assistente (ex.: `127.0.0.1:3307`).

### Segredos gerados localmente

Todos são valores **aleatórios**, sem relação com nenhum serviço externo. Qualquer valor no formato certo funciona. Use
os comandos em vez de inventar um.

| Variável | Para que serve | Formato | Gerar | Se trocar depois |
|---|---|---|---|---|
| `CSRF_SECRET` | Chave do HMAC que assina o token CSRF (*Signed Double-Submit Cookie*) | Texto aleatório, **mínimo 32 caracteres**. O gerador faz 64 (48 bytes em base64url) | `npm run env:secret -- CSRF_SECRET` | Os tokens CSRF emitidos deixam de valer. Quem estiver com a página aberta recarrega a página; o login continua |
| `JOB_SECRET_KEY` | Chave **AES-256-GCM** que cifra as senhas das VPS entre o pedido e o provisionamento. Senha de VPS nunca fica em texto puro no banco | **Exatamente 32 bytes em base64** (44 caracteres). Outro tamanho é recusado | `npm run env:secret -- JOB_SECRET_KEY` | VPS aguardando pagamento e jobs de criação ou reinstalação na fila não conseguem ler as senhas e terminam em erro. Troque com a fila vazia |
| `SEED_DEFAULT_PASSWORD` | Senha dos usuários de demonstração em dev e teste: `ana@`, `bruno@`, `carla@`, `diego@` e `admin@favo.local` | Mínimo 10 caracteres. O gerador faz 16 | `npm run env:secret -- SEED_DEFAULT_PASSWORD` | Só vale para usuários **criados depois**: o seed não troca a senha de quem já existe no banco. Para valer, recrie o banco (guia, C3) |
| `SEED_ADMIN_PASSWORD` | Senha do administrador inicial. Obrigatória em produção; opcional em dev (sem ela, o admin usa a `SEED_DEFAULT_PASSWORD`) | Mínimo 12 caracteres. O gerador faz 20 | `npm run env:secret -- SEED_ADMIN_PASSWORD` | Mesma regra: só vale se o admin ainda não existir |
| `SEED_ADMIN_EMAIL` | E-mail do administrador inicial. Obrigatório em produção | Um e-mail | Perguntado pelo `npm run env:setup` ao criar o `.env.production` (padrão `admin@favo.local`) | Com um e-mail novo, o seed cria **mais** um admin |

Não é preciso manter os mesmos segredos entre os ambientes: cada arquivo tem os seus. A exceção é a
`SEED_DEFAULT_PASSWORD`, que o `env:setup` repete no `.env.test` só para ser uma senha a menos para lembrar.

### Proxmox: o token da plataforma

A Favo fala com o Proxmox por um **API Token do Proxmox VE**. Não usa a senha do root nem o *ticket* de login: o token não
expira, dispensa o `CSRFPreventionToken` e tem permissões próprias. O token é **criado pelo Proxmox**, não gerado
localmente. Quem cria é o `scripts/pve/bootstrap.sh`:

| Variável | Valor | De onde vem |
|---|---|---|
| `PVE_TOKEN_ID` | `vpsplatform@pve!backend`, no formato `<usuário>@<realm>!<nome do token>` | Constantes do `bootstrap.sh`: usuário `vpsplatform` no realm `pve` (interno do Proxmox) e token `backend` |
| `PVE_TOKEN_SECRET` | Um UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) | O Proxmox mostra o secret **uma única vez**, quando cria o token. O `bootstrap.sh` captura e grava |
| `PVE_URL` | `https://192.168.56.10:8006` | IP do Proxmox na rede host-only (`PVE_HOST=<ip> scripts/pve/bootstrap.sh` para outro) |
| `PVE_NODE` | O hostname curto escolhido na instalação do Proxmox | Descoberto pelo `bootstrap.sh` no próprio nó |
| `PVE_TLS_SERVERNAME` | Igual ao `PVE_NODE` | O certificado do Proxmox não contém o IP da host-only. A conexão vai para o IP e o certificado é validado pelo **nome do nó** |
| `PVE_CA_FILE` | `certs/pve-root-ca.pem` | CA do Proxmox, copiada do nó (`/etc/pve/pve-root-ca.pem`) pelo `bootstrap.sh`. **Não é um token**: é o que permite validar o certificado autoassinado sem desligar a verificação TLS |

Características do token criado:
- **`privsep=1`** (*separação de privilégios*): o token não herda as permissões do usuário, e recebe ACLs próprias.
- **Permissões só nos pools da plataforma:** `vps-platform` (VPS) e `vps-templates`, onde só pode clonar. Além disso, uso
  do storage `local-lvm`, da bridge `vmbr1` e leitura do nó.
- **Sem acesso a nada fora dos pools.** Não enxerga as outras VMs do Proxmox e não consegue apagar os templates.
- **Sem data de expiração.**
- **O servidor usa assim:** `Authorization: PVEAPIToken=<PVE_TOKEN_ID>=<PVE_TOKEN_SECRET>`.

**Não crie o token pela interface web.** O `bootstrap.sh` também cria a role, o usuário, os pools e as permissões,
e um token feito à mão ficaria sem elas.

| Situação | O que fazer |
|---|---|
| Instalação nova | `scripts/pve/bootstrap.sh` e depois `npm run env:setup` |
| Apagou o `.env.development`, mas o Proxmox é o mesmo | O secret não pode ser lido de novo. Rode `scripts/pve/bootstrap.sh --rotate-token` e depois `npm run env:setup` |
| Quer trocar o secret (vazou, rotina) | Mesmo procedimento. O secret antigo para de funcionar na hora, então reinicie o servidor |
| Conferir se o token funciona | `npm run pve -- status` |

A CA pode ser copiada de novo, sem mexer no token: `scp root@192.168.56.10:/etc/pve/pve-root-ca.pem certs/`.

## Variáveis opcionais (têm valor padrão)

Só defina estas se quiser mudar o comportamento. Os padrões valem para o laboratório do guia.

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` / `HOST` | `3000` / `localhost` | Onde o servidor escuta |
| `APP_ORIGIN` | `http://HOST:PORT` | Origem pública do app (checagem de `Origin` e CSP). Mude se acessar por outro endereço |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |
| `DB_POOL_LIMIT` | `5` | Conexões simultâneas com o MySQL |
| `COOKIE_SECURE` | `false` | `true` só se servir por HTTPS (cookies `Secure` e prefixo `__Host-`) |
| `CSRF_TTL_HOURS` / `SESSION_IDLE_TTL_HOURS` / `SESSION_ABSOLUTE_TTL_DAYS` | `12` / `24` / `7` | Validade do token CSRF, da sessão ociosa e da sessão no total |
| `PVE_POOL` / `PVE_STORAGE` / `PVE_BRIDGE` | `vps-platform` / `local-lvm` / `vmbr1` | Onde as VPS são criadas. Precisam bater com o `bootstrap.sh` |
| `PVE_VMID_START` | `2000` | Primeiro VMID das VPS (os templates ficam em 9000–9003) |
| `PVE_TIMEOUT_MS` | `15000` | Tempo máximo de uma chamada à API do Proxmox |
| `VPS_NAMESERVERS` | `1.1.1.1 8.8.8.8` | DNS configurado nas VPS |
| `VPS_WAIT_SSH` | `true` | Espera a porta 22 da VPS abrir (até 120 s) antes de marcá-la como Ligada |
| `CAPACITY_MAX_MEMORY_MB` / `CAPACITY_MAX_DISK_GB` | `1536` / `12` | Teto de RAM e disco somados das VPS (calibrado para um Proxmox de 3 GB e 30 GB) |
| `MAX_VPS_PER_USER` | `2` | Limite de VPS por cliente |
| `INVOICE_DUE_HOURS` | `24` | Prazo para pagar a fatura de criação |
| `PAYMENT_LATENCY_MS` | 1 a 2 s aleatório (0 nos testes) | Atraso artificial do pagamento simulado, em milissegundos |
| `BILLING_PERIOD_DAYS` / `BILLING_RENEWAL_NOTICE_DAYS` / `BILLING_GRACE_DAYS` | `30` / `7` / `3` | Mensalidade, aviso de renovação e carência antes da exclusão |
| `BILLING_TIME_SCALE` | `1` | "Relógio acelerado" para demonstração: `1440` faz um dia durar um minuto (o mês, 30 minutos) |
| `SUPPORT_MAX_ACTIVE_PER_AGENT` | `3` | Atendimentos simultâneos por técnico |
| `WORKER_ENABLED` / `WORKER_CONCURRENCY` / `WORKER_POLL_MS` / `WORKER_ID` | `true` / `2` / `1000` / hostname | Worker da fila de jobs (`false` = o processo só atende HTTP) |
| `RECONCILE_INTERVAL_SECONDS` | `60` | Intervalo da conferência entre o banco e o Proxmox |
| `IP_POOL_START` / `IP_POOL_END` / `IP_POOL_GATEWAY` / `IP_POOL_PREFIX` | `.200` / `.228` / `.10` / `24` (em `192.168.56.x`; nos testes, uma faixa fictícia `10.99.0.10–19`) | Faixa de IPs das VPS, gravada no banco pelo **seed**. Mudar exige rodar o seed de novo |

Variáveis usadas só por ferramentas: `DB_PASSWORD` (`npm run env:setup -- --yes`), `PVE_HOST` e `PVE_NODE` (scripts
`scripts/pve/*.sh`) e `LAB=1` (definida pelo `npm run test:lab`).
