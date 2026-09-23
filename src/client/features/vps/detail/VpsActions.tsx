import { canRun, type PowerActionName } from '@shared/constants/vps';
import type { VpsDTO } from '@shared/types/catalog';
import { ChevronDown, Monitor, Play, Power, RotateCw, TriangleAlert, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCan } from '@/features/auth/useAuth';
import { useVpsCommand } from './useVpsCommand';

/** Ações que interrompem o que está rodando pedem confirmação; ligar não. */
const DESTRUCTIVE: readonly PowerActionName[] = ['stop', 'reset'];

/**
 * Ações rápidas do cabeçalho (plano §14.5): Console, Ligar/Desligar, Reiniciar e o menu com "Forçar parada" e "Reset".
 * Os botões seguem a mesma tabela de transições do servidor (VPS_TRANSITIONS); o servidor decide de verdade (409).
 */
export function VpsActions({ vps, onOpenConsole }: { vps: VpsDTO; onOpenConsole: () => void }) {
  const { t } = useTranslation('vps');
  const canManage = useCan('vps:manage:own');
  const canConsole = useCan('vps:console:own');
  const [confirming, setConfirming] = useState<PowerActionName | null>(null);
  const command = useVpsCommand<PowerActionName>(vps.id, (action) => ({ method: 'POST', path: `/vps/${vps.id}/actions/${action}` }), {
    success: () => t('detail.actions.requested', { hostname: vps.hostname }),
  });

  if (!canManage) return null;
  const running = vps.status === 'RUNNING';
  const run = (action: PowerActionName) => {
    setConfirming(null);
    command.mutate(action);
  };
  const disabled = (action: PowerActionName) => command.isPending || !canRun(action, vps.status);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="vps-actions">
      {canConsole ? (
        <Button variant="outline" onClick={onOpenConsole} disabled={!running}>
          <Monitor />
          {t('detail.actions.console')}
        </Button>
      ) : null}
      {running || vps.status === 'STOPPING' ? (
        <Button variant="outline" onClick={() => setConfirming('shutdown')} disabled={disabled('shutdown')}>
          <Power />
          {t('detail.actions.shutdown')}
        </Button>
      ) : (
        <Button onClick={() => run('start')} disabled={disabled('start')} data-testid="action-start">
          <Play />
          {t('detail.actions.start')}
        </Button>
      )}
      <Button variant="outline" onClick={() => setConfirming('reboot')} disabled={disabled('reboot')}>
        <RotateCw />
        {t('detail.actions.reboot')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label={t('detail.actions.more')} disabled={!running || command.isPending}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setConfirming('stop')} disabled={disabled('stop')}>
            <Zap />
            {t('detail.actions.stop')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirming('reset')} disabled={disabled('reset')}>
            <TriangleAlert />
            {t('detail.actions.reset')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          {confirming ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`detail.actions.confirm.${confirming}.title`, { hostname: vps.hostname })}</AlertDialogTitle>
                <AlertDialogDescription>{t(`detail.actions.confirm.${confirming}.body`)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('detail.actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  variant={DESTRUCTIVE.includes(confirming) ? 'destructive' : 'default'}
                  onClick={() => run(confirming)}
                  data-testid="confirm-action"
                >
                  {t(`detail.actions.${confirming}`)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
