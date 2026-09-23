import type { Agent } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyAgents = new Map<string, HttpsProxyAgent<string>>();

function proxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
}

/** Mirrors gaxios's NO_PROXY matching so this agent routes the same requests through the proxy. */
function bypassesProxy(url: URL): boolean {
  const rules = (process.env.NO_PROXY ?? process.env.no_proxy)?.split(',') ?? [];
  return rules.some((raw) => {
    const rule = raw.trim();
    if (rule.startsWith('*.') || rule.startsWith('.')) return url.hostname.endsWith(rule.replace(/^\*\./, '.'));
    return rule === url.origin || rule === url.hostname || rule === url.href;
  });
}

/**
 * HTTP agent for Google API and OAuth requests.
 *
 * gaxios builds its HTTPS proxy agent without keep-alive, so behind a proxy
 * every request opens a new CONNECT tunnel and TLS session. On slow egress
 * paths that turns one search into several full connection setups. Reuse a
 * keep-alive proxy agent instead. Without a proxy, return undefined so Node's
 * default keep-alive agent handles the request.
 */
export function googleRequestAgent(url: URL): Agent | undefined {
  const proxy = proxyUrl();
  if (!proxy || bypassesProxy(url)) return undefined;
  let agent = proxyAgents.get(proxy);
  if (!agent) {
    agent = new HttpsProxyAgent(proxy, { keepAlive: true });
    proxyAgents.set(proxy, agent);
  }
  return agent;
}

/** Options for google-auth-library clients so their requests use {@link googleRequestAgent}. */
export const googleTransporterOptions = {
  // gaxios types the function form as always returning an agent; node-fetch
  // falls back to Node's default agent when it returns undefined.
  agent: googleRequestAgent as (url: URL) => Agent,
};
