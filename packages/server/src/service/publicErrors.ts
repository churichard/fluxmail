import { EmailError, isEmailError } from '@fluxmail/core';

/** Validation produced by Fluxmail from caller input, safe to return to that caller. */
export class ClientInputError extends EmailError {
  constructor(code: 'invalid_request', message: string, data?: Record<string, unknown>) {
    super(code, message, data);
  }
}

const MESSAGES: Record<string, string> = {
  auth_expired: 'The account needs to be connected again.',
  rate_limited: 'The mail provider is rate limiting requests. Try again later.',
  not_found: 'The requested mail item was not found.',
  invalid_request: 'The request is invalid.',
  idempotency_conflict: 'This idempotency key belongs to a different delivery request.',
  provider_unavailable: 'The mail provider could not complete the request.',
  entitlement_exceeded: 'The current subscription does not allow this operation.',
  permission_denied: 'This credential cannot perform the operation.',
  unsupported_capability: 'The provider does not support this operation.',
  internal: 'The request could not be completed.',
};

export function publicError(
  error: unknown,
  requestId: string,
): {
  code: string;
  message: string;
  requestId: string;
  data?: Record<string, unknown>;
} {
  const code = isEmailError(error) ? error.code : 'internal';
  const retryAfterMs = isEmailError(error) ? error.data?.retryAfterMs : undefined;
  const diagnostics = error instanceof ClientInputError ? error.data?.diagnostics : undefined;
  return {
    code,
    message: error instanceof ClientInputError ? error.message : (MESSAGES[code] ?? MESSAGES.internal!),
    requestId,
    ...(diagnostics !== undefined ||
    (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0)
      ? {
          data: {
            ...(diagnostics !== undefined ? { diagnostics } : {}),
            ...(typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
              ? { retryAfterMs }
              : {}),
          },
        }
      : {}),
  };
}
