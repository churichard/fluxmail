import { EmailError } from '@fluxmail/core';
import type { FluxmailConfig } from '../config.js';
import type { FluxmailDb } from '../storage/db.js';
import { createGmailConnectionGrant, type GmailConnectionIntent } from '../storage/gmailConnectionGrants.js';
import { requireGoogleConfig } from './googleAuth.js';

export type GmailConnectionMode = 'local' | 'hosted';

function isLoopbackPublicUrl(publicUrl: string): boolean {
  const hostname = new URL(publicUrl).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateAccountConnectionFlags(
  provider: 'gmail' | 'imap',
  options: { local?: boolean; hosted?: boolean },
): void {
  if (provider === 'imap' && (options.local || options.hosted)) {
    throw new EmailError('invalid_request', '--local and --hosted are only available for Gmail accounts.');
  }
}

export function selectGmailConnectionMode(
  config: FluxmailConfig,
  options: { local?: boolean; hosted?: boolean },
): GmailConnectionMode {
  if (options.local && options.hosted) {
    throw new EmailError('invalid_request', '--local and --hosted cannot be used together.');
  }
  if (options.hosted && !config.publicUrlConfigured) {
    throw new EmailError('invalid_request', '--hosted requires FLUXMAIL_PUBLIC_URL to be set.');
  }
  return options.hosted || (config.publicUrlConfigured && !options.local && !isLoopbackPublicUrl(config.publicUrl))
    ? 'hosted'
    : 'local';
}

export function prepareHostedGmailConnection(
  db: FluxmailDb,
  config: FluxmailConfig,
  intent: GmailConnectionIntent,
): { connectionUrl: string; expiresAt: number } {
  requireGoogleConfig(config);
  const { token, expiresAt } = createGmailConnectionGrant(db, intent);
  return {
    connectionUrl: `${config.publicUrl}/auth/google/connect?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}
