"""Discord bot – lotto-channel reminder + economy system."""

from __future__ import annotations

import asyncio
import re
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
_cmd_cfg: dict[str, dict] = {}  # commandName → {enabled, adminOnly, label}
_last_synced_labels: dict[str, str] = {}  # commandName → label at last Discord sync
_cmd_name_map: dict[str, str] = {}  # current discord name → original name

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


def _label_to_discord_name(label: str) -> str:
    """Convert a human label to a valid Discord slash command name (lowercase, hyphens)."""
    name = label.lower().replace(" ", "-").replace("_", "-")
    name = re.sub(r"[^a-z0-9\-]", "", name)
    name = re.sub(r"-{2,}", "-", name).strip("-")
    return (name or "cmd")[:32]


def _apply_command_labels() -> bool:
    """Rename commands and update their descriptions from _cmd_cfg labels.
    Returns True if any name or description actually changed."""
    global _cmd_name_map
    changed = False

    for cmd in list(bot.tree.get_commands()):
        # On first run cmd.name IS the original name; on subsequent runs
        # _cmd_name_map tells us what the original name was.
        original_name = _cmd_name_map.get(cmd.name, cmd.name)

        cfg = _cmd_cfg.get(original_name)
        label = cfg.get("label") if cfg else None
        if not label:
            _cmd_name_map.setdefault(cmd.name, original_name)
            continue

        new_discord_name = _label_to_discord_name(label)

        # ── Rename the command in the tree if needed ──────────────────────────
        if cmd.name != new_discord_name:
            bot.tree.remove_command(cmd.name)
            _cmd_name_map.pop(cmd.name, None)
            cmd.name = new_discord_name
            bot.tree.add_command(cmd)
            _cmd_name_map[new_discord_name] = original_name
            logger.info("Command renamed: /%s → /%s", original_name, new_discord_name)
            changed = True
        else:
            _cmd_name_map.setdefault(cmd.name, original_name)

        # ── Update description ────────────────────────────────────────────────
        if cmd.description != label:
            cmd.description = label
            changed = True

    return changed


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
    if _apply_command_labels():
        try:
            synced = await bot.tree.sync()
            global _last_synced_labels
            _last_synced_labels = {name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()}
            logger.info("Slash commands re-synced after label change — %d commands", len(synced))
        except Exception:
            logger.exception("Failed to re-sync slash commands after label change")


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


# ── Giveaway helpers ──────────────────────────────────────────────────────────

GIVEAWAY_EMOJI = "🎉"

# ── Duration helpers (shared by giveaway + temp-role display) ─────────────────

def _parse_duration(s: str) -> Optional[int]:
    """Parse '7j'/'7d', '24h', '30m', or a plain number into minutes. Returns None for empty."""
    s = s.strip().lower()
    if not s:
        return None
    if s.endswith("j") or s.endswith("d"):
        return int(s[:-1]) * 1440
    if s.endswith("h"):
        return int(s[:-1]) * 60
    if s.endswith("m"):
        return int(s[:-1])
    return int(s)


def _fmt_duration(minutes: int) -> str:
    """Format a minute count as a human-readable string."""
    if minutes < 60:
        return f"{minutes} min"
    if minutes < 1440:
        h, m = divmod(minutes, 60)
        return f"{h}h{m:02d}" if m else f"{h}h"
    d = minutes // 1440
    return f"{d} jour{'s' if d > 1 else ''}"


async def _filter_eligible(
    users: list[discord.User],
    guild: Optional[discord.Guild],
    giveaway: dict,
) -> list[discord.User]:
    """Return users that meet the giveaway's optional conditions."""
    # Merge legacy single-role field with new plural list
    required_role_ids: list[str] = list(giveaway.get("requiredRoleIds") or [])
    legacy_role = giveaway.get("requiredRoleId")
    if legacy_role and legacy_role not in required_role_ids:
        required_role_ids.append(legacy_role)

    forbidden_role_ids: list[str] = list(giveaway.get("forbiddenRoleIds") or [])
    min_balance: Optional[int] = giveaway.get("requiredMinBalance")

    if not required_role_ids and not forbidden_role_ids and not min_balance:
        return users  # no conditions — everyone is eligible

    eligible: list[discord.User] = []
    for user in users:
        # ── Role checks ─────────────────────────────────────────────────────
        if (required_role_ids or forbidden_role_ids) and guild:
            try:
                member = guild.get_member(user.id) or await guild.fetch_member(user.id)
                role_ids = {str(r.id) for r in member.roles}
                # Must have at least one of the required roles (OR logic)
                if required_role_ids and not any(rid in role_ids for rid in required_role_ids):
                    continue
                # Must NOT have any forbidden role
                if forbidden_role_ids and any(rid in role_ids for rid in forbidden_role_ids):
                    continue
            except Exception:
                continue  # can't fetch member → exclude

        # ── Balance check ────────────────────────────────────────────────────
        if min_balance:
            player = await api_get_json(f"/economy/players/{user.id}")
            if not player or (player.get("balance") or 0) < min_balance:
                continue

        eligible.append(user)

    return eligible


def _build_giveaway_embed(giveaway: dict, ends_ts: int) -> discord.Embed:
    """Build the active giveaway embed."""
    lines = [f"Réagis avec {GIVEAWAY_EMOJI} pour participer !"]

    # Host
    if giveaway.get("hostId"):
        lines.append(f"\n👤 **Organisé par** <@{giveaway['hostId']}>")

    # Conditions section
    conds: list[str] = []
    req_role_ids: list[str] = list(giveaway.get("requiredRoleIds") or [])
    if giveaway.get("requiredRoleId") and giveaway["requiredRoleId"] not in req_role_ids:
        req_role_ids.append(giveaway["requiredRoleId"])
    if req_role_ids:
        conds.append("✅ Rôles autorisés : " + " ".join(f"<@&{rid}>" for rid in req_role_ids))
    for rid in (giveaway.get("forbiddenRoleIds") or []):
        conds.append(f"🚫 Rôle interdit : <@&{rid}>")
    if giveaway.get("requiredMinBalance"):
        conds.append(f"💰 Solde minimum : {giveaway['requiredMinBalance']:,}")
    if conds:
        lines.append("\n**Conditions**\n" + "\n".join(conds))

    # Rewards section
    rewards: list[dict] = giveaway.get("rewards") or []
    if rewards:
        reward_lines: list[str] = []
        for r in rewards:
            if r["type"] == "money":
                reward_lines.append(f"💰 {r['amount']:,} pièces")
            elif r["type"] == "role":
                dur = r.get("roleDurationMinutes")
                dur_str = f" ⏱ {_fmt_duration(dur)}" if dur else ""
                reward_lines.append(f"🎭 <@&{r['roleId']}>{dur_str}")
            elif r["type"] == "item":
                item_label = r.get("itemName") or f"Item #{r.get('itemId', '?')}"
                reward_lines.append(f"📦 {item_label}")
        lines.append("\n**Récompenses supplémentaires**\n" + "\n".join(reward_lines))

    lines.append(f"\n**Fin :** <t:{ends_ts}:R>  (<t:{ends_ts}:f>)")
    lines.append(f"**🏆 Gagnants :** {giveaway['winnersCount']}")

    embed = discord.Embed(
        title=f"{GIVEAWAY_EMOJI}  GIVEAWAY  {GIVEAWAY_EMOJI}",
        description="\n".join(lines),
        color=discord.Color.gold(),
    )
    embed.set_footer(text=f"Giveaway #{giveaway['id']}")
    return embed


async def _post_giveaway_embed(giveaway: dict) -> None:
    """Post the giveaway embed to the target channel and update the API with messageId/guildId."""
    channel_id = int(giveaway["channelId"])
    giveaway_id = giveaway["id"]

    channel = bot.get_channel(channel_id)
    if channel is None:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception as exc:
            logger.error("Giveaway #%d: cannot find channel %s: %s", giveaway_id, channel_id, exc)
            return

    ends_at = datetime.fromisoformat(giveaway["endsAt"].replace("Z", "+00:00"))
    ends_ts = int(ends_at.timestamp())
    embed = _build_giveaway_embed(giveaway, ends_ts)

    # Ping mentioned roles before the embed
    mentioned = giveaway.get("mentionedRoleIds") or []
    mention_ping = " ".join(f"<@&{rid}>" for rid in mentioned) if mentioned else ""

    try:
        if mention_ping:
            await channel.send(mention_ping)
        msg = await channel.send(embed=embed)
        await msg.add_reaction(GIVEAWAY_EMOJI)
        await api_patch(f"/giveaways/{giveaway_id}", {
            "messageId": str(msg.id),
            "guildId": str(channel.guild.id),
        })
        logger.info("Giveaway #%d posted in channel %s (msg %s)", giveaway_id, channel_id, msg.id)
    except Exception as exc:
        logger.error("Giveaway #%d: failed to post: %s", giveaway_id, exc)


async def _deliver_rewards(winners: list[discord.User], giveaway: dict, guild: Optional[discord.Guild]) -> None:
    """Deliver money/role rewards to each winner."""
    rewards: list[dict] = giveaway.get("rewards") or []
    if not rewards:
        return
    for winner in winners:
        for reward in rewards:
            try:
                if reward["type"] == "money" and reward.get("amount"):
                    eco = await api_get_json(f"/economy/players/{winner.id}")
                    if eco is not None:
                        new_wallet = (eco.get("wallet") or 0) + reward["amount"]
                        await api_patch(f"/economy/players/{winner.id}", {"wallet": new_wallet})
                        logger.info("Giveaway reward: +%d wallet → %s", reward["amount"], winner.id)
                elif reward["type"] == "role" and reward.get("roleId") and guild:
                    member = guild.get_member(winner.id) or await guild.fetch_member(winner.id)
                    role = guild.get_role(int(reward["roleId"]))
                    if role and member:
                        await member.add_roles(role, reason=f"Giveaway #{giveaway['id']} reward")
                        logger.info("Giveaway reward: role %s → %s", role.name, winner.id)
                        dur_min = reward.get("roleDurationMinutes")
                        if dur_min and isinstance(dur_min, int):
                            expires = datetime.now(timezone.utc) + timedelta(minutes=dur_min)
                            await api_post("/temporary-roles", {
                                "userId":    str(winner.id),
                                "guildId":   str(guild.id),
                                "roleId":    str(role.id),
                                "expiresAt": expires.isoformat(),
                                "reason":    f"Giveaway #{giveaway['id']} — {_fmt_duration(dur_min)}",
                            })
                            logger.info("Temp role scheduled: %s → %s (expires in %s)", role.name, winner.id, _fmt_duration(dur_min))
                elif reward["type"] == "item" and reward.get("itemId"):
                    item_id = reward["itemId"]
                    # Add to inventory
                    await api_post("/inventory", {
                        "userId": str(winner.id),
                        "itemId": item_id,
                        "quantity": 1,
                        "source": "giveaway",
                    })
                    # Grant associated role if configured
                    item_data = await api_get_json(f"/shop/items")
                    if isinstance(item_data, list):
                        item_obj = next((it for it in item_data if it["id"] == item_id), None)
                    else:
                        item_obj = None
                    if item_obj and item_obj.get("roleId") and guild:
                        try:
                            member = guild.get_member(winner.id) or await guild.fetch_member(winner.id)
                            role = guild.get_role(int(item_obj["roleId"]))
                            if role and member:
                                await member.add_roles(role, reason=f"Giveaway #{giveaway['id']} item reward")
                                logger.info("Giveaway reward: item #%s + role %s → %s", item_id, role.name, winner.id)
                        except Exception as exc:
                            logger.warning("Could not grant role for item #%s: %s", item_id, exc)
                    else:
                        logger.info("Giveaway reward: item #%s added to inventory of %s", item_id, winner.id)
            except Exception as exc:
                logger.error("Giveaway reward delivery error for %s: %s", winner.id, exc)


async def _end_giveaway(giveaway: dict) -> None:
    """Pick winners from reactors, deliver rewards and announce."""
    giveaway_id = giveaway["id"]
    channel_id = int(giveaway["channelId"])
    message_id = int(giveaway["messageId"])
    winners_count = giveaway["winnersCount"]

    try:
        channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
        message = await channel.fetch_message(message_id)
    except Exception as exc:
        logger.error("Giveaway #%d: cannot fetch message: %s", giveaway_id, exc)
        await api_post(f"/giveaways/{giveaway_id}/end", {"winners": []})
        return

    # Collect reactors (exclude the bot itself)
    raw_reactors: list[discord.User] = []
    for reaction in message.reactions:
        if str(reaction.emoji) == GIVEAWAY_EMOJI:
            async for user in reaction.users():
                if not user.bot:
                    raw_reactors.append(user)
            break

    # Apply eligibility conditions
    reactors = await _filter_eligible(raw_reactors, message.guild, giveaway)

    winners: list[discord.User] = []
    if reactors:
        winners = random.sample(reactors, min(winners_count, len(reactors)))

    winner_ids = [str(w.id) for w in winners]
    await api_post(f"/giveaways/{giveaway_id}/end", {"winners": winner_ids})

    # Deliver rewards
    await _deliver_rewards(winners, giveaway, message.guild)

    # Update the original embed to show it's ended
    ends_ts = int(datetime.fromisoformat(giveaway["endsAt"].replace("Z", "+00:00")).timestamp())
    rewards: list[dict] = giveaway.get("rewards") or []
    reward_text = ""
    if rewards:
        parts = []
        for r in rewards:
            if r["type"] == "money":
                parts.append(f"💰 {r['amount']:,} pièces")
            elif r["type"] == "role":
                parts.append(f"🎭 <@&{r['roleId']}>")
            elif r["type"] == "item":
                item_label = r.get("itemName") or f"Item #{r.get('itemId', '?')}"
                parts.append(f"📦 {item_label}")
        reward_text = "\n**Récompenses :** " + " · ".join(parts)

    ended_embed = discord.Embed(
        title="🎊  GIVEAWAY TERMINÉ  🎊",
        description=(
            f"**Prix :** {giveaway['prize']}\n\n"
            + (
                "**🏆 Gagnant(s) :** " + ", ".join(w.mention for w in winners)
                if winners else "😔 Aucun participant éligible"
            )
            + reward_text
            + f"\n\n**Fin :** <t:{ends_ts}:f>"
        ),
        color=discord.Color.greyple(),
    )
    ended_embed.set_footer(text=f"Giveaway #{giveaway_id} — terminé")
    try:
        await message.edit(embed=ended_embed)
    except Exception:
        pass

    # Announce with winner mentions + host ping
    host_ping = f"<@{giveaway['hostId']}> " if giveaway.get("hostId") else ""
    if winners:
        mention_str = " ".join(w.mention for w in winners)
        await channel.send(
            f"{host_ping}🎉 Félicitations {mention_str} ! Vous avez gagné **{giveaway['prize']}** !"
        )
    else:
        await channel.send(f"{host_ping}Le giveaway **{giveaway['prize']}** s'est terminé sans participants éligibles.")

    logger.info("Giveaway #%d ended — %d winner(s): %s", giveaway_id, len(winners), winner_ids)


@tasks.loop(seconds=30)
async def giveaway_poll_loop() -> None:
    """Post pending giveaway embeds and end expired ones."""
    active = await api_get_list("/giveaways?status=active")
    if not active:
        return
    now = datetime.now(timezone.utc)
    for giveaway in active:
        # Post embed if not yet posted
        if not giveaway.get("messageId"):
            await _post_giveaway_embed(giveaway)
            continue
        # End if expired
        ends_at = datetime.fromisoformat(giveaway["endsAt"].replace("Z", "+00:00"))
        if now >= ends_at:
            await _end_giveaway(giveaway)


@giveaway_poll_loop.before_loop
async def before_giveaway_poll() -> None:
    await bot.wait_until_ready()


@tasks.loop(minutes=1)
async def temp_role_poll_loop() -> None:
    """Remove expired temporary roles."""
    pending = await api_get_list("/temporary-roles/pending")
    if not pending:
        return
    for entry in pending:
        try:
            guild = bot.get_guild(int(entry["guildId"]))
            if guild is None:
                guild = await bot.fetch_guild(int(entry["guildId"]))
            member = guild.get_member(int(entry["userId"]))
            if member is None:
                member = await guild.fetch_member(int(entry["userId"]))
            role = guild.get_role(int(entry["roleId"]))
            if role and member and role in member.roles:
                await member.remove_roles(role, reason=f"Rôle temporaire expiré (entrée #{entry['id']})")
                logger.info("Temp role #%s expired: removed %s from %s", entry["id"], role.name, member)
        except Exception as exc:
            logger.warning("Temp role #%s removal error: %s", entry["id"], exc)
        # Always mark as removed so we don't retry indefinitely
        await api_patch(f"/temporary-roles/{entry['id']}/removed", {})


@temp_role_poll_loop.before_loop
async def before_temp_role_poll() -> None:
    await bot.wait_until_ready()


# ── Giveaway interactive setup ─────────────────────────────────────────────────

class _GiveawayCfg:
    """Mutable config built by the interactive setup view."""

    def __init__(self) -> None:
        self.prize: str = ""
        self.channel_id: str = ""
        self.duration_minutes: int = 60
        self.winners_count: int = 1
        self.host_id: Optional[str] = None
        self.mentioned_role_ids: list[str] = []
        self.required_role_ids: list[str] = []
        self.forbidden_role_ids: list[str] = []
        self.required_min_balance: Optional[int] = None
        self.rewards: list[dict] = []

    @property
    def ready(self) -> bool:
        return bool(self.prize and self.channel_id and self.duration_minutes >= 1)

    def to_api_body(self) -> dict:
        body: dict = {
            "prize": self.prize,
            "channelId": self.channel_id,
            "durationMinutes": self.duration_minutes,
            "winnersCount": self.winners_count,
            "rewards": self.rewards,
        }
        if self.host_id:
            body["hostId"] = self.host_id
        if self.mentioned_role_ids:
            body["mentionedRoleIds"] = self.mentioned_role_ids
        if self.required_role_ids:
            body["requiredRoleIds"] = self.required_role_ids
        if self.forbidden_role_ids:
            body["forbiddenRoleIds"] = self.forbidden_role_ids
        if self.required_min_balance is not None:
            body["requiredMinBalance"] = self.required_min_balance
        return body

    def summary_embed(self) -> discord.Embed:
        lines: list[str] = []

        prize_val = self.prize or "*non défini*"
        lines.append(f"**🎁 Prix :** {prize_val}")

        if self.channel_id:
            lines.append(f"**📢 Salon :** <#{self.channel_id}>")
        else:
            lines.append("**📢 Salon :** *non défini*")

        lines.append(
            f"**⏱ Durée :** {self.duration_minutes} min  •  "
            f"**🏆 Gagnants :** {self.winners_count}"
        )

        if self.host_id:
            lines.append(f"**👤 Organisateur :** <@{self.host_id}>")

        if self.mentioned_role_ids:
            pings = " ".join(f"<@&{rid}>" for rid in self.mentioned_role_ids)
            lines.append(f"**💬 Mentions :** {pings}")

        # Conditions
        cond_parts: list[str] = []
        if self.required_role_ids:
            roles = " ".join(f"<@&{rid}>" for rid in self.required_role_ids)
            cond_parts.append(f"✅ Rôles autorisés : {roles}")
        if self.forbidden_role_ids:
            roles = " ".join(f"<@&{rid}>" for rid in self.forbidden_role_ids)
            cond_parts.append(f"🚫 Rôles interdits : {roles}")
        if self.required_min_balance:
            cond_parts.append(f"💰 Solde minimum : {self.required_min_balance:,}")
        if cond_parts:
            lines.append("\n**Conditions**\n" + "\n".join(cond_parts))

        # Rewards
        if self.rewards:
            r_parts: list[str] = []
            for r in self.rewards:
                if r["type"] == "money":
                    r_parts.append(f"💰 {r['amount']:,} pièces")
                elif r["type"] == "role":
                    dur = r.get("roleDurationMinutes")
                    dur_str = f" ⏱ {_fmt_duration(dur)}" if dur else ""
                    r_parts.append(f"🎭 <@&{r['roleId']}>{dur_str}")
                elif r["type"] == "item":
                    item_label = r.get("itemName") or f"Item #{r.get('itemId', '?')}"
                    r_parts.append(f"📦 {item_label}")
            lines.append("\n**Récompenses**\n" + "\n".join(r_parts))

        color = discord.Color.green() if self.ready else discord.Color.orange()
        embed = discord.Embed(
            title="🎉 Configurer le giveaway",
            description="\n".join(lines),
            color=color,
        )
        if self.ready:
            embed.set_footer(text="✅ Prêt à lancer — clique sur 🚀 Lancer")
        else:
            embed.set_footer(text="⚠️ Renseignez le prix, le salon et la durée pour activer le bouton Lancer")
        return embed


class GiveawaySetupView(discord.ui.View):
    """Main setup panel — shown to the admin who runs /giveaway start."""

    def __init__(self, author_id: int) -> None:
        super().__init__(timeout=600)
        self.author_id = author_id
        self.cfg = _GiveawayCfg()
        self._sync_launch_button()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "❌ Ce panneau ne t'appartient pas.", ephemeral=True
            )
            return False
        return True

    def _sync_launch_button(self) -> None:
        for child in self.children:
            if getattr(child, "custom_id", None) == "ga_launch":
                child.disabled = not self.cfg.ready  # type: ignore[union-attr]

    async def _refresh(self, interaction: discord.Interaction) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(embed=self.cfg.summary_embed(), view=self)

    # ── Row 0: core info + rewards ────────────────────────────────────────────

    @discord.ui.button(label="📝 Infos de base", style=discord.ButtonStyle.secondary, row=0)
    async def btn_base(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(_BaseInfoModal(self))

    @discord.ui.button(label="📢 Salon", style=discord.ButtonStyle.secondary, row=0)
    async def btn_channel(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_ChannelSelectView(self),
        )

    @discord.ui.button(label="🎁 Récompenses", style=discord.ButtonStyle.secondary, row=0)
    async def btn_rewards(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(), view=_RewardTypeView(self)
        )

    # ── Row 1: people ─────────────────────────────────────────────────────────

    @discord.ui.button(label="👤 Host", style=discord.ButtonStyle.secondary, row=1)
    async def btn_host(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_UserSelectView(self, "host", 1, "l'organisateur"),
        )

    @discord.ui.button(label="💬 Mentions (rôles)", style=discord.ButtonStyle.secondary, row=1)
    async def btn_mentions(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_RoleSelectView(self, "mentions", "les rôles à mentionner"),
        )

    @discord.ui.button(label="💰 Solde min.", style=discord.ButtonStyle.secondary, row=1)
    async def btn_min_balance(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(_MinBalanceModal(self))

    # ── Row 2: role conditions ────────────────────────────────────────────────

    @discord.ui.button(label="✅ Rôles autorisés", style=discord.ButtonStyle.secondary, row=2)
    async def btn_allowed(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_RoleSelectView(self, "allowed", "les rôles autorisés"),
        )

    @discord.ui.button(label="🚫 Rôles interdits", style=discord.ButtonStyle.secondary, row=2)
    async def btn_forbidden(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_RoleSelectView(self, "forbidden", "les rôles interdits"),
        )

    # ── Row 3: launch ─────────────────────────────────────────────────────────

    @discord.ui.button(
        label="🚀 Lancer le giveaway",
        style=discord.ButtonStyle.green,
        row=3,
        custom_id="ga_launch",
        disabled=True,
    )
    async def btn_launch(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        if not self.cfg.ready:
            await interaction.response.send_message(
                "❌ Renseignez au moins le prix, le salon et la durée.", ephemeral=True
            )
            return
        result = await api_post("/giveaways", self.cfg.to_api_body())
        if result:
            self.stop()
            done = discord.Embed(
                title="✅ Giveaway créé !",
                description=(
                    f"**{self.cfg.prize}** sera posté dans <#{self.cfg.channel_id}> "
                    f"dans quelques secondes."
                ),
                color=discord.Color.green(),
            )
            await interaction.response.edit_message(embed=done, view=None)
        else:
            await interaction.response.send_message(
                "❌ Erreur lors de la création.", ephemeral=True
            )


# ── Sub-views ──────────────────────────────────────────────────────────────────

class _SubView(discord.ui.View):
    """Base for temporary sub-views that go back to the main setup view."""

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__(timeout=120)
        self.parent = parent

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.parent.author_id:
            await interaction.response.send_message("❌", ephemeral=True)
            return False
        return True

    async def _back(self, interaction: discord.Interaction) -> None:
        self.parent._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.parent.cfg.summary_embed(), view=self.parent
        )


class _ChannelSelectView(_SubView):
    """Let the user pick the giveaway channel via a native ChannelSelect."""

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__(parent)
        self._selected: discord.TextChannel | None = None
        sel = discord.ui.ChannelSelect(
            placeholder="Sélectionner le salon du giveaway",
            min_values=1,
            max_values=1,
            channel_types=[discord.ChannelType.text],
        )
        sel.callback = self._on_select
        self.add_item(sel)

    async def _on_select(self, interaction: discord.Interaction) -> None:
        for child in self.children:
            if isinstance(child, discord.ui.ChannelSelect):
                vals = child.values
                self._selected = vals[0] if vals else None  # type: ignore[assignment]
        await interaction.response.defer()

    @discord.ui.button(label="✅ Confirmer", style=discord.ButtonStyle.green, row=1)
    async def confirm(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        if self._selected:
            self.parent.cfg.channel_id = str(self._selected.id)
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._back(interaction)


class _RoleSelectView(_SubView):
    def __init__(self, parent: GiveawaySetupView, field: str, label: str) -> None:
        super().__init__(parent)
        self.field = field
        self._selected: list[discord.Role] = []
        sel = discord.ui.RoleSelect(
            placeholder=f"Sélectionner {label}",
            min_values=0,
            max_values=10,
        )
        sel.callback = self._on_select
        self.add_item(sel)

    async def _on_select(self, interaction: discord.Interaction) -> None:
        for child in self.children:
            if isinstance(child, discord.ui.RoleSelect):
                self._selected = list(child.values)
        await interaction.response.defer()

    @discord.ui.button(label="✅ Confirmer", style=discord.ButtonStyle.green, row=1)
    async def confirm(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        ids = [str(r.id) for r in self._selected]
        if self.field == "allowed":
            self.parent.cfg.required_role_ids = ids
        elif self.field == "forbidden":
            self.parent.cfg.forbidden_role_ids = ids
        else:  # mentions
            self.parent.cfg.mentioned_role_ids = ids
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._back(interaction)


class _UserSelectView(_SubView):
    def __init__(
        self,
        parent: GiveawaySetupView,
        field: str,
        max_values: int,
        label: str,
    ) -> None:
        super().__init__(parent)
        self.field = field
        self._selected: list[discord.User | discord.Member] = []
        sel = discord.ui.UserSelect(
            placeholder=f"Sélectionner {label}",
            min_values=0,
            max_values=max_values,
        )
        sel.callback = self._on_select
        self.add_item(sel)

    async def _on_select(self, interaction: discord.Interaction) -> None:
        for child in self.children:
            if isinstance(child, discord.ui.UserSelect):
                self._selected = list(child.values)
        await interaction.response.defer()

    @discord.ui.button(label="✅ Confirmer", style=discord.ButtonStyle.green, row=1)
    async def confirm(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        ids = [str(u.id) for u in self._selected]
        if self.field == "host":
            self.parent.cfg.host_id = ids[0] if ids else None
        else:
            self.parent.cfg.mentioned_user_ids = ids
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._back(interaction)


class _RewardTypeView(_SubView):
    @discord.ui.select(
        placeholder="Type de récompense à ajouter",
        options=[
            discord.SelectOption(label="💰 Argent", value="money",
                                 description="Ajouter une somme au wallet du gagnant"),
            discord.SelectOption(label="🎭 Rôle", value="role",
                                 description="Attribuer un rôle Discord"),
            discord.SelectOption(label="📦 Item de boutique", value="item",
                                 description="Indiquer un item à remettre manuellement"),
        ],
        row=0,
    )
    async def pick_type(self, interaction: discord.Interaction, sel: discord.ui.Select) -> None:
        t = sel.values[0]
        if t == "money":
            await interaction.response.send_modal(_AddMoneyModal(self.parent))
        elif t == "role":
            await interaction.response.edit_message(
                embed=self.parent.cfg.summary_embed(),
                view=_RoleRewardView(self.parent),
            )
        elif t == "item":
            await interaction.response.send_modal(_AddItemModal(self.parent))

    @discord.ui.button(label="🗑 Vider les récompenses", style=discord.ButtonStyle.danger, row=1)
    async def clear(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        self.parent.cfg.rewards = []
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._back(interaction)


class _RoleRewardView(_SubView):
    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__(parent)
        self._role: Optional[discord.Role] = None
        self._duration_minutes: Optional[int] = None

        sel = discord.ui.RoleSelect(placeholder="Rôle à attribuer au gagnant", min_values=1, max_values=1)
        sel.callback = self._on_select
        self.add_item(sel)

        # Duration toggle — dynamic so we can update label/style after modal submit
        self._dur_btn = discord.ui.Button(
            label="⏱ Permanent  ·  cliquer pour rendre temporaire",
            style=discord.ButtonStyle.secondary,
            row=1,
        )
        self._dur_btn.callback = self._on_duration
        self.add_item(self._dur_btn)

        confirm_btn = discord.ui.Button(label="✅ Ajouter ce rôle", style=discord.ButtonStyle.green, row=1)
        confirm_btn.callback = self._on_confirm
        self.add_item(confirm_btn)

        back_btn = discord.ui.Button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
        back_btn.callback = self._on_back
        self.add_item(back_btn)

    async def _on_select(self, interaction: discord.Interaction) -> None:
        for child in self.children:
            if isinstance(child, discord.ui.RoleSelect):
                self._role = child.values[0] if child.values else None
        await interaction.response.defer()

    async def _on_duration(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(_RoleDurationModal(self))

    async def _on_confirm(self, interaction: discord.Interaction) -> None:
        if self._role:
            reward: dict = {"type": "role", "roleId": str(self._role.id), "roleName": self._role.name}
            if self._duration_minutes:
                reward["roleDurationMinutes"] = self._duration_minutes
            self.parent.cfg.rewards.append(reward)
        await self._back(interaction)

    async def _on_back(self, interaction: discord.Interaction) -> None:
        await interaction.response.edit_message(
            embed=self.parent.cfg.summary_embed(), view=_RewardTypeView(self.parent)
        )


# ── Modals ─────────────────────────────────────────────────────────────────────

class _RoleDurationModal(discord.ui.Modal, title="Durée du rôle temporaire"):
    dur_f = discord.ui.TextInput(
        label="Durée  (ex: 7j · 24h · 30m — vide = permanent)",
        placeholder="ex: 7j",
        max_length=10,
        required=False,
    )

    def __init__(self, view: "_RoleRewardView") -> None:
        super().__init__()
        self._role_view = view
        if view._duration_minutes:
            self.dur_f.default = f"{view._duration_minutes}m"

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self.dur_f.value.strip()
        try:
            self._role_view._duration_minutes = _parse_duration(raw) if raw else None
        except (ValueError, TypeError):
            self._role_view._duration_minutes = None
        dur = self._role_view._duration_minutes
        if dur:
            self._role_view._dur_btn.label = f"⏱ {_fmt_duration(dur)}  ·  cliquer pour modifier"
            self._role_view._dur_btn.style = discord.ButtonStyle.primary
        else:
            self._role_view._dur_btn.label = "⏱ Permanent  ·  cliquer pour rendre temporaire"
            self._role_view._dur_btn.style = discord.ButtonStyle.secondary
        await interaction.response.edit_message(
            embed=self._role_view.parent.cfg.summary_embed(), view=self._role_view
        )


class _BaseInfoModal(discord.ui.Modal, title="Infos de base du giveaway"):
    prize_f    = discord.ui.TextInput(label="Prix à gagner", placeholder="ex: 1 000 sheckels, Nitro…", max_length=200)
    duration_f = discord.ui.TextInput(label="Durée (minutes)", placeholder="60", max_length=6, default="60")
    winners_f  = discord.ui.TextInput(label="Nombre de gagnants", placeholder="1", max_length=3, default="1")

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent
        if parent.cfg.prize:
            self.prize_f.default = parent.cfg.prize
        self.duration_f.default = str(parent.cfg.duration_minutes)
        self.winners_f.default = str(parent.cfg.winners_count)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        self.parent.cfg.prize = self.prize_f.value.strip()
        try:
            self.parent.cfg.duration_minutes = max(1, int(self.duration_f.value))
        except ValueError:
            pass
        try:
            self.parent.cfg.winners_count = max(1, int(self.winners_f.value))
        except ValueError:
            pass
        await self.parent._refresh(interaction)


class _MinBalanceModal(discord.ui.Modal, title="Solde minimum requis"):
    bal_f = discord.ui.TextInput(
        label="Montant minimum (laisser vide pour retirer)",
        placeholder="ex: 500",
        max_length=15,
        required=False,
    )

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent
        if parent.cfg.required_min_balance:
            self.bal_f.default = str(parent.cfg.required_min_balance)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        val = self.bal_f.value.strip()
        try:
            self.parent.cfg.required_min_balance = int(val) if val else None
        except ValueError:
            pass
        await self.parent._refresh(interaction)


class _AddMoneyModal(discord.ui.Modal, title="Récompense argent"):
    amount_f = discord.ui.TextInput(label="Montant à ajouter au wallet", placeholder="ex: 1000", max_length=15)

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            self.parent.cfg.rewards.append({"type": "money", "amount": int(self.amount_f.value.strip())})
        except ValueError:
            pass
        await self.parent._refresh(interaction)


class _AddItemModal(discord.ui.Modal, title="Récompense item"):
    id_f = discord.ui.TextInput(label="ID de l'item (boutique)", placeholder="ex: 3", max_length=10)
    name_f = discord.ui.TextInput(label="Nom de l'item (pour l'affichage)", placeholder="ex: Couronne VIP", max_length=100)

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            self.parent.cfg.rewards.append({
                "type": "item",
                "itemId": int(self.id_f.value.strip()),
                "itemName": self.name_f.value.strip(),
            })
        except ValueError:
            pass
        await self.parent._refresh(interaction)


# ── /giveaway command group ───────────────────────────────────────────────────

giveaway_group = app_commands.Group(name="giveaway", description="Gestion des giveaways [Admin]")


@giveaway_group.command(name="start", description="Ouvrir le panneau de création de giveaway")
async def giveaway_start(interaction: discord.Interaction) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message("❌ Commande réservée aux administrateurs.", ephemeral=True)
        return
    view = GiveawaySetupView(author_id=interaction.user.id)
    await interaction.response.send_message(embed=view.cfg.summary_embed(), view=view, ephemeral=True)


@giveaway_group.command(name="end", description="Terminer un giveaway immédiatement")
@app_commands.describe(giveaway_id="ID du giveaway")
async def giveaway_end(interaction: discord.Interaction, giveaway_id: int) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message("❌ Commande réservée aux administrateurs.", ephemeral=True)
        return
    giveaway = await api_get_json(f"/giveaways/{giveaway_id}")
    if not giveaway or giveaway.get("status") != "active":
        await interaction.response.send_message("❌ Giveaway introuvable ou déjà terminé.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    await _end_giveaway(giveaway)
    await interaction.followup.send(f"✅ Giveaway #{giveaway_id} terminé.", ephemeral=True)


@giveaway_group.command(name="reroll", description="Retirer un nouveau gagnant")
@app_commands.describe(giveaway_id="ID du giveaway")
async def giveaway_reroll(interaction: discord.Interaction, giveaway_id: int) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message("❌ Commande réservée aux administrateurs.", ephemeral=True)
        return
    giveaway = await api_get_json(f"/giveaways/{giveaway_id}")
    if not giveaway or giveaway.get("status") != "ended":
        await interaction.response.send_message("❌ Giveaway introuvable ou pas encore terminé.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)

    channel_id = int(giveaway["channelId"])
    message_id = int(giveaway["messageId"]) if giveaway.get("messageId") else None
    winners_count = giveaway["winnersCount"]

    raw_reactors: list[discord.User] = []
    guild: Optional[discord.Guild] = None
    if message_id:
        try:
            channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
            message = await channel.fetch_message(message_id)
            guild = message.guild
            for reaction in message.reactions:
                if str(reaction.emoji) == GIVEAWAY_EMOJI:
                    async for user in reaction.users():
                        if not user.bot:
                            raw_reactors.append(user)
                    break
        except Exception as exc:
            logger.error("Reroll giveaway #%d: %s", giveaway_id, exc)

    reactors = await _filter_eligible(raw_reactors, guild, giveaway)
    new_winners: list[discord.User] = []
    if reactors:
        new_winners = random.sample(reactors, min(winners_count, len(reactors)))

    winner_ids = [str(w.id) for w in new_winners]
    await api_post(f"/giveaways/{giveaway_id}/reroll", {"winners": winner_ids})

    if new_winners:
        prize = giveaway["prize"]
        mention_str = " ".join(w.mention for w in new_winners)
        try:
            channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
            await channel.send(f"🎲 **Reroll !** Nouveau(x) gagnant(s) : {mention_str} pour **{prize}** !")
        except Exception:
            pass
        await interaction.followup.send(f"✅ Reroll effectué : {mention_str}", ephemeral=True)
    else:
        await interaction.followup.send("❌ Aucun participant pour le reroll.", ephemeral=True)


bot.tree.add_command(giveaway_group)


@tasks.loop(seconds=10)
async def command_sync_poll_loop() -> None:
    """Check for a pending command sync request and re-sync with Discord."""
    job = await api_get_json("/command-sync")
    if not job or job.get("status") != "pending":
        return
    await api_patch("/command-sync", {"status": "running"})
    try:
        await refresh_command_configs()
        _apply_command_labels()
        synced = await bot.tree.sync()
        global _last_synced_labels
        _last_synced_labels = {name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()}
        logger.info("Command sync: %d commands synced", len(synced))
        await api_patch("/command-sync", {"status": "done"})
    except Exception as exc:
        logger.error("Command sync failed: %s", exc)
        await api_patch("/command-sync", {"status": "error"})


@sync_poll_loop.before_loop
async def before_sync_poll() -> None:
    await bot.wait_until_ready()


@command_sync_poll_loop.before_loop
async def before_command_sync_poll() -> None:
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
    _apply_command_labels()

    try:
        synced = await bot.tree.sync()
        global _last_synced_labels
        _last_synced_labels = {name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()}
        logger.info("Slash commands synced — %d commands", len(synced))
    except Exception:
        logger.exception("Failed to sync slash commands")

    if not heartbeat_loop.is_running():
        heartbeat_loop.start()
    if not config_refresh_loop.is_running():
        config_refresh_loop.start()
    if not sync_poll_loop.is_running():
        sync_poll_loop.start()
    if not command_sync_poll_loop.is_running():
        command_sync_poll_loop.start()
    if not giveaway_poll_loop.is_running():
        giveaway_poll_loop.start()
    if not temp_role_poll_loop.is_running():
        temp_role_poll_loop.start()

    await send_heartbeat(connected=True)
    await log_to_api("INFO", f"Bot connected as {bot.user}")

    # Push text channels to API cache (used by the dashboard giveaway form)
    try:
        channels = [
            {"id": str(ch.id), "name": ch.name,
             "guildId": str(ch.guild.id), "guildName": ch.guild.name}
            for guild in bot.guilds
            for ch in guild.text_channels
        ]
        async with aiohttp.ClientSession() as session:
            await session.post(
                f"{API_BASE}/bot/channels",
                json=channels,
                timeout=aiohttp.ClientTimeout(total=5),
            )
    except Exception:
        pass


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

    # Record in inventory
    await api_post("/inventory", {
        "userId": str(interaction.user.id),
        "itemId": target["id"],
        "quantity": 1,
        "source": "buy",
    })

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


# ── /inventory ────────────────────────────────────────────────────────────────

@bot.tree.command(name="inventory", description="View your item inventory (or another member's)")
@app_commands.describe(member="Member whose inventory to view (leave empty for your own)")
async def inventory_cmd(interaction: discord.Interaction, member: Optional[discord.Member] = None) -> None:
    if not await check_cmd(interaction, "inventory"): return
    await interaction.response.defer(ephemeral=True)

    target = member or interaction.user
    entries = await api_get_list(f"/inventory/{target.id}")
    if not entries:
        msg = f"📦 {target.display_name} n'a aucun item." if member else "📦 Ton inventaire est vide."
        await interaction.followup.send(msg, ephemeral=True)
        return

    lines: list[str] = []
    for e in entries:
        item = e.get("item") or {}
        emoji = item.get("emoji", "📦")
        name  = item.get("name") or f"Item #{e['itemId']}"
        qty   = e.get("quantity", 1)
        src   = e.get("source", "buy")
        src_label = {"buy": "achat", "giveaway": "giveaway", "admin": "admin"}.get(src, src)
        qty_str = f" ×{qty}" if qty > 1 else ""
        lines.append(f"{emoji} **{name}**{qty_str}  ·  _{src_label}_")

    embed = discord.Embed(
        title=f"📦 Inventaire de {target.display_name}",
        description="\n".join(lines),
        colour=0x9B59B6,
    )
    embed.set_footer(text=f"{len(entries)} item{'s' if len(entries) > 1 else ''}")
    await interaction.followup.send(embed=embed, ephemeral=True)


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
