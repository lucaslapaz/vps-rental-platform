import type { OsTemplateDTO } from '@shared/types/catalog';
import { KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { validationMessage } from '@/lib/errors';
import { Choice } from './Choice';
import { useSshKeys } from './queries';

export type AccessMethod = 'key' | 'password' | 'both';

/** Força da senha (0–4): comprimento e variedade de caracteres. É só orientação; o mínimo real é 10 caracteres. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}
const STRENGTH = ['weak', 'weak', 'fair', 'good', 'strong'] as const;

/**
 * Estado da seção "Acesso" (método, usuário, chaves, senha, SSH por senha, senha root), usado na criação e na
 * reinstalação da VPS. `values` é a parte do corpo da API; `localErrors` são as regras que o schema não cobre.
 */
export function useAccessForm() {
  const [method, setMethod] = useState<AccessMethod>('key');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [keyIds, setKeyIds] = useState<number[]>([]);
  const [newKey, setNewKey] = useState('');
  const [saveKey, setSaveKey] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [sshPasswordAuth, setSshPasswordAuth] = useState(false);
  const [rootEnabled, setRootEnabled] = useState(false);
  const [rootPassword, setRootPassword] = useState('');

  /** Padrão do "login SSH por senha": ligado se o método for só senha, desligado se houver chave (§14.5). */
  const chooseMethod = (m: AccessMethod) => {
    setMethod(m);
    setSshPasswordAuth(m === 'password');
  };

  /** Trocar de imagem: usuário padrão (se o cliente não mexeu), senha obrigatória e senha root conforme a imagem. */
  const applyTemplate = (tpl: OsTemplateDTO) => {
    if (!usernameTouched) setUsername(tpl.defaultUser);
    if (tpl.requiresPassword && method === 'key') chooseMethod('both');
    if (!tpl.supportsRootPassword) setRootEnabled(false);
  };

  const usesKey = method !== 'password';
  const usesPassword = method !== 'key';

  const values = useMemo(
    () => ({
      username,
      sshKeyIds: usesKey ? keyIds : [],
      ...(usesKey && newKey.trim() ? { newSshKey: { publicKey: newKey, save: saveKey } } : {}),
      ...(usesPassword && password ? { password } : {}),
      sshPasswordAuth: usesPassword && sshPasswordAuth,
      ...(rootEnabled && rootPassword ? { rootPassword } : {}),
    }),
    [username, usesKey, keyIds, newKey, saveKey, usesPassword, password, sshPasswordAuth, rootEnabled, rootPassword],
  );

  const localErrors = (template: OsTemplateDTO | undefined) => {
    const next: Record<string, string> = {};
    if (usesPassword && password !== passwordConfirm) next.passwordConfirm = 'passwordMismatch';
    if (template?.requiresPassword && !password) next.password = 'required';
    if (usesKey && keyIds.length === 0 && !newKey.trim() && !usesPassword) next.newSshKey = 'authMethodRequired';
    return next;
  };

  return {
    method,
    chooseMethod,
    username,
    setUsername: (v: string) => {
      setUsername(v);
      setUsernameTouched(true);
    },
    keyIds,
    setKeyIds,
    newKey,
    setNewKey,
    saveKey,
    setSaveKey,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
    sshPasswordAuth,
    setSshPasswordAuth,
    rootEnabled,
    setRootEnabled,
    rootPassword,
    setRootPassword,
    usesKey,
    usesPassword,
    applyTemplate,
    values,
    localErrors,
  };
}

export type AccessForm = ReturnType<typeof useAccessForm>;

/** Campos da seção "Acesso" (plano §14.5). `errors` são chaves de validação por caminho (ex.: "password"). */
export function AccessFields({ form, template, errors }: { form: AccessForm; template?: OsTemplateDTO; errors: Record<string, string> }) {
  const { t } = useTranslation(['vps', 'errors']);
  const savedKeys = useSshKeys();
  const err = (path: string) => validationMessage(errors[path]);
  const score = passwordScore(form.password);

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel>{t('vps:create.auth.method')}</FieldLabel>
        <div role="radiogroup" aria-label={t('vps:create.auth.method')} className="grid gap-3 sm:grid-cols-3">
          {(['key', 'password', 'both'] as const).map((m) => (
            <Choice
              key={m}
              selected={form.method === m}
              disabled={m === 'key' && template?.requiresPassword}
              onSelect={() => form.chooseMethod(m)}
              testId={`method-${m}`}
            >
              <span className="font-medium">
                {t(
                  m === 'key'
                    ? 'vps:create.auth.methodKey'
                    : m === 'password'
                      ? 'vps:create.auth.methodPassword'
                      : 'vps:create.auth.methodBoth',
                )}
              </span>
              {m === 'key' ? <span className="text-xs text-muted-foreground">{t('vps:create.auth.methodKeyHint')}</span> : null}
            </Choice>
          ))}
        </div>
        {template?.requiresPassword ? <FieldDescription>{t('vps:create.auth.passwordRequired')}</FieldDescription> : null}
        {err('password') && !form.usesPassword ? <FieldError>{err('password')}</FieldError> : null}
      </Field>

      <Field data-invalid={Boolean(err('username')) || undefined} className="max-w-sm">
        <FieldLabel htmlFor="vps-username">{t('vps:create.auth.username')}</FieldLabel>
        <Input
          id="vps-username"
          className="font-mono"
          value={form.username}
          onChange={(e) => form.setUsername(e.target.value.toLowerCase())}
          aria-invalid={Boolean(err('username')) || undefined}
        />
        {err('username') ? (
          <FieldError>{err('username')}</FieldError>
        ) : (
          <FieldDescription>{t('vps:create.auth.usernameHint', { sudo: template?.sudoCommand ?? 'sudo' })}</FieldDescription>
        )}
      </Field>

      {form.usesKey ? (
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t('vps:create.auth.savedKeys')}</FieldLabel>
            {savedKeys.data?.length ? (
              <div className="flex flex-col gap-2">
                {savedKeys.data.map((k) => (
                  <label key={k.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm" htmlFor={`key-${k.id}`}>
                    <Checkbox
                      id={`key-${k.id}`}
                      checked={form.keyIds.includes(k.id)}
                      onCheckedChange={(c) => form.setKeyIds((ids) => (c ? [...ids, k.id] : ids.filter((i) => i !== k.id)))}
                    />
                    <KeyRound className="size-4 text-link" aria-hidden />
                    <span className="font-medium">{k.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{k.fingerprint}</span>
                  </label>
                ))}
              </div>
            ) : (
              <FieldDescription>{t('vps:create.auth.noSavedKeys')}</FieldDescription>
            )}
          </Field>
          <Field data-invalid={Boolean(err('newSshKey.publicKey') || err('newSshKey')) || undefined}>
            <FieldLabel htmlFor="vps-newkey">{t('vps:create.auth.newKey')}</FieldLabel>
            <Textarea
              id="vps-newkey"
              rows={3}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={t('vps:create.auth.newKeyPlaceholder')}
              value={form.newKey}
              onChange={(e) => form.setNewKey(e.target.value)}
            />
            {err('newSshKey.publicKey') || err('newSshKey') ? (
              <FieldError>{err('newSshKey.publicKey') ?? err('newSshKey')}</FieldError>
            ) : null}
            {form.newKey.trim() ? (
              <label className="flex items-center gap-2 text-sm" htmlFor="vps-savekey">
                <Checkbox id="vps-savekey" checked={form.saveKey} onCheckedChange={(c) => form.setSaveKey(c === true)} />
                {t('vps:create.auth.saveKey')}
              </label>
            ) : null}
          </Field>
        </div>
      ) : null}

      {form.usesPassword ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(err('password')) || undefined}>
            <FieldLabel htmlFor="vps-password">{t('vps:create.auth.password')}</FieldLabel>
            <Input
              id="vps-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => form.setPassword(e.target.value)}
            />
            {err('password') ? <FieldError>{err('password')}</FieldError> : null}
            <div className="flex items-center gap-2" aria-live="polite">
              <Progress value={(score / 4) * 100} className="h-1.5" aria-label={t('vps:create.auth.strength.label')} />
              <span className="w-20 text-right text-xs text-muted-foreground">
                {form.password ? t(`vps:create.auth.strength.${STRENGTH[score] ?? 'weak'}`) : ''}
              </span>
            </div>
          </Field>
          <Field data-invalid={Boolean(err('passwordConfirm')) || undefined}>
            <FieldLabel htmlFor="vps-password2">{t('vps:create.auth.passwordConfirm')}</FieldLabel>
            <Input
              id="vps-password2"
              type="password"
              autoComplete="new-password"
              value={form.passwordConfirm}
              onChange={(e) => form.setPasswordConfirm(e.target.value)}
            />
            {err('passwordConfirm') ? <FieldError>{err('passwordConfirm')}</FieldError> : null}
          </Field>
          <label className="flex items-start gap-3 sm:col-span-2" htmlFor="vps-sshpass">
            <Switch id="vps-sshpass" checked={form.sshPasswordAuth} onCheckedChange={form.setSshPasswordAuth} />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t('vps:create.auth.sshPasswordAuth')}</span>
              <span className="text-xs text-muted-foreground">{t('vps:create.auth.sshPasswordAuthHint')}</span>
            </span>
          </label>
        </div>
      ) : null}

      {template?.supportsRootPassword ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3" htmlFor="vps-root">
            <Switch id="vps-root" checked={form.rootEnabled} onCheckedChange={form.setRootEnabled} />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t('vps:create.auth.rootPassword')}</span>
              <span className="text-xs text-muted-foreground">{t('vps:create.auth.rootPasswordHint')}</span>
            </span>
          </label>
          {form.rootEnabled ? (
            <Field data-invalid={Boolean(err('rootPassword')) || undefined} className="max-w-sm">
              <FieldLabel htmlFor="vps-rootpw">{t('vps:create.auth.rootPasswordField')}</FieldLabel>
              <Input
                id="vps-rootpw"
                type="password"
                autoComplete="new-password"
                value={form.rootPassword}
                onChange={(e) => form.setRootPassword(e.target.value)}
              />
              {err('rootPassword') ? <FieldError>{err('rootPassword')}</FieldError> : null}
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
