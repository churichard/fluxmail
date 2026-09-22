---
title: 'Search emails batch'
description: 'Search up to 20 accounts with one portable query and return one result group per account.'
updated: '2026-07-15'
---

<!-- This page is generated from the MCP tool definitions. Run pnpm docs:generate to update it. -->

`search_emails_batch`

Search up to 20 accounts with one portable query and return one result group per account.

## Permissions

Required capabilities: `mail.read`.

## Inputs

| Name | Required | Type | Details |
| --- | --- | --- | --- |
| `accounts` | Yes | array of `object` | None |
| `query` | Yes | `string` | Typed portable search syntax Minimum length: 1. |
| `folder` | No | `inbox` or `sent` or `drafts` or `archive` or `spam` or `trash` or `all` | None |
| `from` | No | `string` | None |
| `to` | No | `string` | None |
| `subject` | No | `string` | None |
| `read` | No | `boolean` | None |
| `starred` | No | `boolean` | None |
| `hasAttachment` | No | `boolean` | None |
| `after` | No | `string` | YYYY-MM-DD received date, inclusive in UTC Minimum length: 1. |
| `before` | No | `string` | YYYY-MM-DD received date, exclusive in UTC Minimum length: 1. |
| `pageSize` | No | `integer` | Defaults to 25 Minimum: 1. Maximum: 100. |
| `includeSnippet` | No | `boolean` | Request or suppress message previews |
| `includeSearchContext` | No | `boolean` | Include a match-centered body excerpt; requires a portable text query |

<details>
<summary>JSON input schema</summary>

```json
{
  "type": "object",
  "properties": {
    "accounts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "accountId": {
            "type": "string",
            "minLength": 1
          },
          "pageToken": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "accountId"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 20
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "description": "Typed portable search syntax"
    },
    "folder": {
      "type": "string",
      "enum": [
        "inbox",
        "sent",
        "drafts",
        "archive",
        "spam",
        "trash",
        "all"
      ]
    },
    "from": {
      "type": "string"
    },
    "to": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "read": {
      "type": "boolean"
    },
    "starred": {
      "type": "boolean"
    },
    "hasAttachment": {
      "type": "boolean"
    },
    "after": {
      "type": "string",
      "minLength": 1,
      "description": "YYYY-MM-DD received date, inclusive in UTC"
    },
    "before": {
      "type": "string",
      "minLength": 1,
      "description": "YYYY-MM-DD received date, exclusive in UTC"
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Defaults to 25"
    },
    "includeSnippet": {
      "type": "boolean",
      "description": "Request or suppress message previews"
    },
    "includeSearchContext": {
      "type": "boolean",
      "description": "Include a match-centered body excerpt; requires a portable text query"
    }
  },
  "required": [
    "accounts",
    "query"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
