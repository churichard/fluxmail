---
title: 'Connect an MCP client'
description: 'Connect Claude, ChatGPT, Codex, Cline, Cursor, Hermes, Gemini, or another MCP client to Fluxmail.'
updated: '2026-10-04'
---

Complete the [Quickstart](/docs/quickstart) before configuring an MCP client.

## Choose one transport

Configure either stdio or Streamable HTTP. You do not need both.

| Transport | Use it when | Authentication |
| --- | --- | --- |
| stdio | Fluxmail and the MCP client run on the same computer | Selected local member session |
| Streamable HTTP | The client connects by URL, including Docker and remote deployments | Fluxmail API key |

For most local setups, choose stdio. Choose Streamable HTTP when Fluxmail runs in Docker, on another machine, or when the client requires a URL.

Both transports provide the same MCP tools. Most examples use the default `full` permission profile; the Cline examples use `read-only`. See [Permissions](/docs/permissions) to choose a profile.

Every `send_email` and `forward_email` call now needs an `idempotencyKey`. Keep the key and reuse it if a call times out. The result includes an `operationId`; call `get_delivery_operation` to check whether delivery succeeded, failed, or is uncertain. Inspect an uncertain message before attempting a new send. Use `preview_send` to check recipients and attachments without sending.

For plain-text email, ask your agent to keep each prose paragraph on one continuous line in `bodyText`, with a blank line between paragraphs. Fluxmail preserves line breaks, so wrapping a paragraph at a fixed width will show as short lines in the recipient's mail app. Lists and signatures can still use intentional line breaks.

An uncertain or failed send is marked as an MCP tool error, but its structured result still contains the operation ID and status. Bulk changes with failed or uncertain messages behave the same way, so inspect their per-message result before retrying.

Input errors from Fluxmail explain which field needs attention. Search syntax errors also include `data.diagnostics`. Provider error text is replaced with a safe message.

Mail tools return typed `structuredContent` and readable text. `get_email` and `get_thread` accept `bodyFormat` to select text, HTML, both, or no body. Large bodies include truncation metadata; use `get_email_body` to read the remaining text. Thread messages are paged. `download_attachment` returns a protected resource link by default. Set `inline` only when the attachment bytes must be embedded in the tool response.

## Option 1: Connect over stdio

Every stdio client launches `fluxmail stdio`. Without `--instance`, Fluxmail selects the active local profile first, then a local profile named `local`, then the sole local profile under any other name. It uses the member session saved for that profile. You do not need to run `fluxmail serve`.

Before connecting, run `fluxmail setup` for a new installation. For an existing installation, list profiles with `fluxmail instances list` and log in to the local profile the client will use with `fluxmail --instance <name> login`. Use `local` for the default profile created by setup or when recreating a missing local profile. The MCP client must run as the same operating-system user and use the same Fluxmail data directory as the setup or login command.

To pin the client to a particular local profile, add `--instance <name>` before `stdio` in the client command. You must choose a profile this way if several local profiles exist and none is active or named `local`. An explicit remote profile is rejected; use Streamable HTTP for remote instances. The stdio selection does not change the active profile for other CLI commands.

If a desktop client cannot find `fluxmail`, use the absolute executable path returned by `which fluxmail` (`where fluxmail` on Windows). For a project-local installation, use `/absolute/path/to/installation/node_modules/.bin/fluxmail` and keep that installation directory available.

For a custom data directory, set `FLUXMAIL_DATA_DIR` in the MCP server's environment to the same absolute path used during setup. In JSON configurations, add `"env": { "FLUXMAIL_DATA_DIR": "/absolute/path/to/data" }` to the server entry.

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

Open Cline's MCP Servers view, edit its MCP settings, and add this entry under `mcpServers` alongside any existing servers:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "/absolute/path/to/fluxmail",
      "args": ["stdio", "--profile", "read-only"]
    }
  }
}
```

Replace the command with your Fluxmail executable's absolute path.

For Cline CLI, run in an interactive terminal:

```bash
cline mcp install fluxmail -- fluxmail stdio --profile read-only
```

Review and save the configuration in the add-server wizard.

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

Reload or restart your client after saving its configuration, then ask:

> Use Fluxmail's list_accounts MCP tool to list my connected mailboxes. Do not connect a mailbox or send mail.

A successful `list_accounts` result confirms the connection. An empty list is expected if you have not connected a mailbox.

Once a mailbox is connected, you can ask:

> What are the latest 5 emails in my inbox?

If the agent returns the messages, the connection is working. See [MCP tools](/docs/tools) for the operations it can call.

## Limit access

For stdio, add `--profile read-only`, `--profile read-write`, or repeated `--allow` options to the server command.

For HTTP, the API key stores the permission profile and mailbox scope. You can change them without updating the client configuration. See [Permissions](/docs/permissions) for profiles and capabilities.
