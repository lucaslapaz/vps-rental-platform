#!/usr/bin/env bash
# Bootstrap idempotente da identidade da plataforma no Proxmox (plano §3.4–3.5).
#
# Uso (na máquina de desenvolvimento, Git Bash):
#   scripts/pve/bootstrap.sh                 # cria/sincroniza pools, role, usuário, token e ACLs; copia a CA
#   scripts/pve/bootstrap.sh --rotate-token  # apaga e recria o token (o secret antigo deixa de valer)
#
# O mesmo arquivo roda em dois modos:
#   - local  (padrão): envia a si mesmo por SSH (`bash -s -- --remote`), copia a CA para certs/ e grava o
#                      secret do token no .env.development (só quando um token novo é criado).
#   - remoto (--remote): executado no Proxmox como root; faz o trabalho com pveum.
#
# Variáveis: PVE_HOST (padrão 192.168.56.10), PVE_NODE (padrão: descoberto no próprio nó, é o hostname curto dele),
#            ENV_FILE (padrão .env.development).
set -euo pipefail

PVE_HOST="${PVE_HOST:-192.168.56.10}"
PVE_NODE="${PVE_NODE:-}"

POOL_VPS="vps-platform"
POOL_TEMPLATES="vps-templates"
ROLE="VPSPlatformVM"
ROLE_PRIVS="VM.Allocate,VM.Audit,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.PowerMgmt,VM.Console,VM.GuestAgent.Audit,VM.GuestAgent.Unrestricted,Pool.Audit"
PVE_USER="vpsplatform@pve"
TOKEN_NAME="backend"
TOKEN_ID="${PVE_USER}!${TOKEN_NAME}"
BRIDGE="vmbr1"
STORAGE="local-lvm"

# ─────────────────────────────── modo remoto (no Proxmox) ───────────────────────────────
remote() {
  local rotate="$1"
  log() { echo "[bootstrap] $*" >&2; }

  if pveum pool list --output-format json | grep -q "\"poolid\":\"${POOL_VPS}\""; then
    log "pool ${POOL_VPS}: já existe"
  else
    pveum pool add "$POOL_VPS" --comment "Favo: VPS dos clientes"; log "pool ${POOL_VPS}: criado"
  fi
  if pveum pool list --output-format json | grep -q "\"poolid\":\"${POOL_TEMPLATES}\""; then
    log "pool ${POOL_TEMPLATES}: já existe"
  else
    pveum pool add "$POOL_TEMPLATES" --comment "Favo: templates (golden images), só clonagem"; log "pool ${POOL_TEMPLATES}: criado"
  fi

  if pveum role list --output-format json | grep -q "\"roleid\":\"${ROLE}\""; then
    pveum role modify "$ROLE" --privs "$ROLE_PRIVS"; log "role ${ROLE}: privilégios sincronizados"
  else
    pveum role add "$ROLE" --privs "$ROLE_PRIVS"; log "role ${ROLE}: criada"
  fi

  if pveum user list --output-format json | grep -q "\"userid\":\"${PVE_USER}\""; then
    log "usuário ${PVE_USER}: já existe"
  else
    pveum user add "$PVE_USER" --comment "Favo (VPS Rental Platform) backend"; log "usuário ${PVE_USER}: criado"
  fi

  local has_token=0
  if pveum user token list "$PVE_USER" --output-format json | grep -q "\"tokenid\":\"${TOKEN_NAME}\""; then has_token=1; fi
  if [ "$has_token" = 1 ] && [ "$rotate" = 1 ]; then
    pveum user token remove "$PVE_USER" "$TOKEN_NAME"; has_token=0; log "token ${TOKEN_ID}: removido para rotação"
  fi
  if [ "$has_token" = 1 ]; then
    log "token ${TOKEN_ID}: já existe (o secret só é exibido na criação; use --rotate-token para gerar outro)"
  else
    local out secret
    out=$(pveum user token add "$PVE_USER" "$TOKEN_NAME" --privsep 1 --comment "Favo backend" --output-format json)
    secret=$(printf '%s' "$out" | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')
    [ -n "$secret" ] || { log "não consegui ler o secret do token"; exit 1; }
    log "token ${TOKEN_ID}: criado"
    # Única linha no stdout: o modo local captura e grava no .env.
    echo "PVE_TOKEN_SECRET=${secret}"
  fi

  # privsep=1: a permissão efetiva do token é a interseção das ACLs do usuário e do token, então os dois recebem as mesmas.
  local acl
  for acl in "/pool/${POOL_VPS}:${ROLE}" \
             "/pool/${POOL_TEMPLATES}:PVETemplateUser" \
             "/storage/${STORAGE}:PVEDatastoreUser" \
             "/sdn/zones/localnetwork/${BRIDGE}:PVESDNUser" \
             "/nodes/${PVE_NODE}:PVEAuditor"; do
    pveum acl modify "${acl%%:*}" --roles "${acl##*:}" --users "$PVE_USER" --tokens "$TOKEN_ID"
    log "ACL ${acl%%:*} → ${acl##*:} (usuário e token)"
  done
}

if [ "${1:-}" = "--remote" ]; then
  remote "${2:-0}"
  exit 0
fi

# ─────────────────────────────── modo local (Windows / Git Bash) ───────────────────────────────
ROTATE=0
[ "${1:-}" = "--rotate-token" ] && ROTATE=1

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/../.."
ENV_FILE="${ENV_FILE:-.env.development}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

# O nome do nó é o hostname curto escolhido na instalação do Proxmox (ex.: pve.laboratorio.local → pve).
if [ -z "$PVE_NODE" ]; then
  PVE_NODE=$(ssh "${SSH_OPTS[@]}" "root@${PVE_HOST}" 'n=$(hostname -s); [ -d "/etc/pve/nodes/$n" ] && echo "$n"') || true
  [ -n "$PVE_NODE" ] || { echo "[bootstrap] não consegui descobrir o nome do nó em ${PVE_HOST}; defina PVE_NODE" >&2; exit 1; }
fi

echo "[bootstrap] Proxmox em ${PVE_HOST} (nó ${PVE_NODE})"
output=$(ssh "${SSH_OPTS[@]}" "root@${PVE_HOST}" "PVE_NODE=${PVE_NODE} bash -s -- --remote ${ROTATE}" < "$SELF")

mkdir -p certs
scp -q "${SSH_OPTS[@]}" "root@${PVE_HOST}:/etc/pve/pve-root-ca.pem" certs/pve-root-ca.pem
echo "[bootstrap] CA copiada para certs/pve-root-ca.pem"

# Grava (ou substitui) uma variável no arquivo .env sem tocar nas demais.
set_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

set_env PVE_URL "https://${PVE_HOST}:8006"
set_env PVE_NODE "$PVE_NODE"
set_env PVE_TLS_SERVERNAME "$PVE_NODE"
set_env PVE_CA_FILE "certs/pve-root-ca.pem"
set_env PVE_TOKEN_ID "$TOKEN_ID"

secret=$(printf '%s\n' "$output" | sed -n 's/^PVE_TOKEN_SECRET=//p')
if [ -n "$secret" ]; then
  set_env PVE_TOKEN_SECRET "$secret"
  echo "[bootstrap] secret do token gravado em ${ENV_FILE}"
elif ! grep -q '^PVE_TOKEN_SECRET=.' "$ENV_FILE"; then
  echo "[bootstrap] AVISO: o token já existia e ${ENV_FILE} não tem PVE_TOKEN_SECRET. Rode com --rotate-token." >&2
  exit 1
fi
echo "[bootstrap] concluído"
