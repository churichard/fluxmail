import { Agent as HttpAgent, type AgentOptions as HttpAgentOptions } from 'node:http';
import { Agent as HttpsAgent, type AgentOptions as HttpsAgentOptions } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyAgents = new Map<string, HttpAgent>();

/** Node added proxyEnv to http.Agent in 22.21.0 and 24.5.0. Earlier versions ignore it and connect directly. */
function supportsAgentProxyEnv(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major === 22) return minor >= 21;
  if (major === 24) return minor >= 5;
  return major >= 25;
}

/** gaxios's proxy precedence. Node's proxyEnv prefers the lowercase names, so it is not used directly. */
function proxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
}

function validProxyUrl(proxy: string): string {
  let url: URL;
  try {
    url = new URL(proxy);
  } catch {
    throw new TypeError('Google proxy URL must use http:// or https://');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Google proxy URL must use http:// or https://');
  }
  return url.href;
}

/** gaxios's NO_PROXY matching, plus the common `*` rule. Node's matching differs, for example it ignores origins. */
function bypassesProxy(url: URL): boolean {
  const rules = (process.env.NO_PROXY ?? process.env.no_proxy)?.split(',') ?? [];
  return rules.some((raw) => {
    const rule = raw.trim();
    if (rule === '*') return true;
    if (rule.startsWith('*.') || rule.startsWith('.')) return url.hostname.endsWith(rule.replace(/^\*\./, '.'));
    return rule === url.origin || rule === url.hostname || rule === url.href;
  });
}

/** Chooses the proxy the way gaxios does, then tunnels through it from a shared keep-alive agent. */
export function googleRequestAgent(url: URL): HttpAgent | undefined {
  const selectedProxy = proxyUrl();
  if (!selectedProxy || bypassesProxy(url)) return undefined;
  const proxy = validProxyUrl(selectedProxy);
  const nativeProxy = supportsAgentProxyEnv();
  const key = `${nativeProxy}:${url.protocol}${proxy}`;
  let agent = proxyAgents.get(key);
  if (!agent) {
    if (nativeProxy) {
      // @types/node 22 does not declare proxyEnv yet. Only the chosen proxy is
      // passed, so Node does not apply its own variable precedence or NO_PROXY.
      agent =
        url.protocol === 'https:'
          ? new HttpsAgent({ keepAlive: true, proxyEnv: { HTTPS_PROXY: proxy } } as HttpsAgentOptions)
          : new HttpAgent({ keepAlive: true, proxyEnv: { HTTP_PROXY: proxy } } as HttpAgentOptions);
    } else {
      agent = new HttpsProxyAgent(proxy, { keepAlive: true });
    }
    proxyAgents.set(key, agent);
  }
  return agent;
}

/**
 * Transport options for google-auth-library clients.
 *
 * gaxios builds its proxy agent without keep-alive, so behind a proxy every
 * request opens a new CONNECT tunnel and TLS session. Any agent passed to gaxios
 * replaces its proxy handling, so googleRequestAgent chooses the proxy using
 * gaxios's environment variable precedence. Older Node versions use
 * HttpsProxyAgent with keep-alive instead of Node's proxyEnv support.
 */
export function googleTransporterOptions(): { agent: (url: URL) => HttpAgent } {
  // gaxios types the function form as always returning an agent; node-fetch
  // falls back to Node's default agent when it returns undefined.
  return { agent: googleRequestAgent as (url: URL) => HttpAgent };
}
