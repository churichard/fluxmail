# Fluxmail MCP bundle

Smithery accepts a prebuilt MCPB for local stdio servers. The current Fluxmail bundle supports Apple Silicon Macs running Node.js 22.22 or later within the Node.js 22 release line. It includes the server and its dependencies, including native SQLite and Argon2 modules. Other systems need their own native builds before they can use a bundle.

Build it from a clean checkout of the matching Fluxmail version:

```bash
pnpm install --frozen-lockfile
pnpm mcpb:build
```

The archive is written to `.context/mcpb/fluxmail-<version>-darwin-arm64.mcpb`. The build extracts the archive and checks the CLI and native modules. The manifest version comes from `packages/server/package.json`; review the tool descriptions in `mcpb/manifest.template.json` when the MCP toolset changes.

Before installing the bundle, users need to complete the [Fluxmail quickstart](https://fluxmail.ai/docs/quickstart) and connect a mailbox. The bundle uses their existing local Fluxmail data and login. It does not contain credentials or mailbox data.

Publish the verified archive through the Smithery CLI under the Fluxmail namespace:

```bash
smithery auth login
smithery mcp publish .context/mcpb/fluxmail-<version>-darwin-arm64.mcpb -n <namespace>/fluxmail
```

Check the published listing and install command after Smithery finishes processing the release. Do not advertise Windows, Linux, Intel Macs, or Node.js 20 support for this artifact.
