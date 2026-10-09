# Public documentation publishing

The `Deploy MCP documentation` workflow validates the public documentation after
changes merge into `main`, then requests the `Production release` workflow in
`fluxmailai/fluxmail-web` on its `main` branch. A manual run also requires `main`.

The website release downloads the latest documentation from this repository. It
checks the website's merged commit, runs CI, builds the site, and applies website
migrations before publishing. The upstream workflow succeeds when GitHub accepts
the release request. Check the website's release run to confirm publication.

## Actions credential

Create a fine-grained GitHub personal access token with `fluxmailai` as the
resource owner, access only to `fluxmail-web`, and the repository permission
**Actions: Read and write**. Store it as the `FLUXMAIL_DOCS_DEPLOY_TOKEN` Actions
secret in `fluxmailai/fluxmail`. Set an expiration and replace the token before it
expires. Organization policy may require an administrator to approve it.

The workflow's built-in `GITHUB_TOKEN` cannot dispatch a workflow in another
repository. Keep the dedicated token out of source files and logs.

The former `FLUXMAIL_DOCS_DEPLOY_HOOK` secret is no longer used. Vercel deploy hooks
require a Git connection, and the website publishes through GitHub Actions with
the Vercel CLI.

## Manual refresh

Run `Production release` on `main` in `fluxmailai/fluxmail-web` to refresh the
documentation while the upstream Actions credential is unavailable. Check that
release's website job and live commit marker before considering the refresh
published.
