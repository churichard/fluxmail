import { describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { identityFromIdToken } from '../src/accounts/googleAuth.js';

function oauthClient(claims: Record<string, unknown>): OAuth2Client {
  return {
    _clientId: 'client-id',
    verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => claims }),
  } as unknown as OAuth2Client;
}

describe('Google OAuth identity', () => {
  it('verifies the id token against the configured client id', async () => {
    const client = oauthClient({
      email: 'me@example.com',
      email_verified: true,
      name: 'Example User',
    });

    await expect(identityFromIdToken(client, { id_token: 'signed-token' })).resolves.toEqual({
      email: 'me@example.com',
      displayName: 'Example User',
    });
    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-token',
      audience: 'client-id',
    });
  });

  it('rejects an unverified email claim', async () => {
    const client = oauthClient({ email: 'me@example.com', email_verified: false });

    await expect(identityFromIdToken(client, { id_token: 'signed-token' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it('rejects a verified token with no claims payload', async () => {
    const client = oauthClient({});
    vi.mocked(client.verifyIdToken).mockResolvedValue({ getPayload: () => undefined } as never);

    await expect(identityFromIdToken(client, { id_token: 'signed-token' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });
});
