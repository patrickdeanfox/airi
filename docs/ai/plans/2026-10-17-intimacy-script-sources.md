# Intimacy script module: source material

Companion to `2026-10-17-intimacy-script-module.md`. Lists public material that
can seed scripts, prompts, and the authoring skill. Private fork only.

No ready-made dataset of spoken-style scripts exists. The material falls into
four buckets. Each bucket serves a different part of the module.

## 1. Performance scripts

Closest match to the module's line format. These scripts are written to be read
aloud. They use bracketed sound cues and parenthesized stage directions, which
map directly to the `clip`, `emotion`, and `pause` fields.

| Source | Link | Notes |
| --- | --- | --- |
| r/gonewildaudio script offers on AO3 | https://archive.transformativeworks.org/series/4476604 | Collection written for voice actors. |
| scriptbin | https://scriptbin.works/about/script-policy | Script host. Content must carry a sensitivity disclaimer. |
| gwasi.com search index | https://greasyfork.org/en/scripts/474018-word-count-for-gone-wild-audio-search-interface | Filter by tags: JOI, edging, countdown, aftercare. |
| gwaripper | https://github.com/nilfoer/gwaripper | Downloads audio fills. Study delivery only. |

License: "script offer" means permission to perform, not to redistribute the
text. Private use is fine. Read each script's permission header.

## 2. Roleplay datasets

Long-form prose, not spoken lines. Use them to extract phrasing and escalation
patterns, then rewrite as short lines.

| Dataset | Link | License | Notes |
| --- | --- | --- | --- |
| PIPPA | https://huggingface.co/datasets/PygmalionAI/PIPPA?not-for-all-audiences=true | Apache-2.0 | Community chat logs, partly synthetic. |
| LimaRP | https://huggingface.co/datasets/lemonilia/LimaRP | Check card | About 2000 curated 1:1 roleplays. Highest quality of the three. |
| Bluemoon cleaned | https://huggingface.co/datasets/Squish42/bluemoon-fandom-1-1-rp-cleaned | Unclear | 290k scraped forum posts. |
| RolePlay-Mixed | https://huggingface.co/datasets/xDAN2099/RolePlay-Mixed-Bluemoon-Limarp | Check card | Bluemoon and LimaRP merged. |
| HF tag listing | https://huggingface.co/datasets?other=not-for-all-audiences%2C+NSFW | Varies | Browse for more. Check each card. |

## 3. Pacing and gating rules

SillyTavern presets encode escalation logic in prompt form. Mine them for the
toolset prompt.

| Preset | Link | What to take |
| --- | --- | --- |
| Stab's EDH | https://github.com/Zorgonatis/Stabs-EDH | NSFW toggle, response length tiers, explicit-language directive. |
| Neconyan (purachina) | https://platberlitz.github.io/ | NSFW mode turns on only once intimacy starts. Direct pacing logic. |
| Marinara's LLM Hub | https://spicymarinara.github.io/ | Preset collection and notes. |
| Sphiratrioth presets | https://huggingface.co/sphiratrioth666/SillyTavern-Presets-Sphiratrioth/blob/main/README.md | CC-BY-NC-3.0. Length variants, about 150 and 350 tokens. |
| sillytavern-preset-creator | https://github.com/cha1latte/sillytavern-preset-creator | Archived. Explains prompt layering by position. |
| SillyTavern default preset | https://github.com/SillyTavern/SillyTavern/blob/release/default/content/presets/openai/Default.json | Structural reference. |

## 4. Structure formats

| Format | Link | Use |
| --- | --- | --- |
| Character Card V2 spec | https://github.com/bradennapier/character-cards-v2 | AIRI already reads character cards. |
| `character_book` lorebooks | https://sillycard-web.pages.dev/blog/st-fields-04-character-book | Keyword-triggered text entries. Near match for scripts keyed by trigger. |
| Card format guide | https://tavernsprite.com/blog/sillytavern-character-card-format/ | PNG vs JSON, V2 vs V3. |

TTS with non-verbal tags, for the open question in the plan:

| Engine | Link | Tags |
| --- | --- | --- |
| Chatterbox Turbo | https://github.com/resemble-ai/chatterbox | `[laugh]`, `[chuckle]` and similar. |
| Chatterbox TTS Server | https://github.com/devnen/Chatterbox-TTS-Server | Self-host with an OpenAI-compatible API. |
| Dia | https://github.com/nari-labs/dia | Speaker tags and non-verbal cues in one pass. |

## Craft references

Thin. These cover communication and consent, not script structure.

| Source | Link |
| --- | --- |
| Tongue Tied, Stella Harris | https://www.simonandschuster.com/books/Tongue-Tied/Stella-Harris/9781627782661 |
| Healthline on dirty talk | https://www.healthline.com/health/healthy-sex/talking-dirty |
| Dirty talk pitfalls guide | https://opulencia.gumroad.com/l/zlcsgk |

## How to turn this into a skill

Confidence: medium.

1. Write a `SKILL.md` that teaches the arc: tease, build, plateau or edge,
   countdown, release, aftercare. Use the user's own lines as the few-shot
   examples. Put no dataset text in the skill.
2. Write a converter from performance-script notation to `ScriptLine` JSON.
   `[sound]` becomes `clip`. `(direction)` becomes `emotion` or `pause`.
3. Put persona vocabulary in lorebook entries. Load them through the existing
   card system.
4. Use the preset rules from bucket 3 as the base of the toolset prompt.

## Rules for any imported material

- Check the license of each source before use.
- Exclude any material that depicts minors, real people, or non-consent.
- Keep imported text out of the repository. Load it from the user's folders.
