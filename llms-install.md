# Install Fluxmail in Cline

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
