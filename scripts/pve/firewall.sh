#!/usr/bin/env bash
# Liga o firewall do datacenter do Proxmox SÓ para permitir o anti-spoofing das VPS (plano §17, Fase 10, extra 2).
#
# Uso (na máquina de desenvolvimento, Git Bash):   scripts/pve/firewall.sh
#
# O que faz, como root no nó (o token da plataforma NÃO ganha Sys.Modify):
#   1. Zona de conntrack para o NAT (doc "Masquerading (NAT) with iptables"): com o firewall ligado, a saída das VPS pelo
#      MASQUERADE quebra (testado: DNS e HTTP falhavam) sem `iptables -t raw -I PREROUTING -i fwbr+ -j CT --zone 1`.
#      A regra é aplicada na hora e gravada como post-up/post-down da vmbr1 em /etc/network/interfaces (com backup).
#   2. Grava /etc/pve/firewall/cluster.fw com `enable: 1` e políticas ACCEPT (o host continua aceitando tudo: nada de
#      ficar trancado para fora) e o IPSet `management` com a rede host-only. ANTES, agenda um rollback em 3 min
#      (`enable: 0`), como na receita P2 do CLAUDE.md; confere SSH e a porta 8006 daqui e só então cancela o rollback.
# Idempotente. Se o cluster.fw já existir com outro conteúdo, o script para (não sobrescreve configuração feita à mão).
#
# Variáveis: PVE_HOST (padrão 192.168.56.10), MGMT_NET (padrão 192.168.56.0/24).
set -euo pipefail

PVE_HOST="${PVE_HOST:-192.168.56.10}"
MGMT_NET="${MGMT_NET:-192.168.56.0/24}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8)
ROOT="$(dirname "$0")/../.."
log() { echo "[firewall] $*" >&2; }
remote() { ssh "${SSH_OPTS[@]}" "root@${PVE_HOST}" "$@"; }
# A9/T9: valida o certificado pela CA do nó e pelo nome dele (o IP não está no SAN). Os dois vêm do bootstrap.sh.
CA="${ROOT}/certs/pve-root-ca.pem"
TLS_NAME="${PVE_TLS_SERVERNAME:-$(sed -n 's/^PVE_TLS_SERVERNAME=//p' "${ROOT}/.env.development" 2>/dev/null | tr -d '\r' | tail -1)}"
[ -f "$CA" ] && [ -n "$TLS_NAME" ] || { log "falta a CA ou o PVE_TLS_SERVERNAME: rode scripts/pve/bootstrap.sh antes"; exit 1; }

# ── 1. Zona de conntrack (não afeta o acesso ao nó: só pacotes que entram pelas bridges de firewall das VMs) ──
remote 'bash -s' <<'EOS'
set -euo pipefail
RULE='-t raw -I PREROUTING -i fwbr+ -j CT --zone 1'
iptables -t raw -C PREROUTING -i fwbr+ -j CT --zone 1 2>/dev/null || iptables $RULE
F=/etc/network/interfaces
if ! grep -q 'CT --zone 1' "$F"; then
  cp "$F" "/root/interfaces.bak-$(date +%Y%m%d%H%M%S)"
  # Logo depois do MASQUERADE da vmbr1 (fica dentro da estrofe dela; a rede pode estar com ou sem aspas).
  sed -i "/post-down *iptables -t nat -D POSTROUTING .*-o vmbr0 -j MASQUERADE/a\\
	post-up   iptables -t raw -I PREROUTING -i fwbr+ -j CT --zone 1\\
	post-down iptables -t raw -D PREROUTING -i fwbr+ -j CT --zone 1" "$F"
  grep -q 'CT --zone 1' "$F" || { echo "[firewall] não achei a linha do MASQUERADE da vmbr1 em $F" >&2; exit 1; }
  echo "[firewall] zona de conntrack gravada em $F" >&2
fi
EOS

# ── 2. Firewall do datacenter ──
read -r -d '' CLUSTER_FW <<EOF || true
[OPTIONS]
# Favo: firewall ligado só para o anti-spoofing das VPS (ipfilter/macfilter por VM). O host aceita tudo.
enable: 1
policy_in: ACCEPT
policy_out: ACCEPT

[IPSET management] # acesso de administração (GUI, SSH, VNC), doc "Standard IP set management"
${MGMT_NET}
EOF

remote_script=$(cat <<'EOS'
set -euo pipefail
FW=/etc/pve/firewall/cluster.fw
NEW=$(cat)
if [ -f "$FW" ]; then
  if [ "$(cat "$FW")" = "$NEW" ]; then echo "igual"; exit 0; fi
  echo "diferente"; exit 3
fi
systemctl stop favo-fw-rollback.timer 2>/dev/null || true
systemd-run --quiet --unit=favo-fw-rollback --on-active=180 /bin/sh -c "sed -i 's/^enable: 1/enable: 0/' $FW"
printf '%s\n' "$NEW" > "$FW"
echo "aplicado"
EOS
)

status=$(printf '%s' "$CLUSTER_FW" | remote "bash -c $(printf '%q' "$remote_script")") || {
  code=$?
  if [ "$code" -eq 3 ]; then log "já existe um cluster.fw diferente no nó: revise à mão antes (nada foi alterado)"; fi
  exit "$code"
}
if [ "$status" = "igual" ]; then log "cluster.fw já está como esperado"; exit 0; fi
log "cluster.fw aplicado; rollback automático em 3 min se o acesso cair"

sleep 15 # o pve-firewall aplica as mudanças em alguns segundos
remote 'pve-firewall status' | sed 's/^/[firewall] nó: /' >&2
if remote true && curl -sf -o /dev/null --max-time 8 --ssl-no-revoke --cacert "$CA" --resolve "${TLS_NAME}:8006:${PVE_HOST}" "https://${TLS_NAME}:8006/"; then
  remote 'systemctl stop favo-fw-rollback.timer'
  log "SSH e 8006 acessíveis daqui: rollback cancelado. Firewall do datacenter ligado."
else
  log "SEM acesso depois de ligar: o rollback desliga o firewall em até 3 min"
  exit 1
fi
