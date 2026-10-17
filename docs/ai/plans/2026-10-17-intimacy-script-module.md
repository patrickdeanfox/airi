# Intimacy script module (dirty talk)

Status: proposed
Scope: private fork only. Do not open an upstream PR.

## Goal

Give the model a set of tools that play user-authored scripts. A script is a
sequence of lines. Each line carries text for TTS and optional animation cues.
Script types include JOI, countdowns, edging loops, aftercare, and free lines.
The user writes every script. The module never generates explicit text on its
own.

## What exists in AIRI today

| Concern | Where | Reuse |
| --- | --- | --- |
| Tool definitions for the model | `packages/stage-ui/src/tools/*.ts`, built with `tool()` from `@xsai/tool` and zod | Same pattern |
| Tool registration | `useLlmToolsStore().addTools()` in `packages/stage-ui/src/stores/ai/chat-llm/tools.ts` | Same pattern |
| Toolset prompt (how the model is told to use a tool group) | `useLlmToolsetPromptsStore().registerToolsetPrompts()`, example in `stores/modules/web-search.ts` | Same pattern |
| Module settings store | `stores/modules/home-assistant.ts` (`useLocalStorageManualReset`, Valibot guards) | Template |
| Special tokens in a response | `<\|ACT ...\|>`, `<\|CALL ...\|>`, `<\|STICKER ...\|>`, parsed in `packages/core-agent` | Extend, do not fork |
| Act signal handling on stage | `Stage.vue` `streamingControl.onSignal`: `act` carries `emotion`, `motion`, `expression`. `delay` sleeps. | Extend |
| Emotion to animation map | `constants/emotions.ts`: `Emotion` enum, VRM expression names, Live2D motion groups, Spine names | Add new entries |
| VRM expressions | `stage-ui-three/src/composables/vrm/expression.ts` `setEmotion(name, intensity)` | Call through the existing queue |
| VRM animation clips | `stage-ui-three/src/composables/vrm/animation.ts` `loadVRMAnimation(url)`, one bundled `idle_loop.vrma` | Add a clip registry |
| Speech output per turn | `stores/voice.ts` `connectOutput`, `stores/modules/speech.ts` | Feed lines through the normal turn so lip sync and captions work |
| Settings page registration | `packages/stage-layouts/src/layouts/settings.vue` and the tamagotchi settings layout | Add a route |

There is no clip-pool player and no arousal emotion. `voice-packs.ts` is a TTS
preset list from the server. It is not related.

## Decision

Build it as a module in `packages/stage-ui`, gated by a feature flag that is
off by default. A plugin would be cleaner for upstream, but the plugin host does
not expose stage animation control. The module path gives direct access to the
emotion queue and the VRM mixer.

## Data model

Scripts live in one JSON file per script under a user-chosen folder. The module
loads them at startup and on a manual reload. Valibot validates each file.

```ts
// packages/stage-ui/src/libs/intimacy/script.ts

/** One line the character speaks or performs. */
interface ScriptLine {
  /** Text for TTS. Empty when the line is animation only. */
  text: string
  /** Emotion name from the extended Emotion enum. */
  emotion?: string
  /** 0 to 1. Default 1. */
  intensity?: number
  /** VRM animation clip id from the clip registry. */
  motion?: string
  /** Seconds to wait after playback ends before the next line. Default 0. */
  pause?: number
  /** Pre-recorded clip id to play instead of TTS. For moans and breaths. */
  clip?: string
}

/** A reusable sequence. */
interface Script {
  id: string
  /** Shown to the model in the tool description. */
  title: string
  /** One sentence the model reads to pick the script. */
  summary: string
  /** joi, countdown, edge, aftercare, free */
  kind: 'joi' | 'countdown' | 'edge' | 'aftercare' | 'free'
  /** Tags for the model: pace, tone, persona. */
  tags: string[]
  lines: ScriptLine[]
  /** Countdown only. Replaces {n} in text for each count. */
  countFrom?: number
  /** Edge only. How many times the loop block repeats before release. */
  loops?: number
}
```

Template variables in `text`: `{n}` for the count, `{name}` for the user name
from the character card, `{pet}` for a user-set pet name.

Pre-recorded clips: a folder of WAV or OGG files. A `clips.json` maps `clip` ids
to file paths and a category (`moan`, `breath`, `laugh`). The player picks at
random inside a category and avoids the last played clip, like the VaM
AudioRouterAB `Avoid Repetition` setting.

## Tools the model gets

All tools are in `packages/stage-ui/src/tools/intimacy.ts`.

| Tool | Input | Effect |
| --- | --- | --- |
| `intimacy_list_scripts` | `kind?`, `tag?` | Returns id, title, summary, kind, tags. Lets the model choose. |
| `intimacy_play_script` | `id`, `speed?` (0.5 to 2), `variables?` | Starts the script. Returns at once with a run id. |
| `intimacy_countdown` | `from` (3 to 60), `style` (script id with kind `countdown`), `speed?` | Expands the countdown script with `{n}` and plays it. |
| `intimacy_say` | `text`, `emotion?`, `motion?`, `clip?` | Plays one line the model wrote itself, with cues. For improvisation between scripts. |
| `intimacy_set_pace` | `speed` | Changes speed of the running script. |
| `intimacy_stop` | `fade?` | Stops the running script. Clears the emotion. Returns the model to idle. |
| `intimacy_status` | none | Returns run id, current line index, remaining lines, pace. |

Rules in the toolset prompt:

- Call `intimacy_list_scripts` before `intimacy_play_script`.
- Do not call another play while one runs. Use `intimacy_status`, then `intimacy_stop`.
- Use `intimacy_say` for short bridges only. Long content comes from scripts.
- After `intimacy_stop`, or when the user says stop, play an `aftercare` script.

## Runtime

```
tool call
  -> useIntimacyStore().play(script, options)
  -> ScriptRunner (class, owns the run state)
       for each line:
         1. resolve template variables
         2. if clip: play through the stage Playback, same destination as speech
            else: submit text to the voice turn so lip sync, captions, and
                  interrupt all work
         3. emit act signal { emotion, intensity, motion } through
            streamingControl, same path the model's <|ACT|> token uses
         4. await playback end, then sleep(pause / speed)
       on stop: interrupt the voice turn, reset emotion, play idle clip
```

The runner is a class because it owns state and lifecycle. Everything that
turns a script into lines is a pure function in `libs/intimacy/`.

Speech rate: pass `speed` to the TTS provider when it supports a rate option
(`params.rate` already exists on voice packs). When it does not, change only
the pauses.

## Animation link

Three layers, applied per line:

1. **Emotion** (expression). Extend `Emotion` with `aroused`, `pleasure`,
   `climax`, `tired`. Add them to every map in `constants/emotions.ts`. VRM
   expression names must match the model's blend shapes. Most VRM models lack
   these. Add a per-model override in settings that maps each new emotion to an
   existing expression name or a custom one.
2. **Motion** (full body). A clip registry in
   `stage-ui-three/src/assets/vrm/animations/index.ts`. Ship nothing. The user
   drops `.vrma` files into a folder and `clips.json` names them. The runner
   crossfades through the existing mixer. Loop clips (`breathing`, `sway`) stay
   until the next motion or stop.
3. **Lip sync**. Free. The voice turn path already drives it from the audio
   node. Pre-recorded clips route through the same `speechAnalysis` gain so
   the mouth moves on moans too.

Live2D: map new emotions to motion groups in the same constants file. Spine and
MMD: map to names or leave neutral.

## Settings page

`apps/stage-web/src/pages/settings/modules/intimacy.vue` and the tamagotchi
twin. Fields:

- Enable switch (feature flag, default off).
- Script folder path and a reload button. Shows parse errors per file.
- Clip folder path.
- Pet name.
- Emotion to expression override table, per loaded VRM.
- Default speed.
- Hard stop keyword list. The hearing module matches these and calls stop
  before the model sees the message.

## Safety and privacy

- Off by default. Nothing registers tools until the switch is on.
- Scripts and clips stay on disk. Nothing uploads.
- Hosted LLM and TTS providers refuse this content. The settings page warns
  and recommends a local chat model and a local or permissive TTS.
- Hard stop keywords bypass the model.

## Files to add

| File | Purpose |
| --- | --- |
| `packages/stage-ui/src/libs/intimacy/script.ts` | Valibot schema, `Script` and `ScriptLine` types |
| `packages/stage-ui/src/libs/intimacy/expand.ts` | Pure: countdown expansion, template variables, edge loops |
| `packages/stage-ui/src/libs/intimacy/clip-pool.ts` | Pure: pick next clip, avoid repeat |
| `packages/stage-ui/src/libs/intimacy/runner.ts` | `ScriptRunner` class |
| `packages/stage-ui/src/stores/modules/intimacy.ts` | Settings, loaded scripts, active run, tool registration |
| `packages/stage-ui/src/tools/intimacy.ts` | The seven tools |
| `packages/stage-ui/src/constants/emotions.ts` | New emotions and maps |
| `packages/stage-ui/src/components/scenes/Stage.vue` | Accept `motion` clip ids for VRM in the act handler |
| `packages/stage-ui-three/src/components/Model/VRMModel.vue` | Expose `playClip(id)` and `stopClip()` |
| `packages/stage-ui-three/src/assets/vrm/animations/index.ts` | Clip registry |
| `packages/stage-web/.../settings/modules/intimacy.vue` | Settings page |
| `packages/i18n/src/locales/en/settings.yaml` | Strings |
| `packages/stage-ui/src/libs/intimacy/*.test.ts` | Unit tests for expand and clip-pool |
| `docs/ai/adr/2026-10-17-intimacy-script-module.md` | ADR when accepted |

## Steps

1. Schema, expand, clip-pool, with tests. No UI.
2. Emotion enum extension and VRM override map. Verify on one model.
3. `ScriptRunner` driving the voice turn with one hard-coded script.
4. VRM clip registry and `playClip`. Verify a `.vrma` crossfade.
5. Tools and toolset prompt. Verify the model picks and stops a script.
6. Settings page, folders, reload, hard stop keywords.
7. Pre-recorded clip path through `speechAnalysis`.
8. ADR.

## Open questions

- Which local TTS. Needs rate control and non-verbal tags. Candidates: Fish
  Speech, Kokoro, GPT-SoVITS. Test with 10 lines each before choosing.
- Where the hard stop hooks into hearing. Needs a look at `modules/hearing.ts`.
- Whether a script can call another script. Start with no.
