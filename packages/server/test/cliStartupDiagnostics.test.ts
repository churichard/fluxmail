import { EmailError } from '@fluxmail/core';
import { describe, expect, it } from 'vitest';
import { CliStartupError, cliStartupDiagnostics } from '../src/cliStartupDiagnostics.js';

describe('CLI startup diagnostic privacy', () => {
  it.each(['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EIO', 'EMFILE', 'ENFILE', 'ELOOP', 'ENAMETOOLONG'])(
    'allows the filesystem code %s without collecting the error message',
    (code) => {
      const error = new CliStartupError(
        'invalid_request',
        '/private/path password=secret',
        'credentials_read_failed',
        code,
      );
      expect(cliStartupDiagnostics(error)).toEqual({
        startup_reason: 'credentials_read_failed',
        startup_io_code: code,
      });
    },
  );

  it.each(['private@example.com', '/private/path', { password: 'secret' }, undefined])(
    'maps an unrecognized filesystem code to unknown',
    (code) => {
      const error = new CliStartupError('invalid_request', 'Private message', 'instance_config_read_failed', code);
      expect(cliStartupDiagnostics(error)).toEqual({
        startup_reason: 'instance_config_read_failed',
        startup_io_code: 'unknown',
      });
    },
  );

  it('ignores untyped errors and rejects unexpected reason strings', () => {
    expect(cliStartupDiagnostics(new EmailError('invalid_request', 'Private error'))).toEqual({});
    expect(cliStartupDiagnostics({ startupReason: 'session_invalid', ioCode: 'EACCES' })).toEqual({});
    const error = Object.assign(new CliStartupError('invalid_request', 'Private error', 'session_invalid'), {
      startupReason: 'private@example.com',
    });
    expect(cliStartupDiagnostics(error)).toEqual({});
  });

  it('omits filesystem codes from failures that do not involve file reads', () => {
    const error = new CliStartupError('permission_denied', 'Private session', 'session_invalid', 'EACCES');
    expect(cliStartupDiagnostics(error)).toEqual({ startup_reason: 'session_invalid' });
  });
});
