/** Formatação de números para a tela, sempre no idioma escolhido (Intl). */

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** 1536 → "1,5 kB"; usa potências de 1024, como o Proxmox e o `df -h`. */
export function formatBytes(bytes: number, locale: string, fractionDigits = 1) {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : fractionDigits,
  }).format(value);
}

/** 0,1234 → "12,3 %". */
export function formatPercent(fraction: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.max(0, fraction));
}

/** 93784 s → "1 d 2 h" (as duas maiores unidades não nulas). */
export function formatDuration(seconds: number, locale: string) {
  const parts: [number, 'day' | 'hour' | 'minute' | 'second'][] = [
    [Math.floor(seconds / 86_400), 'day'],
    [Math.floor((seconds % 86_400) / 3600), 'hour'],
    [Math.floor((seconds % 3600) / 60), 'minute'],
    [Math.floor(seconds % 60), 'second'],
  ];
  const shown = parts.filter(([n]) => n > 0).slice(0, 2);
  if (!shown.length) shown.push([0, 'second']);
  return shown.map(([n, unit]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n)).join(' ');
}

export function formatDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
