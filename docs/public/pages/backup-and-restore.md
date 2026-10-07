---
title: "Back up and restore"
description: "Preserve the database and encryption key, then restore an installation from a complete backup."
updated: '2026-10-06'
---

Back up the complete Fluxmail data directory before an upgrade or move. By default it is `~/.fluxmail` locally and `/data` in Docker. The database and its matching encryption key must stay together: a database backup cannot decrypt credentials without that key.

Also save your deployment configuration and the installed Fluxmail version or image digest. If you use `FLUXMAIL_DB_PATH`, an external encryption key, or `*_FILE` secrets outside the data directory, back up those separately. Keep backups private; they contain credentials and member sessions.

## Back up a local installation

Stop every Fluxmail process that uses the directory, including MCP clients that launch `fluxmail stdio`. Copy the complete directory to a private backup location while it is stopped, then restart your clients or server.

On macOS or Linux, for the default directory:

```bash
umask 077
tar -C "$HOME" -czf fluxmail-backup.tar.gz .fluxmail
```

Use a new backup filename for each backup. Check that the archive can be listed before relying on it:

```bash
tar -tzf fluxmail-backup.tar.gz
```

Check for the database, configuration, and `encryption.key`, unless you manage the key externally. Archive listings show filenames, not credential values.

## Back up Docker storage

Run these commands from the Compose directory. They assume the standard `/data` volume and use the configured Fluxmail image as a stopped-service backup helper:

```bash
umask 077
docker compose stop fluxmail
docker compose run --rm --no-deps -T --entrypoint tar fluxmail \
  -C /data -czf - . > fluxmail-data-backup.tar.gz
```

Wait for the command to finish successfully, then check the archive:

```bash
tar -tzf fluxmail-data-backup.tar.gz
docker compose up -d fluxmail
```

Do not copy a live SQLite database file on its own. Stopping all writers and copying the complete directory keeps the database and any journal files together. The backup helper does not start the Fluxmail server.

Save `.env`, the Compose file, and any external secret files separately in the same private backup system. Do not commit them to source control. Keep a copy outside the server so a disk failure cannot destroy the installation and its only backup.

## Restore a local installation

Review pending scheduled sends before bringing an old backup online: messages whose scheduled time passed while the service was stopped can be sent at startup. Keep restoration tests isolated from provider access until you intend the restored instance to resume work.

1. Stop every process using the data directory.
2. Keep the current directory as a separate recovery copy. Restore the backup into an empty directory, rather than overlaying an existing database and its journal files.
3. Restore any external database path, encryption key, or secret files and their owner-only permissions.
4. Start the Fluxmail version recorded with the backup. If you intend to upgrade, verify the restored installation first, then follow the upgrade guide.
5. Run the checks below.

For an archive made with the local example, extract it into an empty recovery directory with `tar -xzf /path/to/fluxmail-backup.tar.gz -C /path/to/recovery`. It creates `.fluxmail` there. Move that restored directory into the configured data location after preserving the old one.

## Restore Docker storage

Stop the service and keep its current volume. Restore into a new, empty volume so the original remains available if verification fails. Review scheduled sends before starting the restored server; an overdue send can run at startup.

Edit the existing `volumes` mount for the `fluxmail` service in `docker-compose.yml` to use a new volume name, and declare it at the top level:

```yaml
services:
  fluxmail:
    volumes:
      - fluxmail-restored:/data

volumes:
  fluxmail-restored:
```

This is an excerpt: keep the service's image, ports, environment, and other settings. Choose a volume name you have not used before. Set the image to the version recorded with the backup and restore the matching external secrets before starting it.

From the Compose directory, restore the archive:

```bash
docker compose run --rm --no-deps -T --entrypoint tar fluxmail \
  -C /data -xzf - < fluxmail-data-backup.tar.gz
docker compose up -d fluxmail
```

Run the extraction only after stopping the original service. Check its exit status before starting Fluxmail. Keep the original volume until you have verified the restored service.

## Verify the restored installation

```bash
fluxmail status
fluxmail accounts list
fluxmail oauth status
fluxmail --mail-account <account-id> folders list
```

For Docker, prefix each command with `docker compose exec fluxmail`. Log in again if the saved member session has expired. Check a client connection with its existing API key or stdio configuration as well.

If Fluxmail cannot decrypt credentials, restore the matching encryption key. Generating a new key does not recover the encrypted records. If a provider token was revoked after the backup, [reconnect that mailbox](/docs/troubleshooting#a-mailbox-needs-to-be-reconnected).
