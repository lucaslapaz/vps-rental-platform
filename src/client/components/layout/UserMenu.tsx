import { useQueryClient } from '@tanstack/react-query';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdminLinks } from '@/features/admin/AdminNav';
import { useAuth } from '@/features/auth/useAuth';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Menu do usuário logado; para visitantes, os botões Entrar / Criar conta. */
export function UserMenu() {
  const { t } = useTranslation(['common', 'errors']);
  const { user, isPending } = useAuth();
  /** Primeira página de administração que o usuário pode ver (visão geral, VPS, usuários ou roles). */
  const adminHome = useAdminLinks()[0]?.to;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (isPending) return null;
  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link to="/login">{t('nav.login')}</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/register">{t('nav.register')}</Link>
        </Button>
      </div>
    );
  }

  const logout = async () => {
    try {
      await api('POST', '/auth/logout');
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    queryClient.clear();
    navigate('/', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.userMenu')} data-testid="user-menu" className="rounded-full">
          <Avatar size="sm">
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">{initials(user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium text-foreground">{user.name}</span>
          <span className="truncate font-mono text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserRound />
            {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        {adminHome ? (
          <DropdownMenuItem asChild>
            <Link to={adminHome} data-testid="menu-admin">
              <ShieldCheck />
              {t('nav.admin')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} data-testid="menu-logout">
          <LogOut />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
