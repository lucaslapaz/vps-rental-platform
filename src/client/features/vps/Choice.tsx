import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Cartão selecionável (imagem, plano, método de acesso): um radio acessível com aparência de card. */
export function Choice({
  selected,
  disabled,
  onSelect,
  children,
  testId,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: cartão rico (título, preço, selos) no padrão ARIA de radio, operável pelo teclado
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'relative flex w-full flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition-colors outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        selected ? 'border-primary ring-2 ring-primary/40' : 'hover:border-foreground/30',
        disabled && 'cursor-not-allowed opacity-50 hover:border-border',
      )}
    >
      {selected ? <Check className="absolute top-3 right-3 size-4 text-link" aria-hidden /> : null}
      {children}
    </button>
  );
}
