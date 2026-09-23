import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Símbolo da Favo: hexágono de cantos arredondados com o cursor ">_" vazado (plano §14.6).
 * Sempre decorativo: quem o envolve (link, título) fornece o nome acessível.
 */
export function LogoMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <polygon
            points="16,3 27.26,9.5 27.26,22.5 16,29 4.74,22.5 4.74,9.5"
            fill="#fff"
            stroke="#fff"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <polyline
            points="10.5,11.5 14.5,16 10.5,20.5"
            fill="none"
            stroke="#000"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="16.5" y1="20.5" x2="21.5" y2="20.5" stroke="#000" strokeWidth="2.6" strokeLinecap="round" />
        </mask>
      </defs>
      <rect width="32" height="32" className="fill-primary" mask={`url(#${maskId})`} />
    </svg>
  );
}

/** Logotipo completo: símbolo + "favo" em Bricolage Grotesque ExtraBold. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-7" />
      <span className="font-heading text-2xl font-extrabold leading-none tracking-[-0.03em]">favo</span>
    </span>
  );
}
