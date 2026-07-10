import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAttachmentSavePath } from '../src/mcp/buildServer.js';

describe('resolveAttachmentSavePath', () => {
  it('uses only the basename of an attachment filename for directory saves', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-attachment-'));
    expect(resolveAttachmentSavePath(directory, '../../.ssh/authorized_keys')).toBe(
      path.join(directory, 'authorized_keys')
    );
    expect(resolveAttachmentSavePath(`${directory}${path.sep}`, '..\\..\\config.env')).toBe(
      path.join(directory, 'config.env')
    );
  });

  it('preserves an explicit file path selected by the caller', () => {
    const target = path.join(tmpdir(), 'renamed.pdf');
    expect(resolveAttachmentSavePath(target, '../../report.pdf')).toBe(target);
  });
});
