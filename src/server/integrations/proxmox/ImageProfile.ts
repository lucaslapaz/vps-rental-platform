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

const PROFILES: Record<ImageProfile['family'], ImageProfile> = {
  alpine: {
    family: 'alpine',
    sshdDropIn: SSHD_DROP_IN,
    reloadSshd: ['sh', '-c', 'sshd -t && rc-service sshd reload'],
    unlockForKeyLogin: UNLOCK_FOR_KEY_LOGIN,
  },
  // Debian: ssh.service habilitado. Ubuntu 24.04: ativado por socket (o serviço pode nem estar rodando): try-reload-or-restart.
  debian: { family: 'debian', sshdDropIn: SSHD_DROP_IN, reloadSshd: ['sh', '-c', 'sshd -t && systemctl try-reload-or-restart ssh'] },
  ubuntu: { family: 'ubuntu', sshdDropIn: SSHD_DROP_IN, reloadSshd: ['sh', '-c', 'sshd -t && systemctl try-reload-or-restart ssh'] },
};

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
