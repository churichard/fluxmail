# Install Fluxmail in Cline

## Local connection

These commands grant Full access: reading, sending, scheduling, drafts, organization, and moving mail into or out of Trash. Full excludes permanent deletion. Use `read-write` or `read-only` for [restricted access](https://fluxmail.ai/docs/permissions).

Open Cline's MCP Servers view, edit its MCP settings, and add this entry under `mcpServers` alongside any existing servers:

```json
{
  "mcpServers": {
    "fluxmail": {
      "command": "/absolute/path/to/fluxmail",
      "args": ["stdio", "--profile", "full"]
    }
  }
}
```

Replace the command with your Fluxmail executable's absolute path.

For Cline CLI, run in an interactive terminal:

```bash
cline mcp install fluxmail -- fluxmail stdio --profile full
```

Review and save the configuration in the add-server wizard.

## HTTP connection

Create a named key with the [chosen permission profile and mailbox scope](https://fluxmail.ai/docs/connect-an-mcp-client#option-2-connect-over-streamable-http). We recommend `--profile full` for normal MCP use.

Open Cline's MCP settings and add this entry under `mcpServers` alongside any existing servers:

```json
{
  "mcpServers": {
    "fluxmail": {
      "type": "streamableHttp",
      "url": "http://localhost:8977/mcp",
      "headers": { "Authorization": "Bearer fmk_..." }
    }
  }
}
```

Set `type` to `streamableHttp`; omitting it makes Cline use the legacy SSE transport. Replace the URL with your server's endpoint and enter your Fluxmail API key privately in place of `fmk_...`.

For Cline CLI, run `cline mcp` in an interactive terminal, add a server, choose Streamable HTTP, and enter the same URL and Authorization header.
