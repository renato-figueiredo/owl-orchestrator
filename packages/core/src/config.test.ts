import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 4317, dataDir: './data', concurrency: 1, workspaceRoots: [homedir()], allowedOrigins: [] });
  });
  it('reads overrides but never changes the host', () => {
    const c = loadConfig({ OWL_PORT: '5000', OWL_DATA_DIR: '/x', OWL_CONCURRENCY: '3', OWL_WORKSPACE_ROOTS: '/a:/b', OWL_ALLOWED_ORIGINS: 'http://localhost:5173, http://127.0.0.1:5173' });
    expect(c).toEqual({ host: '127.0.0.1', port: 5000, dataDir: '/x', concurrency: 3, workspaceRoots: ['/a', '/b'], allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'] });
  });
  it('rejects invalid ports', () => {
    expect(() => loadConfig({ OWL_PORT: '99999' })).toThrow();
  });
  it('rejects invalid concurrency', () => {
    expect(() => loadConfig({ OWL_CONCURRENCY: '0' })).toThrow();
  });
});
