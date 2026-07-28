"""Discord bot – lotto-channel reminder + economy system."""

from __future__ import annotations

import asyncio
import time
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands, tasks


# ── Configuration ─────────────────────────────────────────────────────────────

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

# Economy config — overwritten at runtime by refresh_economy_config()
_eco: dict = {
    "startingWallet": 200,
    "balanceEnabled": True, "moneyEnabled": True,
    "dailyEnabled": True, "dailyAmount": 500, "dailyCooldownHours": 24,
    "workEnabled": True, "workMinAmount": 50, "workMaxAmount": 200, "workCooldownHours": 1,
    "crimeEnabled": True, "crimeWinMin": 100, "crimeWinMax": 500,
    "crimeLoseMin": 50, "crimeLoseMax": 200, "crimeWinChance": 60, "crimeCooldownHours": 2,
    "depositEnabled": True, "withdrawEnabled": True, "giveEnabled": True, "leaderboardEnabled": True,
    "blackjackEnabled": True, "blackjackMaxBet": 1000,
    "rouletteEnabled": True, "rouletteMaxBet": 1000, "hlEnabled": True,
}

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("lotto-bot")

# ── Runtime state ─────────────────────────────────────────────────────────────

_started_at: datetime = datetime.now(timezone.utc)
_last_reminder_at: Optional[datetime] = None
_reminders_today: int = 0

# Multi-reminder state
_reminders: dict[int, dict] = {}          # id → reminder dict from API
_reminder_tasks: dict[int, asyncio.Task] = {}  # id → running asyncio.Task

# Role reward rules — overwritten at runtime by refresh_role_rewards()
_role_rewards: list[dict] = []  # list of {triggerRoleId, rewardRoleId, enabled}

# Command configs — overwritten at runtime by refresh_command_configs()
_cmd_cfg: dict[str, dict] = {}  # commandName → {enabled, adminOnly}

# ── Bot setup ─────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
intents.message_content = True
# NOTE: intents.members requires "Server Members Intent" enabled in the Discord
# Developer Portal (https://discord.com/developers/applications/).
# Set to True there AND uncomment the line below to activate role rewards.
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ── API helpers ───────────────────────────────────────────────────────────────

async def api_post(path: str, payload: dict) -> Optional[dict]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.content_type == "application/json":
                    return await resp.json()
    except Exception:
        pass
    return None


async def api_patch(path: str, payload: dict) -> Optional[dict]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.patch(
                f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.content_type == "application/json":
                    return await resp.json()
    except Exception:
        pass
    return None


async def api_get_json(path: str) -> Optional[dict]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
    except Exception:
        pass
    return None


async def api_get_list(path: str) -> Optional[list]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
    except Exception:
        pass
    return None


async def log_to_api(level: str, message: str) -> None:
    await api_post("/bot/logs", {"level": level, "message": message})


async def send_heartbeat(connected: bool) -> None:
    payload = {
        "connected": connected,
        "botName": bot.user.name if bot.user else None,
        "botId": str(bot.user.id) if bot.user else None,
        "startedAt": _started_at.isoformat(),
        "lastReminderAt": _last_reminder_at.isoformat() if _last_reminder_at else None,
        "remindersSentToday": _reminders_today,
    }
    await api_post("/bot/heartbeat", payload)


async def _do_send_reminder(r: dict) -> None:
    """Send one reminder if the last message in the channel is not from the bot."""
    global _last_reminder_at, _reminders_today
    try:
        channel_id = int(r["channelId"])
    except (ValueError, KeyError):
        return
    channel = bot.get_channel(channel_id)
    if channel is None:
        try:
            channel = await bot.fetch_channel(channel_id)
        except (discord.NotFound, discord.Forbidden, discord.HTTPException) as exc:
            logger.error("Reminder '%s': cannot access channel %s — %s", r["name"], channel_id, exc)
            await log_to_api("ERROR", f"Reminder '{r['name']}': cannot access channel {channel_id}")
            return
    if not hasattr(channel, "history"):
        return
    try:
        async for msg in channel.history(limit=1):  # type: ignore[union-attr]
            if bot.user and msg.author.id == bot.user.id:
                return
            await channel.send(r["message"])  # type: ignore[union-attr]
            _last_reminder_at = datetime.now(timezone.utc)
            _reminders_today += 1
            info = f"Reminder '{r['name']}' sent to channel {channel_id}."
            logger.info(info)
            await log_to_api("INFO", info)
            return
    except discord.Forbidden:
        logger.error("Reminder '%s': no permission for channel %s", r["name"], channel_id)
    except discord.HTTPException:
        logger.exception("Reminder '%s': Discord HTTP error", r["name"])


async def _run_reminder_loop(reminder_id: int) -> None:
    """Long-running asyncio task for one reminder."""
    # Small initial delay so all tasks don't fire at the same second on startup
    await asyncio.sleep(5)
    while True:
        r = _reminders.get(reminder_id)
        if r is None:
            break  # reminder was deleted — exit
        interval_secs = max(1, r["intervalMinutes"]) * 60
        if r["enabled"] and r.get("channelId") and r.get("message"):
            await _do_send_reminder(r)
        try:
            await asyncio.sleep(interval_secs)
        except asyncio.CancelledError:
            break


async def refresh_reminders() -> None:
    """Fetch reminder list from API and start/stop/update per-reminder tasks."""
    global _reminders
    data = await api_get_list("/bot/reminders")
    if data is None:
        return
    new: dict[int, dict] = {r["id"]: r for r in data}
    _reminders = new
    # Start tasks for new or finished reminders
    for rid in new:
        task = _reminder_tasks.get(rid)
        if task is None or task.done():
            _reminder_tasks[rid] = asyncio.create_task(_run_reminder_loop(rid))
    # Cancel tasks for deleted reminders
    for rid in list(_reminder_tasks.keys()):
        if rid not in new:
            _reminder_tasks[rid].cancel()
            del _reminder_tasks[rid]
    logger.info("Reminders refreshed — %d configured", len(new))


async def refresh_economy_config() -> None:
    global _eco
    data = await api_get_json("/economy/config")
    if data:
        _eco.update(data)
        logger.info("Economy config refreshed — currency: %s", _eco.get("currencyName", "coins"))


async def refresh_role_rewards() -> None:
    global _role_rewards
    data = await api_get_list("/role-rewards")
    if data is not None:
        _role_rewards = [r for r in data if r.get("enabled", True)]
        logger.info("Role rewards refreshed — %d active rule(s)", len(_role_rewards))


async def refresh_command_configs() -> None:
    global _cmd_cfg
    data = await api_get_list("/command-configs")
    if data is not None:
        _cmd_cfg = {entry["name"]: entry for entry in data}
        logger.info("Command configs refreshed — %d commands", len(_cmd_cfg))


def _coin() -> str:
    """Return the current currency name (live from economy config)."""
    return _eco.get("currencyName", "coins")


# ── Per-user message-reward cooldown (in-memory) ──────────────────────────────

_msg_cooldowns: dict[int, float] = {}  # user_id → last rewarded timestamp (monotonic)


@bot.event
async def on_message(message: discord.Message) -> None:
    """Award random coins for chat messages when the feature is enabled."""
    # Ignore bots and DMs
    if message.author.bot or not message.guild:
        await bot.process_commands(message)
        return

    if _eco.get("messageRewardEnabled", False):
        cooldown_secs = int(_eco.get("messageRewardCooldownSeconds", 60))
        now = time.monotonic()
        last = _msg_cooldowns.get(message.author.id, 0.0)

        if now - last >= cooldown_secs:
            _msg_cooldowns[message.author.id] = now
            min_r = int(_eco.get("messageRewardMin", 1))
            max_r = int(_eco.get("messageRewardMax", 10))
            if max_r < min_r:
                max_r = min_r
            earned = random.randint(min_r, max_r)
            try:
                eco = await get_economy(message.author)
                await set_wallet(message.author.id, eco["wallet"] + earned)
            except Exception:
                pass  # never let a reward error crash on_message

    await bot.process_commands(message)


# ── Role reward automation ────────────────────────────────────────────────────

@bot.event
async def on_member_update(before: discord.Member, after: discord.Member) -> None:
    """When a member gains a new role, apply any matching role reward rules."""
    if not _role_rewards:
        return

    # Find roles that were just added
    added_ids = {str(r.id) for r in after.roles} - {str(r.id) for r in before.roles}
    if not added_ids:
        return

    guild = after.guild
    for rule in _role_rewards:
        trigger = rule.get("triggerRoleId", "")
        reward  = rule.get("rewardRoleId", "")
        remove  = rule.get("removeRoleId") or ""
        if not trigger or not reward:
            continue
        if trigger not in added_ids:
            continue
        try:
            # Add reward role (if configured and not already present)
            if reward and not any(str(r.id) == reward for r in after.roles):
                reward_role = guild.get_role(int(reward))
                if reward_role is not None:
                    await after.add_roles(reward_role, reason=f"Role reward: trigger <@&{trigger}>")
                    msg = f"Role reward: {after} +<@&{reward}> (trigger <@&{trigger}>)"
                    logger.info(msg)
                    await log_to_api("INFO", msg)

            # Remove role (if configured and member still has it)
            if remove and any(str(r.id) == remove for r in after.roles):
                remove_role = guild.get_role(int(remove))
                if remove_role is not None:
                    await after.remove_roles(remove_role, reason=f"Role removal: trigger <@&{trigger}>")
                    msg = f"Role removal: {after} -<@&{remove}> (trigger <@&{trigger}>)"
                    logger.info(msg)
                    await log_to_api("INFO", msg)
        except Exception as exc:
            logger.error("Role reward/removal error for %s: %s", after, exc)


# ── Economy DB helpers ────────────────────────────────────────────────────────

async def get_economy(user: discord.User | discord.Member) -> dict:
    """Fetch or create a player's economy record."""
    data = await api_get_json(f"/economy/players/{user.id}")
    if data:
        return data
    # Create with starting wallet
    result = await api_post("/economy/players", {
        "userId": str(user.id),
        "username": user.display_name,
        "wallet": _eco["startingWallet"],
        "bank": 0,
    })
    if result:
        return result
    return {"userId": str(user.id), "username": user.display_name, "wallet": 0, "bank": 0}


async def set_wallet(user_id: int | str, amount: int) -> None:
    await api_patch(f"/economy/players/{user_id}", {"wallet": amount})


async def set_bank(user_id: int | str, amount: int) -> None:
    await api_patch(f"/economy/players/{user_id}", {"bank": amount})


async def set_both(user_id: int | str, wallet: int, bank: int) -> None:
    await api_patch(f"/economy/players/{user_id}", {"wallet": wallet, "bank": bank})


async def ensure_player(user: discord.User | discord.Member) -> None:
    """Make sure a player row exists."""
    await get_economy(user)


def cooldown_remaining(last_str: Optional[str], hours: float) -> Optional[timedelta]:
    if not last_str:
        return None
    last = datetime.fromisoformat(last_str)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    end = last + timedelta(hours=hours)
    now = datetime.now(timezone.utc)
    remaining = end - now
    return remaining if remaining.total_seconds() > 0 else None


def fmt_td(td: timedelta) -> str:
    total = int(td.total_seconds())
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def is_admin(interaction: discord.Interaction) -> bool:
    if not isinstance(interaction.user, discord.Member):
        return False
    return interaction.user.guild_permissions.administrator


async def check_cmd(interaction: discord.Interaction, name: str) -> bool:
    """Return True if the command is allowed; send ephemeral error and return False otherwise."""
    cfg = _cmd_cfg.get(name, {})
    if not cfg.get("enabled", True):
        await interaction.response.send_message(
            "❌ Cette commande est actuellement désactivée.", ephemeral=True
        )
        return False
    if cfg.get("adminOnly", False) and not is_admin(interaction):
        await interaction.response.send_message(
            "🔒 Cette commande est réservée aux administrateurs.", ephemeral=True
        )
        return False
    return True


# ── /balance ──────────────────────────────────────────────────────────────────

@bot.tree.command(name="balance", description="Check your wallet and bank balance (or another player's)")
@app_commands.describe(player="Player to look up — leave empty to check your own balance")
async def balance(interaction: discord.Interaction, player: Optional[discord.Member] = None) -> None:
    if not await check_cmd(interaction, "balance"): return
    target = player or interaction.user
    eco = await get_economy(target)
    colour = 0x3498DB if player else 0x2ECC71
    embed = discord.Embed(title=f"Balance — {target.display_name}", colour=colour)
    embed.add_field(name="Wallet", value=f"**{eco['wallet']:,}** {_coin()}", inline=True)
    embed.add_field(name="Bank",   value=f"**{eco['bank']:,}** {_coin()}",   inline=True)
    embed.add_field(name="Total",  value=f"**{eco['wallet'] + eco['bank']:,}** {_coin()}", inline=True)
    embed.add_field(name="Rang",   value=f"🏆 **#{eco['rank']}**", inline=False)
    await interaction.response.send_message(embed=embed)


# ── /addmoney ─────────────────────────────────────────────────────────────────

@bot.tree.command(name="addmoney", description="[Admin] Add {_coin()} to a player's wallet or bank")
@app_commands.describe(player="Target player", amount="Amount to add", location="Where to add the coins")
@app_commands.choices(location=[
    app_commands.Choice(name="Wallet", value="wallet"),
    app_commands.Choice(name="Bank", value="bank"),
])
async def addmoney(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
    location: app_commands.Choice[str] = None,  # type: ignore[assignment]
) -> None:
    if not await check_cmd(interaction, "addmoney"): return
    if not is_admin(interaction):
        await interaction.response.send_message("You need Administrator permission to use this command.", ephemeral=True)
        return
    target = location.value if location else "wallet"
    eco = await get_economy(player)
    if target == "bank":
        new_bank = eco["bank"] + amount
        await set_bank(player.id, new_bank)
        embed = discord.Embed(
            title="Coins Added",
            description=f"Added **{amount:,}** {_coin()} to {player.mention}'s **bank**.\nNew bank: **{new_bank:,}** {_coin()}",
            colour=0x2ECC71,
        )
        await log_to_api("INFO", f"Admin {interaction.user} added {amount} {_coin()} to {player}'s bank (new bank: {new_bank})")
    else:
        new_wallet = eco["wallet"] + amount
        await set_wallet(player.id, new_wallet)
        embed = discord.Embed(
            title="Coins Added",
            description=f"Added **{amount:,}** {_coin()} to {player.mention}'s **wallet**.\nNew wallet: **{new_wallet:,}** {_coin()}",
            colour=0x2ECC71,
        )
        await log_to_api("INFO", f"Admin {interaction.user} added {amount} {_coin()} to {player}'s wallet (new wallet: {new_wallet})")
    await interaction.response.send_message(embed=embed)


# ── /removemoney ──────────────────────────────────────────────────────────────

@bot.tree.command(name="removemoney", description="[Admin] Remove {_coin()} from a player's wallet or bank")
@app_commands.describe(player="Target player", amount="Amount to remove", location="Where to remove the coins from")
@app_commands.choices(location=[
    app_commands.Choice(name="Wallet", value="wallet"),
    app_commands.Choice(name="Bank", value="bank"),
])
async def removemoney(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
    location: app_commands.Choice[str] = None,  # type: ignore[assignment]
) -> None:
    if not await check_cmd(interaction, "removemoney"): return
    if not is_admin(interaction):
        await interaction.response.send_message("You need Administrator permission to use this command.", ephemeral=True)
        return
    target = location.value if location else "wallet"
    eco = await get_economy(player)
    if target == "bank":
        new_bank = max(0, eco["bank"] - amount)
        await set_bank(player.id, new_bank)
        embed = discord.Embed(
            title="Coins Removed",
            description=f"Removed **{amount:,}** {_coin()} from {player.mention}'s **bank**.\nNew bank: **{new_bank:,}** {_coin()}",
            colour=0xE74C3C,
        )
        await log_to_api("INFO", f"Admin {interaction.user} removed {amount} {_coin()} from {player}'s bank (new bank: {new_bank})")
    else:
        new_wallet = max(0, eco["wallet"] - amount)
        await set_wallet(player.id, new_wallet)
        embed = discord.Embed(
            title="Coins Removed",
            description=f"Removed **{amount:,}** {_coin()} from {player.mention}'s **wallet**.\nNew wallet: **{new_wallet:,}** {_coin()}",
            colour=0xE74C3C,
        )
        await log_to_api("INFO", f"Admin {interaction.user} removed {amount} {_coin()} from {player}'s wallet (new wallet: {new_wallet})")
    await interaction.response.send_message(embed=embed)


# ── /setmoney ─────────────────────────────────────────────────────────────────

@bot.tree.command(name="setmoney", description="[Admin] Set a player's wallet to an exact amount")
@app_commands.describe(player="Target player", amount="New wallet amount")
async def setmoney(interaction: discord.Interaction, player: discord.Member, amount: app_commands.Range[int, 0]) -> None:
    if not await check_cmd(interaction, "setmoney"): return
    if not is_admin(interaction):
        await interaction.response.send_message("You need Administrator permission to use this command.", ephemeral=True)
        return
    await get_economy(player)
    await set_wallet(player.id, amount)
    embed = discord.Embed(
        title="Balance Set",
        description=f"{player.mention}'s wallet set to **{amount:,}** {_coin()}.",
        colour=0xF1C40F,
    )
    await interaction.response.send_message(embed=embed)
    await log_to_api("INFO", f"Admin {interaction.user} set {player}'s wallet to {amount}")


# ── /resetmoney ───────────────────────────────────────────────────────────────

@bot.tree.command(name="resetmoney", description="[Admin] Reset a player's wallet and bank to 0")
@app_commands.describe(player="Target player")
async def resetmoney(interaction: discord.Interaction, player: discord.Member) -> None:
    if not await check_cmd(interaction, "resetmoney"): return
    if not is_admin(interaction):
        await interaction.response.send_message("You need Administrator permission to use this command.", ephemeral=True)
        return
    await get_economy(player)
    await set_both(player.id, 0, 0)
    embed = discord.Embed(
        title="Balance Reset",
        description=f"{player.mention}'s wallet and bank have been reset to **0** {_coin()}.",
        colour=0xE74C3C,
    )
    await interaction.response.send_message(embed=embed)
    await log_to_api("INFO", f"Admin {interaction.user} reset {player}'s balance to 0")


# ── /daily ────────────────────────────────────────────────────────────────────

@bot.tree.command(name="daily", description="Claim your daily coin reward")
async def daily(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "daily"): return
    if not _eco["dailyEnabled"]:
        await interaction.response.send_message("The `/daily` command is currently disabled.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastDaily"), _eco["dailyCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            f"You already claimed your daily reward. Come back in **{fmt_td(remaining)}**.",
            ephemeral=True,
        )
        return
    amount = _eco["dailyAmount"]
    new_wallet = eco["wallet"] + amount
    await api_patch(f"/economy/players/{interaction.user.id}/daily", {"wallet": new_wallet})
    embed = discord.Embed(
        title="Daily Reward",
        description=f"You claimed **{amount:,}** coins!\nWallet: **{new_wallet:,}** {_coin()}",
        colour=0xF1C40F,
    )
    embed.set_footer(text=f"Come back in {_eco['dailyCooldownHours']}h for your next reward.")
    await interaction.response.send_message(embed=embed)


# ── /work ─────────────────────────────────────────────────────────────────────

@bot.tree.command(name="work", description="Work to earn coins")
async def work(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "work"): return
    if not _eco["workEnabled"]:
        await interaction.response.send_message("The `/work` command is currently disabled.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastWork"), _eco["workCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            f"You are tired. Rest for **{fmt_td(remaining)}** before working again.",
            ephemeral=True,
        )
        return
    earned = random.randint(_eco["workMinAmount"], _eco["workMaxAmount"])
    new_wallet = eco["wallet"] + earned
    await api_patch(f"/economy/players/{interaction.user.id}/work", {"wallet": new_wallet})
    jobs = [
        "delivered pizzas", "mowed lawns", "coded a website", "walked dogs",
        "fixed computers", "stocked shelves", "washed cars", "taught classes",
    ]
    embed = discord.Embed(
        title="Work",
        description=f"You {random.choice(jobs)} and earned **{earned:,}** coins!\nWallet: **{new_wallet:,}** {_coin()}",
        colour=0x2ECC71,
    )
    embed.set_footer(text=f"Work again in {_eco['workCooldownHours']}h.")
    await interaction.response.send_message(embed=embed)


# ── /crime ────────────────────────────────────────────────────────────────────

@bot.tree.command(name="crime", description="Attempt a crime for big coins — risk a fine")
async def crime(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "crime"): return
    if not _eco["crimeEnabled"]:
        await interaction.response.send_message("The `/crime` command is currently disabled.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastCrime"), _eco["crimeCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            f"The police are still watching you. Wait **{fmt_td(remaining)}**.",
            ephemeral=True,
        )
        return

    success = random.random() < (_eco["crimeWinChance"] / 100)
    if success:
        gained = random.randint(_eco["crimeWinMin"], _eco["crimeWinMax"])
        new_wallet = eco["wallet"] + gained
        await api_patch(f"/economy/players/{interaction.user.id}/crime", {"wallet": new_wallet})
        crimes = ["robbed a store", "hacked a server", "scammed a trader", "picked a pocket"]
        embed = discord.Embed(
            title="Crime Succeeded",
            description=f"You {random.choice(crimes)} and got away with **{gained:,}** coins!\nWallet: **{new_wallet:,}** {_coin()}",
            colour=0x9B59B6,
        )
    else:
        fine = random.randint(_eco["crimeLoseMin"], _eco["crimeLoseMax"])
        new_wallet = max(0, eco["wallet"] - fine)
        await api_patch(f"/economy/players/{interaction.user.id}/crime", {"wallet": new_wallet})
        embed = discord.Embed(
            title="Crime Failed",
            description=f"You got caught and paid a **{fine:,}** coin fine!\nWallet: **{new_wallet:,}** {_coin()}",
            colour=0xE74C3C,
        )
    embed.set_footer(text=f"Try again in {_eco['crimeCooldownHours']}h.")
    await interaction.response.send_message(embed=embed)


# ── /deposit ──────────────────────────────────────────────────────────────────

@bot.tree.command(name="deposit", description="Deposit {_coin()} from your wallet into the bank")
@app_commands.describe(amount="Amount to deposit")
async def deposit(interaction: discord.Interaction, amount: int) -> None:
    if not await check_cmd(interaction, "deposit"): return
    if not _eco["depositEnabled"]:
        await interaction.response.send_message("The `/deposit` command is currently disabled.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if amount <= 0:
        await interaction.response.send_message("Amount must be positive.", ephemeral=True)
        return
    if amount > eco["wallet"]:
        await interaction.response.send_message(
            f"You only have **{eco['wallet']:,}** {_coin()} in your wallet.", ephemeral=True
        )
        return
    new_wallet = eco["wallet"] - amount
    new_bank = eco["bank"] + amount
    await set_both(interaction.user.id, new_wallet, new_bank)
    embed = discord.Embed(
        title="Deposit",
        description=f"Deposited **{amount:,}** {_coin()} into the bank.",
        colour=0x3498DB,
    )
    embed.add_field(name="Wallet", value=f"**{new_wallet:,}**", inline=True)
    embed.add_field(name="Bank", value=f"**{new_bank:,}**", inline=True)
    await interaction.response.send_message(embed=embed)


# ── /withdraw ─────────────────────────────────────────────────────────────────

@bot.tree.command(name="withdraw", description="Withdraw {_coin()} from the bank into your wallet")
@app_commands.describe(amount="Amount to withdraw")
async def withdraw(interaction: discord.Interaction, amount: int) -> None:
    if not await check_cmd(interaction, "withdraw"): return
    if not _eco["withdrawEnabled"]:
        await interaction.response.send_message("The `/withdraw` command is currently disabled.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if amount <= 0:
        await interaction.response.send_message("Amount must be positive.", ephemeral=True)
        return
    if amount > eco["bank"]:
        await interaction.response.send_message(
            f"You only have **{eco['bank']:,}** {_coin()} in the bank.", ephemeral=True
        )
        return
    new_wallet = eco["wallet"] + amount
    new_bank = eco["bank"] - amount
    await set_both(interaction.user.id, new_wallet, new_bank)
    embed = discord.Embed(
        title="Withdraw",
        description=f"Withdrew **{amount:,}** {_coin()} from the bank.",
        colour=0x3498DB,
    )
    embed.add_field(name="Wallet", value=f"**{new_wallet:,}**", inline=True)
    embed.add_field(name="Bank", value=f"**{new_bank:,}**", inline=True)
    await interaction.response.send_message(embed=embed)


# ── /give ─────────────────────────────────────────────────────────────────────

@bot.tree.command(name="give", description="Give {_coin()} from your wallet to another player")
@app_commands.describe(player="Who to give to", amount="How many coins")
async def give(interaction: discord.Interaction, player: discord.Member, amount: app_commands.Range[int, 1]) -> None:
    if not await check_cmd(interaction, "give"): return
    if not _eco["giveEnabled"]:
        await interaction.response.send_message("The `/give` command is currently disabled.", ephemeral=True)
        return
    if player.id == interaction.user.id:
        await interaction.response.send_message("You cannot give {_coin()} to yourself.", ephemeral=True)
        return
    if player.bot:
        await interaction.response.send_message("You cannot give {_coin()} to a bot.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if amount > eco["wallet"]:
        await interaction.response.send_message(
            f"You only have **{eco['wallet']:,}** {_coin()} in your wallet.", ephemeral=True
        )
        return
    eco_target = await get_economy(player)
    await set_wallet(interaction.user.id, eco["wallet"] - amount)
    await set_wallet(player.id, eco_target["wallet"] + amount)
    embed = discord.Embed(
        title="Transfer",
        description=f"You gave **{amount:,}** {_coin()} to {player.mention}.",
        colour=0x2ECC71,
    )
    await interaction.response.send_message(embed=embed)


# ── /leaderboard ──────────────────────────────────────────────────────────────

@bot.tree.command(name="leaderboard", description="Show the top 10 richest players")
async def leaderboard(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "leaderboard"): return
    if not _eco["leaderboardEnabled"]:
        await interaction.response.send_message("The `/leaderboard` command is currently disabled.", ephemeral=True)
        return
    await interaction.response.defer()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}/economy/players", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                players: list[dict] = await resp.json()
    except Exception:
        await interaction.followup.send("Could not load leaderboard right now.", ephemeral=True)
        return

    players.sort(key=lambda p: p["wallet"] + p["bank"], reverse=True)
    top = players[:10]

    embed = discord.Embed(title="Leaderboard — Top 10", colour=0xF1C40F)
    medals = ["\U0001f947", "\U0001f948", "\U0001f949"]
    lines = []
    for i, p in enumerate(top):
        medal = medals[i] if i < 3 else f"`{i+1}.`"
        total = p["wallet"] + p["bank"]
        lines.append(f"{medal} **{p['username']}** — {total:,} {_coin()}")
    embed.description = "\n".join(lines) if lines else "No players yet."
    await interaction.followup.send(embed=embed)


# ── /blackjack ────────────────────────────────────────────────────────────────

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


class BlackjackView(discord.ui.View):
    def __init__(self, deck: list[str], player: list[str], dealer: list[str], bet: int, player_user: discord.User | discord.Member, initial_wallet: int):
        super().__init__(timeout=60)
        self.deck = deck
        self.player = player
        self.dealer = dealer
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet
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
        embed.set_footer(text=f"Bet: {self.bet} {_coin()}")
        return embed

    async def end_game(self, interaction: discord.Interaction, reason: str) -> None:
        self.ended = True
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        player_total = hand_total(self.player)

        if player_total > 21:
            delta = -self.bet
            result = f"\U0001f4a5 Bust! You lost **{self.bet:,}** {_coin()}."
            colour = 0xE74C3C
        elif reason == "stand":
            while hand_total(self.dealer) < 17:
                self.dealer.append(self.deck.pop())
            dealer_total = hand_total(self.dealer)
            if dealer_total > 21 or player_total > dealer_total:
                delta = self.bet
                result = f"\U0001f3c6 You win **{self.bet:,}** {_coin()}!"
                colour = 0x2ECC71
            elif player_total == dealer_total:
                delta = 0
                result = "\U0001f91d Push — your bet is returned."
                colour = 0xF1C40F
            else:
                delta = -self.bet
                result = f"\U0001f61e Dealer wins. You lost **{self.bet:,}** {_coin()}."
                colour = 0xE74C3C
        else:
            delta = int(self.bet * 1.5)
            result = f"\U0001f389 Blackjack! You win **{delta:,}** {_coin()}!"
            colour = 0xF1C40F

        new_wallet = max(0, self.initial_wallet + delta)
        await set_wallet(self.player_user.id, new_wallet)

        embed = self.build_embed(title=result, hide_dealer=False)
        embed.colour = colour
        embed.set_footer(text=f"Wallet: {new_wallet:,} {_coin()}")
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
@app_commands.describe(bet="How many {_coin()} to bet")
async def blackjack(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "blackjack"): return
    if not _eco["blackjackEnabled"]:
        await interaction.response.send_message("The `/blackjack` command is currently disabled.", ephemeral=True)
        return
    max_bet = _eco["blackjackMaxBet"]
    if bet < 1 or bet > max_bet:
        await interaction.response.send_message(f"Bet must be between 1 and {max_bet:,} {_coin()}.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            f"You only have **{eco['wallet']:,}** {_coin()} in your wallet.", ephemeral=True
        )
        return
    deck = new_deck()
    random.shuffle(deck)
    player = [deck.pop(), deck.pop()]
    dealer = [deck.pop(), deck.pop()]
    view = BlackjackView(deck, player, dealer, bet, interaction.user, eco["wallet"])
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
    if not await check_cmd(interaction, "higher-lower"): return
    start = random.randint(1, 100)
    view = HLView(current=start)
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /roulette ─────────────────────────────────────────────────────────────────

ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


class RouletteView(discord.ui.View):
    def __init__(self, bet: int, player_user: discord.User | discord.Member, initial_wallet: int):
        super().__init__(timeout=60)
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet

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
            delta = winnings - self.bet
            title = f"\U0001f3b0 {colour_emoji} {result} — You win **{winnings:,}** {_coin()}!"
            colour = 0x2ECC71
        else:
            delta = -self.bet
            title = f"\U0001f3b0 {colour_emoji} {result} — You lost **{self.bet:,}** {_coin()}."
            colour = 0xE74C3C

        new_wallet = max(0, self.initial_wallet + delta)
        await set_wallet(self.player_user.id, new_wallet)

        embed = discord.Embed(
            title=title,
            description=f"You bet **{choice}** with **{self.bet:,}** coins.\nWallet: **{new_wallet:,}** {_coin()}",
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)


@bot.tree.command(name="roulette", description="Spin the roulette wheel")
@app_commands.describe(bet="How many {_coin()} to bet")
async def roulette(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "roulette"): return
    if not _eco["rouletteEnabled"]:
        await interaction.response.send_message("The `/roulette` command is currently disabled.", ephemeral=True)
        return
    max_bet = _eco["rouletteMaxBet"]
    if bet < 1 or bet > max_bet:
        await interaction.response.send_message(f"Bet must be between 1 and {max_bet:,} {_coin()}.", ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            f"You only have **{eco['wallet']:,}** {_coin()} in your wallet.", ephemeral=True
        )
        return
    view = RouletteView(bet=bet, player_user=interaction.user, initial_wallet=eco["wallet"])
    embed = discord.Embed(
        title="\U0001f3b0 Roulette",
        description=f"Bet: **{bet:,}** coins\nChoose a colour to spin!",
        colour=0x9B59B6,
    )
    embed.add_field(name="Payouts", value="Red \u2192 2x\nBlack \u2192 2x\nGreen (0) \u2192 14x", inline=False)
    await interaction.response.send_message(embed=embed, view=view)


# ── Cooldown reset endpoints (internal — called by bot itself) ─────────────────
# These are handled directly by the economy route on the API server


# ── Reminder loops (dynamic, one asyncio.Task per reminder) ───────────────────

@tasks.loop(seconds=30)
async def heartbeat_loop() -> None:
    await send_heartbeat(connected=True)


@tasks.loop(minutes=2)
async def config_refresh_loop() -> None:
    await refresh_reminders()
    await refresh_economy_config()
    await refresh_role_rewards()
    await refresh_command_configs()


@tasks.loop(seconds=10)
async def sync_poll_loop() -> None:
    """Check for pending role-reward sync jobs and process them."""
    job = await api_get_json("/role-rewards-sync")
    if not job or job.get("status") != "pending":
        return

    job_id = job["id"]
    logger.info("Role-reward sync job #%d — starting", job_id)
    await api_patch(f"/role-rewards-sync/{job_id}", {"status": "running"})

    total = 0
    processed = 0
    errors = 0

    for guild in bot.guilds:
        try:
            members = [m async for m in guild.fetch_members(limit=None)]
        except Exception as exc:
            logger.error("Sync: failed to fetch members for guild %s: %s", guild, exc)
            await api_patch(f"/role-rewards-sync/{job_id}", {
                "status": "error", "total": 0, "processed": 0, "errors": 1,
            })
            return

        total += len(members)
        for member in members:
            member_role_ids = {str(r.id) for r in member.roles}
            for rule in _role_rewards:
                trigger = rule.get("triggerRoleId", "")
                reward  = rule.get("rewardRoleId", "")
                remove  = rule.get("removeRoleId") or ""
                if not trigger or trigger not in member_role_ids:
                    continue
                try:
                    # Add reward role if configured and missing
                    if reward and reward not in member_role_ids:
                        reward_role = guild.get_role(int(reward))
                        if reward_role:
                            await member.add_roles(reward_role, reason="Sync: role reward")
                    # Remove role if configured and present
                    if remove and remove in member_role_ids:
                        remove_role = guild.get_role(int(remove))
                        if remove_role:
                            await member.remove_roles(remove_role, reason="Sync: role removal")
                    processed += 1
                except Exception as exc:
                    logger.error("Sync: error on member %s: %s", member, exc)
                    errors += 1

    await api_patch(f"/role-rewards-sync/{job_id}", {
        "status": "done", "total": total, "processed": processed, "errors": errors,
    })
    logger.info("Role-reward sync job #%d — done (%d members, %d actions, %d errors)",
                job_id, total, processed, errors)


@heartbeat_loop.before_loop
async def before_heartbeat() -> None:
    await bot.wait_until_ready()


@config_refresh_loop.before_loop
async def before_config_refresh() -> None:
    await bot.wait_until_ready()


@sync_poll_loop.before_loop
async def before_sync_poll() -> None:
    await bot.wait_until_ready()


# ── Ready ─────────────────────────────────────────────────────────────────────

@bot.event
async def on_ready() -> None:
    if bot.user is not None:
        logger.info("Bot connected as %s (ID: %s)", bot.user, bot.user.id)

    await refresh_reminders()
    await refresh_economy_config()
    await refresh_role_rewards()
    await refresh_command_configs()

    try:
        synced = await bot.tree.sync()
        logger.info("Slash commands synced — %d commands", len(synced))
    except Exception:
        logger.exception("Failed to sync slash commands")

    if not heartbeat_loop.is_running():
        heartbeat_loop.start()
    if not config_refresh_loop.is_running():
        config_refresh_loop.start()
    if not sync_poll_loop.is_running():
        sync_poll_loop.start()

    await send_heartbeat(connected=True)
    await log_to_api("INFO", f"Bot connected as {bot.user}")


# ── /shop ─────────────────────────────────────────────────────────────────────

@bot.tree.command(name="shop", description="Browse items available in the shop")
async def shop_cmd(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "shop"): return
    await interaction.response.defer()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                items: list[dict] = await resp.json()
    except Exception:
        await interaction.followup.send("Could not load the shop right now.", ephemeral=True)
        return

    enabled = [it for it in items if it.get("enabled", True)]
    enabled.sort(key=lambda it: (it.get("position", 0), it.get("id", 0)))

    if not enabled:
        await interaction.followup.send("The shop is empty for now.", ephemeral=True)
        return

    embed = discord.Embed(
        title="🛒 Shop",
        description=f"Use `/buy <item>` to purchase. Prices in **{_coin()}**.",
        colour=0x9B59B6,
    )
    for it in enabled:
        emoji = it.get("emoji", "🛍️")
        name = it.get("name", "?")
        price = it.get("price", 0)
        desc = it.get("description") or ""
        role_id = it.get("roleId")
        role_note = f"\n*Grants <@&{role_id}>*" if role_id else ""
        embed.add_field(
            name=f"{emoji} {name} — {price:,} {_coin()}",
            value=(desc + role_note) if (desc or role_note) else "\u200b",
            inline=False,
        )
    await interaction.followup.send(embed=embed)


# ── /buy ──────────────────────────────────────────────────────────────────────

async def _shop_items_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=3)
            ) as resp:
                items: list[dict] = await resp.json()
    except Exception:
        return []
    enabled = [it for it in items if it.get("enabled", True)]
    return [
        app_commands.Choice(name=f"{it.get('emoji','')} {it['name']} — {it['price']:,} {_coin()}", value=str(it["id"]))
        for it in enabled
        if current.lower() in it["name"].lower()
    ][:25]


@bot.tree.command(name="buy", description="Buy an item from the shop")
@app_commands.describe(item="Item to buy (type to search)")
@app_commands.autocomplete(item=_shop_items_autocomplete)
async def buy_cmd(interaction: discord.Interaction, item: str) -> None:
    if not await check_cmd(interaction, "buy"): return
    # Fetch shop items
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                items: list[dict] = await resp.json()
    except Exception:
        await interaction.response.send_message("Could not reach the shop right now.", ephemeral=True)
        return

    # Find the item by id or name
    target: dict | None = None
    for it in items:
        if str(it.get("id")) == item or it.get("name", "").lower() == item.lower():
            target = it
            break

    if not target:
        await interaction.response.send_message("Item not found.", ephemeral=True)
        return
    if not target.get("enabled", True):
        await interaction.response.send_message("This item is currently unavailable.", ephemeral=True)
        return

    price = target.get("price", 0)
    eco = await get_economy(interaction.user)

    if eco["wallet"] < price:
        await interaction.response.send_message(
            f"You need **{price:,}** {_coin()} but only have **{eco['wallet']:,}** {_coin()} in your wallet.",
            ephemeral=True,
        )
        return

    # Deduct wallet
    new_wallet = eco["wallet"] - price
    await set_wallet(interaction.user.id, new_wallet)

    # Grant Discord role if configured
    role_granted = False
    role_id = target.get("roleId")
    if role_id and interaction.guild:
        try:
            role = interaction.guild.get_role(int(role_id))
            if role and isinstance(interaction.user, discord.Member):
                await interaction.user.add_roles(role, reason=f"Shop purchase: {target['name']}")
                role_granted = True
        except Exception:
            pass

    emoji = target.get("emoji", "🛍️")
    name = target.get("name", "?")
    embed = discord.Embed(
        title=f"{emoji} Purchase confirmed!",
        description=f"You bought **{name}** for **{price:,}** {_coin()}.",
        colour=0x2ECC71,
    )
    embed.add_field(name="Wallet", value=f"**{new_wallet:,}** {_coin()}", inline=True)
    if role_granted:
        embed.add_field(name="Role granted", value=f"<@&{role_id}>", inline=True)
    await interaction.response.send_message(embed=embed)
    await log_to_api("INFO", f"{interaction.user} bought '{name}' for {price} {_coin()} (wallet → {new_wallet})")


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
