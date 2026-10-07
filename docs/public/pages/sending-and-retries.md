---
title: "Sending and retries"
description: "Preview a send, track its delivery, and retry without sending a duplicate."
updated: '2026-10-06'
---

Sending requires `mail.send`. Choose the mailbox, recipients, and message before submitting a send. You can inspect a saved draft or preview a request first. Previewing does not deliver email.

## Preview the message

Use MCP `preview_send`, CLI `emails preview`, or REST `/accounts/<account-id>/send/preview` to resolve the sender, reply recipients, subject, and attachment metadata. To inspect an existing draft, use `get_draft`, `drafts get`, or `GET /accounts/<account-id>/drafts/<draft-id>`.

See [Send from another address](/docs/send-as-addresses) if you want to use an existing mailbox alias. Fluxmail does not create the alias at your provider.

## Give each delivery a stable key

Create an idempotency key for each intended send or forward, and save it with the request before calling Fluxmail:

| Interface | Where to pass the key |
| --- | --- |
| MCP | `idempotencyKey` on `send_email` or `forward_email` |
| REST | `Idempotency-Key` request header |
| CLI | `--idempotency-key` on `emails send` or `emails forward` |

Reuse the same key when retrying the same request. New delivery-operation keys have no automatic expiry and are scoped to the authenticated credential. Reusing a key with different request data returns a conflict. See the [0.11.0 migration guide](/docs/upgrades/0.11.0) for legacy REST records with a 24-hour lifetime.

Do not switch credentials or create a new key to retry a request whose outcome you have not established.

## Check the delivery operation

A send returns an `operationId` and a status. Save the returned ID; do not assume it is the same as your idempotency key.

| Status | What to do |
| --- | --- |
| `queued` | Wait for the scheduled delivery. |
| `sending` | Check the operation again. |
| `succeeded` | Delivery completed; the result includes the sent message ID. |
| `failed` | Inspect the failure before deciding what to do next. |
| `uncertain` | Check the Sent folder or recipient before making any new send request. The provider may have delivered it. |

Use MCP `get_delivery_operation`, CLI `emails delivery-status`, or REST `GET /accounts/<account-id>/delivery-operations/<operation-id>` to check the result. Fluxmail does not automatically retry an uncertain delivery under the same key.

MCP marks failed and uncertain sends as tool errors, but the structured result still includes the operation ID and status. Read that result before retrying. If a request times out before you receive its result, retry the same request with the same credential and key to recover the saved operation.

## Schedule a message

Use the sending interface's `sendAt` field or CLI scheduling option. Fluxmail saves the scheduled message as a draft in the mailbox. The server must be running at delivery time; a send missed while it is stopped can run when it starts again.

Review pending schedules before restoring a backup or restarting an instance after a long outage. Use the [MCP tools](/docs/tools), [CLI guide](/docs/use-the-cli), or [REST reference](/docs/rest-api) to list and cancel scheduled sends.

## Before restarting an existing instance

Starting `fluxmail stdio`, `fluxmail serve`, or the Docker service starts the instance-wide scheduler. Overdue scheduled messages can send immediately. A client's read-only profile and mailbox restrictions apply to its tool calls; they do not pause the scheduler or limit it to that client's mailboxes.

Before restarting an instance, inspect pending schedules with a one-shot local CLI command for each mailbox you can access:

```bash
fluxmail --instance <local-name> --mail-account <account-id> scheduled list
```

For a stopped Docker installation, use a one-shot container with the existing data volume:

```bash
docker compose run --rm --no-deps -T fluxmail \
  --instance local --mail-account <account-id> scheduled list
```

These commands do not start the scheduler. If your saved session has expired, log in with a one-shot local command before listing schedules. Ask the instance operator to review mailboxes your member cannot access. Resume the instance only when you intend its pending deliveries to run. A connection test does not require canceling or changing those schedules.

## Preserve paragraph formatting

For plain-text email, keep each prose paragraph on one continuous line and separate paragraphs with blank lines. This applies to MCP `bodyText`, REST `body.text`, and a forward's `comment`. Fluxmail preserves line breaks, so fixed-width wrapping appears as short lines in the recipient's mail app. Lists and signatures can use intentional line breaks.

See [Send email](/docs/tools/send-email) for MCP inputs or [the REST send endpoint](/docs/rest-api/send-message) for request fields.
