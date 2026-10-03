# Releasing Fluxmail

The `/release` skill is the normal release interface. It audits compatibility, selects a version, prepares the Common Changelog entry, opens the release pull request, waits for CI, asks for publication approval, merges, publishes, resumes failures, and verifies every destination.

The scripts in `scripts/release.mjs` and `scripts/publish.mjs` enforce release invariants. The GitHub workflow performs live publication. This document covers one-time service setup and manual recovery.

## One-time setup

Run the automated checks first:

```bash
pnpm release doctor --json
```

Routine releases use npm trusted publishing through GitHub OIDC. The publish job needs no npm login, npm token, or authenticator code. The normal preflight above does not access private npm account settings.

### GitHub release environment

Create a GitHub environment named `release`. Restrict deployment branches to `main`.

The agent asks for explicit publication approval before it merges and dispatches a release, so the environment does not need required reviewers. Add a reviewer only if the project needs a second approval in the GitHub interface.

The workflow uses the environment name as part of its npm trusted-publisher identity. Do not rename it without updating the workflow and every npm package configuration.

### npm trusted publishers

Configure GitHub Actions as the trusted publisher for these packages:

- `@fluxmail/core`
- `@fluxmail/provider-gmail`
- `@fluxmail/provider-imap`
- `@fluxmail/provider-outlook`
- `fluxmail`

Use the same settings for each package:

- Repository: `churichard/fluxmail`
- Workflow file: `publish-release.yml`
- Environment: `release`
- Permission: `npm publish`

The agent can configure them after setup approval. The equivalent bulk command is:

```bash
for package in \
  @fluxmail/core \
  @fluxmail/provider-gmail \
  @fluxmail/provider-imap \
  @fluxmail/provider-outlook \
  fluxmail
do
  npx --yes npm@11 trust github "$package" \
    --repo churichard/fluxmail \
    --file publish-release.yml \
    --env release \
    --allow-publish \
    --yes
  sleep 2
done
```

The release flow does not audit these private npm settings before publishing. The protected workflow checks the trusted-publisher match through OIDC. If that workflow reports a trust mismatch, or you are changing the publisher settings, run `pnpm release doctor --json --npm-trust` as a separate setup audit. It may require an interactive npm login.

### GHCR Actions access

Connect the `fluxmail` container package to `churichard/fluxmail`. A linked package inherits GitHub Actions access from that repository. The Dockerfile's `org.opencontainers.image.source` label keeps future images linked to the repository.

If preflight reports a mismatch, open the package settings and add `churichard/fluxmail` under Manage Actions access with write permission.

## Agent-driven release flow

Invoke `/release` and let the agent continue until it presents the publication approval packet. The packet includes the selected version, compatibility reasoning, complete changelog entry, pull request, release commit, npm tag, and destinations.

Approval authorizes the agent to merge the reviewed release pull request and dispatch the protected workflow. The workflow publishes five npm packages, a multi-platform GHCR image, MCP Registry metadata, a Git tag, and a GitHub Release. It verifies all destinations before it succeeds.

The release state lives in GitHub and the registries. Running `/release` again resumes an open pull request, a failed workflow, or a partial publication without relying on a local progress file.

## Manual inspection and recovery

Inspect destination state without writing anything:

```bash
pnpm release status --version <version> --json
```

Verify a completed release:

```bash
pnpm release verify \
  --version <version> \
  --sha <release-sha> \
  --npm-tag <latest-or-next>
```

When a workflow publish job fails after validation, rerun only the failed job. The release command skips existing immutable versions and starts at the first missing destination.

For the active release, a retry repairs a missing or stale Docker `latest` or `next` tag without rebuilding the image. A historical retry leaves newer npm and Docker channel tags unchanged.

Stop instead of retrying when Docker exists before every npm package, an existing npm version has the wrong channel tag without a consistent newer release, a published GitHub Release has a missing destination, a Git tag points to the wrong commit, or a draft GitHub Release has uploaded assets.

## Local fallback

Use local publishing only when GitHub Actions is unavailable. It requires separate approval because it replaces the normal OIDC and workflow controls.

Local publishing cannot use GitHub Actions OIDC, so npm may require an authenticator code in this fallback.

Authenticate to npm and GitHub first. The GitHub CLI token needs `write:packages`:

```bash
npm whoami
gh auth refresh --hostname github.com --scopes write:packages
```

Then publish from a clean checkout of the approved commit:

```bash
pnpm release publish \
  --version <version> \
  --sha <release-sha> \
  --npm-tag <latest-or-next> \
  --resume
```

## Claude Code plugin

The plugin bundle lives in `integrations/claude-code`. Its manifest version matches the Fluxmail packages. `pnpm release prepare` updates that version, and release validation and CI reject mismatches. The MCP command uses `fluxmail@latest`, so a server restart picks up the latest stable npm release.

After a successful stable release, Publish release copies the bundle to the standalone `claude-code-plugin` branch used by the Claude directory submission. Prereleases do not update that branch. Historical release retries skip the refresh when npm latest points to another version.

For plugin configuration or API compatibility changes between releases, merge the bundle changes into main and run the Refresh Claude Code plugin workflow. Main must still match npm latest. If main contains an unreleased version, publish the stable release first. Both workflows serialize plugin updates, create ordinary commits, and push without force. Identical bundles produce no commit.

Run `pnpm plugin:check` locally to validate the bundle. `pnpm plugin:sync` updates the manifest version from the packages. `pnpm plugin:publish` refreshes the submitted branch from the current checkout and requires the same stable version check. Anthropic controls directory approval; updating the source branch does not approve or resubmit the listing automatically.
