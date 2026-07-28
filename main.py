"""Discord bot – lotto-channel reminder + slash commands + dashboard integration."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands, tasks


# ── Configuration ─────────────────────────────────────────────────────────────

# Default fallback values; live config is fetched from the API on startup.
DEFAULT_CHANNEL_ID = 1_531_418_977_677_475_992
DEFAULT_REMINDER_MESSAGE = """Here is the lotto channel.
You can play many games to win money.
Here are all the commands:
/blackjack
/higher-lower
/roulette

Many other commands are available in the #cmds\U0001f916

/balance
/crime
/deposit
/collect-income
/item buy
/item info
/item inventory
/withdraw
/work
And more!"""

API_BASE = "http://localhost:80/api"

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("lotto-bot")

# ── Runtime state ─────────────────────────────────────────────────────────────

_channel_id: int = DEFAULT_CHANNEL_ID
_reminder_enabled: bool = True
_reminder_interval: int = 1  # minutes
_reminder_message: str = DEFAULT_REMINDER_MESSAGE
_started_at: datetime = datetime.now(timezone.utc)
_last_reminder_at: Optional[datetime] = None
_reminders_today: int = 0

# ── Bot setup ─────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ── API helpers ───────────────────────────────────────────────────────────────

async def api_post(path: str, payload: dict) -> None:
    try:
        async with aiohttp.ClientSession() as session:
            await session.post(f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5))
    except Exception:
        pass  # never crash the bot due to API issues


async def api_get_json(path: str) -> Optional[dict]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    return await resp.json()
    except Exception:
        pass
    return None


async def log_to_api(level: str, message: str) -> None:
    await api_post("/bot/logs", {"level": level, "message": message})


async def send_heartbeat(connected: bool) -> None:
    global _last_reminder_at
    payload = {
        "connected": connected,
        "botName": bot.user.name if bot.user else None,
        "botId": str(bot.user.id) if bot.user else None,
        "startedAt": _started_at.isoformat(),
        "lastReminderAt": _last_reminder_at.isoformat() if _last_reminder_at else None,
        "remindersSentToday": _reminders_today,
    }
    await api_post("/bot/heartbeat", payload)


async def refresh_config() -> None:
    global _channel_id, _reminder_enabled, _reminder_interval, _reminder_message
    data = await api_get_json("/bot/config")
    if data:
        _channel_id = int(data.get("channelId", _channel_id))
        _reminder_enabled = bool(data.get("reminderEnabled", _reminder_enabled))
        _reminder_interval = int(data.get("reminderIntervalMinutes", _reminder_interval))
        _reminder_message = data.get("reminderMessage", _reminder_message)
        logger.info("Config refreshed from API — channel=%s reminder=%s interval=%dmin",
                    _channel_id, _reminder_enabled, _reminder_interval)


async def sync_custom_commands() -> None:
    """Fetch custom text commands from DB and register them as slash commands."""
    data = await api_get_json("/bot/commands")
    if not data:
        return

    # Remove old dynamic commands before re-adding
    for cmd in list(bot.tree.get_commands()):
        if getattr(cmd, "_is_custom", False):
            bot.tree.remove_command(cmd.name)

    for entry in data:
        if not entry.get("enabled", True):
            continue

        name: str = entry["name"]
        description: str = entry["description"]
        response: str = entry["response"]

        @bot.tree.command(name=name, description=description)
        async def _cmd(interaction: discord.Interaction, _resp: str = response) -> None:
            await interaction.response.send_message(_resp)

        # Mark as dynamic so we can remove on next sync
        _cmd._is_custom = True  # type: ignore[attr-defined]

    try:
        synced = await bot.tree.sync()
        logger.info("Custom commands synced — %d total slash commands", len(synced))
    except Exception:
        logger.exception("Failed to sync custom commands")


# ── Helper: card deck ─────────────────────────────────────────────────────────

SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


def new_deck() -> list[str]:
    return [f"{r}{s}" for r in RANKS for s in SUITS]


def card_value(card: str) -> int:
    rank = card[:-1]
    if rank in ("J", "Q", "K"):
        return 10
    if rank == "A":
        return 11
    return int(rank)


def hand_total(hand: list[str]) -> int:
    total = sum(card_value(c) for c in hand)
    aces = sum(1 for c in hand if c.startswith("A"))
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def fmt_hand(hand: list[str], hide_second: bool = False) -> str:
    if hide_second:
        return f"{hand[0]}  \U0001f0a0"
    return "  ".join(hand)


# ── /blackjack ────────────────────────────────────────────────────────────────

class BlackjackView(discord.ui.View):
    def __init__(self, deck: list[str], player: list[str], dealer: list[str], bet: int):
        super().__init__(timeout=60)
        self.deck = deck
        self.player = player
        self.dealer = dealer
        self.bet = bet
        self.ended = False

    def build_embed(self, title: str = "\U0001f0cf Blackjack", hide_dealer: bool = True) -> discord.Embed:
        embed = discord.Embed(title=title, colour=0x2ECC71 if not hide_dealer else 0x3498DB)
        embed.add_field(
            name=f"Dealer {'(hidden)' if hide_dealer else f'— {hand_total(self.dealer)}'}",
            value=fmt_hand(self.dealer, hide_second=hide_dealer),
            inline=False,
        )
        embed.add_field(
            name=f"You — {hand_total(self.player)}",
            value=fmt_hand(self.player),
            inline=False,
        )
        embed.set_footer(text=f"Bet: {self.bet} coins")
        return embed

    async def end_game(self, interaction: discord.Interaction, reason: str) -> None:
        self.ended = True
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        player_total = hand_total(self.player)

        if player_total > 21:
            result = f"\U0001f4a5 Bust! You lost **{self.bet}** coins."
            colour = 0xE74C3C
        elif reason == "stand":
            while hand_total(self.dealer) < 17:
                self.dealer.append(self.deck.pop())
            dealer_total = hand_total(self.dealer)
            if dealer_total > 21 or player_total > dealer_total:
                result = f"\U0001f3c6 You win **{self.bet}** coins!"
                colour = 0x2ECC71
            elif player_total == dealer_total:
                result = "\U0001f91d Push — your bet is returned."
                colour = 0xF1C40F
            else:
                result = f"\U0001f61e Dealer wins. You lost **{self.bet}** coins."
                colour = 0xE74C3C
        else:
            result = f"\U0001f389 Blackjack! You win **{int(self.bet * 1.5)}** coins!"
            colour = 0xF1C40F

        embed = self.build_embed(title=result, hide_dealer=False)
        embed.colour = colour
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Hit", style=discord.ButtonStyle.primary, emoji="\U0001f0cf")
    async def hit(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if self.ended:
            return
        self.player.append(self.deck.pop())
        if hand_total(self.player) > 21:
            await self.end_game(interaction, "bust")
        else:
            await interaction.response.edit_message(embed=self.build_embed(), view=self)

    @discord.ui.button(label="Stand", style=discord.ButtonStyle.secondary, emoji="\U0001f6d1")
    async def stand(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if self.ended:
            return
        await self.end_game(interaction, "stand")


@bot.tree.command(name="blackjack", description="Play a round of blackjack")
@app_commands.describe(bet="How many coins to bet (1-1000)")
async def blackjack(interaction: discord.Interaction, bet: app_commands.Range[int, 1, 1000] = 100) -> None:
    deck = new_deck()
    random.shuffle(deck)
    player = [deck.pop(), deck.pop()]
    dealer = [deck.pop(), deck.pop()]
    view = BlackjackView(deck, player, dealer, bet)
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /higher-lower ─────────────────────────────────────────────────────────────

class HLView(discord.ui.View):
    def __init__(self, current: int, streak: int = 0):
        super().__init__(timeout=60)
        self.current = current
        self.next = random.randint(1, 100)
        self.streak = streak
        self.ended = False

    def build_embed(self) -> discord.Embed:
        return discord.Embed(
            title="\U0001f522 Higher or Lower",
            description=f"Current number: **{self.current}**\nWill the next number be higher or lower?\n\nStreak: **{self.streak}**",
            colour=0x9B59B6,
        )

    async def resolve(self, interaction: discord.Interaction, guess: str) -> None:
        self.ended = True
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        correct = (
            (guess == "higher" and self.next > self.current)
            or (guess == "lower" and self.next < self.current)
            or self.next == self.current
        )

        if correct:
            new_streak = self.streak + 1
            embed = discord.Embed(
                title=f"\u2705 Correct! The number was **{self.next}**",
                description=f"Streak: **{new_streak}** \U0001f525",
                colour=0x2ECC71,
            )
            new_view = HLView(self.next, new_streak)
            await interaction.response.edit_message(embed=embed, view=new_view)
        else:
            embed = discord.Embed(
                title=f"\u274c Wrong! The number was **{self.next}**",
                description=f"Final streak: **{self.streak}**",
                colour=0xE74C3C,
            )
            await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Higher", style=discord.ButtonStyle.success, emoji="\u2b06\ufe0f")
    async def higher(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.resolve(interaction, "higher")

    @discord.ui.button(label="Lower", style=discord.ButtonStyle.danger, emoji="\u2b07\ufe0f")
    async def lower(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.resolve(interaction, "lower")


@bot.tree.command(name="higher-lower", description="Guess if the next number is higher or lower")
async def higher_lower(interaction: discord.Interaction) -> None:
    start = random.randint(1, 100)
    view = HLView(current=start)
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /roulette ─────────────────────────────────────────────────────────────────

ROULETTE_RED = {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}


class RouletteView(discord.ui.View):
    def __init__(self, bet: int):
        super().__init__(timeout=60)
        self.bet = bet

    @discord.ui.button(label="Red  (2x)", style=discord.ButtonStyle.danger, emoji="\U0001f534")
    async def red(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "red")

    @discord.ui.button(label="Black  (2x)", style=discord.ButtonStyle.secondary, emoji="\u26ab")
    async def black(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "black")

    @discord.ui.button(label="Green / 0  (14x)", style=discord.ButtonStyle.success, emoji="\U0001f7e2")
    async def green(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "green")

    async def spin(self, interaction: discord.Interaction, choice: str) -> None:
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        result = random.randint(0, 36)
        if result == 0:
            colour_name, colour_emoji = "green", "\U0001f7e2"
        elif result in ROULETTE_RED:
            colour_name, colour_emoji = "red", "\U0001f534"
        else:
            colour_name, colour_emoji = "black", "\u26ab"

        multipliers = {"red": 2, "black": 2, "green": 14}
        won = choice == colour_name

        if won:
            winnings = self.bet * multipliers[choice]
            title = f"\U0001f3b0 {colour_emoji} {result} — You win **{winnings}** coins!"
            colour = 0x2ECC71
        else:
            title = f"\U0001f3b0 {colour_emoji} {result} — You lost **{self.bet}** coins."
            colour = 0xE74C3C

        embed = discord.Embed(
            title=title,
            description=f"You bet **{choice}** with **{self.bet}** coins.",
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)


@bot.tree.command(name="roulette", description="Spin the roulette wheel")
@app_commands.describe(bet="How many coins to bet (1-1000)")
async def roulette(interaction: discord.Interaction, bet: app_commands.Range[int, 1, 1000] = 100) -> None:
    view = RouletteView(bet=bet)
    embed = discord.Embed(
        title="\U0001f3b0 Roulette",
        description=f"Bet: **{bet}** coins\nChoose a colour to spin!",
        colour=0x9B59B6,
    )
    embed.add_field(name="Payouts", value="Red \u2192 2x\nBlack \u2192 2x\nGreen (0) \u2192 14x", inline=False)
    await interaction.response.send_message(embed=embed, view=view)


# ── Reminder loop ─────────────────────────────────────────────────────────────

async def get_lotto_channel() -> Optional[discord.abc.Messageable]:
    channel = bot.get_channel(_channel_id)
    if channel is not None:
        return channel
    try:
        return await bot.fetch_channel(_channel_id)
    except discord.NotFound:
        logger.error("Channel %s was not found.", _channel_id)
    except discord.Forbidden:
        logger.error("The bot cannot access channel %s.", _channel_id)
    except discord.HTTPException:
        logger.exception("Discord failed while fetching channel %s.", _channel_id)
    return None


@tasks.loop(minutes=1)
async def verifier_et_envoyer() -> None:
    global _last_reminder_at, _reminders_today

    if not _reminder_enabled:
        return

    channel = await get_lotto_channel()
    if channel is None or not hasattr(channel, "history"):
        msg = f"Configured channel {_channel_id} is not a readable text channel."
        logger.error(msg)
        await log_to_api("ERROR", msg)
        return

    try:
        async for message in channel.history(limit=1):  # type: ignore[union-attr]
            if bot.user is not None and message.author.id == bot.user.id:
                return
            await channel.send(_reminder_message)  # type: ignore[union-attr]
            _last_reminder_at = datetime.now(timezone.utc)
            _reminders_today += 1
            msg = f"Reminder sent to channel {_channel_id}."
            logger.info(msg)
            await log_to_api("INFO", msg)
            return
    except discord.Forbidden:
        msg = f"The bot cannot read or send messages in channel {_channel_id}."
        logger.error(msg)
        await log_to_api("ERROR", msg)
    except discord.HTTPException:
        logger.exception("Discord failed while processing channel %s.", _channel_id)


@tasks.loop(seconds=30)
async def heartbeat_loop() -> None:
    await send_heartbeat(connected=True)


@tasks.loop(minutes=2)
async def config_refresh_loop() -> None:
    await refresh_config()
    # Dynamically adjust reminder loop interval if changed
    if verifier_et_envoyer.is_running():
        current = verifier_et_envoyer.minutes  # type: ignore[attr-defined]
        if current != _reminder_interval:
            verifier_et_envoyer.change_interval(minutes=_reminder_interval)


@verifier_et_envoyer.before_loop
async def avant_envoi() -> None:
    await bot.wait_until_ready()


@heartbeat_loop.before_loop
async def before_heartbeat() -> None:
    await bot.wait_until_ready()


@config_refresh_loop.before_loop
async def before_config_refresh() -> None:
    await bot.wait_until_ready()


# ── Ready ─────────────────────────────────────────────────────────────────────

@bot.event
async def on_ready() -> None:
    if bot.user is not None:
        logger.info("Bot connected as %s (ID: %s)", bot.user, bot.user.id)

    # Fetch live config from dashboard API
    await refresh_config()

    # Sync built-in + custom slash commands
    await sync_custom_commands()

    # Start background loops (guard against double-start on reconnect)
    if not verifier_et_envoyer.is_running():
        verifier_et_envoyer.start()
    if not heartbeat_loop.is_running():
        heartbeat_loop.start()
    if not config_refresh_loop.is_running():
        config_refresh_loop.start()

    # Immediate first heartbeat
    await send_heartbeat(connected=True)
    await log_to_api("INFO", f"Bot connected as {bot.user}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit(
            "DISCORD_TOKEN is not configured. Add it as a Replit Secret before running the bot."
        )
    bot.run(token)


if __name__ == "__main__":
    main()
