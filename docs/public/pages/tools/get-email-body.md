---
title: 'Get email body'
description: 'Read a bounded portion of one email body. Use nextOffset to continue.'
updated: '2026-07-15'
---

<!-- This page is generated from the MCP tool definitions. Run pnpm docs:generate to update it. -->

`get_email_body`

Read a bounded portion of one email body. Use nextOffset to continue.

## Permissions

Required capabilities: `mail.read`.

## Inputs

| Name | Required | Type | Details |
| --- | --- | --- | --- |
| `accountId` | No | `string` | Account to operate on. Optional when exactly one account is connected. Minimum length: 1. |
| `messageId` | Yes | `string` | Minimum length: 1. |
| `format` | Yes | `text` or `html` | None |
| `offset` | No | `integer` | Minimum: 0. |
| `maxChars` | No | `integer` | Minimum: 1. Maximum: 50000. |

<details>
<summary>JSON input schema</summary>

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "minLength": 1,
      "description": "Account to operate on. Optional when exactly one account is connected."
    },
    "messageId": {
      "type": "string",
      "minLength": 1
    },
    "format": {
      "type": "string",
      "enum": [
        "text",
        "html"
      ]
    },
    "offset": {
      "type": "integer",
      "minimum": 0
    },
    "maxChars": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50000
    }
  },
  "required": [
    "messageId",
    "format"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
