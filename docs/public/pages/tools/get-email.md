---
title: 'Get email'
description: 'Fetch one email in full: body (text and/or HTML), recipients, attachment metadata.'
updated: '2026-07-15'
---

<!-- This page is generated from the MCP tool definitions. Run pnpm docs:generate to update it. -->

`get_email`

Fetch one email in full: body (text and/or HTML), recipients, attachment metadata.

## Permissions

Required capabilities: `mail.read`.

## Inputs

| Name | Required | Type | Details |
| --- | --- | --- | --- |
| `accountId` | No | `string` | Account to operate on. Optional when exactly one account is connected. Minimum length: 1. |
| `messageId` | Yes | `string` | Minimum length: 1. |
| `bodyFormat` | No | `text` or `html` or `both` or `none` | None |

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
    "bodyFormat": {
      "type": "string",
      "enum": [
        "text",
        "html",
        "both",
        "none"
      ]
    }
  },
  "required": [
    "messageId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
