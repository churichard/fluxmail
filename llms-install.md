# Install Fluxmail in Cline

Use a local stdio connection to call Fluxmail from Cline. You can check the connection before connecting a mailbox. If you completed the [quickstart](https://fluxmail.ai/docs/quickstart), skip to the Cline configuration below.

## Requirements

- Node.js 20.20.x, or Node.js 22.22 or later.
- Cline with a configured model provider.
- pnpm 11 for the project-local installation below.

## Install the package

In a directory where you want to keep the installation, run:

```bash
pnpm add --allow-build=better-sqlite3 fluxmail
pnpm exec fluxmail --version
```

The build permission lets the SQLite dependency install its native module. Keep this directory and its `node_modules` folder available while Cline uses the server.

## Create the local administrator

Run from the installation directory:

```bash
pnpm exec fluxmail setup --name "Your name" --email you@example.com
```

Fluxmail asks for a password without displaying it. Setup creates a local profile and saves your member session. For unattended setup, supply `FLUXMAIL_PASSWORD` through a secure environment; do not put a password in a command argument or commit it to a file.

Fluxmail normally stores data in your operating system's application-data directory. To use a separate instance, set `FLUXMAIL_DATA_DIR` to an absolute directory before setup. Pass the same value to Cline's MCP server configuration. `FLUXMAIL_TELEMETRY=0` disables anonymous telemetry.

You can check the instance before connecting a mailbox:

```bash
pnpm exec fluxmail status
pnpm exec fluxmail accounts list
```

An empty mailbox list is expected on a fresh instance. You do not need a paid plan or mailbox credentials for this connection check.

## Connect Cline

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

## Verify the MCP connection

Reload the server in Cline, then ask:

> Use Fluxmail's list_accounts MCP tool to list my connected mailboxes. Do not connect a mailbox or send mail.

A successful `list_accounts` result with no accounts confirms that Cline can call the server. If Cline cannot find the executable, check the absolute command path. If it reports that login is required, run `pnpm exec fluxmail login` from the installation directory with the same data directory, then reload the server.

## Connect a mailbox when ready

Gmail uses browser consent:

```bash
pnpm exec fluxmail accounts add gmail
```

For Microsoft 365, Outlook.com, or IMAP/SMTP, follow the provider setup in the [quickstart](https://fluxmail.ai/docs/quickstart). Ask before authenticating to a mail provider or accessing someone's mail. The Personal plan supports three mailboxes and one member. Fluxmail is source available under the Elastic License 2.0.
