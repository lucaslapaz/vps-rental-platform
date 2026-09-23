import { zodResolver } from '@hookform/resolvers/zod';
import { type OpenConversationInput, openConversationSchema } from '@shared/schemas/support';
import type { SupportConversationDTO } from '@shared/types/support';
import { useQueryClient } from '@tanstack/react-query';
import { Headset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TextField } from '@/components/form/TextField';
import { ConversationStatusBadge } from '@/components/StatusBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/useAuth';
import { useSocket } from '@/features/realtime/RealtimeProvider';
import { api } from '@/lib/api';
import { errorMessage, validationMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';
import { ChatPanel } from './ChatPanel';
import { supportKeys, useCurrentConversation } from './queries';

function NewConversationForm({ onOpened }: { onOpened: (c: SupportConversationDTO) => void }) {
  const { t } = useTranslation('support');
  const form = useForm<OpenConversationInput>({
    resolver: zodResolver(openConversationSchema),
    defaultValues: { subject: '', message: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      onOpened((await api<{ conversation: SupportConversationDTO }>('POST', '/support/conversations', values)).conversation);
    } catch (err) {
      if (!applyServerErrors(err, form.setError, ['subject', 'message'])) toast.error(errorMessage(err));
    }
  });

  return (
    <Card className="max-w-2xl">
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>{t('customer.newTitle')}</CardTitle>
          <CardDescription>{t('customer.newDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <TextField
              label={t('customer.subject')}
              placeholder={t('customer.subjectPlaceholder')}
              registration={form.register('subject')}
              error={errors.subject}
              maxLength={150}
            />
            <Field data-invalid={Boolean(errors.message) || undefined}>
              <FieldLabel htmlFor="mensagem-inicial">{t('customer.message')}</FieldLabel>
              <Textarea
                id="mensagem-inicial"
                rows={5}
                placeholder={t('customer.messagePlaceholder')}
                aria-invalid={Boolean(errors.message) || undefined}
                {...form.register('message')}
              />
              {errors.message ? <FieldError>{validationMessage(errors.message.message)}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={isSubmitting} data-testid="open-conversation">
            {t('customer.submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/** /support (plano §13): o cliente abre uma conversa, vê a posição na fila e conversa com o técnico em tempo real. */
export function SupportPage() {
  const { t } = useTranslation('support');
  const { user } = useAuth();
  const socket = useSocket();
  const queryClient = useQueryClient();
  const current = useCurrentConversation();
  const [startingNew, setStartingNew] = useState(false);

  // Posição na fila, técnico que assumiu, encerramento: chegam pelo socket e atualizam o cache na hora.
  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p: {
      id: string;
      status: SupportConversationDTO['status'];
      agent: SupportConversationDTO['agent'];
      queuePosition: number | null;
    }) => {
      queryClient.setQueryData<SupportConversationDTO | null>(supportKeys.current, (c) =>
        c && c.id === p.id ? { ...c, status: p.status, agent: p.agent ?? c.agent, queuePosition: p.queuePosition } : c,
      );
    };
    socket.on('support:conversation:updated', onUpdated);
    return () => {
      socket.off('support:conversation:updated', onUpdated);
    };
  }, [socket, queryClient]);

  const close = async (id: string) => {
    try {
      const { conversation } = await api<{ conversation: SupportConversationDTO }>('POST', `/support/conversations/${id}/close`);
      queryClient.setQueryData(supportKeys.current, conversation);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const header = (
    <header className="flex flex-col gap-1">
      <h1 className="flex items-center gap-2 text-3xl font-extrabold">
        <Headset className="size-7" aria-hidden />
        {t('customer.title')}
      </h1>
      <p className="text-muted-foreground">{t('customer.subtitle')}</p>
    </header>
  );

  if (current.isPending || !user) return <Skeleton className="h-96 w-full" />;
  const c = current.data;

  if (!c || startingNew) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <NewConversationForm
          onOpened={(conv) => {
            queryClient.setQueryData(supportKeys.current, conv);
            setStartingNew(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="support-page" data-status={c.status}>
      {header}
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {c.subject}
              <ConversationStatusBadge status={c.status} />
            </CardTitle>
            <CardDescription data-testid="conversation-state">
              {c.status === 'WAITING' && c.queuePosition
                ? `${t('customer.position', { position: c.queuePosition })} · ${t('customer.waitingHint')}`
                : c.status === 'ACTIVE' && c.agent
                  ? t('customer.activeWith', { name: c.agent.name })
                  : t('customer.closedHint')}
            </CardDescription>
          </div>
          {c.status === 'CLOSED' ? (
            <Button onClick={() => setStartingNew(true)}>{t('customer.newConversation')}</Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">{t('customer.close')}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('customer.closeConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('customer.closeConfirmBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('customer.cancel')}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void close(c.id)}>
                    {t('customer.close')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardHeader>
        <CardContent>
          <ChatPanel conversation={c} viewerId={user.id} />
        </CardContent>
      </Card>
    </div>
  );
}
