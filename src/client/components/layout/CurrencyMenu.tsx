import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CURRENCIES, type Currency, useCurrency } from '@/lib/currency';

/** Seletor de moeda (só exibição; a cobrança é sempre em BRL). */
export function CurrencyMenu() {
  const { t } = useTranslation();
  const { currency, setCurrency } = useCurrency();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('currency.label')} data-testid="currency-menu">
          <span className="font-mono text-xs">{currency}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t('currency.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currency} onValueChange={(c) => setCurrency(c as Currency)}>
          {CURRENCIES.map((c) => (
            <DropdownMenuRadioItem key={c} value={c} data-currency={c}>
              {t(`currency.${c}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('currency.note')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
