# Revisão de segurança (Fase 9)

Checklist da [OWASP Top 10 (2021)](https://owasp.org/Top10/) aplicado à Favo. Cada item aponta a proteção e onde ela é
verificada: código ou teste. A revisão encontrou dois problemas, corrigidos nesta fase (marcados como **Corrigido**).

## A01 · Controle de acesso

| Controle | Onde | Verificação |
|---|---|---|
| Checagem por **permissão**, nunca pelo nome da role (`requirePermission`) | `http/middlewares/auth.ts`, `shared/constants/permissions.ts` | `tests/server/auth.test.ts` |
| Recursos de outro usuário respondem **404** (não revelam que existem): VPS, faturas, conversas | `VpsRepository.findOwned`, `SupportService.participant` | `orders`, `vps-page`, `support` |
| Técnico de suporte sem acesso a VPS, faturas e console | permissões da role `support_agent` | `support.test.ts` (403 em `/api/vps` e `/api/invoices`), `vps-page.test.ts` |
| Console: `consoleId` de uso único, 30 s, preso à **sessão** que o pediu; limite de 2 por usuário | `ConsoleService`, `consoleProxy.ts` | `vps-page.test.ts` (reutilizado, outro usuário, sem sessão) |
| **Corrigido:** revogar a sessão fecha também o console aberto por ela (antes, só o Socket.IO caía) | `RealtimeHub.onSessionEnded` | `vps-page.test.ts` (código 4001) |
| Token do Proxmox restrito aos pools `vps-platform`/`vps-templates` e a uma role mínima | `scripts/pve/bootstrap.sh` | `@lab`: `DELETE` do template com o token → 403 |
| Uma VPS não consegue usar o IP ou o MAC de outra (anti-spoofing: `ipfilter` + `macfilter` do firewall do Proxmox) | `QemuCloudInitProvider.applyNetworkFirewall`, `scripts/pve/firewall.sh` | `@lab`: IP falso dentro da VM é bloqueado; contraprova sem `ipfilter` passa |
| Console de texto com a mesma sessão de uso único do gráfico; o ticket do `termproxy` fica no servidor | `consoleProxy.ts` | `vps-page.test.ts` (serial) |

## A02 · Falhas de criptografia

- Senhas de login com **argon2id** (`utils/password.ts`).
- Sessão: o cookie leva um token aleatório de 32 bytes, e o banco guarda só o **SHA-256** dele.
- Token CSRF: **HMAC-SHA256** ligado à sessão (ou à pré-sessão), com expiração.
- Senhas das VPS: cifradas com **AES-256-GCM** (`SecretBox`) entre o pedido e o uso, e apagadas depois. A redefinição
  de senha vai direto ao Proxmox, sem passar pelo banco nem pela fila.
- TLS até o Proxmox validado com a CA do nó (sem desligar a verificação). Cookies `Secure` + prefixo `__Host-` quando
  `COOKIE_SECURE=true` (HTTPS).

## A03 · Injeção

- Banco: Prisma parametrizado. Os `$queryRaw` usam template com parâmetros; não existe `$queryRawUnsafe`.
- Comandos dentro da VM (guest agent): **fixos** por família de imagem (`ImageProfile`). O texto do usuário entra só
  como argumento posicional (`$1`) ou pela entrada padrão, nunca interpolado no script. O `agent/exec` nunca é exposto
  ao cliente. Hostname e usuário são validados por regex (rótulo DNS; usuário Linux, sem nomes reservados).
- Frontend: React escapa o conteúdo. O único `dangerouslySetInnerHTML` é o do `chart` do shadcn, com CSS montado da
  configuração de cores do próprio código.
- Teste: `proxmox-units.test.ts` confere os scripts fixos (inclusive o escape do `\b` do `sed`).

## A04 · Design inseguro

- Limites de negócio: VPS por cliente, capacidade do nó (memória **disponível** e storage), consoles por usuário,
  atendimentos simultâneos por técnico e uma conversa aberta por cliente (com a linha do cliente travada).
- Concorrência tratada no banco: pagamento com `SELECT … FOR UPDATE`; claim, transições de estado e VMID com lock
  otimista ou índice único. Testes de concorrência em `orders`, `support`, `jobs` e `hardening`.

## A05 · Configuração insegura

- `helmet` com CSP estrita em produção (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`, `form-action 'self'`), `x-powered-by` desligado (`http/security.ts`, `app.ts`).
- Erros inesperados viram `500` genérico, sem stack (`errorHandler.ts`). As mensagens de erro de VPS vistas pelo cliente
  são **códigos** (`VPS_ERROR_CODES`); o texto técnico do Proxmox fica só no log e no `Job.lastError`.
- Corpo JSON limitado a 100 KB; mensagens de chat a 2000 caracteres.
- Variáveis de ambiente validadas com zod no boot (`config/env.ts`); segredos fora do git (`.env*`, `certs/`).

## A06 · Componentes vulneráveis

- Política do projeto: sempre a **maior versão estável** (`npm run deps:check`, 60 dependências em dia).
- `npm audit --omit=dev`: 6 avisos, todos transitivos do Prisma 7.10.0 (`mariadb`, `mysql2`, `deepmerge-ts`). A única
  "correção" é voltar ao Prisma 6 com `--force` (proibido pela regra do projeto). **Risco aceito:** os avisos exigem
  MitM na conexão com o MySQL, protocolo comprimido ou objetos recursivos controlados por terceiros; aqui o MySQL é
  local (`127.0.0.1`), sem TLS, e a config é nossa. Reavaliar quando sair uma versão estável do Prisma com as correções.

## A07 · Identificação e autenticação

- Limites de tentativa: login 5/15 min **por e-mail** e 20/15 min por IP; cadastro 10/h; ações de VPS, acesso e console
  também limitados (`rateLimit.ts`). Teste: `hardening.test.ts` (a 6ª tentativa recebe 429 mesmo com a senha certa).
- Login com mensagem genérica (`INVALID_CREDENTIALS`). Sessão nova a cada login, expiração deslizante com teto
  absoluto, e revogação ao trocar a senha ou a role.
- **Risco aceito:** o cadastro informa `EMAIL_TAKEN` (enumeração de e-mails), um compromisso comum de usabilidade,
  mitigado pelo limite de 10 cadastros por hora por IP.

## A08 · Integridade de software e dados

- CSRF em **todas** as rotas que alteram dados, com a checagem de `Origin` antes (teste estático
  `routes-guard.test.ts`: uma rota nova sem `originCheck`/CSRF/autenticação quebra o build).
- WebSockets (Socket.IO e console) conferem o `Origin` (proteção contra *Cross-Site WebSocket Hijacking*) e autenticam
  pelo cookie `HttpOnly` no handshake (`realtime/handshake.ts`). Ações de estado do chat ficam no REST com CSRF.
- **Corrigido:** o envio de mensagens pelo socket não tinha limite (o REST tinha 30/min). Agora são 20 mensagens a cada
  10 s por socket (`support.test.ts`, rajada de 21 → `RATE_LIMITED`).

## A09 · Registro e monitoramento

- `AuditLog` para login, pedidos, pagamentos, ações de VPS, console (abrir/fechar), acesso e suporte.
- `pino` com *redact* de cookies, `Authorization`, `X-CSRF-Token`, senhas e dados de cartão. O corpo das requisições
  não é logado. PAN e CVV do cartão de teste nunca são gravados (só a bandeira e os 4 últimos dígitos).

## A10 · SSRF

- O servidor não busca URLs vindas do usuário. As únicas chamadas de saída vão para o Proxmox, com URL fixa do `.env`.

## Fora do escopo do laboratório (para uma implantação real)

- HTTPS com HSTS (`COOKIE_SECURE=true`, `strictTransportSecurity` e `upgradeInsecureRequests` ligados).
- Rate limit compartilhado entre instâncias (hoje é em memória, um processo só).
- Rotação periódica do token do Proxmox e da `JOB_SECRET_KEY`.
