---
title: 'Connect an MCP client'
description: 'Connect Claude, ChatGPT, Codex, Cursor, Hermes, Gemini, or another MCP client to Fluxmail.'
updated: '2026-07-17'
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

## Option 1: Connect over stdio

Every stdio client launches `fluxmail stdio`. Fluxmail uses the member logged in to the selected local instance. You do not need to run `fluxmail serve`.

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
