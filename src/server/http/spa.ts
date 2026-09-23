import type { Request, RequestHandler } from 'express';

/**
 * Fallback da SPA: entrega o index.html para qualquer rota que não seja da API nem um arquivo estático.
 * O HTML sempre passa por aqui (em produção o express.static usa `index: false`), porque é neste ponto que a Fase 3
 * emite os cookies `psid`/`csrf` (plano §9.6). `no-store`: o HTML nunca fica em cache.
 */
export function spaHandler(getHtml: (req: Request) => Promise<string>): RequestHandler {
  return async (req, res) => {
    const html = await getHtml(req);
    res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(html);
  };
}
