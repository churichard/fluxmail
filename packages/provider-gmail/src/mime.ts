import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import type { DraftInput, EmailAddress } from '@fluxmail/core';

export interface ThreadingHeaders {
  inReplyTo?: string;
  references?: string;
}

function toMailAddresses(addrs: EmailAddress[] | undefined): Mail.Address[] | undefined {
  if (!addrs?.length) return undefined;
  return addrs.map((a) => ({ name: a.name ?? '', address: a.email }));
}

/** Build a raw RFC 5322 message from a DraftInput. */
export async function buildRawMessage(
  draft: DraftInput,
  from: EmailAddress,
  threading?: ThreadingHeaders
): Promise<Buffer> {
  const options: Mail.Options = {
    from: { name: from.name ?? '', address: from.email },
    to: toMailAddresses(draft.to),
    cc: toMailAddresses(draft.cc),
    bcc: toMailAddresses(draft.bcc),
    subject: draft.subject ?? '',
    text: draft.body.text,
    html: draft.body.html,
    attachments: draft.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      contentType: a.mimeType,
      ...(a.contentId ? { cid: a.contentId } : {}),
      ...(a.disposition ? { contentDisposition: a.disposition } : {}),
    })),
  };
  if (threading?.inReplyTo) options.inReplyTo = threading.inReplyTo;
  if (threading?.references) options.references = threading.references;

  const composer = new MailComposer(options);
  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
