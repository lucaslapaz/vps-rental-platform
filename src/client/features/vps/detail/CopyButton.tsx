import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Copia um texto para a área de transferência e confirma com um ícone por 2 s. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation('vps');
  const [copied, setCopied] = useState(false);
  const text = label ?? t('detail.copy');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência (ex.: HTTP fora de localhost): o texto continua visível para copiar à mão.
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={text}>
          {copied ? <Check className="text-status-running" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? t('detail.copied') : text}</TooltipContent>
    </Tooltip>
  );
}
