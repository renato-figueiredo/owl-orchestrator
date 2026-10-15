import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 4317, dataDir: './data', concurrency: 1 });
  });
  it('reads overrides but never changes the host', () => {
    const c = loadConfig({ OWL_PORT: '5000', OWL_DATA_DIR: '/x', OWL_CONCURRENCY: '3' });
    expect(c).toEqual({ host: '127.0.0.1', port: 5000, dataDir: '/x', concurrency: 3 });
  });
  it('rejects invalid ports', () => {
    expect(() => loadConfig({ OWL_PORT: '99999' })).toThrow();
  });
  it('rejects invalid concurrency', () => {
    expect(() => loadConfig({ OWL_CONCURRENCY: '0' })).toThrow();
  });
});
