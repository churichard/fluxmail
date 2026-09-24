import { describe, expect, it } from 'vitest';
import { EmailError } from '@fluxmail/core';
import { ClientInputError, publicError } from '../src/service/publicErrors.js';

describe('public errors', () => {
  it('keeps Fluxmail input guidance and search diagnostics', () => {
    const diagnostics = [{ code: 'conflicting_filter', severity: 'error', message: 'Choose one sender.' }];
    expect(
      publicError(new ClientInputError('invalid_request', 'Choose one sender.', { diagnostics }), 'request_1'),
    ).toEqual({
      code: 'invalid_request',
      message: 'Choose one sender.',
      requestId: 'request_1',
      data: { diagnostics },
    });
  });

  it('hides provider validation text and unapproved data', () => {
    const result = publicError(
      new EmailError('invalid_request', 'private provider response', { recipient: 'private@example.com' }),
      'request_2',
    );
    expect(result).toEqual({ code: 'invalid_request', message: 'The request is invalid.', requestId: 'request_2' });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
  });
});
