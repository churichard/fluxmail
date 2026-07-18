---
title: 'Use the CLI'
description: 'Manage a Fluxmail instance, its mailboxes, members, API keys, and server processes.'
updated: '2026-07-17'
---

The Fluxmail CLI configures and runs the service. Email operations such as reading, drafting, and sending are available through MCP and REST.

Complete the [Quickstart](/docs/quickstart) before using the workflows below.

## Check the instance

```bash
fluxmail status
fluxmail accounts list
fluxmail members list
```

`fluxmail status` reports provider availability, connected mailboxes, and mailboxes that need to be reauthorized.

## Run the HTTP server

```bash
fluxmail serve
```

The server listens on port 8977 by default. It provides MCP at `/mcp` and REST at `/api/v1`.

For a local MCP client that uses stdio, the client launches this command instead:

```bash
fluxmail stdio
```

See [Connect an MCP client](/docs/connect-an-mcp-client) for client configuration and transport options.

## Manage mailboxes and members

Connect another mailbox or list the existing mailboxes:

```bash
fluxmail accounts add gmail
fluxmail accounts list
```

Administrators can invite members and share mailboxes with them:

```bash
fluxmail members add --name "Another person" --email person@example.com
fluxmail accounts access <account-id> --share-with person@example.com
```

See [Teams and plans](/docs/teams-and-plans) for mailbox sharing and plan limits.

## Manage API keys

Create a key for an HTTP MCP or REST client:

```bash
fluxmail apikey create --name local-client
```

Fluxmail shows the key once. You can list, change, or revoke keys without exposing their stored secrets:

```bash
fluxmail apikey list
fluxmail apikey permissions <key-id> --profile read-only
fluxmail apikey revoke <key-id>
```

See [Permissions](/docs/permissions) for profiles, custom capabilities, and mailbox restrictions.

## Use the CLI with Docker

Prefix commands with `docker compose exec fluxmail`:

```bash
docker compose exec fluxmail fluxmail status
docker compose exec fluxmail fluxmail accounts list
```

See [Deploy with Docker](/docs/deploy-with-docker) for remote server setup.

## Command reference

Run `fluxmail --help` or add `--help` to a command for terminal help:

```bash
fluxmail accounts add --help
```

The [CLI reference](/docs/cli) lists every command and option.
