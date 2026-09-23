/**
 * Tokens de injeção para o que não é classe concreta (interfaces, valores). Classes concretas usam a própria classe
 * como token. Todo parâmetro de construtor leva @inject(TOKEN) explícito, porque o tsx/esbuild não emite
 * design:paramtypes (plano §7).
 */
export const TOKENS = {
  Env: Symbol('Env'),
  Logger: Symbol('Logger'),
  Clock: Symbol('Clock'),
} as const;
