/**
 * Comandos próprios de cada família de imagem (padrão Strategy, plano §10.6). Só o backend executa estes comandos
 * pelo guest agent, e eles são FIXOS: nenhum texto vindo do usuário entra aqui.
 *
 * Conferido nas três imagens (revisão 11): o `sshd_config` faz `Include /etc/ssh/sshd_config.d/*.conf` ANTES das outras
 * diretivas e, no sshd, o primeiro valor lido vence. O Alpine traz `50-cloud-init.conf` e o Ubuntu
 * `60-cloudimg-settings.conf` (ambos com `PasswordAuthentication no`), por isso o arquivo da Favo é `01-favo.conf`.
 */
export interface ImageProfile {
  family: 'alpine' | 'debian' | 'ubuntu';
  sshdDropIn: string;
  /** Valida a configuração e recarrega o sshd. */
  reloadSshd: readonly string[];
  /**
   * Conta criada só com chave: o cloud-init a deixa bloqueada (`!` no shadow). O sshd do Alpine é compilado SEM PAM e
   * recusa até login por chave de conta bloqueada ("account is locked"); Debian/Ubuntu usam PAM e não precisam disto.
   * O comando troca `!` por `*` (nenhuma senha válida, mas não bloqueada), só se estiver bloqueada. O usuário vai como
   * argumento posicional ($1), nunca interpolado.
   */
  unlockForKeyLogin?: readonly string[];
}

const UNLOCK_FOR_KEY_LOGIN = [
  'sh',
  '-c',
  `set -e; s=$(awk -F: -v u="$1" '$1 == u { print $2 }' /etc/shadow); case "$s" in "!"*) usermod -p "*" "$1" ;; esac`,
  'favo-unlock',
] as const;

const SSHD_DROP_IN = '/etc/ssh/sshd_config.d/01-favo.conf';

const SYSTEMD_SSHD_RELOAD = ['sh', '-c', 'install -d -m 0755 /run/sshd && sshd -t && systemctl try-reload-or-restart ssh'] as const;

const PROFILES: Record<ImageProfile['family'], ImageProfile> = {
  alpine: {
    family: 'alpine',
    sshdDropIn: SSHD_DROP_IN,
    reloadSshd: ['sh', '-c', 'sshd -t && rc-service sshd reload'],
    unlockForKeyLogin: UNLOCK_FOR_KEY_LOGIN,
  },
  // Debian: ssh.service habilitado. Ubuntu 24.04: ativado por socket; antes da 1ª conexão o serviço nunca rodou e o
  // /run/sshd (RuntimeDirectory do serviço) não existe, e o `sshd -t` falha com "Missing privilege separation
  // directory" (CLAUDE.md C24). Por isso o diretório é criado antes, com o mesmo modo do serviço.
  debian: { family: 'debian', sshdDropIn: SSHD_DROP_IN, reloadSshd: SYSTEMD_SSHD_RELOAD },
  ubuntu: { family: 'ubuntu', sshdDropIn: SSHD_DROP_IN, reloadSshd: SYSTEMD_SSHD_RELOAD },
};

/**
 * Comandos comuns às três famílias (testados no laboratório na revisão 14, CLAUDE.md C23). O cloud-init roda como
 * "nova instância" sempre que a config de cloud-init da VM muda (instance-id = sha1 do user-data + rede, no
 * `Cloudinit.pm`); renomear a VM mudaria o hostname do user-data e, no próximo boot, as chaves de host SSH seriam
 * regeneradas. Por isso o cloud-init é CONGELADO no fim do provisionamento, e renomear/aumentar o disco passam a ser
 * feitos pelo agente.
 */
export const FREEZE_CLOUD_INIT = ['touch', '/etc/cloud/cloud-init.disabled'] as const;

/** Novo hostname em $1 (validado como rótulo DNS antes): /etc/hostname, hostname e a linha do /etc/hosts. */
export const SET_HOSTNAME = [
  'sh',
  '-c',
  'set -e; old=$(hostname); printf "%s\\n" "$1" > /etc/hostname; hostname "$1"; if grep -qw "$old" /etc/hosts; then sed -i "s/\\b$old\\b/$1/g" /etc/hosts; fi',
  'favo-hostname',
] as const;

/**
 * Expande a raiz até o fim do disco com a VM ligada: `growpart` se a raiz for uma partição (Debian/Ubuntu; no Ubuntu o
 * /proc/mounts mostra "/dev/root", daí o findmnt) e `resize2fs` (ext4 cresce online). No Alpine a raiz é o próprio
 * /dev/sda. growpart sai com 1 quando não há o que crescer.
 */
export const GROW_ROOT_FS = [
  'sh',
  '-c',
  'set -e; src=$(findmnt -n -o SOURCE / 2>/dev/null || awk \x27$2 == "/" { print $1 }\x27 /proc/mounts | tail -n 1); ' +
    // biome-ignore lint/suspicious/noTemplateCurlyInString: é a expansão ${var#prefixo} do shell, não um template JS
    'case "$src" in /dev/sd[a-z][0-9]*|/dev/vd[a-z][0-9]*) disk=$(echo "$src" | sed "s/[0-9]*$//"); part=${src#"$disk"}; ' +
    'growpart "$disk" "$part" || [ $? -eq 1 ] ;; esac; resize2fs "$src"',
  'favo-grow',
] as const;

export function imageProfile(family: string): ImageProfile {
  const profile = PROFILES[family as ImageProfile['family']];
  if (!profile) throw new Error(`família de imagem sem ImageProfile: ${family}`);
  return profile;
}

/** Conteúdo do drop-in do sshd. O login SSH como root fica SEMPRE desativado (plano §14.5). */
export function sshdPolicy(passwordAuth: boolean): string {
  return [
    '# Gerenciado pelo painel da Favo: alterações manuais podem ser sobrescritas.',
    `PasswordAuthentication ${passwordAuth ? 'yes' : 'no'}`,
    'KbdInteractiveAuthentication no',
    'PermitRootLogin no',
    '',
  ].join('\n');
}
