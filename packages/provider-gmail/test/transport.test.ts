import { Agent as HttpsAgent } from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleTransporterOptions } from '../src/transport.js';

describe('googleTransporterOptions', () => {
  beforeEach(() => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('leaves proxy handling to gaxios without HTTPS_PROXY', () => {
    expect(googleTransporterOptions()).toEqual({});
    vi.stubEnv('HTTP_PROXY', 'http://proxy.test:3128');
    expect(googleTransporterOptions()).toEqual({});
  });

  it('shares one keep-alive agent across clients behind an HTTPS proxy', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    const first = googleTransporterOptions().agent;
    expect(first).toBeInstanceOf(HttpsAgent);
    expect(first?.keepAlive).toBe(true);
    expect(googleTransporterOptions().agent).toBe(first);
  });

  it('leaves proxy handling to gaxios on Node 20', () => {
    vi.stubEnv('https_proxy', 'http://proxy.test:3128');
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: '20.20.0' });
    expect(googleTransporterOptions()).toEqual({});
  });
});
