---
title: 'fluxmail attachments download'
description: 'Download an attachment'
updated: '2026-07-15'
---

<!-- This page is generated from the CLI command definitions. Run pnpm docs:generate to update it. -->

`fluxmail attachments download`

Download an attachment

## Usage

```bash
fluxmail attachments download <message-id> <attachment-id> [options]
```

## Arguments

| Name | Required | Details | Default |
| --- | --- | --- | --- |
| `message-id` | Yes | Provider message ID | None |
| `attachment-id` | Yes | Opaque attachment ID from message metadata | None |

## Options

| Option | Required | Details | Default |
| --- | --- | --- | --- |
| `--output <path>` | Yes | Write the attachment to this path | None |
| `--force` | No | Overwrite an existing file | None |
