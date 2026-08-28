import type { Provider } from '@fluxmail/core';
import type { FluxmailConfig } from '../config.js';
import type { TelemetryProperties } from '../telemetry.js';
import { DEFAULT_GOOGLE_CLIENT_ID } from './defaultGoogleOAuth.js';
import type { AccountRegistry } from './registry.js';

/** Where the provider sends the browser after consent. */
export type ConnectionFlow = 'hosted' | 'loopback';

/** Fluxmail's built-in OAuth application, or one the operator registered. */
export type OAuthAppKind = 'built-in' | 'custom';

/**
 * Outlook has no built-in application, so any Entra app the instance uses is
 * the operator's own.
 */
export function oauthAppKind(provider: Provider, clientId: string | undefined): OAuthAppKind | undefined {
  if (provider === 'imap' || !clientId) return undefined;
  return provider === 'gmail' && clientId === DEFAULT_GOOGLE_CLIENT_ID ? 'built-in' : 'custom';
}

/** The OAuth application this instance is configured to use for a provider. */
export function configuredOAuthAppKind(config: FluxmailConfig, provider: Provider): OAuthAppKind | undefined {
  return oauthAppKind(provider, provider === 'gmail' ? config.google?.clientId : config.microsoft?.clientId);
}

export interface ConnectionTelemetry {
  provider: Provider;
  reauthorize: boolean;
  flow?: ConnectionFlow;
  oauthApp?: OAuthAppKind;
}

/** Describe a connection attempt without naming the mailbox it connects. */
export function connectionProperties(connection: ConnectionTelemetry): TelemetryProperties {
  return {
    provider: connection.provider,
    reauthorize: connection.reauthorize,
    ...(connection.flow ? { connection_flow: connection.flow } : {}),
    ...(connection.oauthApp ? { oauth_app: connection.oauthApp } : {}),
  };
}

/** Mailbox totals by provider. Counts only: no address, id, or credential. */
export function accountInventoryProperties(
  registry: Pick<AccountRegistry, 'accountProviderCounts'> | undefined,
): TelemetryProperties {
  try {
    const counts = registry?.accountProviderCounts();
    if (!counts) return {};
    return {
      account_count: counts.total,
      gmail_account_count: counts.gmail,
      outlook_account_count: counts.outlook,
      imap_account_count: counts.imap,
    };
  } catch {
    // Telemetry must never affect a connection result.
    return {};
  }
}
