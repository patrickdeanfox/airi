# Settings tools for the character

Status: accepted

## Context

The user wants to change AIRI settings by asking the character in chat, for example "switch to the Kokoro voice" or "show your Cry expression".
No code path let an agent change settings. Settings live in renderer Pinia stores. The channel protocol has no settings event, and the plugin SDK has no settings kit.
The wake word tool (`packages/stage-ui/src/tools/wake-words.ts`) already lets the model edit its own card during a turn.

## Decision

Add LLM tools in `packages/stage-ui/src/tools/settings/` and list them on every chat turn while the `settings-tools` feature flag is on.

| Concern | Location |
| --- | --- |
| Tool definitions, validation, result shapes | `packages/stage-ui/src/tools/settings/index.ts` |
| Store binding for the leader window | `packages/stage-ui/src/tools/settings/access.ts` |
| Per-turn wiring and the flag check | `packages/stage-ui/src/stores/chat.ts` |
| Flag and its strings | `packages/stage-ui/src/libs/feature-flags.ts`, `packages/i18n/src/locales/en/settings.yaml` |

### Why tools before a protocol event

A tool needs no new transport and no permission model. The turn already runs in the leader window with every store available.
A `settings:patch` channel event is the next step. It can reuse `SettingsAccess`.

### Why card actions instead of store writes

`applyActiveCardSettings` rewrites the chat, speech and display model stores from the active card. A raw store write is lost on the next activation.
`updateActiveCardConsciousness`, `updateActiveCardSpeech` and `setActiveCardDefaultAvatarModel` persist the override on the card first.

### Why act tokens for expressions

`live2d.expressions.execute` lives in the Live2D context of the Stage component, not in a store.
The act signal path in `Stage.vue` already applies the character's control policy.
The tool dispatches `<|ACT {"expression":{...}}|>` through `useLlmStreamingControlStore().dispatchWith`, so a tool call and a reply token behave the same.

### Limits

Credentials and base URLs are out of reach. VRM has no expression tool. The tools validate before they write and return the valid choices on a rejection.

## Consequences

Every turn carries eleven more tool definitions while the flag is on. Turning the flag off removes them on the next turn.
Tests in `index.test.ts` run against a fake `SettingsAccess`. The typecheck and a manual check through the channel cover the store binding.
