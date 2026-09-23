import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { AccountPage } from '@/features/account/AccountPage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { RequireAuth, RequireGuest, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { BillingPage } from '@/features/billing/BillingPage';
import { CheckoutPage } from '@/features/billing/CheckoutPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { RouteErrorPage } from '@/features/errors/RouteErrorPage';
import { HomeRoute } from '@/features/home/HomeRoute';
import { AgentPage } from '@/features/support/AgentPage';
import { SupportPage } from '@/features/support/SupportPage';
import { CreateVpsPage } from '@/features/vps/CreateVpsPage';
import { VpsDetailPage } from '@/features/vps/detail/VpsDetailPage';
import { VpsListPage } from '@/features/vps/VpsListPage';

// Rotas do plano §14.1; as demais entram nas fases seguintes.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomeRoute /> },
      {
        path: 'login',
        element: (
          <RequireGuest>
            <LoginPage />
          </RequireGuest>
        ),
      },
      {
        path: 'register',
        element: (
          <RequireGuest>
            <RegisterPage />
          </RequireGuest>
        ),
      },
      {
        path: 'vps',
        element: (
          <RequireAuth>
            <RequirePermission permission="vps:read:own">
              <VpsListPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'vps/new',
        element: (
          <RequireAuth>
            <RequirePermission permission="vps:create">
              <CreateVpsPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'vps/:id',
        element: (
          <RequireAuth>
            <RequirePermission permission="vps:read:own">
              <VpsDetailPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'support',
        element: (
          <RequireAuth>
            <RequirePermission permission="support:conversation:create">
              <SupportPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'agent',
        element: (
          <RequireAuth>
            <RequirePermission permission="support:queue:read">
              <AgentPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'checkout/:invoiceId',
        element: (
          <RequireAuth>
            <RequirePermission permission="billing:pay:own">
              <CheckoutPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'billing',
        element: (
          <RequireAuth>
            <RequirePermission permission="billing:read:own">
              <BillingPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <RequireAuth>
            <RequirePermission permission="admin:users:read">
              <AdminUsersPage />
            </RequirePermission>
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
