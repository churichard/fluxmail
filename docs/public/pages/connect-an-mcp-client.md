---
title: 'Connect an MCP client'
description: 'Connect Claude, ChatGPT, Codex, Cline, Cursor, Hermes, Gemini, or another MCP client to Fluxmail.'
updated: '2026-10-03'
---

Complete the [Quickstart](/docs/quickstart) before configuring an MCP client.

## Choose one transport

Configure either stdio or Streamable HTTP. You do not need both.

| Transport | Use it when | Authentication |
| --- | --- | --- |
| stdio | Fluxmail and the MCP client run on the same computer | Selected local member session |
| Streamable HTTP | The client connects by URL, including Docker and remote deployments | Fluxmail API key |

For most local setups, choose stdio. Choose Streamable HTTP when Fluxmail runs in Docker, on another machine, or when the client requires a URL.

Both transports provide the same MCP tools. The examples use the default `full` permission profile. See [Permissions](/docs/permissions) if the client should have less access.

Every `send_email` and `forward_email` call now needs an `idempotencyKey`. Keep the key and reuse it if a call times out. The result includes an `operationId`; call `get_delivery_operation` to check whether delivery succeeded, failed, or is uncertain. Inspect an uncertain message before attempting a new send. Use `preview_send` to check recipients and attachments without sending.

For plain-text email, ask your agent to keep each prose paragraph on one continuous line in `bodyText`, with a blank line between paragraphs. Fluxmail preserves line breaks, so wrapping a paragraph at a fixed width will show as short lines in the recipient's mail app. Lists and signatures can still use intentional line breaks.

An uncertain or failed send is marked as an MCP tool error, but its structured result still contains the operation ID and status. Bulk changes with failed or uncertain messages behave the same way, so inspect their per-message result before retrying.

Input errors from Fluxmail explain which field needs attention. Search syntax errors also include `data.diagnostics`. Provider error text is replaced with a safe message.

Mail tools return typed `structuredContent` and readable text. `get_email` and `get_thread` accept `bodyFormat` to select text, HTML, both, or no body. Large bodies include truncation metadata; use `get_email_body` to read the remaining text. Thread messages are paged. `download_attachment` returns a protected resource link by default. Set `inline` only when the attachment bytes must be embedded in the tool response.

## Option 1: Connect over stdio

Every stdio client launches `fluxmail stdio`. Without `--instance`, Fluxmail selects the active local profile first, then a local profile named `local`, then the sole local profile under any other name. It uses the member session saved for that profile. You do not need to run `fluxmail serve`.

Before connecting, run `fluxmail setup` for a new installation. For an existing installation, list profiles with `fluxmail instances list` and log in to the local profile the client will use with `fluxmail --instance <name> login`. Use `local` for the default profile created by setup or when recreating a missing local profile. The MCP client must run as the same operating-system user and use the same Fluxmail data directory as the setup or login command.

To pin the client to a particular local profile, add `--instance <name>` before `stdio` in the client command. You must choose a profile this way if several local profiles exist and none is active or named `local`. An explicit remote profile is rejected; use Streamable HTTP for remote instances. The stdio selection does not change the active profile for other CLI commands.

<details>
<summary>Claude Code</summary>

```bash
claude mcp add fluxmail -- fluxmail stdio
```

</details>

<details>
<summary>Claude Desktop</summary>

Add this server to `claude_desktop_config.json` under Settings > Developer > Edit Config:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "fluxmail",
      "args": ["stdio"]
    }
  }
}
```

</details>

<details>
<summary>ChatGPT / Codex app</summary>

Open Settings > Plugins > MCPs > Add server, then enter:

- Name: `Fluxmail`
- Type: `STDIO`
- Command to launch: `fluxmail`
- Arguments: `stdio`

Save the server and restart the app.

</details>

<details>
<summary>Codex CLI</summary>

```bash
codex mcp add fluxmail -- fluxmail stdio
```

You can also add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.fluxmail]
command = "fluxmail"
args = ["stdio"]
```

</details>

<details>
<summary>Cursor</summary>

Add the server to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "fluxmail",
      "args": ["stdio"]
    }
  }
}
```

</details>

<details>
<summary>Cline</summary>

Use a local stdio connection to call Fluxmail from Cline. You can check the connection before connecting a mailbox. If you completed the [quickstart](https://fluxmail.ai/docs/quickstart), skip to the Cline configuration below.

### Requirements

- Node.js 22.22 or later.
- Cline with a configured model provider.
- pnpm 11 for the project-local installation below.

### Install the package

In a directory where you want to keep the installation, run:

```bash
pnpm add --allow-build=better-sqlite3 fluxmail
pnpm exec fluxmail --version
```

The build permission lets the SQLite dependency install its native module. Keep this directory and its `node_modules` folder available while Cline uses the server.

### Create the local administrator

Run from the installation directory:

```bash
pnpm exec fluxmail setup --name "Your name" --email you@example.com
```

Fluxmail asks for a password without displaying it. Setup creates a local profile and saves your member session. For unattended setup, supply `FLUXMAIL_PASSWORD` through a secure environment; do not put a password in a command argument or commit it to a file.

Fluxmail stores data in `.fluxmail` in your home directory by default. To use a separate instance, set `FLUXMAIL_DATA_DIR` to an absolute directory before setup. Pass the same value to Cline's MCP server configuration. `FLUXMAIL_TELEMETRY=0` disables anonymous telemetry.

You can check the instance before connecting a mailbox:

```bash
pnpm exec fluxmail status
pnpm exec fluxmail accounts list
```

An empty mailbox list is expected on a fresh instance. You do not need a paid plan or mailbox credentials for this connection check.

### Connect Cline

Open Cline's MCP Servers view and edit its MCP settings. Add a `fluxmail` entry under `mcpServers`, preserving existing entries:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "/absolute/path/to/installation/node_modules/.bin/fluxmail",
      "args": ["stdio", "--profile", "read-only"]
    }
  }
}
```

Replace the command with the absolute path to the installed executable. For a global installation, use the path returned by `which fluxmail` (`where fluxmail` on Windows). If you selected a custom data directory, add `"env": { "FLUXMAIL_DATA_DIR": "/absolute/path/to/data" }` to that server entry. The setup command and Cline must run as the same operating-system user and use the same data directory.

For Cline CLI, use its MCP settings file or MCP add command. Consult `cline mcp --help` for the options supported by your installed version. The Fluxmail command and arguments are the same.

Cline starts `fluxmail stdio` itself. This uses the local member session saved by setup. It does not require an API key or a separate HTTP server. The `read-only` profile permits reading email and listing mailboxes while excluding email changes and sending.

### Verify the MCP connection

Reload the server in Cline, then ask:

> Use Fluxmail's list_accounts MCP tool to list my connected mailboxes. Do not connect a mailbox or send mail.

A successful `list_accounts` result with no accounts confirms that Cline can call the server. If Cline cannot find the executable, check the absolute command path. If it reports that login is required, run `pnpm exec fluxmail login` from the installation directory with the same data directory, then reload the server.

### Connect a mailbox when ready

Gmail uses browser consent:

```bash
pnpm exec fluxmail accounts add gmail
```

For Microsoft 365, Outlook.com, or IMAP/SMTP, follow the provider setup in the [quickstart](https://fluxmail.ai/docs/quickstart). Ask before authenticating to a mail provider or accessing someone's mail. The Personal plan supports three mailboxes and one member. Fluxmail is source available under the Elastic License 2.0.

</details>

<details>
<summary>Hermes</summary>

Add the server to `~/.hermes/config.yaml`, then run `/reload-mcp`. You can also use the dashboard opened by `hermes dashboard`.

```yaml
mcp_servers:
  fluxmail:
    command: 'fluxmail'
    args: ['stdio']
```

</details>

<details>
<summary>Gemini CLI</summary>

Add the server to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "fluxmail",
      "args": ["stdio"]
    }
  }
}
```

</details>

<details>
<summary>Other stdio clients</summary>

Register `fluxmail` as the command with `stdio` as its argument.

</details>

If a desktop client cannot find `fluxmail`, run `which fluxmail` in your terminal and use the returned absolute path as the command.

If you configured stdio, continue to [Test the connection](#test-the-connection). Do not configure Streamable HTTP as well.

## Option 2: Connect over Streamable HTTP

Use this option instead of stdio when the MCP client connects to Fluxmail by URL.

Start the HTTP server and create an API key for the client:

```bash
fluxmail apikey create --name local-agent

fluxmail serve
```

Fluxmail displays the `fmk_...` key once. The local MCP URL is `http://localhost:8977/mcp`. A remote deployment uses its public HTTPS URL followed by `/mcp`.

If Fluxmail runs in Docker, create the key inside the container. The server is already started by Docker Compose:

```bash
docker compose exec fluxmail \
  fluxmail apikey create --name desktop
```

<details>
<summary>Claude Code</summary>

```bash
claude mcp add --transport http fluxmail http://localhost:8977/mcp \
  --header "Authorization: Bearer fmk_..."
```

</details>

<details>
<summary>Claude Desktop</summary>

Claude Desktop's built-in remote connectors accept OAuth or no authentication, so they cannot send a Fluxmail API key. Use the local [`mcp-remote`](https://github.com/geelen/mcp-remote) bridge.

Add this server to `claude_desktop_config.json` under Settings > Developer > Edit Config:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "http://localhost:8977/mcp",
        "--allow-http",
        "--transport",
        "http-only",
        "--header",
        "Authorization:${FLUXMAIL_AUTH_HEADER}"
      ],
      "env": {
        "FLUXMAIL_AUTH_HEADER": "Bearer fmk_..."
      }
    }
  }
}
```

Replace `fmk_...` with the API key, then restart Claude Desktop. The bridge requires Node.js and npm on the same computer as Claude Desktop.

</details>

<details>
<summary>ChatGPT / Codex app</summary>

Open Settings > Plugins > MCPs > Add server, then enter:

- Name: `Fluxmail`
- Type: `Streamable HTTP`
- URL: `http://localhost:8977/mcp`
- Header name: `Authorization`
- Header value: `Bearer fmk_...`

Save the server and restart the app.

</details>

<details>
<summary>Codex CLI</summary>

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.fluxmail]
url = "http://localhost:8977/mcp"
http_headers = { Authorization = "Bearer fmk_..." }
```

</details>

<details>
<summary>Cursor</summary>

Add the server to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "fluxmail": {
      "url": "http://localhost:8977/mcp",
      "headers": { "Authorization": "Bearer fmk_..." }
    }
  }
}
```

</details>

<details>
<summary>Hermes</summary>

Add the server to `~/.hermes/config.yaml`, then run `/reload-mcp`:

```yaml
mcp_servers:
  fluxmail:
    url: 'http://localhost:8977/mcp'
    headers:
      Authorization: 'Bearer fmk_...'
```

</details>

<details>
<summary>Gemini CLI</summary>

Add the server to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "fluxmail": {
      "httpUrl": "http://localhost:8977/mcp",
      "headers": { "Authorization": "Bearer fmk_..." }
    }
  }
}
```

</details>

<details>
<summary>ChatGPT.com developer mode</summary>

The ChatGPT / Codex app entry above configures Codex inside the ChatGPT app. Developer-mode apps used from regular ChatGPT chats have separate settings.

ChatGPT cannot connect directly to `localhost`. For a local Docker server, use OpenAI's [Secure MCP Tunnel](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta#h_8e76ef4c26). You can also deploy Fluxmail at a public HTTPS URL.

ChatGPT connectors currently support OAuth or no authentication, so they cannot send Fluxmail's API key. Fluxmail does not offer an unauthenticated MCP mode. ChatGPT developer-mode apps are not compatible until Fluxmail supports MCP OAuth.

</details>

<details>
<summary>Other HTTP clients</summary>

Point the client to `http://localhost:8977/mcp`, or to the deployed `/mcp` URL. Send `Authorization: Bearer fmk_...` with each request.

Clients that cannot set an authorization header are not compatible with the HTTP MCP endpoint.

</details>

## Test the connection

Ask the connected agent:

> What are the latest 5 emails in my inbox?

If the agent returns the messages, the connection is working. See [MCP tools](/docs/tools) for the operations it can call.

## Limit access

For stdio, add `--profile read-only`, `--profile read-write`, or repeated `--allow` options to the server command.

For HTTP, the API key stores the permission profile and mailbox scope. You can change them without updating the client configuration. See [Permissions](/docs/permissions) for profiles and capabilities.
