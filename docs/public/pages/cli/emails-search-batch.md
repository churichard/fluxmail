---
title: 'fluxmail emails search-batch'
description: 'Search multiple email accounts'
updated: '2026-07-15'
---

<!-- This page is generated from the CLI command definitions. Run pnpm docs:generate to update it. -->

`fluxmail emails search-batch`

Search multiple email accounts

## Usage

```bash
fluxmail emails search-batch [query] [options]
```

## Arguments

| Name | Required | Details | Default |
| --- | --- | --- | --- |
| `query` | No | Typed portable search query | None |

## Options

| Option | Required | Details | Default |
| --- | --- | --- | --- |
| `--account <id>` | No | Account ID to search; repeat as needed | None |
| `--folder <role>` | No | Filter by a portable folder role | None |
| `--text <query>` | No | Filter by literal full-text search | None |
| `--from <address>` | No | Filter by sender | None |
| `--to <address>` | No | Filter by recipient | None |
| `--subject <text>` | No | Filter by subject | None |
| `--read <boolean>` | No | Filter by read state | None |
| `--starred <boolean>` | No | Filter by starred state | None |
| `--has-attachment <boolean>` | No | Filter by attachment state | None |
| `--after <date>` | No | Return messages on or after this YYYY-MM-DD date | None |
| `--before <date>` | No | Return messages before this YYYY-MM-DD date | None |
| `--page-size <number>` | No | Return 1 to 100 messages per account | None |
| `--include-snippet <boolean>` | No | Request or suppress message previews | None |
| `--input <file>` | No | Read an exact REST JSON body from a file, or pass - for stdin | None |
