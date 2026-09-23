import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { googleRequestAgent } from '../src/transport.js';

const GMAIL_URL = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');

describe('googleRequestAgent', () => {
  beforeEach(() => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves requests on the default agent without a proxy', () => {
    expect(googleRequestAgent(GMAIL_URL)).toBeUndefined();
  });

  it('reuses one keep-alive agent for every request through the same proxy', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    const first = googleRequestAgent(GMAIL_URL);
    const second = googleRequestAgent(new URL('https://oauth2.googleapis.com/token'));
    expect(first).toBeInstanceOf(HttpsProxyAgent);
    expect(first?.keepAlive).toBe(true);
    expect(second).toBe(first);
  });

  it('falls back to HTTP_PROXY', () => {
    vi.stubEnv('http_proxy', 'http://fallback.test:8080');
    const agent = googleRequestAgent(GMAIL_URL) as HttpsProxyAgent<string> | undefined;
    expect(agent?.proxy.href).toBe('http://fallback.test:8080/');
  });

  it.each(['gmail.googleapis.com', '.googleapis.com', '*.googleapis.com', 'https://gmail.googleapis.com'])(
    'skips the proxy when NO_PROXY contains %s',
    (rule) => {
      vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
      vi.stubEnv('NO_PROXY', `localhost, ${rule}`);
      expect(googleRequestAgent(GMAIL_URL)).toBeUndefined();
    },
  );
});
