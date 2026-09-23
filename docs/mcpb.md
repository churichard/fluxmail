# Fluxmail MCP bundle

Smithery accepts a prebuilt MCPB for local stdio servers. The Fluxmail bundle runs on Windows and macOS on x64 or ARM64, and on Linux on x64 or ARM64 with glibc or musl. It requires Node.js 22.22 or later in the Node.js 22 release line. MCPB lists supported operating systems in its manifest but has no CPU architecture field, so the bundle selects its native binaries when it starts.

Build from a checkout of the matching Fluxmail version with Node.js 22.22 or later:

```bash
pnpm install --frozen-lockfile
pnpm mcpb:build
```

The build writes `fluxmail-<version>.mcpb` and `fluxmail-<version>-smithery.mcpb` to `.context/mcpb/`. The first follows MCPB 0.3. Smithery requires `inputSchema` on each manifest tool, although MCPB 0.3 rejects that field. The Smithery archive adds schemas returned by Fluxmail's MCP server.

The build uses a hoisted production install. It includes Argon2 binaries for each supported system and downloads the matching SQLite binaries from the pinned better-sqlite3 release after checking their SHA-256 hashes. If better-sqlite3 changes version, update the hashes and review the bundled loader. The build removes SQLite source files and unused Google API clients to stay under Smithery's 25 MB upload limit. It then extracts both archives and checks the CLI, SQLite, Argon2, and MCP tools. CI runs the extracted bundle on Windows, macOS, Ubuntu, and Alpine. Review the tool descriptions in `mcpb/manifest.template.json` when the MCP toolset changes.

Users need to complete the [Fluxmail quickstart](https://fluxmail.ai/docs/quickstart) and connect a mailbox before installing the bundle. It uses their existing local Fluxmail data and login. The archive contains no credentials or mailbox data.

Publish the verified archive through the Smithery CLI to the [Fluxmail listing](https://smithery.ai/servers/richard-8sjs/fluxmail):

```bash
smithery auth login
smithery mcp publish .context/mcpb/fluxmail-<version>-smithery.mcpb -n richard-8sjs/fluxmail
```

Check the published listing and install command after Smithery finishes processing the release.
