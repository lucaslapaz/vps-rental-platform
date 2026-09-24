import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { queryKeys } from '../queries';
import type { ConsoleProps } from './ConsoleTab';

type State = 'connecting' | 'connected' | 'disconnected' | 'error';

const DOT: Record<State, string> = {
  connecting: 'bg-status-pending animate-pulse motion-reduce:animate-none',
  connected: 'bg-status-running',
  disconnected: 'bg-status-stopped',
  error: 'bg-status-error',
};

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * Console de texto na serial0 (Fase 10) com xterm.js. Protocolo do termproxy, conferido no pve-xtermjs do nó: dados
 * "0:<bytes>:<texto>", redimensionar "1:<cols>:<rows>:" e ping "2" a cada 30 s. A autenticação com o ticket é feita
 * pelo proxy da Favo; o navegador só recebe um consoleId de uso único.
 */
export function SerialConsole({ vps, onConnection, stopSignal }: ConsoleProps) {
  const { t } = useTranslation('vps');
  const queryClient = useQueryClient();
  const refreshConnections = () => void queryClient.invalidateQueries({ queryKey: queryKeys.consoles });
  const stopAtMount = useRef(stopSignal);
  const socket = useRef<WebSocket | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconecta só quando o usuário pede (attempt) ou a VPS muda
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: token('--font-mono') || 'monospace',
      fontSize: 14,
      theme: { background: token('--console'), foreground: token('--console-foreground'), cursor: token('--primary') },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    setState('connecting');
    setError(null);

    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    const send = (frame: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(frame);
    };
    const onData = term.onData((data) => send(`0:${utf8Length(data)}:${data}`));
    const onResize = term.onResize(({ cols, rows }) => send(`1:${cols}:${rows}:`));
    const onWindowResize = () => fit.fit();
    window.addEventListener('resize', onWindowResize);

    // Adiado um tick: no StrictMode (dev) o efeito monta duas vezes e não pode gastar 2 sessões de console (N31).
    const timer = setTimeout(async () => {
      try {
        const { consoleId, connectionId } = await api<{ consoleId: string; connectionId: string }>('POST', `/vps/${vps.id}/console`, {
          type: 'serial',
        });
        refreshConnections();
        if (disposed) return;
        onConnection(connectionId);
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${scheme}://${window.location.host}/ws/console/${consoleId}`, ['binary']);
        ws.binaryType = 'arraybuffer';
        socket.current = ws;
        ws.onopen = () => {
          setState('connected');
          refreshConnections();
          send(`1:${term.cols}:${term.rows}:`);
          // Um Enter faz o getty mostrar o "login:" de novo (a tela da serial não tem histórico).
          send('0:1:\r');
          term.focus();
          ping = setInterval(() => send('2'), 30_000);
        };
        ws.onmessage = (event) => term.write(new Uint8Array(event.data as ArrayBuffer));
        ws.onclose = (event) => {
          refreshConnections();
          if (disposed) return;
          // Encerrada pelo painel de conexões (4002): desconectada, sem erro.
          if (event.code === 4002) {
            setState('disconnected');
            return;
          }
          setState(event.code === 1000 || event.code === 1001 ? 'disconnected' : 'error');
          if (event.code !== 1000 && event.code !== 1001) setError(t('detail.console.failed'));
        };
      } catch (err) {
        console.error('[console] falha ao abrir o console de texto', err);
        if (!disposed) {
          setState('error');
          setError(errorMessage(err));
        }
      }
    }, 0);

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(ping);
      window.removeEventListener('resize', onWindowResize);
      onData.dispose();
      onResize.dispose();
      ws?.close();
      term.dispose();
    };
  }, [vps.id, attempt]);

  // Encerrada pelo painel de conexões (a aba também pode receber o 4002 do servidor): fecha sem mostrar erro.
  useEffect(() => {
    if (stopSignal === stopAtMount.current) return;
    socket.current?.close();
    setState('disconnected');
    setError(null);
  }, [stopSignal]);

  const label: Record<State, string> = {
    connecting: t('detail.console.connecting'),
    connected: t('detail.console.connected'),
    disconnected: t('detail.console.disconnected'),
    error: t('detail.console.disconnected'),
  };

  return (
    <div className="flex flex-col gap-2" data-testid="serial-console">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" data-state={state}>
          <span aria-hidden className={cn('size-2 rounded-full', DOT[state])} />
          {label[state]}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)} disabled={state === 'connecting'}>
          <RefreshCw />
          {t('detail.console.reconnect')}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div ref={host} className="h-[60vh] min-h-72 w-full overflow-hidden rounded-lg border bg-console p-2" />
      <p className="text-xs text-muted-foreground">{t('detail.console.serialHint')}</p>
    </div>
  );
}
