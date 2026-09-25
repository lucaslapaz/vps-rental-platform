#!/usr/bin/env bash
# Constrói os templates "golden image" das VPS (plano §3.6), a partir das imagens cloud oficiais já
# baixadas em /var/lib/vz/import/ no Proxmox.
#
# Uso (na máquina de desenvolvimento, Git Bash):
#   scripts/pve/build-template.sh <imagem> [--force] [--no-test]
#   scripts/pve/build-template.sh all [--force] [--no-test]
#     <imagem>: alpine (9000) | debian (9001) | ubuntu (9002) | alpine-desktop (9003)
#     --force   : recria o template mesmo que ele já exista (falha se houver clones vinculados a ele)
#     --no-test : não roda o teste de aceite com o token da plataforma (scripts/pve/test-template.mjs)
#
# Modos do mesmo arquivo:
#   - local  (padrão): copia este script para o Proxmox, roda o build lá e depois o teste com o token.
#   - remoto (--remote <imagem> <force>): executado no Proxmox como root.
#
# O build usa o IP 192.168.56.250 (reservado para builds: fora do DHCP e do pool das VPS) e a chave SSH
# do root do Proxmox. No fim, o usuário do build é removido e o cloud-init é "zerado", para que cada
# clone gere a sua própria identidade (usuário, chaves de host, machine-id).
set -euo pipefail

PVE_HOST="${PVE_HOST:-192.168.56.10}"
IMPORT_DIR="/var/lib/vz/import"
BUILD_IP="192.168.56.250"
GATEWAY="192.168.56.10"
BRIDGE="vmbr1"
STORAGE="local-lvm"
POOL="vps-templates"

# Perfil de cada imagem: VMID, nome, arquivo, usuário padrão, família, RAM do build, RAM do template, disco do template.
# O disco do template é o menor tamanho de VPS possível para a imagem (o resize só aumenta, armadilha A8).
profile() {
  case "$1" in
    alpine)         echo "9000 favo-tpl-alpine generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2 alpine alpine 256 256 1G" ;;
    debian)         echo "9001 favo-tpl-debian debian-13-genericcloud-amd64.qcow2 debian debian 512 512 -" ;;
    ubuntu)         echo "9002 favo-tpl-ubuntu ubuntu-24.04-minimal-cloudimg-amd64.img ubuntu debian 512 512 -" ;;
    alpine-desktop) echo "9003 favo-tpl-alpine-desktop generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2 alpine alpine 768 1024 3G" ;;
    *) return 1 ;;
  esac
}
IMAGES="alpine debian ubuntu alpine-desktop"

# ─────────────────────────────── modo remoto (no Proxmox) ───────────────────────────────
log() { echo "[build $(date +%H:%M:%S)] $*" >&2; }

SSH_VM=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

wait_until() { # wait_until <segundos> <descrição> <comando...>
  local limit="$1" what="$2"; shift 2
  local start; start=$(date +%s)
  until "$@" >/dev/null 2>&1; do
    if [ $(( $(date +%s) - start )) -ge "$limit" ]; then log "tempo esgotado esperando: ${what}"; return 1; fi
    sleep 3
  done
  log "${what}: ok em $(( $(date +%s) - start ))s"
}

# Executa um comando como root dentro da VM pelo guest agent e falha se o código de saída não for 0.
guest_root() { # guest_root <vmid> <script sh>
  local out
  out=$(qm guest exec "$1" --timeout 600 -- sh -c "$2")
  printf '%s' "$out" | python3 -c '
import json, sys
r = json.load(sys.stdin)
sys.stdout.write(r.get("out-data", "")); sys.stderr.write(r.get("err-data", ""))
sys.exit(0 if r.get("exited") and r.get("exitcode") == 0 else 1)'
}

# Provisionamento dentro da VM (roda como root via doas/sudo). $1 = família, $2 = imagem.
provision_script() {
  local family="$1" image="$2"
  if [ "$family" = alpine ]; then
    cat <<'EOF'
set -eu
# DNS só para o build: o cloud-init do Alpine não gera o /etc/resolv.conf (armadilha C2).
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf
apk update
apk upgrade
apk add qemu-guest-agent
rc-update add qemu-guest-agent default
rc-service qemu-guest-agent start
# Correção permanente do DNS para os clones (testada na Fase 0, armadilha C2).
mkdir -p /etc/cloud/cloud.cfg.d
cat > /etc/cloud/cloud.cfg.d/99-vpsplatform.cfg <<'CFG'
# Favo: o ifupdown-ng do Alpine não gera o /etc/resolv.conf a partir do cloud-init.
manage_resolv_conf: true
resolv_conf:
  nameservers: ["1.1.1.1", "8.8.8.8"]
# O default_user do Alpine tem gecos "alpine Cloud User", que aparecia para qualquer usuário (ex.: no LightDM).
system_info:
  default_user:
    gecos: ""
CFG
EOF
    if [ "$image" = alpine-desktop ]; then
      cat <<'EOF'
# Área de trabalho XFCE + LightDM (script oficial do Alpine; com argumento roda sem perguntas, armadilha C12).
# BROWSER evita o Firefox, que o script instalaria por padrão.
BROWSER=xfce4-taskmanager setup-desktop xfce
EOF
    fi
    echo 'apk cache clean 2>/dev/null || true'
  else
    cat <<'EOF'
set -eu
export DEBIAN_FRONTEND=noninteractive
APT="apt-get -y -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"
$APT update
$APT full-upgrade
$APT install qemu-guest-agent
systemctl start qemu-guest-agent
$APT autoremove --purge
apt-get clean
EOF
  fi
}

# Limpeza final (roda como root pelo guest agent, depois que a sessão SSH do build terminou).
cleanup_script() {
  local user="$1"
  cat <<EOF
set -eu
U='${user}'
pkill -KILL -u "\$U" 2>/dev/null || true
sleep 1
userdel -r "\$U"
getent group "\$U" >/dev/null && groupdel "\$U" || true
# Regras de sudo/doas que o cloud-init criou para o usuário do build (cada clone recebe as suas).
rm -f /etc/sudoers.d/90-cloud-init-users
[ -f /etc/doas.conf ] && sed -i '/^# cloud-init User rules for /d; /^permit nopass '"\$U"'\$/d' /etc/doas.conf
cloud-init clean --logs --seed --machine-id
rm -f /etc/ssh/ssh_host_* /root/.ash_history /root/.bash_history
rm -f /etc/resolv.conf.bak
sync
EOF
}

remote() {
  local image="$1" force="$2"
  local vmid name file user family build_mem tpl_mem disk
  read -r vmid name file user family build_mem tpl_mem disk < <(profile "$image") || { log "imagem desconhecida: $image"; exit 2; }
  local img="${IMPORT_DIR}/${file}"
  [ -f "$img" ] || { log "imagem não encontrada: $img"; exit 1; }

  if qm status "$vmid" >/dev/null 2>&1; then
    if grep -q '^template: 1' "/etc/pve/qemu-server/${vmid}.conf" && [ "$force" != 1 ]; then
      log "template ${vmid} (${image}) já existe; use --force para recriar"
      return 0
    fi
    log "removendo a VM ${vmid} existente"
    qm stop "$vmid" >/dev/null 2>&1 || true
    qm destroy "$vmid" --purge 1 --destroy-unreferenced-disks 1
  fi
  if ping -c 1 -W 1 "$BUILD_IP" >/dev/null 2>&1; then log "o IP de build ${BUILD_IP} já está em uso"; exit 1; fi

  log "criando a VM ${vmid} (${name}) a partir de ${file}"
  qm create "$vmid" --name "$name" --memory "$build_mem" --cores 1 --ostype l26 \
    --net0 "virtio,bridge=${BRIDGE}" --scsihw virtio-scsi-pci --agent enabled=1 \
    --vga std --serial0 socket --pool "$POOL" --tags favo \
    --description "Favo: template ${image} (golden image), construído por scripts/pve/build-template.sh em $(date -Iseconds)"
  qm set "$vmid" --scsi0 "${STORAGE}:0,import-from=${img}" >/dev/null
  qm set "$vmid" --ide2 "${STORAGE}:cloudinit" --boot order=scsi0 >/dev/null
  [ "$disk" != - ] && qm resize "$vmid" scsi0 "$disk" >/dev/null
  # Chave do root do Proxmox para o SSH do build: a instalação cria a id_rsa; se não houver nenhuma, gera uma.
  local key=""
  for key in /root/.ssh/id_ed25519 /root/.ssh/id_rsa ""; do [ -n "$key" ] && [ -f "${key}.pub" ] && break; done
  if [ -z "$key" ]; then
    key=/root/.ssh/id_ed25519
    ssh-keygen -q -t ed25519 -N '' -f "$key"
    log "chave SSH do root criada em ${key}"
  fi
  # ciupgrade=0: o upgrade é feito explicitamente abaixo (no Alpine o do cloud-init falharia sem DNS, armadilha C1).
  qm set "$vmid" --ciuser "$user" --sshkeys "${key}.pub" \
    --ipconfig0 "ip=${BUILD_IP}/24,gw=${GATEWAY}" --nameserver 1.1.1.1 --ciupgrade 0 >/dev/null

  qm start "$vmid"
  wait_until 300 "SSH do build" ssh -n "${SSH_VM[@]}" "${user}@${BUILD_IP}" true
  ssh -n "${SSH_VM[@]}" "${user}@${BUILD_IP}" 'cloud-init status --wait >/dev/null; cloud-init status' >&2 || true

  local su=sudo; [ "$family" = alpine ] && su=doas
  log "provisionando (upgrade, qemu-guest-agent$( [ "$image" = alpine-desktop ] && echo ', XFCE'))"
  provision_script "$family" "$image" | ssh "${SSH_VM[@]}" "${user}@${BUILD_IP}" "${su} sh -s" >&2

  wait_until 120 "guest agent" qm agent "$vmid" ping
  log "limpeza (usuário do build, cloud-init, chaves de host)"
  guest_root "$vmid" "$(cleanup_script "$user")" >&2

  log "desligando"
  qm shutdown "$vmid" --timeout 180
  qm set "$vmid" --delete ciuser,sshkeys,ipconfig0,nameserver >/dev/null
  qm set "$vmid" --memory "$tpl_mem" >/dev/null
  qm template "$vmid"
  log "template ${vmid} (${image}) pronto: $(grep -E '^(scsi0|memory|ciupgrade|vga|serial0|agent):' "/etc/pve/qemu-server/${vmid}.conf" | tr '\n' ' ')"
}

if [ "${1:-}" = "--remote" ]; then
  remote "$2" "${3:-0}"
  exit 0
fi

# ─────────────────────────────── modo local (Windows / Git Bash) ───────────────────────────────
target="${1:-}"; shift || true
FORCE=0; TEST=1
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --no-test) TEST=0 ;;
    *) echo "opção desconhecida: $arg" >&2; exit 2 ;;
  esac
done
if [ "$target" = all ]; then list="$IMAGES"; else list="$target"; fi
for image in $list; do profile "$image" >/dev/null || { echo "uso: $0 <alpine|debian|ubuntu|alpine-desktop|all> [--force] [--no-test]" >&2; exit 2; }; done

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/../.."
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

ssh "${SSH_OPTS[@]}" "root@${PVE_HOST}" 'mkdir -p /root/favo'
scp -q "${SSH_OPTS[@]}" "$SELF" "root@${PVE_HOST}:/root/favo/build-template.sh"
for image in $list; do
  ssh "${SSH_OPTS[@]}" "root@${PVE_HOST}" "bash /root/favo/build-template.sh --remote ${image} ${FORCE}"
  if [ "$TEST" = 1 ]; then
    read -r vmid _ < <(profile "$image")
    node scripts/pve/test-template.mjs "$vmid"
  fi
done
