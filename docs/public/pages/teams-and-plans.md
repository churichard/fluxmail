---
title: 'Teams & plans'
description: 'Add members, share mailboxes across a team, and unlock paid-plan limits with a license key on the self-hosted Fluxmail MCP server.'
updated: '2026-07-13'
---

## Members and shared mailboxes

For personal use you can skip this section. On the paid Team and Enterprise plans, one Fluxmail instance is shared by several people, tracked as **members**. Each member connects their own mailboxes, and a mailbox can also be marked shared so everyone can reach it.

```bash
# Add the people using this instance
fluxmail members add --name "Ada Lovelace" --email ada@example.com
fluxmail members list

# Connect a mailbox and set its owner in one step
fluxmail accounts add gmail --member ada@example.com

# Reassign an existing mailbox, or make it shared
fluxmail accounts assign <account-id> --member ada@example.com
fluxmail accounts assign <account-id> --shared

# Scope an API key to one member and limit it to read-only access
fluxmail apikey create \
  --name "ada laptop" \
  --member ada@example.com \
  --profile read-only
```

Member scope controls which mailboxes a key can reach. Its [permission profile](/docs/permissions) separately controls which email actions the client can take. Use one key per client so you can change its permissions or revoke it without interrupting other connections.

## Plans and licensing

Self-hosting is free on the **Personal** plan: 3 connected mailboxes and 1 member. Pro raises the mailbox limit for one person. Team and Enterprise add members and more mailboxes. On Team and Enterprise, each person connects their own mailboxes, and a mailbox can also be shared. See [pricing](/pricing) for current limits.

You can buy Pro or Team from the pricing page. Stripe returns you to Fluxmail after payment and shows your license key. Copy it then, and keep it private.

Use **Manage subscription** on the pricing page or license screen to update your card, view invoices, change plans, or cancel. Stripe asks for the email used at checkout and sends a one-time passcode before opening billing details. Stripe billing emails also include the same portal link.

Unlock a paid plan with your license key:

```bash
fluxmail license activate <key>
fluxmail license status
```

One license activates one instance, and enforcement keeps working offline. If you schedule a cancellation, the paid plan works until the end of the billing period. After the subscription ends or a payment fails, the instance drops back to Personal limits. Deactivating, downgrading, or lapsing never deletes accounts or data.

## Software license

Fluxmail MCP is proprietary, source-available software. You can inspect, test, and privately modify the source. Production use must stay within your Fluxmail entitlement, including the built-in Personal plan. The license does not permit redistribution, hosted resale, competing use, or bypassing plan controls. Read the [full license terms](https://github.com/churichard/fluxmail-mcp/blob/main/LICENSE.md) before using or modifying the software.
