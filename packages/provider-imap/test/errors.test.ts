import { describe, expect, it } from 'vitest';
import { EmailError } from '@fluxmail/core';
import { mapImapError } from '../src/errors.js';

describe('IMAP error mapping', () => {
  it.each([
    [{ code: 'EAUTH', message: 'bad password' }, 'auth_expired'],
    [{ authenticationFailed: true, message: 'login rejected' }, 'auth_expired'],
    [{ code: 'EENVELOPE', message: 'bad recipient' }, 'invalid_request'],
    [{ code: 'ECONNRESET', message: 'connection reset' }, 'provider_unavailable'],
  ] as const)('maps provider failures to EmailError (%s)', (input, code) => {
    expect(mapImapError(input)).toMatchObject({ code });
  });

  it('includes the IMAP server reply for failed commands', () => {
    const error = Object.assign(new Error('Command failed'), {
      responseStatus: 'BAD',
      responseText: 'Message contains bare newlines',
    });
    expect(mapImapError(error)).toMatchObject({
      code: 'provider_unavailable',
      message: 'IMAP/SMTP operation failed: Command failed (BAD: Message contains bare newlines)',
    });
  });

  it('preserves an existing EmailError', () => {
    const error = new EmailError('not_found', 'gone');
    expect(mapImapError(error)).toBe(error);
  });
});
