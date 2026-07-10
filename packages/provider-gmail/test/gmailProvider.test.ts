import { OAuth2Client } from 'googleapis-common';
import { describe, expect, it, vi } from 'vitest';
import { GmailProvider } from '../src/gmailProvider.js';

interface ProviderInternals {
  gmail: {
    users: {
      settings: {
        sendAs: {
          list: () => Promise<{ data: { sendAs?: Array<{ isPrimary?: boolean; displayName?: string }> } }>;
        };
      };
    };
  };
  resolveSenderName: () => Promise<string | null>;
}

function providerWith(
  auth: OAuth2Client,
  sendAs: Array<{ isPrimary?: boolean; displayName?: string }>,
  displayName?: string
): ProviderInternals {
  const provider = new GmailProvider({
    accountId: 'acct_1',
    email: 'me@example.com',
    ...(displayName ? { displayName } : {}),
    auth,
  });
  const internals = provider as unknown as ProviderInternals;
  internals.gmail = {
    users: {
      settings: {
        sendAs: { list: vi.fn().mockResolvedValue({ data: { sendAs } }) },
      },
    },
  };
  return internals;
}

describe('GmailProvider sender name', () => {
  it('uses the primary Gmail send-as display name when configured', async () => {
    const auth = new OAuth2Client();
    const request = vi.spyOn(auth, 'request');
    const provider = providerWith(auth, [{ isPrimary: true, displayName: 'Gmail Name' }], 'Stored Name');

    await expect(provider.resolveSenderName()).resolves.toBe('Gmail Name');
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back to the current Google profile name for existing accounts without a stored name', async () => {
    const auth = new OAuth2Client();
    vi.spyOn(auth, 'request').mockResolvedValue({ data: { name: 'Richard Chu' } } as never);
    const provider = providerWith(auth, [{ isPrimary: true, displayName: '' }]);

    await expect(provider.resolveSenderName()).resolves.toBe('Richard Chu');
  });

  it('uses the stored name when profile lookup fails', async () => {
    const auth = new OAuth2Client();
    vi.spyOn(auth, 'request').mockRejectedValue(new Error('userinfo unavailable'));
    const provider = providerWith(auth, [], 'Stored Name');

    await expect(provider.resolveSenderName()).resolves.toBe('Stored Name');
  });
});

describe('GmailProvider draft ids', () => {
  it('maps a draft message id to the id required by draft operations', async () => {
    const provider = new GmailProvider({
      accountId: 'acct_1',
      email: 'me@example.com',
      auth: new OAuth2Client(),
    });
    const internals = provider as unknown as {
      gmail: {
        users: {
          messages: { get: () => Promise<{ data: object }> };
          labels: { list: () => Promise<{ data: { labels: never[] } }> };
          drafts: { list: () => Promise<{ data: { drafts: object[] } }> };
        };
      };
    };
    internals.gmail = {
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'msg_1',
              threadId: 'thread_1',
              labelIds: ['DRAFT'],
              internalDate: '1751976000000',
              payload: { headers: [{ name: 'Subject', value: 'Saved draft' }] },
            },
          }),
        },
        labels: { list: vi.fn().mockResolvedValue({ data: { labels: [] } }) },
        drafts: {
          list: vi.fn().mockResolvedValue({
            data: { drafts: [{ id: 'draft_1', message: { id: 'msg_1', threadId: 'thread_1' } }] },
          }),
        },
      },
    };

    await expect(provider.getMessage('msg_1')).resolves.toMatchObject({
      id: 'msg_1',
      draftId: 'draft_1',
      flags: { draft: true },
    });
  });
});
