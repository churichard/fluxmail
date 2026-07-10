import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAttachmentSavePath, saveAttachment, toSendRequest } from '../src/mcp/buildServer.js';

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

  it('does not overwrite an explicitly selected file path', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-attachment-'));
    const target = path.join(directory, 'report.pdf');
    writeFileSync(target, 'existing');

    expect(() => saveAttachment(target, 'ignored.pdf', Buffer.from('replacement'))).toThrow(
      /Refusing to overwrite/
    );
    expect(readFileSync(target, 'utf8')).toBe('existing');
  });

  it('does not overwrite an existing file during a directory save', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-attachment-'));
    const target = path.join(directory, 'report.pdf');
    writeFileSync(target, 'existing');

    expect(() => saveAttachment(directory, 'report.pdf', Buffer.from('replacement'))).toThrow(
      /Refusing to overwrite/
    );
    expect(readFileSync(target, 'utf8')).toBe('existing');
  });

  it('does not follow a destination symlink during a directory save', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-attachment-'));
    const victim = path.join(directory, 'victim.txt');
    writeFileSync(victim, 'existing');
    symlinkSync(victim, path.join(directory, 'report.pdf'));

    expect(() => saveAttachment(directory, 'report.pdf', Buffer.from('replacement'))).toThrow(
      /Refusing to overwrite/
    );
    expect(readFileSync(victim, 'utf8')).toBe('existing');
  });

  it('rejects relative save paths', () => {
    expect(() => saveAttachment('downloads', 'report.pdf', Buffer.from('data'))).toThrow(
      /must be absolute/
    );
  });
});

describe('toSendRequest', () => {
  it('uses an existing draft when no replacement content is supplied', () => {
    expect(toSendRequest({ draftId: 'draft_1' })).toEqual({ draftId: 'draft_1' });
  });

  it('rejects content fields combined with an existing draft id', () => {
    expect(() => toSendRequest({ draftId: 'draft_1', bodyText: 'replacement' })).toThrow(
      /update the draft/
    );
  });

  it('rejects replyAll without a reply target', () => {
    expect(() => toSendRequest({ replyAll: true })).toThrow(/requires replyToMessageId/);
  });
});
