# Fluxmail

[Fluxmail](https://github.com/churichard/fluxmail-mcp) is a self-hosted MCP server that connects AI agents to Gmail and IMAP/SMTP mailboxes. It gives MCP clients a consistent set of tools to read, search, draft, send, and organize email.

## Install

Fluxmail requires Node.js 20.20.x, or Node.js 22.22 or later.

```bash
npm install -g fluxmail
```

To run Fluxmail without installing it globally:

```bash
npx fluxmail
```

Create a member before connecting a mailbox:

```bash
fluxmail members add --name "Your name" --email you@example.com
```

## Connect Gmail

Create a Google Cloud OAuth client with the Gmail API enabled, then save its credentials:

```bash
fluxmail config set GOOGLE_CLIENT_ID <your-client-id>.apps.googleusercontent.com
fluxmail config set GOOGLE_CLIENT_SECRET <your-client-secret>
fluxmail accounts add gmail --owner you@example.com
```

For a local installation, the last command starts Google's consent flow in your browser.

For Docker or a remote server, set `FLUXMAIL_PUBLIC_URL` to the server's public HTTPS address and register `<FLUXMAIL_PUBLIC_URL>/auth/google/callback` as an authorized redirect URI in Google Cloud. Run the command on the server, then open the printed URL in your local browser:

```bash
docker compose exec fluxmail fluxmail accounts add gmail --owner you@example.com
```

Open the printed link, then select Continue with Google. The link expires after 10 minutes and works once. Fluxmail selects the flow from `FLUXMAIL_PUBLIC_URL`; `--local` and `--hosted` override that selection when needed.

## Connect IMAP

```bash
fluxmail accounts add imap \
  --owner you@example.com \
  --email you@example.com \
  --imap-host imap.example.com \
  --smtp-host smtp.example.com
```

Fluxmail prompts for the password and stores it encrypted. Use `--imap-password-env <name>` for Docker or scripted setup.

## Connect an MCP client

For example, with Claude Code:

```bash
claude mcp add fluxmail -- fluxmail stdio --member you@example.com
```

Or with Codex CLI:

```bash
codex mcp add fluxmail -- fluxmail stdio --member you@example.com
```

To have your MCP client run Fluxmail without a global installation, replace `fluxmail stdio` with `npx -y fluxmail@latest stdio`. Keep the `--member` option after `stdio`. Replace `@latest` with an exact version to keep the client on that version.

Each MCP connection can use the mailboxes owned by or shared with its member. Repeat `--account <id-or-email>` if the connection should use fewer mailboxes. For HTTP, create a key with `fluxmail apikey create --name <name> --member <id-or-email>` and add the same `--account` options when needed.

Fluxmail also supports Streamable HTTP for Docker and remote deployments.

See the [setup guide](https://fluxmail.ai/docs/quickstart) for Google OAuth configuration, Docker deployment, supported MCP clients, environment variables, and the complete tool list.

## License

See the [repository](https://github.com/churichard/fluxmail-mcp) for license terms.
