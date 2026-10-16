# @proj-airi/plugin-protocol

Shared protocol contracts for plugin-module communication in Project AIRI.

## What it does

- Defines websocket event names and payload types for module/plugin orchestration.
- Exposes Eventa event definitions bound to protocol event names.
- Provides shared transport/event utility types used by server and plugin runtimes.

## How to use

```ts
import type { WebSocketEvent, WebSocketEventOf, WebSocketEvents } from '@proj-airi/plugin-protocol/types'

import { moduleAnnounce, moduleAuthenticate } from '@proj-airi/plugin-protocol/types'
```

### Request and answer events

Some events ask the stage for an answer. The stage sends the answer only to the asking connection, through the destination `peer:<peerId>`. The answer carries the request event ID in `metadata.event.parentId`.

| Request | Answer | Purpose |
| --- | --- | --- |
| `asset:get:request` | `asset:get:response` | Read the bytes of an image or recording that a chat message references. |
| `tool:list:request` | `tool:list:response` | List the tools that the stage runs for modules, with JSON Schemas and annotations. |
| `tool:invoke:request` | `tool:invoke:response` | Run one stage tool. The stage validates the arguments first. |

Only the leader stage window answers the tool events. The server SDK `Client` wraps them as `getAsset`, `listStageTools`, and `invokeStageTool`.

## When to use

- You need canonical protocol contracts for plugin <-> host communication.
- You need event name stability and matching payload definitions across runtimes.

## When not to use

- You only need higher-level runtime client APIs from SDK packages.
- You are implementing app-only UI state that is not part of plugin/server transport contracts.

## License

[MIT](../../LICENSE)
