#!/usr/bin/env bash
# Baixa as imagens cloud oficiais dos templates para /var/lib/vz/import/ no Proxmox e confere os checksums publicados.
#
# Uso (na máquina de desenvolvimento, Git Bash, na raiz do repositório):   scripts/pve/download-images.sh
#
# Idempotente: arquivo já baixado com o checksum certo não é baixado de novo. Se o checksum publicado mudou (o Debian
# atualiza a imagem "latest"), baixa a versão nova. Os nomes dos arquivos precisam bater com o profile() do
# build-template.sh. Sem o checksum conferido, o script para com erro.
#
# Variáveis: PVE_HOST (padrão 192.168.56.10).
set -euo pipefail

PVE_HOST="${PVE_HOST:-192.168.56.10}"

ssh -o BatchMode=yes -o ConnectTimeout=10 "root@${PVE_HOST}" 'bash -s' <<'EOS'
set -euo pipefail
DIR=/var/lib/vz/import
mkdir -p "$DIR"
cd "$DIR"
log() { echo "[imagens] $*" >&2; }

# image <arquivo> <url do arquivo> <url dos checksums> <sha256|sha512> <nome local dos checksums>
image() {
  local file="$1" url="$2" sums_url="$3" algo="$4" sums="$5" expected
  wget -q -O "$sums" "$sums_url"
  # Linha "hash  arquivo" (Debian), "hash *arquivo" (Ubuntu) ou só o hash (Alpine: um arquivo por imagem).
  expected=$(awk -v f="$file" '($2 == f || $2 == "*" f || NF == 1) { print $1; exit }' "$sums")
  [ -n "$expected" ] || { log "${file}: não achei o checksum em ${sums_url}"; exit 1; }
  if [ -s "$file" ] && [ "$("${algo}sum" "$file" | cut -d' ' -f1)" = "$expected" ]; then
    log "${file}: já baixado, ${algo} confere"
    return
  fi
  [ -e "$file" ] && log "${file}: diferente do publicado, baixando de novo"
  log "${file}: baixando (pode levar alguns minutos)"
  wget -q -O "${file}.part" "$url"
  if [ "$("${algo}sum" "${file}.part" | cut -d' ' -f1)" != "$expected" ]; then
    rm -f "${file}.part"
    log "${file}: o ${algo} NÃO confere com o publicado; nada foi gravado"
    exit 1
  fi
  mv "${file}.part" "$file"
  log "${file}: baixado, ${algo} confere"
}

ALPINE=generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2
image "$ALPINE" "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/${ALPINE}" \
  "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/${ALPINE}.sha512" sha512 "${ALPINE}.sha512"

DEBIAN=debian-13-genericcloud-amd64.qcow2
image "$DEBIAN" "https://cloud.debian.org/images/cloud/trixie/latest/${DEBIAN}" \
  "https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS" sha512 debian-13.SHA512SUMS

UBUNTU=ubuntu-24.04-minimal-cloudimg-amd64.img
image "$UBUNTU" "https://cloud-images.ubuntu.com/minimal/releases/noble/release/${UBUNTU}" \
  "https://cloud-images.ubuntu.com/minimal/releases/noble/release/SHA256SUMS" sha256 ubuntu-24.04-minimal.SHA256SUMS

log "pronto: $(df -h "$DIR" | awk 'NR == 2 { print $4 }') livres em ${DIR}"
EOS
