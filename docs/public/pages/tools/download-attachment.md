---
title: 'Download attachment'
description: 'Get attachment metadata and a fetchable resource link. Set inline to embed the bytes.'
updated: '2026-07-15'
---

<!-- This page is generated from the MCP tool definitions. Run pnpm docs:generate to update it. -->

`download_attachment`

Get attachment metadata and a fetchable resource link. Set inline to embed the bytes.

## Permissions

Required capabilities: `mail.read`.

## Inputs

| Name | Required | Type | Details |
| --- | --- | --- | --- |
| `accountId` | Yes | `string` | Minimum length: 1. |
| `messageId` | Yes | `string` | None |
| `attachmentId` | Yes | `string` | Opaque attachment ID returned by message metadata Minimum length: 1. |
| `inline` | No | `boolean` | None |

<details>
<summary>JSON input schema</summary>

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "minLength": 1
    },
    "messageId": {
      "$ref": "#/properties/accountId"
    },
    "attachmentId": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque attachment ID returned by message metadata"
    },
    "inline": {
      "type": "boolean"
    }
  },
  "required": [
    "accountId",
    "messageId",
    "attachmentId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
