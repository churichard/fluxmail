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
| `folder` | No | `inbox` or `sent` or `drafts` or `archive` or `spam` or `trash` or `all` or `null` | None |
| `from` | No | `string` or `null` | None |
| `to` | No | `string` or `null` | None |
| `subject` | No | `string` or `null` | None |
| `read` | No | `boolean` or `null` | None |
| `starred` | No | `boolean` or `null` | None |
| `hasAttachment` | No | `boolean` or `null` | None |
| `after` | No | `string` or `null` | YYYY-MM-DD received date, inclusive in UTC Minimum length: 1. |
| `before` | No | `string` or `null` | YYYY-MM-DD received date, exclusive in UTC Minimum length: 1. |
| `pageSize` | No | `integer` or `null` | Defaults to 25 Minimum: 1. Maximum: 100. |
| `includeSnippet` | No | `boolean` or `null` | Request or suppress message previews |
| `includeSearchContext` | No | `boolean` or `null` | Include a match-centered body excerpt; requires a portable text query |

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
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
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
      "anyOf": [
        {
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
        {
          "type": "null"
        }
      ]
    },
    "from": {
      "type": [
        "string",
        "null"
      ]
    },
    "to": {
      "type": [
        "string",
        "null"
      ]
    },
    "subject": {
      "type": [
        "string",
        "null"
      ]
    },
    "read": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "starred": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "hasAttachment": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "after": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "null"
        }
      ],
      "description": "YYYY-MM-DD received date, inclusive in UTC"
    },
    "before": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "null"
        }
      ],
      "description": "YYYY-MM-DD received date, exclusive in UTC"
    },
    "pageSize": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        {
          "type": "null"
        }
      ],
      "description": "Defaults to 25"
    },
    "includeSnippet": {
      "type": [
        "boolean",
        "null"
      ],
      "description": "Request or suppress message previews"
    },
    "includeSearchContext": {
      "type": [
        "boolean",
        "null"
      ],
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
