import { EmailError } from '@fluxmail/core';

interface GoogleApiErrorLike {
  code?: number | string;
  message?: string;
  response?: { status?: number };
  errors?: Array<{ reason?: string }>;
}

function statusOf(err: GoogleApiErrorLike): number | undefined {
  if (typeof err.code === 'number') return err.code;
  if (typeof err.code === 'string' && /^\d+$/.test(err.code)) return Number(err.code);
  return err.response?.status;
}

export function isRetryable(err: unknown): boolean {
  const status = statusOf(err as GoogleApiErrorLike);
  return status === 429 || status === 500 || status === 502 || status === 503;
}

/** Map googleapis errors onto the normalized EmailError codes. */
export function toEmailError(err: unknown): EmailError {
  if (err instanceof EmailError) return err;
  const e = err as GoogleApiErrorLike & Error;
  const status = statusOf(e);
  const message = e.message ?? 'Gmail API error';

  // invalid_grant = revoked/expired refresh token; comes back as a 400.
  if (status === 401 || /invalid_grant/i.test(message)) {
    return new EmailError('auth_expired', `Gmail authorization expired or revoked: ${message}`);
  }
  if (status === 429 || e.errors?.some((x) => /ratelimit/i.test(x.reason ?? ''))) {
    return new EmailError('rate_limited', `Gmail rate limit hit: ${message}`);
  }
  if (status === 403) {
    return new EmailError('rate_limited', `Gmail quota or permission error: ${message}`);
  }
  if (status === 404) {
    return new EmailError('not_found', `Not found in Gmail: ${message}`);
  }
  if (status === 400) {
    return new EmailError('invalid_request', message);
  }
  return new EmailError('provider_unavailable', `Gmail API failure: ${message}`);
}

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw toEmailError(err);
      const delayMs = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delayMs));
      attempt++;
    }
  }
}
