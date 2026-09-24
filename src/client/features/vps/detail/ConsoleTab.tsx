import RFB from '@novnc/novnc';
import type { VpsDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { Expand, Keyboard, Maximize, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { queryKeys } from '../queries';
import { ConsoleConnections } from './ConsoleConnections';
import { SerialConsole } from './SerialConsole';

export interface ConsoleProps {
  vps: VpsDTO;
  /** Id público da conexão desta aba (para o painel de conexões marcar "Esta aba"). */
  onConnection: (connectionId: string | null) => void;
  /** Incrementado quando o usuário encerra a conexão desta aba pelo painel. */
  stopSignal: number;
}

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
function VncConsole({ vps, onConnection, stopSignal }: ConsoleProps) {
  const { t } = useTranslation('vps');
  const queryClient = useQueryClient();
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
  /** A lista de conexões muda quando esta aba conecta ou desconecta. */
  const refreshConnections = useCallback(() => void queryClient.invalidateQueries({ queryKey: queryKeys.consoles }), [queryClient]);

  const connect = useCallback(async () => {
    if (!screen.current) return;
    disconnect();
    const mine = attempt.current;
    setError(null);
    setState('connecting');
    // O WebSocket é criado aqui e entregue ao noVNC: se qualquer passo seguinte falhar, ele é fechado no catch. Antes, o
    // noVNC abria a conexão dentro do construtor e uma exceção logo depois deixava um cliente órfão conectado, ocupando
    // uma das vagas de console do usuário até fechar a aba.
    let socket: WebSocket | null = null;
    let client: RFB | null = null;
    try {
      const { consoleId, connectionId, password } = await api<{ consoleId: string; connectionId: string; password: string }>(
        'POST',
        `/vps/${vps.id}/console`,
      );
      refreshConnections();
      if (!screen.current || mine !== attempt.current) return; // o usuário saiu da aba ou reconectou nesse meio-tempo
      onConnection(connectionId);
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/console/${consoleId}`, ['binary']);
      socket.binaryType = 'arraybuffer';
      // 4002: encerrada pelo painel de conexões (nesta ou em outra aba). Não é erro.
      let terminated = false;
      socket.addEventListener('close', (e) => {
        terminated = e.code === 4002;
      });
      client = new RFB(screen.current, socket, {
        credentials: { password } as { username: string; password: string; target: string },
      });
      rfb.current = client;
      const current = client;
      client.scaleViewport = fit;
      client.background = 'var(--console)';
      client.focusOnClick = true;
      client.addEventListener('connect', () => {
        setState('connected');
        refreshConnections();
      });
      client.addEventListener('disconnect', (e) => {
        refreshConnections();
        if (rfb.current !== current) return;
        rfb.current = null;
        const ok = e.detail.clean || terminated;
        setState(ok ? 'disconnected' : 'error');
        if (!ok) setError(t('detail.console.failed'));
      });
      // O Proxmox usa a senha VNC do ticket; se o servidor pedir de novo, reenvia a mesma.
      client.addEventListener('credentialsrequired', () => current.sendCredentials({ password } as never));
      client.addEventListener('securityfailure', (e) => {
        console.error('[console] noVNC: falha de segurança', e.detail);
        setState('error');
        setError(t('detail.console.failed'));
      });
    } catch (err) {
      // Mostra no console do navegador o erro real (ajuda a diagnosticar navegadores e extensões) e libera a conexão.
      console.error('[console] falha ao abrir o console gráfico', err);
      if (client) {
        if (rfb.current === client) rfb.current = null;
        try {
          client.disconnect();
        } catch {
          // o noVNC pode falhar ao desmontar um cliente que nem terminou de montar; o socket é fechado abaixo
        }
      }
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
      refreshConnections();
      setState('error');
      setError(
        err instanceof Error && !(err instanceof ApiError) ? t('detail.console.failedDetail', { detail: err.message }) : errorMessage(err),
      );
    }
  }, [vps.id, fit, disconnect, t, onConnection, refreshConnections]);

  // Esta conexão foi encerrada pelo painel de conexões: desconecta sem mostrar erro. Compara com o valor da montagem
  // (o sinal sobrevive à troca entre gráfico e texto).
  const stopAtMount = useRef(stopSignal);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reage só ao sinal
  useEffect(() => {
    if (stopSignal === stopAtMount.current) return;
    disconnect();
    setState('disconnected');
    setError(null);
  }, [stopSignal]);

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

/**
 * Aba Console: gráfico (noVNC, a tela da VM, inclusive o login gráfico da Desktop) ou texto (xterm.js na serial0, com
 * copiar/colar de terminal). Os dois passam pelo mesmo proxy de uso único (plano §10.5).
 */
export function ConsoleTab({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const [mode, setMode] = useState<'vnc' | 'serial'>('vnc');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [stopSignal, setStopSignal] = useState(0);
  const onConnection = useCallback((id: string | null) => setCurrentId(id), []);
  if (vps.status !== 'RUNNING') return <p className="text-muted-foreground">{t('detail.console.notRunning')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="inline-flex w-fit rounded-lg border-0 bg-muted p-[3px]">
        <legend className="sr-only">{t('detail.tabs.console')}</legend>
        {(['vnc', 'serial'] as const).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? 'outline' : 'ghost'}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setCurrentId(null);
            }}
            data-testid={`console-mode-${m}`}
          >
            {m === 'vnc' ? t('detail.console.modeVnc') : t('detail.console.modeSerial')}
          </Button>
        ))}
      </fieldset>
      <ConsoleConnections currentId={currentId} onTerminateCurrent={() => setStopSignal((n) => n + 1)} />
      {mode === 'vnc' ? (
        <VncConsole vps={vps} onConnection={onConnection} stopSignal={stopSignal} />
      ) : (
        <SerialConsole vps={vps} onConnection={onConnection} stopSignal={stopSignal} />
      )}
    </div>
  );
}
