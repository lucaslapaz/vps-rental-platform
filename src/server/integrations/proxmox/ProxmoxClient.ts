import { readFileSync } from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { Agent, fetch } from 'undici';
import type { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import type { Logger } from '../../utils/logger.ts';

export type Params = Record<string, string | number | boolean | readonly (string | number)[] | undefined>;

/** Erro da API do Proxmox: status HTTP, mensagem e os erros por parâmetro que ele devolve em `errors`. */
export class ProxmoxApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly method: string,
    readonly path: string,
    readonly errors?: Record<string, string>,
  ) {
    super(`Proxmox ${method} ${path} → ${status} ${message}${errors ? ` ${JSON.stringify(errors)}` : ''}`);
    this.name = 'ProxmoxApiError';
  }
}

/**
 * Cliente fino da API REST do Proxmox (plano §10.1). Autentica com o API token da plataforma (sem CSRF, sem expirar
 * em 2 h), confia na CA do Proxmox em vez de desligar a verificação TLS e valida o certificado pelo nome do nó
 * (o certificado não tem o IP no SAN, CLAUDE.md A9). As respostas são validadas com zod por quem chama.
 */
@injectable()
export class ProxmoxClient {
  private readonly base: string;
  private readonly authorization: string;
  private readonly dispatcher: Agent;

  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Logger) private readonly logger: Logger,
  ) {
    this.base = `${env.PVE_URL.replace(/\/$/, '')}/api2/json`;
    this.authorization = `PVEAPIToken=${env.PVE_TOKEN_ID}=${env.PVE_TOKEN_SECRET}`;
    this.dispatcher = new Agent({
      connect: { ca: readFileSync(env.PVE_CA_FILE), ...(env.PVE_TLS_SERVERNAME ? { servername: env.PVE_TLS_SERVERNAME } : {}) },
      keepAliveTimeout: 10_000,
    });
  }

  /** Form-urlencoded; arrays viram chaves repetidas (é assim que a API recebe `command` do agent/exec). */
  private static encode(params: Params | undefined): string {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) body.append(key, String(v));
      else body.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    return body.toString();
  }

  async request<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    schema: S,
    params?: Params,
  ): Promise<z.output<S>> {
    const encoded = ProxmoxClient.encode(params);
    const inQuery = method === 'GET' || method === 'DELETE';
    const url = `${this.base}${path}${inQuery && encoded ? `?${encoded}` : ''}`;
    const started = Date.now();
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        method,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.env.PVE_TIMEOUT_MS),
        headers: {
          Authorization: this.authorization,
          Accept: 'application/json',
          ...(!inQuery && encoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(!inQuery && encoded ? { body: encoded } : {}),
      });
    } catch (err) {
      throw new ProxmoxApiError(0, `falha de rede: ${(err as Error).message}`, method, path);
    }
    const text = await res.text();
    let json: { data?: unknown; errors?: Record<string, string>; message?: string } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {}
    // Nunca logar parâmetros: podem conter senhas (cipassword, set-user-password).
    this.logger.debug({ method, path, status: res.status, ms: Date.now() - started }, 'proxmox');
    if (!res.ok) throw new ProxmoxApiError(res.status, json.message?.trim() || res.statusText, method, path, json.errors);
    const parsed = schema.safeParse(json.data);
    if (!parsed.success) {
      throw new ProxmoxApiError(res.status, `resposta inesperada: ${parsed.error.issues[0]?.message ?? 'formato inválido'}`, method, path);
    }
    return parsed.data;
  }

  get<S extends z.ZodType>(path: string, schema: S, params?: Params) {
    return this.request('GET', path, schema, params);
  }
  post<S extends z.ZodType>(path: string, schema: S, params?: Params) {
    return this.request('POST', path, schema, params);
  }
  put<S extends z.ZodType>(path: string, schema: S, params?: Params) {
    return this.request('PUT', path, schema, params);
  }
  delete<S extends z.ZodType>(path: string, schema: S, params?: Params) {
    return this.request('DELETE', path, schema, params);
  }

  async close() {
    await this.dispatcher.close();
  }
}
