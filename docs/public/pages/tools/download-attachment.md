---
title: 'Download attachment'
description: 'Download an email attachment as an embedded MCP resource.'
updated: '2026-07-15'
---

<!-- This page is generated from the MCP tool definitions. Run pnpm docs:generate to update it. -->

`download_attachment`

Download an email attachment as an embedded MCP resource.

## Permissions

Required capabilities: `mail.read`.

## Inputs

| Name | Required | Type | Details |
| --- | --- | --- | --- |
| `accountId` | No | `string` | Account to operate on. Optional when exactly one account is connected. Minimum length: 1. |
| `messageId` | Yes | `string` | Minimum length: 1. |
| `attachmentId` | Yes | `string` | Opaque attachment ID returned by message metadata Minimum length: 1. |

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
    "attachmentId": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque attachment ID returned by message metadata"
    }
  },
  "required": [
    "messageId",
    "attachmentId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
