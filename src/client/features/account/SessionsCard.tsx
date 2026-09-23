import type { SessionDTO } from '@shared/types/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, apiGet } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Resumo legível do user agent (navegador + sistema), sem biblioteca. */
function describeAgent(ua: string | null, fallback: string) {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

export function SessionsCard() {
  const { t, i18n } = useTranslation(['account', 'errors']);
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['account', 'sessions'], queryFn: () => apiGet<{ sessions: SessionDTO[] }>('/account/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api('DELETE', `/account/sessions/${id}`),
    onSuccess: async () => {
      toast.success(t('account:sessions.revoked'));
      await queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">{t('account:sessions.title')}</CardTitle>
        <CardDescription>{t('account:sessions.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Table data-testid="sessions-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('account:sessions.device')}</TableHead>
                <TableHead>{t('account:sessions.ip')}</TableHead>
                <TableHead>{t('account:sessions.lastSeen')}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data?.sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {describeAgent(s.userAgent, t('account:sessions.unknownDevice'))}
                    {s.current ? (
                      <Badge variant="secondary" className="ml-2">
                        {t('account:sessions.current')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.ip ?? '—'}</TableCell>
                  <TableCell>{dateFmt.format(new Date(s.lastSeenAt))}</TableCell>
                  <TableCell>
                    {s.current ? null : (
                      <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                        {t('account:sessions.revoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
