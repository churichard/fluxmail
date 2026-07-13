import { PostHog } from 'posthog-node';
import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import path from 'node:path';
import { readStoredConfig } from './config.js';
import { VERSION } from './version.js';

// PostHog project tokens are public ingestion identifiers. This is the same
// project and first-party proxy used by fluxmail.ai.
const POSTHOG_PROJECT_TOKEN = 'phc_t9WdWpoONslidKRejBKMYG8FLjLo0tR84U8lFKE4MlN';
const POSTHOG_HOST = 'https://t.fluxmail.ai';
const POSTHOG_REQUEST_TIMEOUT_MS = 500;
const POSTHOG_SHUTDOWN_TIMEOUT_MS = 1_000;

export type TelemetryProperties = Record<string, boolean | number | string | undefined>;

export interface Telemetry {
  capture(event: string, properties?: TelemetryProperties): void;
  shutdown(): Promise<void>;
}

interface PostHogClient {
  captureImmediate(options: {
    distinctId: string;
    event: string;
    properties: Record<string, boolean | number | string>;
    disableGeoip?: boolean;
  }): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}

interface PostHogFetchOptions {
  method?: string;
  headers: Record<string, string>;
  body?: string | Blob;
  signal?: AbortSignal;
}

interface PostHogFetchResponse {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers: { get(name: string): string | null };
}

interface PostHogTransport {
  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse>;
  destroy(): void;
}

/** Keep pooled analytics sockets under our control so shutdown can close them. */
function createPostHogTransport(): PostHogTransport {
  const httpAgent = new HttpAgent({ keepAlive: true });
  const httpsAgent = new HttpsAgent({ keepAlive: true });

  return {
    async fetch(url, options) {
      const target = new URL(url);
      const send = target.protocol === 'https:' ? httpsRequest : target.protocol === 'http:' ? httpRequest : undefined;
      if (!send) throw new Error(`Unsupported telemetry URL protocol: ${target.protocol}`);

      const body =
        options.body instanceof Blob
          ? Buffer.from(await options.body.arrayBuffer())
          : options.body === undefined
            ? undefined
            : Buffer.from(options.body);

      return new Promise((resolve, reject) => {
        const request = send(
          target,
          {
            method: options.method,
            headers: options.headers,
            signal: options.signal,
            agent: target.protocol === 'https:' ? httpsAgent : httpAgent,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.once('error', reject);
            response.once('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              resolve({
                status: response.statusCode ?? 0,
                text: async () => text,
                json: async () => JSON.parse(text) as unknown,
                headers: {
                  get(name) {
                    const value = response.headers[name.toLowerCase()];
                    return Array.isArray(value) ? value.join(', ') : (value ?? null);
                  },
                },
              });
            });
          },
        );
        request.once('error', reject);
        request.end(body);
      });
    },
    destroy() {
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && !['', '0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

const TELEMETRY_ID_PATTERN = /^[a-f0-9]{32}$/;

function readTelemetryId(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const id = readFileSync(file, 'utf8').trim();
  return TELEMETRY_ID_PATTERN.test(id) ? id : undefined;
}

export function publishTelemetryId(file: string, candidateFile: string, candidateId: string): string {
  try {
    linkSync(candidateFile, file);
    return candidateId;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const existingId = readTelemetryId(file);
    if (existingId) return existingId;

    // Preserve self-repair for a corrupt ID file. Normal first-run races never
    // reach this path because the linked candidate is complete before publishing.
    writeFileSync(file, `${candidateId}\n`, { mode: 0o600 });
    return candidateId;
  }
}

function loadTelemetryId(dataDir: string): string {
  const file = path.join(dataDir, 'telemetry.id');
  const id = randomBytes(16).toString('hex');
  const candidateFile = `${file}.${process.pid}.${id}.tmp`;
  writeFileSync(candidateFile, `${id}\n`, { flag: 'wx', mode: 0o600 });
  try {
    return publishTelemetryId(file, candidateFile, id);
  } finally {
    rmSync(candidateFile, { force: true });
  }
}

function telemetryDisabledFile(dataDir: string): string {
  return path.join(dataDir, 'telemetry.disabled');
}

export function telemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.FLUXMAIL_TELEMETRY?.toLowerCase();
  return (
    setting === '0' ||
    setting === 'false' ||
    setting === 'no' ||
    setting === 'off' ||
    isTruthy(env.DO_NOT_TRACK) ||
    env.NODE_ENV === 'test' ||
    env.VITEST !== undefined
  );
}

export function isTelemetryEnabled(dataDir: string, env?: NodeJS.ProcessEnv): boolean {
  return !existsSync(telemetryDisabledFile(dataDir)) && !telemetryDisabled(env ?? withStoredTelemetrySetting(dataDir));
}

export function setTelemetryEnabled(dataDir: string, enabled: boolean): void {
  const file = telemetryDisabledFile(dataDir);
  if (enabled) rmSync(file, { force: true });
  else writeFileSync(file, 'disabled\n', { mode: 0o600 });
}

export function withStoredTelemetrySetting(dataDir: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.FLUXMAIL_TELEMETRY !== undefined) return env;
  const storedSetting = readStoredConfig(dataDir).FLUXMAIL_TELEMETRY;
  return storedSetting === undefined ? env : { ...env, FLUXMAIL_TELEMETRY: storedSetting };
}

export function createTelemetry(options: {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  client?: PostHogClient;
}): Telemetry {
  const env = options.env ?? withStoredTelemetrySetting(options.dataDir);
  let initialized: { client: PostHogClient; distinctId: string; transport?: PostHogTransport } | undefined;
  let initializationFailed = false;
  let closed = false;

  function initialize(): typeof initialized {
    if (closed || initializationFailed || !isTelemetryEnabled(options.dataDir, env)) return undefined;
    if (initialized) return initialized;
    let transport: PostHogTransport | undefined;
    try {
      const distinctId = loadTelemetryId(options.dataDir);
      transport = options.client ? undefined : createPostHogTransport();
      const client =
        options.client ??
        new PostHog(env.FLUXMAIL_POSTHOG_KEY ?? POSTHOG_PROJECT_TOKEN, {
          host: env.FLUXMAIL_POSTHOG_HOST ?? POSTHOG_HOST,
          disableGeoip: true,
          flushAt: 20,
          flushInterval: 10_000,
          requestTimeout: POSTHOG_REQUEST_TIMEOUT_MS,
          fetchRetryCount: 0,
          fetch: transport?.fetch,
        });
      initialized = { client, distinctId, transport };
      return initialized;
    } catch {
      transport?.destroy();
      initializationFailed = true;
      return undefined;
    }
  }

  return {
    capture(event, properties = {}) {
      const telemetry = initialize();
      if (!telemetry) return;
      try {
        void telemetry.client
          .captureImmediate({
            distinctId: telemetry.distinctId,
            event,
            disableGeoip: true,
            properties: {
              ...Object.fromEntries(Object.entries(properties).filter((entry) => entry[1] !== undefined)),
              $process_person_profile: false,
              fluxmail_version: VERSION,
              node_version: process.versions.node,
              platform: process.platform,
              arch: process.arch,
            } as Record<string, boolean | number | string>,
          })
          .catch(() => {});
      } catch {
        // Telemetry must never affect Fluxmail behavior.
      }
    },
    async shutdown() {
      closed = true;
      if (!initialized) return;
      try {
        await initialized.client.shutdown(POSTHOG_SHUTDOWN_TIMEOUT_MS);
      } catch {
        // Network and analytics failures are intentionally ignored.
      } finally {
        initialized.transport?.destroy();
      }
    },
  };
}

let sharedTelemetry: Telemetry | undefined;

export function getTelemetry(dataDir: string): Telemetry {
  sharedTelemetry ??= createTelemetry({ dataDir });
  return sharedTelemetry;
}

export async function shutdownTelemetry(): Promise<void> {
  const telemetry = sharedTelemetry;
  sharedTelemetry = undefined;
  await telemetry?.shutdown();
}
