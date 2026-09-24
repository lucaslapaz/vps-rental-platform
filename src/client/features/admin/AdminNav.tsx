import type { Permission } from '@shared/constants/permissions';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useAuth } from '@/features/auth/useAuth';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: '/admin', key: 'overview', permission: 'admin:overview:read' },
  { to: '/admin/vps', key: 'vps', permission: 'admin:vps:read' },
  { to: '/admin/users', key: 'users', permission: 'admin:users:read' },
  { to: '/admin/roles', key: 'roles', permission: 'admin:users:read' },
] as const satisfies readonly { to: string; key: string; permission: Permission }[];

/** Páginas de administração que o usuário pode ver (cada uma pela sua permissão). */
export function useAdminLinks() {
  const { user } = useAuth();
  return LINKS.filter((l) => user?.permissions.includes(l.permission));
}

/** Navegação entre as páginas de administração (topo de cada uma). */
export function AdminNav() {
  const { t } = useTranslation('admin');
  const links = useAdminLinks();
  if (links.length < 2) return null;
  return (
    <nav aria-label={t('nav.label')} className="-mb-2 flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-[3px]" data-testid="admin-nav">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2',
              isActive && 'bg-background text-foreground shadow-sm',
            )
          }
        >
          {t(`nav.${l.key}`)}
        </NavLink>
      ))}
    </nav>
  );
}
