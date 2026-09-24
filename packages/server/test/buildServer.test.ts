import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EmailError } from '@fluxmail/core';
import type { EmailService } from '../src/service/emailService.js';
import { buildMcpServer, toSendRequest, type McpServerOptions } from '../src/mcp/buildServer.js';
import { customPermissionPolicy, permissionPolicyForProfile } from '../src/permissions.js';
import type { Telemetry } from '../src/telemetry.js';
import type { Logger } from '../src/logging.js';

const draftMessage = {
  id: 'd1',
  threadId: 't1',
  accountId: 'acct_1',
  from: { email: 'me@example.com' },
  to: [{ email: 'recipient@example.com' }],
  subject: 'Reply',
  date: '2026-07-11T09:00:00.000Z',
  body: { text: 'Reply' },
  attachments: [],
  flags: { read: true, starred: false, draft: true },
  draftId: 'd1',
};

function loggerSpy(): { logger: Logger; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const error = vi.fn();
  return {
    warn,
    error,
    logger: {
      info: vi.fn(),
      warn,
      error,
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function connectMcp(service: Partial<EmailService>, options?: McpServerOptions) {
  const server = buildMcpServer(service as EmailService, options);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function telemetrySpy(): {
  telemetry: Telemetry;
  capture: ReturnType<typeof vi.fn>;
  beginActivity: ReturnType<typeof vi.fn>;
  finishActivity: ReturnType<typeof vi.fn>;
} {
  const capture = vi.fn();
  const finishActivity = vi.fn();
  const beginActivity = vi.fn(() => finishActivity);
  return {
    capture,
    beginActivity,
    finishActivity,
    telemetry: { capture, beginActivity, shutdown: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('toSendRequest', () => {
  it('uses an existing draft when no replacement content is supplied', () => {
    expect(toSendRequest({ draftId: 'draft_1' })).toEqual({ draftId: 'draft_1' });
  });

  it('rejects content fields combined with an existing draft id', () => {
    expect(() => toSendRequest({ draftId: 'draft_1', bodyText: 'replacement' })).toThrow(/update the draft/);
    expect(() => toSendRequest({ draftId: 'draft_1', from: 'sales@example.com' })).toThrow(/update the draft/);
  });

  it('rejects replyAll without a reply target', () => {
    expect(() => toSendRequest({ replyAll: true })).toThrow(/requires replyToMessageId/);
  });
});

describe('MCP permissions', () => {
  const readTools = [
    'download_attachment',
    'get_email',
    'get_email_body',
    'get_status',
    'get_thread',
    'list_accounts',
    'list_emails',
    'list_folders',
    'list_labels',
    'list_scheduled_emails',
    'list_send_as',
    'search_emails',
    'search_emails_batch',
  ];

  async function toolNames(options: McpServerOptions): Promise<string[]> {
    const client = await connectMcp({ enforceQuota: () => undefined }, options);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  }

  it('advertises only read tools for the read-only profile', async () => {
    await expect(toolNames({ permissions: permissionPolicyForProfile('read-only') })).resolves.toEqual(readTools);
  });

  it('uses mail.read for every read tool', async () => {
    await expect(toolNames({ permissions: customPermissionPolicy(['mail.read']) })).resolves.toEqual(readTools);
  });

  it('adds safe write tools but not send tools for the read-write profile', async () => {
    const names = await toolNames({ permissions: permissionPolicyForProfile('read-write') });
    expect(names).toEqual(
      [
        ...readTools,
        'cancel_scheduled_email',
        'create_draft',
        'delete_draft',
        'get_draft',
        'modify_emails',
        'update_draft',
      ].sort(),
    );
    expect(names).not.toContain('send_email');
    expect(names).not.toContain('forward_email');
  });

  it('uses one capability for trash and untrash but keeps permanent delete separate', async () => {
    const modify = vi.fn().mockResolvedValue({ succeededIds: ['m1'], failed: [], uncertainIds: [] });
    const client = await connectMcp({ enforceQuota: () => undefined, modify } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.trash']),
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['modify_emails']);

    const trashed = await client.callTool({
      name: 'modify_emails',
      arguments: { messageIds: ['m1'], action: 'trash' },
    });
    expect(trashed.isError).toBeFalsy();
    expect(modify).toHaveBeenCalledWith(undefined, ['m1'], 'trash');

    const restored = await client.callTool({
      name: 'modify_emails',
      arguments: { messageIds: ['m1'], action: 'untrash' },
    });
    expect(restored.isError).toBeFalsy();
    expect(modify).toHaveBeenCalledWith(undefined, ['m1'], 'untrash');

    const deleted = await client.callTool({
      name: 'modify_emails',
      arguments: { messageIds: ['m1'], action: 'delete' },
    });
    expect(deleted.isError).toBe(true);
    expect(modify).toHaveBeenCalledTimes(2);
  });

  it('uses mail.organize for reversible message organization', async () => {
    const modify = vi.fn().mockResolvedValue({ succeededIds: ['m1'], failed: [], uncertainIds: [] });
    const client = await connectMcp({ enforceQuota: () => undefined, modify } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.organize']),
    });

    const tools = await client.listTools();
    const modifyTool = tools.tools.find((tool) => tool.name === 'modify_emails');
    expect(modifyTool?.inputSchema.properties?.action).toMatchObject({
      enum: ['markRead', 'markUnread', 'star', 'unstar', 'archive', 'move', 'addLabels', 'removeLabels'],
    });

    for (const action of ['markRead', 'markUnread', 'star', 'unstar']) {
      const result = await client.callTool({
        name: 'modify_emails',
        arguments: { messageIds: ['m1'], action },
      });
      expect(result.isError).toBeFalsy();
      expect(modify).toHaveBeenCalledWith(undefined, ['m1'], action);
    }
  });

  it('does not let generic move permissions change protected folders', async () => {
    const modify = vi.fn().mockResolvedValue({ succeededIds: ['m1'], failed: [], uncertainIds: [] });
    const client = await connectMcp({ enforceQuota: () => undefined, modify } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.organize']),
    });

    for (const arguments_ of [
      { messageIds: ['m1'], action: 'move', folder: 'Trash' },
      { messageIds: ['m1'], action: 'move', folder: 'Archive' },
    ]) {
      const result = await client.callTool({ name: 'modify_emails', arguments: arguments_ });
      expect(result.isError).toBe(true);
    }
    expect(modify).not.toHaveBeenCalled();
  });

  it('defers label-name validation to the provider', async () => {
    const modify = vi.fn().mockResolvedValue({ succeededIds: ['m1'], failed: [], uncertainIds: [] });
    const client = await connectMcp({ enforceQuota: () => undefined, modify } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.organize']),
    });

    const result = await client.callTool({
      name: 'modify_emails',
      arguments: { messageIds: ['m1'], action: 'addLabels', labels: ['Important'] },
    });

    expect(result.isError).toBeFalsy();
    expect(modify).toHaveBeenCalledWith(undefined, ['m1'], { addLabels: ['Important'] });
  });

  it('requires read access to expose forwarding', async () => {
    await expect(toolNames({ permissions: customPermissionPolicy(['mail.send']) })).resolves.not.toContain(
      'forward_email',
    );

    const deliverForward = vi.fn().mockResolvedValue({
      operationId: 'dop_2',
      accountId: 'acct_1',
      kind: 'forward',
      status: 'succeeded',
      result: { id: 'm2', threadId: 't2' },
    });
    const client = await connectMcp({ enforceQuota: () => undefined, deliverForward } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.send', 'mail.read']),
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('forward_email');

    const withAttachments = await client.callTool({
      name: 'forward_email',
      arguments: { messageId: 'm1', to: ['recipient@example.com'], idempotencyKey: 'forward-1' },
    });
    expect(withAttachments.isError).toBeFalsy();
    expect(deliverForward).toHaveBeenCalledOnce();

    const withoutAttachments = await client.callTool({
      name: 'forward_email',
      arguments: {
        messageId: 'm1',
        to: ['recipient@example.com'],
        includeAttachments: false,
        idempotencyKey: 'forward-2',
      },
    });
    expect(withoutAttachments.isError).toBeFalsy();
    expect(deliverForward).toHaveBeenCalledTimes(2);
  });
});

describe('MCP typed search', () => {
  it('parses portable syntax and includes parser warnings in the result', async () => {
    const listMessages = vi.fn().mockResolvedValue({ items: [], exhausted: true });
    const client = await connectMcp({ enforceQuota: () => undefined, listMessages } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
    });

    const result = await client.callTool({
      name: 'search_emails',
      arguments: {
        query: 'form:ann@example.com is:unread',
        starred: true,
        includeSearchContext: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(listMessages).toHaveBeenCalledWith(
      undefined,
      { text: 'form:ann@example.com', read: false, starred: true },
      { includeSearchContext: true },
    );
    expect(JSON.stringify(result.content)).toContain('possible_operator_typo');
  });

  it('rejects invalid syntax and duplicate structured filters', async () => {
    const listMessages = vi.fn();
    const client = await connectMcp({ enforceQuota: () => undefined, listMessages } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
    });

    const invalid = await client.callTool({
      name: 'search_emails',
      arguments: { query: 'in:starred' },
    });
    expect(invalid.isError).toBe(true);

    const duplicate = await client.callTool({
      name: 'search_emails',
      arguments: { query: 'from:ann@example.com', from: 'bob@example.com' },
    });
    expect(duplicate.isError).toBe(true);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('returns mixed batch results and marks all-account failures as tool errors', async () => {
    const searchMessagesBatch = vi
      .fn()
      .mockResolvedValueOnce({
        groups: [
          {
            accountId: 'acct_1',
            page: {
              items: [{ searchContext: { status: 'matched', excerpt: 'private body excerpt' } }],
              exhausted: true,
            },
          },
          {
            accountId: 'acct_2',
            error: { code: 'provider_unavailable', message: 'Search timed out.', exhausted: false },
          },
        ],
        exhausted: false,
      })
      .mockResolvedValueOnce({
        groups: [
          {
            accountId: 'acct_2',
            error: { code: 'provider_unavailable', message: 'Search timed out.', exhausted: false },
          },
        ],
        exhausted: false,
      })
      .mockResolvedValueOnce({
        groups: [{ accountId: 'acct_1', page: { items: [], exhausted: true } }],
        exhausted: true,
      });
    const capture = vi.fn();
    const client = await connectMcp({ enforceQuota: () => undefined, searchMessagesBatch } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
      telemetry: { capture, shutdown: async () => undefined },
    });

    const mixed = await client.callTool({
      name: 'search_emails_batch',
      arguments: {
        accounts: [{ accountId: 'acct_1' }, { accountId: 'acct_2' }],
        query: 'invoice subject:report',
        includeSnippet: true,
        includeSearchContext: true,
      },
    });
    expect(mixed.isError).toBeFalsy();
    expect(JSON.stringify(mixed.content)).toContain('private body excerpt');
    expect(searchMessagesBatch).toHaveBeenNthCalledWith(1, {
      accounts: [{ accountId: 'acct_1' }, { accountId: 'acct_2' }],
      query: { subject: 'report', text: 'invoice' },
      includeSnippet: true,
      includeSearchContext: true,
    });

    const failed = await client.callTool({
      name: 'search_emails_batch',
      arguments: { accounts: [{ accountId: 'acct_2' }], query: 'subject:report' },
    });
    expect(failed.isError).toBe(true);
    const succeeded = await client.callTool({
      name: 'search_emails_batch',
      arguments: { accounts: [{ accountId: 'acct_1' }], query: 'subject:complete' },
    });
    expect(succeeded.isError).toBeFalsy();
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'search_emails_batch',
        outcome: 'error',
        error_code: 'account_failure',
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private body excerpt');
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'search_emails_batch',
        outcome: 'success',
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('subject:report');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('subject:complete');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('acct_1');
  });

  it('includes parser warnings in successful batch groups', async () => {
    const searchMessagesBatch = vi.fn().mockResolvedValue({
      groups: [{ accountId: 'acct_1', page: { items: [], exhausted: true } }],
      exhausted: true,
    });
    const client = await connectMcp({ enforceQuota: () => undefined, searchMessagesBatch } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
    });

    const result = await client.callTool({
      name: 'search_emails_batch',
      arguments: { accounts: [{ accountId: 'acct_1' }], query: 'form:ann@example.com' },
    });

    expect(result.isError).toBeFalsy();
    expect(searchMessagesBatch).toHaveBeenCalledWith({
      accounts: [{ accountId: 'acct_1' }],
      query: { text: 'form:ann@example.com' },
    });
    expect(JSON.stringify(result.content)).toContain('possible_operator_typo');
  });

  it('returns actionable local search diagnostics without calling the provider', async () => {
    const listMessages = vi.fn();
    const client = await connectMcp({ enforceQuota: () => undefined, listMessages } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
    });
    const result = await client.callTool({
      name: 'search_emails',
      arguments: { accountId: 'acct_1', query: 'from:ann@example.com', from: 'bob@example.com' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('diagnostics');
    expect(JSON.stringify(result.content)).toContain('invalid_request');
    expect(listMessages).not.toHaveBeenCalled();
  });
});

describe('attachment tool', () => {
  it('returns an embedded binary resource and passes the size limit to the service', async () => {
    const getAttachment = vi.fn().mockResolvedValue({
      meta: { id: 'a1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
      content: Buffer.from('pdf'),
    });
    const client = await connectMcp({ enforceQuota: () => undefined, getAttachment } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
      maxAttachmentBytes: 3,
    });

    const result = await client.callTool({
      name: 'download_attachment',
      arguments: { accountId: 'acct_1', messageId: 'INBOX:42', attachmentId: 'AAMk=+/' },
    });

    expect(result.isError).toBeFalsy();
    expect(getAttachment).toHaveBeenCalledWith('acct_1', 'INBOX:42', 'AAMk=+/', 3);
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'resource_link', mimeType: 'application/pdf' }),
    );
    const link = result.content.find((item) => item.type === 'resource_link');
    expect(link?.type).toBe('resource_link');
    if (link?.type === 'resource_link') {
      const fetched = await client.readResource({ uri: link.uri });
      expect(fetched.contents).toContainEqual(expect.objectContaining({ blob: Buffer.from('pdf').toString('base64') }));
      expect(getAttachment).toHaveBeenLastCalledWith('acct_1', 'INBOX:42', 'AAMk=+/', 3);
    }
    const inline = await client.callTool({
      name: 'download_attachment',
      arguments: { accountId: 'acct_1', messageId: 'INBOX:42', attachmentId: 'AAMk=+/', inline: true },
    });
    expect(inline.content).toContainEqual({
      type: 'resource',
      resource: expect.objectContaining({ blob: Buffer.from('pdf').toString('base64') }),
    });
  });

  it('checks the final decoded size even when a provider ignores the limit', async () => {
    const getAttachment = vi.fn().mockResolvedValue({
      meta: { id: 'a1', filename: 'large.bin', mimeType: 'application/octet-stream', sizeBytes: 4 },
      content: Buffer.alloc(4),
    });
    const client = await connectMcp({ enforceQuota: () => undefined, getAttachment } as Partial<EmailService>, {
      permissions: permissionPolicyForProfile('read-only'),
      maxAttachmentBytes: 3,
    });

    const result = await client.callTool({
      name: 'download_attachment',
      arguments: { accountId: 'acct_1', messageId: 'm1', attachmentId: 'a1' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('invalid_request');
  });
});

describe('typed MCP responses', () => {
  it('hides unexpected exception text and returns a request ID', async () => {
    const getMessage = vi.fn().mockRejectedValue(new Error('private database password'));
    const client = await connectMcp({ enforceQuota: () => undefined, getMessage } as Partial<EmailService>);
    const result = await client.callTool({ name: 'get_email', arguments: { messageId: 'm1' } });
    expect(result.isError).toBe(true);
    const error = JSON.parse(String(result.content.find((item) => item.type === 'text')?.text));
    expect(error).toMatchObject({ error: 'internal', requestId: expect.any(String) });
    expect(JSON.stringify(result.content)).not.toContain('private database password');
  });

  it('marks partial bulk changes as errors while retaining each outcome', async () => {
    const { telemetry, capture } = telemetrySpy();
    const modify = vi.fn().mockResolvedValue({
      succeededIds: ['m1'],
      failed: [{ messageId: 'm2', code: 'not_found' }],
      uncertainIds: ['m3'],
    });
    const client = await connectMcp({ enforceQuota: () => undefined, modify } as Partial<EmailService>, { telemetry });
    const result = await client.callTool({
      name: 'modify_emails',
      arguments: { messageIds: ['m1', 'm2', 'm3'], action: 'markRead' },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      data: { succeededIds: ['m1'], failed: [{ messageId: 'm2', code: 'not_found' }], uncertainIds: ['m3'] },
    });
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({ operation: 'modify_emails', outcome: 'error', error_code: 'account_failure' }),
    );
  });

  it('declares an output schema for every tool and bounds body content', async () => {
    const getMessage = vi.fn().mockResolvedValue({ ...draftMessage, body: { text: 'x'.repeat(60_000) } });
    const client = await connectMcp({ enforceQuota: () => undefined, getMessage } as Partial<EmailService>);
    const tools = (await client.listTools()).tools;
    expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    const first = await client.callTool({
      name: 'get_email',
      arguments: { messageId: 'private-message', bodyFormat: 'text' },
    });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({
      data: { bodyTruncation: { text: { totalChars: 60_000, nextOffset: 50_000 } } },
    });
    const next = await client.callTool({
      name: 'get_email_body',
      arguments: { messageId: 'private-message', format: 'text', offset: 50_000 },
    });
    expect(next.structuredContent).toMatchObject({ data: { totalChars: 60_000, offset: 50_000 } });
    expect((next.structuredContent as { data: { text: string } }).data.text).toHaveLength(10_000);
  });

  it('records safe success and error telemetry for new lookups', async () => {
    const { telemetry, capture } = telemetrySpy();
    const getDraft = vi
      .fn()
      .mockResolvedValueOnce(draftMessage)
      .mockRejectedValueOnce(new EmailError('not_found', 'private draft ID'));
    const previewSend = vi.fn().mockResolvedValue({
      accountId: 'acct_1',
      from: 'me@example.com',
      to: [{ email: 'private@example.com' }],
      cc: [],
      bcc: [],
      subject: 'private subject',
      attachments: [],
      bodyTextChars: 3,
      bodyHtmlChars: 0,
    });
    const getDelivery = vi.fn().mockReturnValue({
      operationId: 'private-operation',
      accountId: 'acct_1',
      kind: 'send',
      status: 'uncertain',
      error: { code: 'provider_unavailable' },
    });
    const getMessage = vi
      .fn()
      .mockResolvedValueOnce(draftMessage)
      .mockRejectedValueOnce(new EmailError('not_found', 'private body'));
    const client = await connectMcp(
      { enforceQuota: () => undefined, getDraft, previewSend, getDelivery, getMessage } as Partial<EmailService>,
      { telemetry },
    );
    await client.callTool({ name: 'get_draft', arguments: { draftId: 'private-draft' } });
    await client.callTool({ name: 'get_draft', arguments: { draftId: 'private-draft' } });
    await client.callTool({ name: 'preview_send', arguments: { to: ['private@example.com'], bodyText: 'Hi!' } });
    await client.callTool({ name: 'get_email_body', arguments: { messageId: 'private-message', format: 'text' } });
    await client.callTool({ name: 'get_email_body', arguments: { messageId: 'private-message', format: 'text' } });
    await client.callTool({
      name: 'get_delivery_operation',
      arguments: { accountId: 'acct_1', operationId: 'private-operation' },
    });
    previewSend.mockRejectedValueOnce(new EmailError('not_found', 'private preview'));
    getDelivery.mockImplementationOnce(() => {
      throw new EmailError('not_found', 'private operation');
    });
    await client.callTool({ name: 'preview_send', arguments: { to: ['private@example.com'], bodyText: 'Hi!' } });
    await client.callTool({
      name: 'get_delivery_operation',
      arguments: { accountId: 'acct_1', operationId: 'private-operation' },
    });
    for (const operation of ['get_draft', 'preview_send', 'get_delivery_operation', 'get_email_body']) {
      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({ product_surface: 'mcp', operation, outcome: 'success' }),
      );
    }
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'get_draft',
        outcome: 'error',
        error_code: 'not_found',
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'get_email_body',
        outcome: 'error',
        error_code: 'not_found',
      }),
    );
    for (const operation of ['preview_send', 'get_delivery_operation']) {
      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({ product_surface: 'mcp', operation, outcome: 'error', error_code: 'not_found' }),
      );
    }
    const captured = JSON.stringify(capture.mock.calls);
    for (const privateValue of [
      'private-draft',
      'private-operation',
      'private@example.com',
      'private subject',
      'private-message',
      'private body',
      'private preview',
    ])
      expect(captured).not.toContain(privateValue);
  });
});

describe('scheduled send tools', () => {
  function connect(service: Partial<EmailService>) {
    return connectMcp({ enforceQuota: () => undefined, ...service });
  }

  it('registers the scheduling tools', async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('send_email');
    expect(names).toContain('list_scheduled_emails');
    expect(names).toContain('cancel_scheduled_email');
  });

  it('marks an uncertain send as an error with an operation ID', async () => {
    const { telemetry, capture } = telemetrySpy();
    const deliver = vi.fn().mockResolvedValue({
      operationId: 'dop_uncertain',
      accountId: 'acct_1',
      kind: 'send',
      status: 'uncertain',
      error: { code: 'provider_unavailable' },
    });
    const client = await connectMcp({ enforceQuota: () => undefined, deliver } as Partial<EmailService>, { telemetry });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: ['recipient@example.com'], bodyText: 'Hi', idempotencyKey: 'uncertain-key' },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ data: { operationId: 'dop_uncertain', status: 'uncertain' } });
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({ operation: 'send_email', outcome: 'error', error_code: 'account_failure' }),
    );
  });

  it('routes send_email with sendAt to scheduleDelivery', async () => {
    const scheduleDelivery = vi.fn().mockResolvedValue({
      operationId: 'dop_1',
      accountId: 'acct_1',
      kind: 'scheduled',
      status: 'queued',
      scheduleId: 'sch_1',
    });
    const deliver = vi.fn();
    const client = await connect({ scheduleDelivery, deliver } as Partial<EmailService>);

    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        to: ['bob@example.com'],
        subject: 'Later',
        bodyText: 'hi',
        sendAt: '2026-07-11T09:00:00-07:00',
        idempotencyKey: 'schedule-1',
      },
    });

    expect(result.isError).toBeFalsy();
    expect(deliver).not.toHaveBeenCalled();
    expect(scheduleDelivery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ subject: 'Later' }),
      '2026-07-11T09:00:00-07:00',
      'schedule-1',
    );
    // sendAt must not leak into the composed message content.
    expect(scheduleDelivery.mock.calls[0]![1]).not.toHaveProperty('sendAt');
  });

  it('routes send_email without sendAt to deliver', async () => {
    const scheduleDelivery = vi.fn();
    const deliver = vi.fn().mockResolvedValue({
      operationId: 'dop_1',
      accountId: 'acct_1',
      kind: 'send',
      status: 'succeeded',
      result: { id: 'm1', threadId: 't1' },
    });
    const client = await connect({ scheduleDelivery, deliver } as Partial<EmailService>);

    const result = await client.callTool({
      name: 'send_email',
      arguments: { draftId: 'draft_1', idempotencyKey: 'send-1' },
    });

    expect(result.isError).toBeFalsy();
    expect(scheduleDelivery).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(undefined, { draftId: 'draft_1' }, 'send-1');
  });

  it('rejects a sendAt without a timezone before reaching the service', async () => {
    const scheduleDelivery = vi.fn();
    const client = await connect({ scheduleDelivery } as Partial<EmailService>);

    const result = await client.callTool({
      name: 'send_email',
      arguments: { draftId: 'draft_1', sendAt: '2026-07-11T09:00:00', idempotencyKey: 'schedule-1' },
    });

    expect(result.isError).toBe(true);
    expect(scheduleDelivery).not.toHaveBeenCalled();
  });

  it('uses mail.send for immediate and scheduled delivery', async () => {
    const deliver = vi.fn().mockResolvedValue({
      operationId: 'dop_1',
      accountId: 'acct_1',
      kind: 'send',
      status: 'succeeded',
      result: { id: 'm1', threadId: 't1' },
    });
    const scheduleDelivery = vi.fn().mockResolvedValue({
      operationId: 'dop_2',
      accountId: 'acct_1',
      kind: 'scheduled',
      status: 'queued',
      scheduleId: 'sch_1',
    });
    const client = await connectMcp(
      { enforceQuota: () => undefined, deliver, scheduleDelivery } as Partial<EmailService>,
      {
        permissions: customPermissionPolicy(['mail.send']),
      },
    );

    const direct = await client.callTool({
      name: 'send_email',
      arguments: { to: ['bob@example.com'], subject: 'Hello', bodyText: 'Hi', idempotencyKey: 'send-1' },
    });
    expect(direct.isError).toBeFalsy();

    const reply = await client.callTool({
      name: 'send_email',
      arguments: { replyToMessageId: 'm1', bodyText: 'Hi', idempotencyKey: 'send-2' },
    });
    expect(reply.isError).toBe(true);

    const draft = await client.callTool({
      name: 'send_email',
      arguments: { draftId: 'draft_1', idempotencyKey: 'send-3' },
    });
    expect(draft.isError).toBeFalsy();

    const scheduled = await client.callTool({
      name: 'send_email',
      arguments: {
        to: ['bob@example.com'],
        subject: 'Later',
        bodyText: 'Hi',
        sendAt: '2026-07-11T09:00:00-07:00',
        idempotencyKey: 'schedule-1',
      },
    });
    expect(scheduled.isError).toBeFalsy();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(scheduleDelivery).toHaveBeenCalledOnce();
  });

  it('uses mail.send plus read access for replies', async () => {
    const deliver = vi.fn().mockResolvedValue({
      operationId: 'dop_1',
      accountId: 'acct_1',
      kind: 'send',
      status: 'succeeded',
      result: { id: 'm2', threadId: 't1' },
    });
    const client = await connectMcp({ enforceQuota: () => undefined, deliver } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.send', 'mail.read']),
    });

    const reply = await client.callTool({
      name: 'send_email',
      arguments: { replyToMessageId: 'm1', bodyText: 'Hi', idempotencyKey: 'reply-1' },
    });
    expect(reply.isError).toBeFalsy();
    expect(deliver).toHaveBeenCalledOnce();
  });
});

describe('reply permissions', () => {
  it('requires read access for reply drafts', async () => {
    const createDraft = vi.fn();
    const client = await connectMcp({ enforceQuota: () => undefined, createDraft } as Partial<EmailService>, {
      permissions: customPermissionPolicy(['mail.drafts']),
    });

    const result = await client.callTool({
      name: 'create_draft',
      arguments: { replyToMessageId: 'm1', bodyText: 'Reply' },
    });
    expect(result.isError).toBe(true);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('uses the normal create and update capabilities for reply drafts', async () => {
    const createDraft = vi.fn().mockResolvedValue(draftMessage);
    const updateDraft = vi.fn().mockResolvedValue(draftMessage);
    const client = await connectMcp(
      { enforceQuota: () => undefined, createDraft, updateDraft } as Partial<EmailService>,
      { permissions: customPermissionPolicy(['mail.drafts', 'mail.read']) },
    );

    const created = await client.callTool({
      name: 'create_draft',
      arguments: { replyToMessageId: 'm1', bodyText: 'Reply' },
    });
    const updated = await client.callTool({
      name: 'update_draft',
      arguments: { draftId: 'd1', replyToMessageId: 'm1', bodyText: 'Updated reply' },
    });

    expect(created.isError).toBeFalsy();
    expect(updated.isError).toBeFalsy();
    expect(createDraft).toHaveBeenCalledOnce();
    expect(updateDraft).toHaveBeenCalledOnce();
  });
});

describe('tool telemetry', () => {
  it('records sanitized send-as discovery success and errors', async () => {
    const { telemetry, capture } = telemetrySpy();
    const listSendAs = vi
      .fn()
      .mockResolvedValueOnce([{ email: 'private-alias@example.com', isPrimary: false, source: 'provider' as const }])
      .mockRejectedValueOnce(new EmailError('provider_unavailable', 'private discovery response'));
    const client = await connectMcp({ enforceQuota: () => undefined, listSendAs } as Partial<EmailService>, {
      telemetry,
      transport: 'http',
    });

    await client.callTool({ name: 'list_send_as', arguments: { accountId: 'private-account' } });
    await client.callTool({ name: 'list_send_as', arguments: { accountId: 'private-account' } });

    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({ product_surface: 'mcp', operation: 'list_send_as', outcome: 'success' }),
    );
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'list_send_as',
        outcome: 'error',
        error_code: 'provider_unavailable',
      }),
    );
    const captured = JSON.stringify(capture.mock.calls);
    expect(captured).not.toContain('private-alias@example.com');
    expect(captured).not.toContain('private-account');
    expect(captured).not.toContain('private discovery response');
  });

  it('lists labels and records sanitized success telemetry', async () => {
    const { telemetry, capture } = telemetrySpy();
    const listLabels = vi.fn().mockResolvedValue([{ id: 'private-id', name: 'private-project' }]);
    const client = await connectMcp({ enforceQuota: () => undefined, listLabels } as Partial<EmailService>, {
      telemetry,
      transport: 'http',
    });

    const result = await client.callTool({ name: 'list_labels', arguments: { accountId: 'private-account' } });

    expect(result.isError).toBeFalsy();
    expect(listLabels).toHaveBeenCalledWith('private-account');
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'list_labels',
        transport: 'http',
        outcome: 'success',
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private-account');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private-project');
  });

  it('captures the tool, transport, outcome, and allowlisted feature properties', async () => {
    const { telemetry, capture, beginActivity, finishActivity } = telemetrySpy();
    const service = {
      enforceQuota: () => undefined,
      scheduleDelivery: vi.fn().mockResolvedValue({
        operationId: 'dop_1',
        accountId: 'acct_1',
        kind: 'scheduled',
        status: 'queued',
        scheduleId: 'sch_1',
      }),
    } as Partial<EmailService>;
    const client = await connectMcp(service, { telemetry, transport: 'http' });

    await client.callTool({
      name: 'send_email',
      arguments: {
        to: ['private@example.com'],
        subject: 'private subject',
        bodyText: 'private body',
        sendAt: '2026-07-11T09:00:00-07:00',
        idempotencyKey: 'schedule-private',
      },
    });

    expect(capture).toHaveBeenCalledWith('operation completed', {
      product_surface: 'mcp',
      operation: 'send_email',
      transport: 'http',
      outcome: 'success',
      duration_ms: expect.any(Number),
      mode: 'direct',
      scheduled: true,
      reply_all: false,
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private@example.com');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private subject');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private body');
    expect(beginActivity).toHaveBeenCalledOnce();
    expect(finishActivity).toHaveBeenCalledOnce();
  });

  it('captures a safe label error code without the error message', async () => {
    const { telemetry, capture } = telemetrySpy();
    const { logger, warn, error } = loggerSpy();
    const service = {
      enforceQuota: () => undefined,
      listLabels: vi.fn(() => {
        throw new EmailError('provider_unavailable', 'private provider response');
      }),
    } as Partial<EmailService>;
    const client = await connectMcp(service, { telemetry, transport: 'stdio', logger });

    await client.callTool({ name: 'list_labels', arguments: {} });

    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({
        product_surface: 'mcp',
        operation: 'list_labels',
        transport: 'stdio',
        outcome: 'error',
        error_code: 'provider_unavailable',
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private provider response');
    expect(warn).toHaveBeenCalledWith(
      'mcp.operation_failed',
      'private provider response',
      expect.objectContaining({ code: 'provider_unavailable' }),
      expect.objectContaining({ productSurface: 'mcp', operation: 'list_labels' }),
    );
    expect(error).not.toHaveBeenCalled();
  });
});

describe('plan quota gate', () => {
  it('blocks tool calls while over quota but keeps get_status available', async () => {
    const listAccounts = vi.fn().mockReturnValue([]);
    const status = vi.fn().mockResolvedValue({ accounts: [], providersAvailable: [] });
    const enforceQuota = vi.fn(() => {
      throw new EmailError('entitlement_exceeded', 'Renew the license or remove mailboxes/members');
    });
    const client = await connectMcp({ listAccounts, status, enforceQuota } as Partial<EmailService>);

    const blocked = await client.callTool({ name: 'list_accounts', arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked.content)).toContain('entitlement_exceeded');
    expect(listAccounts).not.toHaveBeenCalled();

    const diagnostics = await client.callTool({ name: 'get_status', arguments: {} });
    expect(diagnostics.isError).toBeFalsy();
    expect(status).toHaveBeenCalled();
  });

  it('appends the renewal warning to tool results while the license is in grace', async () => {
    const listAccounts = vi.fn().mockReturnValue([]);
    const enforceQuota = vi.fn().mockReturnValue('The Fluxmail license expired yesterday');
    const client = await connectMcp({ listAccounts, enforceQuota } as Partial<EmailService>);

    const result = await client.callTool({ name: 'list_accounts', arguments: {} });
    expect(result.isError).toBeFalsy();
    const texts = (result.content as Array<{ text: string }>).map((c) => c.text);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe('Note: The Fluxmail license expired yesterday');
  });
});
