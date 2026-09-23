import type { AdminUserDTO, RoleDTO } from '@shared/types/auth';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth, useCan } from '@/features/auth/useAuth';
import { api, apiGet } from '@/lib/api';
import { errorMessage, roleLabel } from '@/lib/errors';

interface PendingChange {
  user: AdminUserDTO;
  role: string;
}

/** Administração → Usuários (plano §9.7): lista, busca e troca de role, com confirmação. */
export function AdminUsersPage() {
  const { t, i18n } = useTranslation(['admin', 'common', 'errors']);
  const { user: me } = useAuth();
  const canAssign = useCan('admin:users:assign-role');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [pending, setPending] = useState<PendingChange | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => apiGet<{ users: AdminUserDTO[] }>(`/admin/users${query ? `?query=${encodeURIComponent(query)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => apiGet<{ roles: RoleDTO[] }>('/admin/roles') });

  const changeRole = useMutation({
    mutationFn: ({ user, role }: PendingChange) => api('PATCH', `/admin/users/${user.id}/role`, { role }),
    onSuccess: async (_data, { user }) => {
      toast.success(t('admin:users.changed', { name: user.name }));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setPending(null),
  });

  const labelFor = (key: string) => roleLabel(key, roles.data?.roles.find((r) => r.key === key)?.name);
  const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">{t('admin:users.title')}</h1>
          <p className="text-muted-foreground">{t('admin:users.subtitle')}</p>
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label={t('admin:users.searchLabel')}
            placeholder={t('admin:users.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </header>

      <Card>
        <CardContent>
          {users.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table data-testid="admin-users-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:users.name')}</TableHead>
                  <TableHead>{t('admin:users.email')}</TableHead>
                  <TableHead className="w-56">{t('admin:users.role')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin:users.createdAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data?.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t('admin:users.empty')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {users.data?.users.map((u) => {
                  const isMe = u.id === me?.id;
                  return (
                    <TableRow key={u.id} data-email={u.email}>
                      <TableCell className="font-medium">
                        {u.name}
                        {isMe ? (
                          <Badge variant="secondary" className="ml-2">
                            {t('admin:users.you')}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell>
                        {canAssign && !isMe ? (
                          <Select value={u.role} onValueChange={(role) => role !== u.role && setPending({ user: u, role })}>
                            <SelectTrigger size="sm" className="w-full" aria-label={`${t('admin:users.role')}: ${u.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roles.data?.roles.map((r) => (
                                <SelectItem key={r.key} value={r.key}>
                                  {labelFor(r.key)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          labelFor(u.role)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{dateFmt.format(new Date(u.createdAt))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !changeRole.isPending && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin:users.confirmTitle', { name: pending?.user.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin:users.confirmDescription', { name: pending?.user.name ?? '', role: pending ? labelFor(pending.role) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changeRole.isPending}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={changeRole.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pending) changeRole.mutate(pending);
              }}
            >
              {t('common:actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
