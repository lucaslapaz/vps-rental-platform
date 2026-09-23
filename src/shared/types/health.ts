export type CheckStatus = 'ok' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  environment: 'development' | 'test' | 'production';
  uptimeSeconds: number;
  time: string;
  checks: { database: CheckStatus; proxmox: CheckStatus };
}
