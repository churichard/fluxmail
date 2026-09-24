import { readFileSync } from 'node:fs';
import { Agent as HttpAgent, createServer, type Server } from 'node:http';
import { Agent as HttpsAgent, get } from 'node:https';
import type { AddressInfo } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleRequestAgent, googleTransporterOptions } from '../src/transport.js';

const GMAIL_URL = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');

/** A proxy that records CONNECT requests and refuses them, so no request leaves the machine. */
async function refusingProxy(): Promise<{ url: string; connects: string[]; server: Server }> {
  const connects: string[] = [];
  const server = createServer();
  server.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, connects, server };
}

function request(url: URL, agent: HttpAgent | undefined): Promise<void> {
  return new Promise((resolve) => {
    get(url, { agent: agent as HttpsAgent }, (res) => res.resume().on('end', resolve)).on('error', () => resolve());
  });
}

describe('Google request transport', () => {
  beforeEach(() => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('connects directly without a proxy', () => {
    expect(googleRequestAgent(GMAIL_URL)).toBeUndefined();
  });

  it('reuses one keep-alive agent for every HTTPS request through a proxy', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    const first = googleRequestAgent(GMAIL_URL);
    expect(first).toBeInstanceOf(HttpAgent);
    expect(first?.keepAlive).toBe(true);
    expect(googleRequestAgent(new URL('https://oauth2.googleapis.com/token'))).toBe(first);
  });

  it.each(['socks5://127.0.0.1:9', 'proxy.example.com:8080', 'http://'])(
    'rejects an invalid proxy URL instead of connecting directly: %s',
    (proxy) => {
      vi.stubEnv('HTTPS_PROXY', proxy);
      expect(() => googleTransporterOptions().agent(GMAIL_URL)).toThrow(
        'Google proxy URL must use http:// or https://',
      );
    },
  );

  it('tunnels through the uppercase proxy when both cases are set, like gaxios', async () => {
    const upper = await refusingProxy();
    const lower = await refusingProxy();
    try {
      vi.stubEnv('HTTPS_PROXY', upper.url);
      vi.stubEnv('https_proxy', lower.url);
      await request(GMAIL_URL, googleRequestAgent(GMAIL_URL));
      expect(upper.connects).toEqual(['gmail.googleapis.com:443']);
      expect(lower.connects).toEqual([]);
    } finally {
      upper.server.close();
      lower.server.close();
    }
  });

  it('tunnels HTTPS requests through HTTP_PROXY when HTTPS_PROXY is unset, like gaxios', async () => {
    const proxy = await refusingProxy();
    try {
      vi.stubEnv('http_proxy', proxy.url);
      await request(GMAIL_URL, googleRequestAgent(GMAIL_URL));
      expect(proxy.connects).toEqual(['gmail.googleapis.com:443']);
    } finally {
      proxy.server.close();
    }
  });

  it.each(['*', 'gmail.googleapis.com', '.googleapis.com', '*.googleapis.com', 'https://gmail.googleapis.com'])(
    'connects directly when NO_PROXY contains %s',
    (rule) => {
      vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
      vi.stubEnv('NO_PROXY', `localhost, ${rule}`);
      expect(googleRequestAgent(GMAIL_URL)).toBeUndefined();
    },
  );

  it('reads NO_PROXY before no_proxy, like gaxios', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    vi.stubEnv('NO_PROXY', 'gmail.googleapis.com');
    vi.stubEnv('no_proxy', 'example.com');
    expect(googleRequestAgent(GMAIL_URL)).toBeUndefined();
  });

  it('keeps an HTTP agent for plain HTTP URLs', () => {
    vi.stubEnv('HTTP_PROXY', 'http://proxy.test:3128');
    const agent = googleRequestAgent(new URL('http://example.test/'));
    expect(agent).toBeInstanceOf(HttpAgent);
    expect(agent).not.toBeInstanceOf(HttpsAgent);
  });

  it.each(['20.20.0', '23.11.0', '24.4.0'])('uses a keep-alive proxy agent on Node %s', (version) => {
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: version });
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    const agent = googleTransporterOptions().agent(GMAIL_URL);
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
    expect(agent.keepAlive).toBe(true);
    expect(googleRequestAgent(new URL('https://oauth2.googleapis.com/token'))).toBe(agent);
  });

  it.each(['22.22.0', '24.5.0', '25.0.0'])('uses the Node keep-alive agent on Node %s', (version) => {
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: version });
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
    expect(googleTransporterOptions().agent).toBe(googleRequestAgent);
    const agent = googleTransporterOptions().agent(GMAIL_URL);
    expect(agent).toBeInstanceOf(HttpsAgent);
    expect(agent.keepAlive).toBe(true);
  });

  it.each(['22.22.0', '24.5.0', '25.0.0'])('uses HttpsProxyAgent for HTTPS proxies on Node %s', (version) => {
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: version });
    vi.stubEnv('HTTPS_PROXY', 'https://proxy.test:3128');
    const agent = googleRequestAgent(GMAIL_URL);
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
    expect(agent?.keepAlive).toBe(true);
    expect(googleRequestAgent(new URL('https://oauth2.googleapis.com/token'))).toBe(agent);
  });

  it('sends the proxy hostname as SNI before CONNECT', async () => {
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: '22.22.0' });
    const servernames: (string | false)[] = [];
    const connects: string[] = [];
    const cert = readFileSync(new URL('./fixtures/proxy-cert.pem', import.meta.url));
    const proxy = createTlsServer(
      {
        key: readFileSync(new URL('./fixtures/proxy-key.pem', import.meta.url)),
        cert,
      },
      (socket) => {
        servernames.push(socket.servername);
        socket.once('data', (data) => {
          connects.push(data.toString());
          socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        });
      },
    );
    await new Promise<void>((resolve) => proxy.listen(0, 'localhost', resolve));
    try {
      vi.stubEnv('HTTPS_PROXY', `https://localhost:${(proxy.address() as AddressInfo).port}`);
      const agent = googleRequestAgent(GMAIL_URL) as HttpsProxyAgent<string>;
      agent.connectOpts.ca = cert;
      await request(GMAIL_URL, agent);
      expect(servernames).toEqual(['localhost']);
      expect(connects[0]).toMatch(/^CONNECT gmail\.googleapis\.com:443 HTTP\/1\.1\r\n/);
    } finally {
      proxy.close();
    }
  });

  it('uses the proxy on Node 20 rather than connecting directly', async () => {
    vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, node: '20.20.0' });
    const proxy = await refusingProxy();
    try {
      vi.stubEnv('HTTPS_PROXY', proxy.url);
      await request(GMAIL_URL, googleTransporterOptions().agent(GMAIL_URL));
      expect(proxy.connects).toEqual(['gmail.googleapis.com:443']);
    } finally {
      proxy.server.close();
    }
  });
});
