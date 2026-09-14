export interface EnvironmentRequirement {
  name: string;
  current?: string;
  required?: string;
  recommended?: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  source?: string;
  reason?: string;
}
