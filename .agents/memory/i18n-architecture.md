---
name: i18n architecture
description: How FR/EN translation is implemented in the Discord bot
---

## Rule
All user-facing bot strings go through `_t(key, **kwargs)` / `_tl(base_key)` helpers defined in main.py. Never hardcode French or English strings directly in command handlers.

**Why:** The `/config language` command lets server admins switch the bot between French and English at runtime. Bypassing `_t()` breaks the feature silently.

## How to apply
- `_t(key, **kwargs)` — returns the translated string for the current `_lang` global, with `.format(**kwargs)` substitution.
- `_tl(base_key)` — returns a translated list (e.g. `work_jobs_fr` / `work_jobs_en`).
- `_lang` is set by `refresh_economy_config()` from `data.get("language", "fr")`.
- All STRINGS keys are in `main.py` under the `STRINGS` dict.

## API
- `PATCH /economy/config` — added alongside `PUT /economy/config`; bot uses `api_patch()` which sends PATCH.
- `language` column: `text default 'fr'` on `economyConfigTable`.
- OpenAPI: `language` field added to both `EconomyConfig` (required) and `EconomyConfigInput` schemas.

## Bot tree
- `config_group` must be defined **before** `bot.tree.add_command(config_group)` — they are both at module level, so declaration order matters. The group is defined in the `/config` section, and `add_command` is called immediately after, before `# ── Entry point`.
