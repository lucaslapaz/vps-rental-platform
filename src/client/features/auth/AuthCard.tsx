import type { ReactNode } from 'react';
import { LogoMark } from '@/components/brand/Logo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Padrão de colmeia sutil (4–6% de opacidade) atrás das telas de login e cadastro (plano §14.6). */
const HONEYCOMB =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='98' viewBox='0 0 56 98'%3E%3Cpath d='M28 66 0 50V18L28 2l28 16v32zM28 98 0 82' fill='none' stroke='%23f2a516' stroke-width='2'/%3E%3C/svg%3E\")";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative -my-10 flex min-h-[calc(100svh-8.5rem)] items-center justify-center py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: HONEYCOMB }} />
      <Card className="relative w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <LogoMark className="mx-auto mb-2 size-10" />
          <CardTitle className="font-heading text-2xl font-extrabold">{title}</CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {children}
          <div className="text-center text-sm text-muted-foreground">{footer}</div>
        </CardContent>
      </Card>
    </div>
  );
}
