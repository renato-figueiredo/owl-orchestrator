import { z } from 'zod';

const schema = z.object({
  OWL_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  OWL_DATA_DIR: z.string().min(1).default('./data'),
  OWL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
});

export interface OwlConfig {
  /** Always loopback: the server must never listen on 0.0.0.0 by default. */
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  /** Maximum runs executing at once (default 1). */
  concurrency: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): OwlConfig {
  const parsed = schema.parse(env);
  return { host: '127.0.0.1', port: parsed.OWL_PORT, dataDir: parsed.OWL_DATA_DIR, concurrency: parsed.OWL_CONCURRENCY };
}
