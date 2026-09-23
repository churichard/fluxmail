import { EmailError, isEmailError } from '@fluxmail/core';

export function mapImapError(error: unknown): EmailError {
  if (isEmailError(error)) return error;
  const value = error as {
    code?: string;
    responseStatus?: string;
    responseText?: string;
    authenticationFailed?: boolean;
    message?: string;
  };
  const message = value?.message ?? String(error);
  // ImapFlow reports every NO/BAD reply as "Command failed" and puts the server's reason in responseText.
  const detail = value?.responseText ? `${message} (${value.responseStatus ?? 'NO'}: ${value.responseText})` : message;
  if (value?.authenticationFailed || value?.code === 'EAUTH' || /auth|credential|login/i.test(message)) {
    return new EmailError('auth_expired', `IMAP/SMTP authentication failed: ${detail}`);
  }
  if (value?.code === 'EENVELOPE' || value?.code === 'EMESSAGE') {
    return new EmailError('invalid_request', message);
  }
  return new EmailError('provider_unavailable', `IMAP/SMTP operation failed: ${detail}`);
}
