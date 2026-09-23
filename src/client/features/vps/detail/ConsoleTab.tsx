import RFB from '@novnc/novnc';
import type { VpsDTO } from '@shared/types/catalog';
import { Expand, Keyboard, Maximize, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

type State = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const DOT: Record<State, string> = {
  idle: 'bg-status-stopped',
  connecting: 'bg-status-pending animate-pulse motion-reduce:animate-none',
  connected: 'bg-status-running',
  disconnected: 'bg-status-stopped',
  error: 'bg-status-error',
};

/**
 * Console gráfico (plano §10.5). O navegador nunca fala com o Proxmox: pede uma sessão de uso único
 * (POST /api/vps/:id/console → consoleId + senha VNC) e abre o WebSocket /ws/console/:consoleId na própria Favo, que faz
 * a ponte. Conecta ao abrir a aba e desconecta ao sair dela.
 */
export function ConsoleTab({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  /** Cada conexão tem um número; uma resposta que chega depois de um disconnect/reconnect é descartada. */
  const attempt = useRef(0);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true);
  const running = vps.status === 'RUNNING';

  const disconnect = useCallback(() => {
    attempt.current++;
    rfb.current?.disconnect();
    rfb.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!screen.current) return;
    disconnect();
    const mine = attempt.current;
    setError(null);
    setState('connecting');
    try {
      const { consoleId, password } = await api<{ consoleId: string; password: string }>('POST', `/vps/${vps.id}/console`);
      if (!screen.current || mine !== attempt.current) return; // o usuário saiu da aba ou reconectou nesse meio-tempo
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const client = new RFB(screen.current, `${scheme}://${window.location.host}/ws/console/${consoleId}`, {
        wsProtocols: ['binary'],
        credentials: { password } as { username: string; password: string; target: string },
      });
      client.scaleViewport = fit;
      client.background = 'var(--console)';
      client.focusOnClick = true;
      client.addEventListener('connect', () => setState('connected'));
      client.addEventListener('disconnect', (e) => {
        if (rfb.current !== client) return;
        rfb.current = null;
        setState(e.detail.clean ? 'disconnected' : 'error');
        if (!e.detail.clean) setError(t('detail.console.failed'));
      });
      // O Proxmox usa a senha VNC do ticket; se o servidor pedir de novo, reenvia a mesma.
      client.addEventListener('credentialsrequired', () => client.sendCredentials({ password } as never));
      client.addEventListener('securityfailure', () => {
        setState('error');
        setError(t('detail.console.failed'));
      });
      rfb.current = client;
    } catch (err) {
      setState('error');
      setError(errorMessage(err));
    }
  }, [vps.id, fit, disconnect, t]);

  // Abre ao entrar na aba (com a VPS ligada) e fecha ao sair ou se a VPS parar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconectar só quando a VPS liga/desliga, não a cada render
  useEffect(() => {
    if (!running) {
      disconnect();
      setState('idle');
      return;
    }
    // Adiado: no StrictMode (dev) o efeito monta, desmonta e monta de novo; sem o timer, a primeira montagem pediria
    // uma sessão de console à toa (e o limite é de 2 por usuário).
    const timer = setTimeout(() => void connect(), 0);
    return () => {
      clearTimeout(timer);
      disconnect();
    };
  }, [running]);

  useEffect(() => {
    if (rfb.current) rfb.current.scaleViewport = fit;
  }, [fit]);

  const label: Record<State, string> = {
    idle: t('detail.console.disconnected'),
    connecting: t('detail.console.connecting'),
    connected: t('detail.console.connected'),
    disconnected: t('detail.console.disconnected'),
    error: t('detail.console.disconnected'),
  };

  if (!running) return <p className="text-muted-foreground">{t('detail.console.notRunning')}</p>;

  return (
    <div ref={frame} className="flex flex-col gap-2 bg-background" data-testid="console">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" data-state={state}>
          <span aria-hidden className={cn('size-2 rounded-full', DOT[state])} />
          {label[state]}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => rfb.current?.sendCtrlAltDel()} disabled={state !== 'connected'}>
          <Keyboard />
          {t('detail.console.ctrlAltDel')}
        </Button>
        <Button size="sm" variant={fit ? 'secondary' : 'outline'} onClick={() => setFit((v) => !v)} aria-pressed={fit}>
          <Expand />
          {t('detail.console.fit')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void frame.current?.requestFullscreen?.()}>
          <Maximize />
          {t('detail.console.fullscreen')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void connect()} disabled={state === 'connecting'}>
          <RefreshCw />
          {t('detail.console.reconnect')}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div ref={screen} className="h-[70vh] min-h-80 w-full overflow-hidden rounded-lg border bg-console" />
      <p className="text-xs text-muted-foreground">{t('detail.console.hint')}</p>
    </div>
  );
}
