# Lotto Discord Bot

A Discord bot that watches a configured lotto channel and posts the game reminder when a new user message is the latest message.

## Run & Operate

- `python3 main.py` — start the Discord bot
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- Python 3.11 + discord.py
- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `main.py` — Discord bot and reminder loop
- `pyproject.toml` — Python dependency declaration
- `uv.lock` — locked Python dependency versions

## Architecture decisions

- `DISCORD_TOKEN` is read only from Replit Secrets.
- The reminder loop starts only once, even if Discord reconnects and emits `on_ready` again.
- The bot checks the latest message before sending, so its own reminder does not trigger another reminder.

## Product

The bot posts the configured lotto-channel announcement once per minute when a user has most recently posted in the channel.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Enable the Message Content Intent for the bot in the Discord Developer Portal.
- The bot needs View Channel, Read Message History, and Send Messages permissions in the configured channel.
- `/blackjack`, `/higher-lower`, and `/roulette` are advertised in the reminder but are not implemented by this bot yet.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
