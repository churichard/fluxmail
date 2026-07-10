import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { EmailError } from '@fluxmail/core';
import type { FluxmailConfig } from '../config.js';

/**
 * Full mail scope: the unified API includes permanent delete, which Gmail only
 * allows with https://mail.google.com/ (gmail.modify cannot call messages.delete).
 * Users bring their own OAuth app, so they are consenting to their own credentials.
 */
export const GMAIL_SCOPES = ['https://mail.google.com/', 'openid', 'email', 'profile'];

export function requireGoogleConfig(config: FluxmailConfig): { clientId: string; clientSecret: string } {
  if (!config.google) {
    throw new EmailError(
      'invalid_request',
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. Create OAuth credentials in Google Cloud ' +
        '(see README "Google setup") and set both environment variables.'
    );
  }
  return config.google;
}

export function createOAuthClient(config: FluxmailConfig, redirectUri: string): OAuth2Client {
  const { clientId, clientSecret } = requireGoogleConfig(config);
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export function buildAuthUrl(client: OAuth2Client, state: string): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Extract the authenticated identity from the OAuth id_token (openid+email+profile scopes). */
export function identityFromIdToken(tokens: Credentials): { email: string; displayName?: string } {
  const idToken = tokens.id_token;
  if (!idToken) throw new EmailError('provider_unavailable', 'Google did not return an id_token');
  const payload = idToken.split('.')[1];
  if (!payload) throw new EmailError('provider_unavailable', 'Malformed id_token from Google');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    email?: string;
    name?: string;
  };
  if (!claims.email) throw new EmailError('provider_unavailable', 'Google id_token has no email claim');
  return { email: claims.email, ...(claims.name ? { displayName: claims.name } : {}) };
}

export interface OAuthResult {
  email: string;
  displayName?: string;
  tokens: Credentials;
}

export async function exchangeCode(client: OAuth2Client, code: string): Promise<OAuthResult> {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new EmailError(
      'invalid_request',
      'Google did not return a refresh token. Remove Fluxmail from the account\'s third-party access ' +
        '(myaccount.google.com/permissions) and try again.'
    );
  }
  return { ...identityFromIdToken(tokens), tokens };
}

/**
 * Loopback OAuth flow for the CLI: listens once on config.oauthPort, prints the
 * consent URL, and resolves when Google redirects back with a code.
 */
export async function runLoopbackFlow(
  config: FluxmailConfig,
  onAuthUrl: (url: string) => void
): Promise<OAuthResult> {
  const redirectUri = `http://localhost:${config.oauthPort}/oauth/callback`;
  const client = createOAuthClient(config, redirectUri);
  const state = randomBytes(16).toString('hex');

  return new Promise<OAuthResult>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      // Close the listener and destroy lingering keep-alive sockets (the browser
      // holds its connection open after loading the page); otherwise the CLI
      // process never exits.
      const finish = (settle: () => void) => {
        res.once('close', () => {
          server.close();
          server.closeAllConnections();
          settle();
        });
      };
      try {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404).end('Not found');
          return;
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400).end('State mismatch. Restart the flow.');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          finish(() => reject(new EmailError('invalid_request', `Google OAuth error: ${error}`)));
          res.writeHead(400).end(`Google returned an error: ${error}. You can close this tab.`);
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400).end('Missing code parameter.');
          return;
        }
        const result = await exchangeCode(client, code);
        finish(() => resolve(result));
        res.writeHead(200, { 'content-type': 'text/html' }).end(
          `<html><body style="font-family: sans-serif"><h2>${result.email} is connected to Fluxmail</h2>` +
            '<p>You can close this tab and return to the terminal.</p></body></html>'
        );
      } catch (err) {
        finish(() => reject(err));
        res.writeHead(500).end('Token exchange failed; check the terminal.');
      }
    });
    server.on('error', reject);
    server.listen(config.oauthPort, config.oauthHost, () => {
      onAuthUrl(buildAuthUrl(client, state));
    });
  });
}
