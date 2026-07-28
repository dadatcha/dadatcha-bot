"""Discord bot – lotto-channel reminder + slash commands for blackjack, higher-lower and roulette."""

from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks


# ── Configuration ────────────────────────────────────────────────────────────

CHANNEL_ID = 1_531_418_977_677_475_992

REMINDER_MESSAGE = """Here is the lotto channel.
You can play many games to win money.
Here are all the commands:
/blackjack
/higher-lower
/roulette

Many other commands are available in the #cmds🤖

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

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("lotto-bot")

# ── Bot setup ────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ── Helper: card deck ────────────────────────────────────────────────────────

SUITS = ["♠", "♥", "♦", "♣"]
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
        return f"{hand[0]}  🂠"
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

    def build_embed(self, title: str = "🃏 Blackjack", hide_dealer: bool = True) -> discord.Embed:
        dealer_total = hand_total(self.dealer) if not hide_dealer else card_value(self.dealer[0])
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
        dealer_total = hand_total(self.dealer)

        if player_total > 21:
            result = f"💥 Bust! You lost **{self.bet}** coins."
            colour = 0xE74C3C
        elif reason == "stand":
            # Dealer draws to 17
            while hand_total(self.dealer) < 17:
                self.dealer.append(self.deck.pop())
            dealer_total = hand_total(self.dealer)
            if dealer_total > 21 or player_total > dealer_total:
                result = f"🏆 You win **{self.bet}** coins!"
                colour = 0x2ECC71
            elif player_total == dealer_total:
                result = "🤝 Push — your bet is returned."
                colour = 0xF1C40F
            else:
                result = f"😞 Dealer wins. You lost **{self.bet}** coins."
                colour = 0xE74C3C
        else:  # blackjack
            result = f"🎉 Blackjack! You win **{int(self.bet * 1.5)}** coins!"
            colour = 0xF1C40F

        embed = self.build_embed(title=result, hide_dealer=False)
        embed.colour = colour
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Hit", style=discord.ButtonStyle.primary, emoji="🃏")
    async def hit(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if self.ended:
            return
        self.player.append(self.deck.pop())
        if hand_total(self.player) > 21:
            await self.end_game(interaction, "bust")
        else:
            await interaction.response.edit_message(embed=self.build_embed(), view=self)

    @discord.ui.button(label="Stand", style=discord.ButtonStyle.secondary, emoji="🛑")
    async def stand(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if self.ended:
            return
        await self.end_game(interaction, "stand")

    async def on_timeout(self) -> None:
        self.ended = True
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]


@bot.tree.command(name="blackjack", description="Play a round of blackjack")
@app_commands.describe(bet="How many coins to bet (1–1000)")
async def blackjack(interaction: discord.Interaction, bet: app_commands.Range[int, 1, 1000] = 100) -> None:
    deck = new_deck()
    random.shuffle(deck)
    player = [deck.pop(), deck.pop()]
    dealer = [deck.pop(), deck.pop()]

    view = BlackjackView(deck, player, dealer, bet)

    # Instant blackjack?
    if hand_total(player) == 21:
        await interaction.response.send_message(embed=view.build_embed(), view=view)
        await view.end_game(await interaction.original_response(), "blackjack")  # type: ignore[arg-type]
        return

    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /higher-lower ────────────────────────────────────────────────────────────

class HLView(discord.ui.View):
    def __init__(self, current: int, streak: int = 0):
        super().__init__(timeout=60)
        self.current = current
        self.next = random.randint(1, 100)
        self.streak = streak
        self.ended = False

    def build_embed(self) -> discord.Embed:
        embed = discord.Embed(
            title="🔢 Higher or Lower",
            description=f"Current number: **{self.current}**\nWill the next number be higher or lower?\n\nStreak: **{self.streak}**",
            colour=0x9B59B6,
        )
        embed.set_footer(text="Numbers are between 1 and 100")
        return embed

    async def resolve(self, interaction: discord.Interaction, guess: str) -> None:
        self.ended = True
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        correct = (guess == "higher" and self.next > self.current) or \
                  (guess == "lower" and self.next < self.current) or \
                  self.next == self.current  # tie counts as correct

        if correct:
            new_streak = self.streak + 1
            embed = discord.Embed(
                title=f"✅ Correct! The number was **{self.next}**",
                description=f"Streak: **{new_streak}** 🔥",
                colour=0x2ECC71,
            )
            new_view = HLView(self.next, new_streak)
            embed.set_footer(text="Keep going!")
            await interaction.response.edit_message(embed=embed, view=new_view)
        else:
            embed = discord.Embed(
                title=f"❌ Wrong! The number was **{self.next}**",
                description=f"Final streak: **{self.streak}**",
                colour=0xE74C3C,
            )
            await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Higher ⬆️", style=discord.ButtonStyle.success)
    async def higher(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.resolve(interaction, "higher")

    @discord.ui.button(label="Lower ⬇️", style=discord.ButtonStyle.danger)
    async def lower(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.resolve(interaction, "lower")


@bot.tree.command(name="higher-lower", description="Guess if the next number is higher or lower")
async def higher_lower(interaction: discord.Interaction) -> None:
    start = random.randint(1, 100)
    view = HLView(current=start)
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /roulette ────────────────────────────────────────────────────────────────

ROULETTE_RED = {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}

class RouletteView(discord.ui.View):
    def __init__(self, bet: int):
        super().__init__(timeout=60)
        self.bet = bet

    @discord.ui.button(label="🔴 Red  (2×)", style=discord.ButtonStyle.danger)
    async def red(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "red")

    @discord.ui.button(label="⚫ Black  (2×)", style=discord.ButtonStyle.secondary)
    async def black(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "black")

    @discord.ui.button(label="🟢 Green / 0  (14×)", style=discord.ButtonStyle.success)
    async def green(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.spin(interaction, "green")

    async def spin(self, interaction: discord.Interaction, choice: str) -> None:
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        result = random.randint(0, 36)
        if result == 0:
            colour_name, colour_emoji = "green", "🟢"
        elif result in ROULETTE_RED:
            colour_name, colour_emoji = "red", "🔴"
        else:
            colour_name, colour_emoji = "black", "⚫"

        multipliers = {"red": 2, "black": 2, "green": 14}
        won = choice == colour_name

        if won:
            winnings = self.bet * multipliers[choice]
            title = f"🎰 {colour_emoji} {result} — You win **{winnings}** coins!"
            colour = 0x2ECC71
        else:
            title = f"🎰 {colour_emoji} {result} — You lost **{self.bet}** coins."
            colour = 0xE74C3C

        embed = discord.Embed(
            title=title,
            description=f"You bet **{choice}** with **{self.bet}** coins.",
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)


@bot.tree.command(name="roulette", description="Spin the roulette wheel")
@app_commands.describe(bet="How many coins to bet (1–1000)")
async def roulette(interaction: discord.Interaction, bet: app_commands.Range[int, 1, 1000] = 100) -> None:
    view = RouletteView(bet=bet)
    embed = discord.Embed(
        title="🎰 Roulette",
        description=f"Bet: **{bet}** coins\nChoose a colour to spin!",
        colour=0x9B59B6,
    )
    embed.add_field(name="Payouts", value="🔴 Red → 2×\n⚫ Black → 2×\n🟢 Green (0) → 14×", inline=False)
    await interaction.response.send_message(embed=embed, view=view)


# ── Reminder loop ─────────────────────────────────────────────────────────────

async def get_lotto_channel() -> Optional[discord.abc.Messageable]:
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
    channel = await get_lotto_channel()
    if channel is None or not hasattr(channel, "history"):
        logger.error("Configured channel %s is not a readable text channel.", CHANNEL_ID)
        return
    try:
        async for message in channel.history(limit=1):  # type: ignore[union-attr]
            if bot.user is not None and message.author.id == bot.user.id:
                return
            await channel.send(REMINDER_MESSAGE)  # type: ignore[union-attr]
            logger.info("Reminder sent to channel %s.", CHANNEL_ID)
            return
    except discord.Forbidden:
        logger.error("The bot cannot read or send messages in channel %s.", CHANNEL_ID)
    except discord.HTTPException:
        logger.exception("Discord failed while processing channel %s.", CHANNEL_ID)


@verifier_et_envoyer.before_loop
async def avant_envoi() -> None:
    await bot.wait_until_ready()


# ── Ready ─────────────────────────────────────────────────────────────────────

@bot.event
async def on_ready() -> None:
    if bot.user is not None:
        logger.info("Bot connected as %s (ID: %s)", bot.user, bot.user.id)

    try:
        synced = await bot.tree.sync()
        logger.info("Synced %d slash command(s): %s", len(synced), [c.name for c in synced])
    except Exception:
        logger.exception("Failed to sync slash commands.")

    if not verifier_et_envoyer.is_running():
        verifier_et_envoyer.start()


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
