import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { onUnauthenticated } from '@/lib/api';
import '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/router';
import '@/styles/index.css';

// Sessão expirada ou revogada (ex.: a role mudou): limpa o cache e volta para o login, lembrando onde o usuário estava.
onUnauthenticated(() => {
  queryClient.clear();
  const here = window.location.pathname + window.location.search;
  void router.navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
});

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
