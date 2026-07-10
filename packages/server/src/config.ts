import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface FluxmailConfig {
  dataDir: string;
  dbPath: string;
  /** 32-byte key for AES-256-GCM token encryption. */
  encryptionKey: Buffer;
  port: number;
  /** Public base URL of the HTTP server, used to build OAuth redirect URIs. */
  baseUrl: string;
  /** Port for the ephemeral loopback OAuth listener used by `fluxmail accounts add`. */
  oauthPort: number;
  /** Bind address for the OAuth listener. Docker uses 0.0.0.0 so its published port can reach it. */
  oauthHost: string;
  /** 'apikey' (default) requires a bearer token on /mcp; 'none' is for trusted networks only. */
  authMode: 'apikey' | 'none';
  google?: {
    clientId: string;
    clientSecret: string;
  };
}

function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        const parsed = JSON.parse(value) as unknown;
        value = typeof parsed === 'string' ? parsed : value.slice(1, -1);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function applyDotEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnvContent(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Load .env.local and .env from the working directory. Real environment
 * variables always win; .env.local wins over .env.
 */
export function loadDotEnv(cwd = process.cwd()): void {
  applyDotEnvFile(path.join(cwd, '.env.local'));
  applyDotEnvFile(path.join(cwd, '.env'));
}

/** Expand a leading "~" (e.g. FLUXMAIL_DATA_DIR=~/.fluxmail), which Node does not do. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

/** Resolve (and create) the data dir, honoring cwd .env files and FLUXMAIL_DATA_DIR. */
export function resolveDataDir(): string {
  loadDotEnv();
  const fromEnv = process.env.FLUXMAIL_DATA_DIR;
  const dataDir = fromEnv ? expandHome(fromEnv) : path.join(homedir(), '.fluxmail');
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function configFilePath(dataDir: string): string {
  return path.join(dataDir, 'config.env');
}

/** Settings persisted by `fluxmail config set`, e.g. GOOGLE_CLIENT_ID. */
export function readStoredConfig(dataDir: string): Record<string, string> {
  const file = configFilePath(dataDir);
  if (!existsSync(file)) return {};
  return parseEnvContent(readFileSync(file, 'utf8'));
}

const CONFIG_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function setStoredConfig(dataDir: string, key: string, value: string): void {
  if (!CONFIG_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid key "${key}": use UPPER_SNAKE_CASE, e.g. GOOGLE_CLIENT_ID`);
  }
  if (key === 'FLUXMAIL_DATA_DIR') {
    throw new Error('FLUXMAIL_DATA_DIR cannot be stored in the data dir itself; set it in your shell or a .env file');
  }
  const stored = readStoredConfig(dataDir);
  stored[key] = value;
  writeStoredConfig(dataDir, stored);
}

export function unsetStoredConfig(dataDir: string, key: string): boolean {
  const stored = readStoredConfig(dataDir);
  if (!(key in stored)) return false;
  delete stored[key];
  writeStoredConfig(dataDir, stored);
  return true;
}

function writeStoredConfig(dataDir: string, values: Record<string, string>): void {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  writeFileSync(configFilePath(dataDir), lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
}

function loadEncryptionKey(dataDir: string): Buffer {
  const fromEnv = process.env.FLUXMAIL_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length !== 32) {
      throw new Error('FLUXMAIL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return key;
  }
  // Auto-generate on first run so getting started requires zero key management.
  const keyPath = path.join(dataDir, 'encryption.key');
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex');
    if (key.length !== 32) throw new Error(`Corrupt encryption key at ${keyPath}`);
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('hex') + '\n', { mode: 0o600 });
  return key;
}

export function loadConfig(): FluxmailConfig {
  // Precedence: shell env > cwd .env.local > cwd .env > data-dir config.env.
  const dataDir = resolveDataDir();
  applyDotEnvFile(configFilePath(dataDir));

  const port = Number(process.env.FLUXMAIL_PORT ?? 8977);
  const authModeEnv = process.env.FLUXMAIL_AUTH ?? 'apikey';
  if (authModeEnv !== 'apikey' && authModeEnv !== 'none') {
    throw new Error(`FLUXMAIL_AUTH must be "apikey" or "none", got "${authModeEnv}"`);
  }

  const config: FluxmailConfig = {
    dataDir,
    dbPath: process.env.FLUXMAIL_DB_PATH
      ? expandHome(process.env.FLUXMAIL_DB_PATH)
      : path.join(dataDir, 'fluxmail.db'),
    encryptionKey: loadEncryptionKey(dataDir),
    port,
    baseUrl: process.env.FLUXMAIL_BASE_URL ?? `http://localhost:${port}`,
    oauthPort: Number(process.env.FLUXMAIL_OAUTH_PORT ?? 8976),
    oauthHost: process.env.FLUXMAIL_OAUTH_HOST ?? '127.0.0.1',
    authMode: authModeEnv,
  };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    config.google = { clientId, clientSecret };
  }
  return config;
}
