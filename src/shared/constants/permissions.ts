/**
 * Fonte da verdade das permissões (plano §9.7). O seed sincroniza a tabela `permissions` com esta lista, e o tipo
 * `Permission` impede usar uma permissão inexistente no código. O código verifica PERMISSÕES, nunca o nome da role.
 */
export const PERMISSIONS = {
  'account:manage:own': 'Gerenciar a própria conta (perfil, senha, sessões)',

  'vps:read:own': 'Ver as próprias VPS',
  'vps:create': 'Criar VPS',
  'vps:manage:own': 'Ligar, desligar, reiniciar e alterar as próprias VPS',
  'vps:delete:own': 'Excluir as próprias VPS',
  'vps:console:own': 'Abrir o console das próprias VPS',

  'sshkey:manage:own': 'Gerenciar as próprias chaves SSH',

  'billing:read:own': 'Ver as próprias faturas',
  'billing:pay:own': 'Pagar as próprias faturas',

  'support:conversation:create': 'Abrir conversas com o suporte',
  'support:conversation:read:own': 'Ver as próprias conversas com o suporte',
  'support:queue:read': 'Ver a fila de atendimento',
  'support:conversation:claim': 'Assumir conversas da fila',
  'support:conversation:reply': 'Responder conversas assumidas',
  'support:conversation:close': 'Encerrar ou devolver conversas assumidas',

  'admin:overview:read': 'Ver a visão geral administrativa',
  'admin:users:read': 'Listar usuários',
  'admin:users:assign-role': 'Trocar a role de um usuário',
  'admin:vps:read': 'Ver todas as VPS (somente leitura, sem console)',
  'admin:roles:manage': 'Editar as permissões de cada role',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_KEYS = ['customer', 'support_agent', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles do sistema e as suas permissões (tabela do plano §8.4). O técnico NÃO tem vps:*, billing:* nem sshkey:*. */
export const SYSTEM_ROLES: Record<RoleKey, { name: string; description: string; permissions: readonly Permission[] }> = {
  customer: {
    name: 'Cliente',
    description: 'Contrata e gerencia as próprias VPS',
    permissions: [
      'account:manage:own',
      'vps:read:own',
      'vps:create',
      'vps:manage:own',
      'vps:delete:own',
      'vps:console:own',
      'sshkey:manage:own',
      'billing:read:own',
      'billing:pay:own',
      'support:conversation:create',
      'support:conversation:read:own',
    ],
  },
  support_agent: {
    name: 'Técnico de suporte',
    description: 'Atende a fila de suporte pelo chat (sem acesso às VPS nem às faturas)',
    permissions: [
      'account:manage:own',
      'support:queue:read',
      'support:conversation:claim',
      'support:conversation:reply',
      'support:conversation:close',
    ],
  },
  admin: {
    name: 'Administrador',
    description: 'Administra usuários e roles; vê as VPS em modo somente leitura',
    permissions: [
      'account:manage:own',
      'support:queue:read',
      'support:conversation:claim',
      'support:conversation:reply',
      'support:conversation:close',
      'admin:overview:read',
      'admin:users:read',
      'admin:users:assign-role',
      'admin:vps:read',
      'admin:roles:manage',
    ],
  },
};
