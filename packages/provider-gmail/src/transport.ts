import { Agent as HttpsAgent, type AgentOptions } from 'node:https';

let proxyAgent: HttpsAgent | undefined;

/**
 * Transport options for google-auth-library clients.
 *
 * gaxios builds its HTTPS proxy agent without keep-alive, so behind a proxy
 * every request opens a new CONNECT tunnel and TLS session. Node 22 and later
 * can tunnel through the proxy from a keep-alive agent, which reuses tunnels and
 * applies NO_PROXY itself. Any agent passed to gaxios turns off its own proxy
 * handling, so return no agent when Node would not proxy the request: without
 * HTTPS_PROXY, and on Node 20, which ignores proxyEnv.
 */
export function googleTransporterOptions(): { agent?: HttpsAgent } {
  if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) return {};
  if (Number(process.versions.node.split('.')[0]) < 22) return {};
  // @types/node 22 does not declare proxyEnv yet.
  proxyAgent ??= new HttpsAgent({ keepAlive: true, proxyEnv: process.env } as AgentOptions);
  return { agent: proxyAgent };
}
