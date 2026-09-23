# Fluxmail MCP bundle

Smithery accepts a prebuilt MCPB for local stdio servers. The current Fluxmail bundle supports Apple Silicon Macs running Node.js 22.22 or later within the Node.js 22 release line. It includes the server and its dependencies, including native SQLite and Argon2 modules. Other systems need their own native builds before they can use a bundle. MCPB's compatibility field can limit the operating system but has no CPU architecture field. The manifest states the Apple Silicon requirement, and the launcher checks it before loading native modules.

Build it from a clean checkout of the matching Fluxmail version:

```bash
pnpm install --frozen-lockfile
pnpm mcpb:build
```

The build writes two archives to `.context/mcpb/`: `fluxmail-<version>-darwin-arm64.mcpb` and `fluxmail-<version>-darwin-arm64-smithery.mcpb`. The first follows MCPB 0.3. Smithery requires `inputSchema` on each manifest tool, although MCPB 0.3 rejects that field, so the second archive adds the schemas returned by Fluxmail's MCP server. The build uses a hoisted production install and removes Google API clients other than Gmail to stay under Smithery's 25 MB bundle limit. It extracts the archives and checks the CLI, native modules, and MCP tools. The manifest version comes from `packages/server/package.json`; review the tool descriptions in `mcpb/manifest.template.json` when the MCP toolset changes.

Before installing the bundle, users need to complete the [Fluxmail quickstart](https://fluxmail.ai/docs/quickstart) and connect a mailbox. The bundle uses their existing local Fluxmail data and login. It does not contain credentials or mailbox data.

Publish the verified archive through the Smithery CLI to the [Fluxmail listing](https://smithery.ai/servers/richard-8sjs/fluxmail):

```bash
smithery auth login
smithery mcp publish .context/mcpb/fluxmail-<version>-darwin-arm64-smithery.mcpb -n richard-8sjs/fluxmail
```

Check the published listing and install command after Smithery finishes processing the release. Do not advertise Windows, Linux, Intel Macs, or Node.js 20 support for this artifact.
