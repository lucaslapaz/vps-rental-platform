import type { Permission } from '@shared/constants/permissions';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { HexLoader } from '@/components/brand/HexLoader';
import { ForbiddenPage } from '@/features/errors/ForbiddenPage';
import { useAuth } from './useAuth';

/** Só para quem está logado: mostra o loader enquanto o /me responde; visitante vai para /login?next=… (§14.2). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isPending } = useAuth();
  const location = useLocation();
  if (isPending) return <HexLoader fullScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

/** Só para visitantes (login e cadastro): quem já está logado segue para o destino. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { user, isPending } = useAuth();
  if (isPending) return <HexLoader fullScreen />;
  if (user) return <Navigate to={safeNext(new URLSearchParams(window.location.search).get('next'))} replace />;
  return children;
}

/** Bloqueia a página sem a permissão. É só UX: a API também recusa (403). */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.permissions.includes(permission)) return <ForbiddenPage />;
  return children;
}

/** Aceita só caminhos internos no ?next= (evita redirecionamento aberto para outro site). */
export function safeNext(next: string | null | undefined): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}
