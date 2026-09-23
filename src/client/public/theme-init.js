// Aplica o tema antes da primeira pintura (evita o "flash" claro no modo escuro). É um arquivo externo, e não um
// <script> inline, porque a CSP de produção é script-src 'self'. Mesma chave e mesma regra de src/client/lib/theme.ts.
(() => {
  let pref = 'system';
  try {
    pref = localStorage.getItem('favo.theme') || 'system';
  } catch {}
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
