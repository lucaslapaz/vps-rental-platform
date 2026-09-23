import { HexLoader } from '@/components/brand/HexLoader';
import { useAuth } from '@/features/auth/useAuth';
import { DashboardPage } from './DashboardPage';
import { HomePage } from './HomePage';

/** `/`: página de apresentação para visitantes e painel para quem está logado. */
export function HomeRoute() {
  const { user, isPending } = useAuth();
  if (isPending) return <HexLoader />;
  return user ? <DashboardPage /> : <HomePage />;
}
