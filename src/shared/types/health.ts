export interface HealthResponse {
  status: 'ok';
  environment: 'development' | 'test' | 'production';
  uptimeSeconds: number;
  time: string;
}
