"""Discord bot that posts a lottery-channel reminder when the channel is active."""

from __future__ import annotations

import logging
import os

import discord
from discord.ext import commands, tasks


CHANNEL_ID = 1_530_295_626_242_461_726
REMINDER_MESSAGE = """Here is the lotto channel.
You can play many games to win money.
Here are all the commands:
/blackjack
/higher-lower
/roulette"""


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("lotto-bot")

intents = discord.Intents.default()
# This is required to inspect the latest message in the channel.
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready() -> None:
    """Log readiness and start the reminder loop once per process."""
    if bot.user is not None:
        logger.info("Bot connected as %s (ID: %s)", bot.user, bot.user.id)

    if not verifier_et_envoyer.is_running():
        verifier_et_envoyer.start()


async def get_lotto_channel() -> discord.abc.Messageable | None:
    """Return the configured channel, fetching it if it is not cached."""
    channel = bot.get_channel(CHANNEL_ID)
    if channel is not None:
        return channel

    try:
        return await bot.fetch_channel(CHANNEL_ID)
    except discord.NotFound:
        logger.error("Channel %s was not found.", CHANNEL_ID)
    except discord.Forbidden:
        logger.error("The bot cannot access channel %s.", CHANNEL_ID)
    except discord.HTTPException:
        logger.exception("Discord failed while fetching channel %s.", CHANNEL_ID)
    return None


@tasks.loop(minutes=1)
async def verifier_et_envoyer() -> None:
    """Send the reminder only when the latest channel message is not from the bot."""
    channel = await get_lotto_channel()
    if channel is None or not hasattr(channel, "history"):
        logger.error("Configured channel %s is not a readable text channel.", CHANNEL_ID)
        return

    try:
        async for message in channel.history(limit=1):
            if bot.user is not None and message.author.id == bot.user.id:
                return

            await channel.send(REMINDER_MESSAGE)
            logger.info("Reminder sent to channel %s.", CHANNEL_ID)
            return
    except discord.Forbidden:
        logger.error("The bot cannot read or send messages in channel %s.", CHANNEL_ID)
    except discord.HTTPException:
        logger.exception("Discord failed while processing channel %s.", CHANNEL_ID)


@verifier_et_envoyer.before_loop
async def avant_envoi() -> None:
    await bot.wait_until_ready()


def main() -> None:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit(
            "DISCORD_TOKEN is not configured. Add it as a Replit Secret before running the bot."
        )

    bot.run(token)


if __name__ == "__main__":
    main()