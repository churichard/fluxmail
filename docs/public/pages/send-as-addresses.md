---
title: 'Send from another address'
description: 'Use an existing Gmail, Outlook, or IMAP alias when you draft, reply, forward, send, or schedule a message.'
updated: '2026-09-16'
---

Fluxmail can send from another address that belongs to the connected mailbox. The provider must already know and allow the address. Fluxmail does not create or verify aliases.

## Provider setup

Gmail aliases come from Gmail's Send mail as settings. Fluxmail lists the primary address and verified aliases, including each identity's display name and Reply-To address. Add or verify an alias in Gmail before using it through Fluxmail.

Outlook and IMAP aliases are configured in Fluxmail after an administrator creates them with the mail provider. Add an existing alias with:

```bash
fluxmail accounts send-as add <account-id> sales@example.com --name "Sales"
```

Remove a configured alias with:

```bash
fluxmail accounts send-as remove <account-id> sales@example.com
```

These commands change Fluxmail's allowed sender list. They do not change the mailbox or provider account. Microsoft 365, Outlook.com, and SMTP servers can still reject an address that the provider has not assigned to the mailbox.

List the addresses available for an account:

```bash
fluxmail accounts send-as list <account-id>
```

You can also use the `list_send_as` MCP tool or `GET /api/v1/accounts/{accountId}/send-as`. Listing requires `mail.read`. Replacing the configured Outlook or IMAP list through REST requires `admin.accounts`:

```http
PUT /api/v1/accounts/acct_123/send-as
Content-Type: application/json

{
  "identities": [
    { "email": "sales@example.com", "name": "Sales" }
  ]
}
```

The `PUT` request replaces the full configured alias list for that account. Gmail aliases remain managed by Gmail.

## Choose a sender

Pass `from` through MCP or REST. In the CLI, use `--from` with send, draft, or forward commands:

```bash
fluxmail emails send \
  --from sales@example.com \
  --to customer@example.com \
  --subject "Order update" \
  --body "Your order has shipped."
```

The sender address must match an available identity. Matching ignores letter case, but it does not remove dots or plus tags. Fluxmail rejects unknown and unverified addresses before delivery.

New messages and forwards use the connected account address when `from` is omitted. Replies look for an owned address in the original To field, then Cc. The first match becomes the sender. If no address matches, Fluxmail uses the connected account address. A reply to a message sent from one of your own aliases reuses that alias.

Reply-all removes every known identity for the account from the recipient list. An address that appears only in Bcc does not affect automatic sender selection.

## Drafts and scheduled messages

A draft keeps its sender when you update it without `from`. To change the sender, update the draft first. Sending a draft by ID does not accept `from` or other message fields.

Scheduled messages store the sender in the provider draft. Fluxmail checks an alternate sender again before delivery. If an administrator removes the alias before the send time, the schedule fails instead of switching to the primary address.
