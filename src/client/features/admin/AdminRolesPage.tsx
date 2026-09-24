import { PERMISSION_KEYS, PERMISSIONS, type Permission } from '@shared/constants/permissions';
import { ROLE_KEY_PATTERN } from '@shared/schemas/admin';
import type { RoleDTO } from '@shared/types/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/features/auth/useAuth';
import { ApiError, api, apiGet } from '@/lib/api';
import { errorMessage, permissionLabel, roleLabel, validationMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AdminNav } from './AdminNav';

const GROUPS = ['account', 'vps', 'sshkey', 'billing', 'support', 'admin'] as const;
const groupOf = (p: Permission) => p.split(':')[0] as (typeof GROUPS)[number];
const sameSet = (a: Set<string>, b: readonly string[]) => a.size === b.length && b.every((p) => a.has(p));

/**
 * Administração → Roles (plano §9.7, Fase 10): grade de permissões × roles. As roles do sistema aparecem travadas (a
 * fonte da verdade é o código e o seed as reaplica); as criadas aqui são editadas na grade e salvas uma a uma.
 */
export function AdminRolesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const canManage = useCan('admin:roles:manage');
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: async () => (await apiGet<{ roles: RoleDTO[] }>('/admin/roles')).roles });
  /** Rascunho das roles editáveis que o admin mexeu (chave → permissões marcadas). */
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RoleDTO | null>(null);

  const list = roles.data ?? [];
  const byGroup = useMemo(() => GROUPS.map((g) => ({ group: g, permissions: PERMISSION_KEYS.filter((p) => groupOf(p) === g) })), []);
  const checked = (role: RoleDTO) => drafts[role.key] ?? new Set(role.permissions);
  const dirty = list.filter((r) => drafts[r.key] && !sameSet(drafts[r.key] as Set<string>, r.permissions));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });

  const toggle = (role: RoleDTO, permission: string, on: boolean) =>
    setDrafts((d) => {
      const next = new Set(d[role.key] ?? role.permissions);
      if (on) next.add(permission);
      else next.delete(permission);
      return { ...d, [role.key]: next };
    });
  const discard = (key: string) =>
    setDrafts((d) => {
      const { [key]: _, ...rest } = d;
      return rest;
    });

  const save = useMutation({
    mutationFn: (role: RoleDTO) =>
      api('PUT', `/admin/roles/${role.key}`, {
        name: role.name,
        description: role.description ?? undefined,
        permissions: [...(drafts[role.key] ?? [])],
      }),
    onSuccess: async (_, role) => {
      toast.success(t('admin:roles.saved', { name: role.name }));
      await refresh();
      discard(role.key);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (role: RoleDTO) => api('DELETE', `/admin/roles/${role.key}`),
    onSuccess: async (_, role) => {
      toast.success(t('admin:roles.deleted', { name: role.name }));
      discard(role.key);
      await refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setToDelete(null),
  });

  return (
    <div className="flex flex-col gap-6">
      <AdminNav />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">{t('admin:roles.title')}</h1>
          <p className="max-w-3xl text-muted-foreground">{t('admin:roles.subtitle')}</p>
        </div>
        {canManage && !creating ? (
          <Button onClick={() => setCreating(true)} data-testid="role-new">
            <Plus />
            {t('admin:roles.new')}
          </Button>
        ) : null}
      </header>

      {creating ? <NewRoleForm roles={list} onDone={() => setCreating(false)} onCreated={refresh} /> : null}

      <Card>
        <CardContent className="overflow-x-auto">
          {roles.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="roles-grid">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 text-left font-medium text-muted-foreground">
                    {t('admin:roles.permission')}
                  </th>
                  {list.map((r) => (
                    <th key={r.key} scope="col" className="min-w-32 px-2 py-2 text-center align-bottom font-medium" data-role={r.key}>
                      <span className="flex items-center justify-center gap-1">
                        {r.isSystem ? <Lock aria-label={t('admin:roles.system')} className="size-3.5 text-muted-foreground" /> : null}
                        {roleLabel(r.key, r.name)}
                      </span>
                      <span className="block font-mono text-xs font-normal text-muted-foreground">{r.key}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t('admin:roles.users', { count: r.userCount })}
                      </span>
                      {canManage && !r.isSystem ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 text-xs"
                          onClick={() => setToDelete(r)}
                          disabled={r.userCount > 0}
                          title={r.userCount > 0 ? t('admin:roles.inUse') : undefined}
                          data-testid="role-delete"
                        >
                          <Trash2 />
                          {t('admin:roles.delete')}
                        </Button>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byGroup.map(({ group, permissions }) => (
                  <GroupRows key={group} label={t(`admin:roles.groups.${group}`)} colSpan={list.length + 1}>
                    {permissions.map((p) => (
                      <tr key={p} className="border-b last:border-0 hover:bg-muted/40">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          <span className="block">{permissionLabel(p, PERMISSIONS[p])}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{p}</span>
                        </th>
                        {list.map((r) => {
                          const editable = canManage && !r.isSystem;
                          const on = checked(r).has(p);
                          return (
                            <td key={r.key} className="px-2 py-2 text-center">
                              <Checkbox
                                checked={on}
                                disabled={!editable}
                                onCheckedChange={(v) => toggle(r, p, v === true)}
                                aria-label={`${roleLabel(r.key, r.name)}: ${permissionLabel(p, PERMISSIONS[p])}`}
                                className={cn(!editable && 'opacity-70')}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {dirty.length ? (
        <div
          className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-md"
          role="status"
          data-testid="roles-unsaved"
        >
          <span className="text-sm font-medium">{t('admin:roles.unsaved')}</span>
          <span className="flex-1" />
          {dirty.map((r) => (
            <span key={r.key} className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => discard(r.key)}>
                {t('admin:roles.discard')}
              </Button>
              <Button size="sm" onClick={() => save.mutate(r)} disabled={save.isPending} data-testid="role-save">
                {t('admin:roles.save', { name: r.name })}
              </Button>
            </span>
          ))}
        </div>
      ) : null}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin:roles.deleteTitle', { name: toDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('admin:roles.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('admin:roles.form.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => toDelete && remove.mutate(toDelete)} disabled={remove.isPending}>
              {t('admin:roles.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupRows({ label, colSpan, children }: { label: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={colSpan}
          className="pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </th>
      </tr>
      {children}
    </>
  );
}

/** Formulário de nova role: chave, nome, descrição e (opcional) as permissões de outra role como ponto de partida. */
function NewRoleForm({ roles, onDone, onCreated }: { roles: RoleDTO[]; onDone: () => void; onCreated: () => Promise<unknown> }) {
  const { t } = useTranslation(['admin', 'errors']);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('none');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const create = useMutation({
    mutationFn: () =>
      api('POST', '/admin/roles', {
        key,
        name,
        description: description || undefined,
        permissions: roles.find((r) => r.key === copyFrom)?.permissions ?? [],
      }),
    onSuccess: async () => {
      toast.success(t('admin:roles.created', { name }));
      await onCreated();
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        const fields: Record<string, string | undefined> = {};
        for (const d of err.details as { path: string; message: string }[]) fields[d.path] = validationMessage(d.message);
        setErrors(fields);
      } else toast.error(errorMessage(err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string | undefined> = {};
    if (!ROLE_KEY_PATTERN.test(key)) local.key = validationMessage('roleKey');
    if (name.trim().length < 2) local.name = validationMessage('nameTooShort');
    setErrors(local);
    if (!Object.values(local).some(Boolean)) create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin:roles.form.title')}</CardTitle>
        <CardDescription>{t('admin:roles.form.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate data-testid="role-form">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-key">{t('admin:roles.form.key')}</Label>
            <Input
              id="role-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              className="font-mono"
              aria-invalid={errors.key ? true : undefined}
              aria-describedby="role-key-hint"
              autoComplete="off"
            />
            <p id="role-key-hint" className={cn('text-xs', errors.key ? 'text-destructive' : 'text-muted-foreground')}>
              {errors.key ?? t('admin:roles.form.keyHint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">{t('admin:roles.form.name')}</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">{t('admin:roles.form.descriptionLabel')}</Label>
            <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-copy">{t('admin:roles.form.copyFrom')}</Label>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger id="role-copy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('admin:roles.form.none')}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {roleLabel(r.key, r.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={create.isPending} data-testid="role-create">
              {t('admin:roles.form.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t('admin:roles.form.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
