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
from flask import Flask
from threading import Thread

logger = logging.getLogger(__name__)

# Définition de RestartView pour éviter le NameError
class RestartView(discord.ui.View):
    def __init__(self, owner_id: int):
        super().__init__()
        self.owner_id = owner_id

# Définition de l'API_BASE pour éviter le NameError
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:10000/api")

# --- Mini serveur web pour Render ---
app = Flask('')

@app.route('/')
def home():
    return "Je suis en ligne !"

def run():
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)

def keep_alive():
    t = Thread(target=run)
    t.start()


# ── Global HTTP session (reused across all API calls) ─────────────────────────

_session: Optional[aiohttp.ClientSession] = None


async def get_http_session() -> aiohttp.ClientSession:
    """Return the shared aiohttp session, creating it if needed."""
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session


async def api_post(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.post(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_patch(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.patch(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_delete(path: str) -> Optional[bool]:
    """Returns True on 204 success, False on 404, None on error."""
    try:
        s = await get_http_session()
        async with s.delete(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 204:
                return True
            if resp.status == 404:
                return False
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_put(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.put(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_get_json(path: str) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 200:
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_get_list(path: str) -> Optional[list]:
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 200:
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None

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

#API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:10000/api")

# Economy config — overwritten at runtime by refresh_economy_config()
_eco: dict = {
    "startingWallet": 200,
    "balanceEnabled": True,
    "moneyEnabled": True,
    "dailyEnabled": True,
    "dailyAmount": 500,
    "dailyCooldownHours": 24,
    "workEnabled": True,
    "workMinAmount": 50,
    "workMaxAmount": 200,
    "workCooldownHours": 1,
    "crimeEnabled": True,
    "crimeWinMin": 100,
    "crimeWinMax": 500,
    "crimeLoseMin": 50,
    "crimeLoseMax": 200,
    "crimeWinChance": 60,
    "crimeCooldownHours": 2,
    "depositEnabled": True,
    "withdrawEnabled": True,
    "giveEnabled": True,
    "leaderboardEnabled": True,
    "blackjackEnabled": True,
    "blackjackMinBet": 10,
    "blackjackMaxBet": 1000,
    "rouletteEnabled": True,
    "rouletteMinBet": 10,
    "rouletteMaxBet": 1000,
    "hlEnabled": True,
    "hlMinBet": 10,
    "hlMaxBet": 500,
    "hlStreakReward": 25,
    "guessEnabled": True,
    "guessMinBet": 10,
    "guessMaxBet": 1000,
    "guessMaxAttempts": 7,
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
_reminders: dict[int, dict] = {}  # id → reminder dict from API
_reminder_tasks: dict[int, asyncio.Task] = {}  # id → running asyncio.Task

# Role reward rules — overwritten at runtime by refresh_role_rewards()
_role_rewards: list[dict] = []  # list of {triggerRoleId, rewardRoleId, enabled}

# Command configs — overwritten at runtime by refresh_command_configs()
_cmd_cfg: dict[str, dict] = {}  # commandName → {enabled, adminOnly, label}
_last_synced_labels: dict[str, str] = {}  # commandName → label at last Discord sync
_cmd_name_map: dict[str, str] = {}  # current discord name → original name

# Bot language — overwritten at runtime from economy config
_lang: str = "fr"

# Random activity — overwritten at runtime by refresh_random_activity()
_rdm_cfg: dict = {
    "enabled": False,
    "channelId": "",
    "topic": "",
    "minIntervalMinutes": 30,
    "maxIntervalMinutes": 120,
    "includeCommandSuggestions": True,
}
_rdm_messages: list[dict] = []  # [{id, content, enabled}, ...]
_rdm_next_send: Optional[datetime] = None  # UTC datetime for next message

# Welcome / Leave embeds — overwritten at runtime by refresh_welcome_config()
_welcome_cfg: dict = {
    "joinEnabled": False,
    "joinChannelId": "",
    "joinEmbedTitle": "Bienvenue sur {server} ! 🎉",
    "joinEmbedDescription": "Bienvenue {mention}, tu es le **{count}ème** membre !",
    "joinEmbedColor": "57F287",
    "joinEmbedFooter": "",
    "joinShowAvatar": True,
    "leaveEnabled": False,
    "leaveChannelId": "",
    "leaveEmbedTitle": "{user} a quitté le serveur. 👋",
    "leaveEmbedDescription": "Nous sommes maintenant **{count}** membres.",
    "leaveEmbedColor": "ED4245",
    "leaveEmbedFooter": "",
    "leaveShowAvatar": True,
}

# Ticket system — overwritten at runtime by refresh_ticket_config()
_tkts_cfg: dict = {
    "enabled": False,
    "panelChannelId": "",
    "categoryId": "",
    "staffRoleId": "",
    "embedTitle": "🎫 Support",
    "embedDescription": "Cliquez sur le bouton ci-dessous pour ouvrir un ticket de support.\nUn membre du staff vous répondra dès que possible.",
    "embedColor": "5865F2",
    "logChannelId": "",
    "welcomeMessage": "Bonjour {user} ! Un membre du staff va vous répondre bientôt.",
}

# Custom commands — overwritten at runtime by refresh_custom_commands()
_custom_commands: list[dict] = []
# Per-(command_id, user_id) cooldown tracker
_cc_cooldowns: dict[tuple[int, int], float] = {}


# ── i18n ─────────────────────────────────────────────────────────────────────

STRINGS: dict[str, dict[str, str] | list] = {
    # Generic errors
    "err_admin_perm": {
        "fr": "Tu dois avoir la permission Administrateur pour utiliser cette commande.",
        "en": "You need Administrator permission to use this command.",
    },
    "err_amount_positive": {
        "fr": "Le montant doit être positif.",
        "en": "Amount must be positive.",
    },
    "err_not_enough_wallet": {
        "fr": "Tu n'as que **{amount:,}** {coin} dans ton portefeuille.",
        "en": "You only have **{amount:,}** {coin} in your wallet.",
    },
    "err_not_enough_bank": {
        "fr": "Tu n'as que **{amount:,}** {coin} en banque.",
        "en": "You only have **{amount:,}** {coin} in the bank.",
    },
    "err_cmd_disabled": {
        "fr": "❌ Cette commande est actuellement désactivée.",
        "en": "❌ This command is currently disabled.",
    },
    "err_cmd_admin_only": {
        "fr": "🔒 Cette commande est réservée aux administrateurs.",
        "en": "🔒 This command is restricted to administrators.",
    },
    "err_give_self": {
        "fr": "Tu ne peux pas te donner des {coin} à toi-même.",
        "en": "You cannot give {coin} to yourself.",
    },
    "err_give_bot": {
        "fr": "Tu ne peux pas donner des {coin} à un bot.",
        "en": "You cannot give {coin} to a bot.",
    },
    # balance
    "bal_title": {"fr": "Balance — {name}", "en": "Balance — {name}"},
    "bal_wallet": {"fr": "Portefeuille", "en": "Wallet"},
    "bal_bank": {"fr": "Banque", "en": "Bank"},
    "bal_total": {"fr": "Total", "en": "Total"},
    "bal_rank": {"fr": "Rang", "en": "Rank"},
    # addmoney / removemoney / setmoney / resetmoney
    "addmoney_title": {"fr": "Coins ajoutés", "en": "Coins Added"},
    "addmoney_desc_bank": {
        "fr": "Ajouté **{amount:,}** {coin} à la **banque** de {mention}.\nNouvelle banque : **{new:,}** {coin}",
        "en": "Added **{amount:,}** {coin} to {mention}'s **bank**.\nNew bank: **{new:,}** {coin}",
    },
    "addmoney_desc_wallet": {
        "fr": "Ajouté **{amount:,}** {coin} au **portefeuille** de {mention}.\nNouveau portefeuille : **{new:,}** {coin}",
        "en": "Added **{amount:,}** {coin} to {mention}'s **wallet**.\nNew wallet: **{new:,}** {coin}",
    },
    "removemoney_title": {"fr": "Coins retirés", "en": "Coins Removed"},
    "removemoney_desc_bank": {
        "fr": "Retiré **{amount:,}** {coin} de la **banque** de {mention}.\nNouvelle banque : **{new:,}** {coin}",
        "en": "Removed **{amount:,}** {coin} from {mention}'s **bank**.\nNew bank: **{new:,}** {coin}",
    },
    "removemoney_desc_wallet": {
        "fr": "Retiré **{amount:,}** {coin} du **portefeuille** de {mention}.\nNouveau portefeuille : **{new:,}** {coin}",
        "en": "Removed **{amount:,}** {coin} from {mention}'s **wallet**.\nNew wallet: **{new:,}** {coin}",
    },
    "setmoney_title": {"fr": "Balance modifiée", "en": "Balance Set"},
    "setmoney_desc": {
        "fr": "Le portefeuille de {mention} a été fixé à **{amount:,}** {coin}.",
        "en": "{mention}'s wallet set to **{amount:,}** {coin}.",
    },
    "resetmoney_title": {"fr": "Balance réinitialisée", "en": "Balance Reset"},
    "resetmoney_desc": {
        "fr": "Le portefeuille et la banque de {mention} ont été réinitialisés à **0** {coin}.",
        "en": "{mention}'s wallet and bank have been reset to **0** {coin}.",
    },
    # drop-money
    "drop_title": {"fr": "💰 Drop de coins !", "en": "💰 Coin Drop!"},
    "drop_desc": {
        "fr": "**{amount:,} {coin}** ont été lâchés dans le salon !\nSois le premier à les ramasser.",
        "en": "**{amount:,} {coin}** dropped in the channel!\nBe the first to grab them.",
    },
    "drop_claimed": {
        "fr": "💰 **{mention}** a ramassé **{amount:,} {coin}** !",
        "en": "💰 **{mention}** grabbed **{amount:,} {coin}**!",
    },
    "drop_expired": {
        "fr": "⌛ Personne n'a ramassé les coins — ils ont disparu.",
        "en": "⌛ Nobody grabbed the coins — they vanished.",
    },
    "drop_btn": {"fr": "💰 Ramasser !", "en": "💰 Grab!"},
    "drop_started": {
        "fr": "✅ Drop de **{amount:,} {coin}** lancé dans {channel}.",
        "en": "✅ Dropped **{amount:,} {coin}** in {channel}.",
    },
    # daily
    "daily_title": {"fr": "Récompense quotidienne", "en": "Daily Reward"},
    "daily_desc": {
        "fr": "Tu as réclamé **{amount:,}** coins !\nPortefeuille : **{wallet:,}** {coin}",
        "en": "You claimed **{amount:,}** coins!\nWallet: **{wallet:,}** {coin}",
    },
    "daily_footer": {
        "fr": "Reviens dans {h}h pour ta prochaine récompense.",
        "en": "Come back in {h}h for your next reward.",
    },
    "daily_cooldown": {
        "fr": "Tu as déjà réclamé ta récompense quotidienne. Reviens dans **{remaining}**.",
        "en": "You already claimed your daily reward. Come back in **{remaining}**.",
    },
    # work
    "work_title": {"fr": "Travail", "en": "Work"},
    "work_desc": {
        "fr": "Tu as {job} et gagné **{earned:,}** coins !\nPortefeuille : **{wallet:,}** {coin}",
        "en": "You {job} and earned **{earned:,}** coins!\nWallet: **{wallet:,}** {coin}",
    },
    "work_footer": {"fr": "Retravaille dans {h}h.", "en": "Work again in {h}h."},
    "work_cooldown": {
        "fr": "Tu es fatigué·e. Repose-toi **{remaining}** avant de retravailler.",
        "en": "You are tired. Rest for **{remaining}** before working again.",
    },
    "work_jobs_fr": [
        "livré des pizzas",
        "tondu des pelouses",
        "codé un site web",
        "promené des chiens",
        "réparé des ordinateurs",
        "rempli des rayons",
        "lavé des voitures",
        "donné des cours",
    ],
    "work_jobs_en": [
        "delivered pizzas",
        "mowed lawns",
        "coded a website",
        "walked dogs",
        "fixed computers",
        "stocked shelves",
        "washed cars",
        "taught classes",
    ],
    # crime
    "crime_cooldown": {
        "fr": "La police te surveille encore. Attends **{remaining}**.",
        "en": "The police are still watching you. Wait **{remaining}**.",
    },
    "crime_success_title": {"fr": "Crime réussi", "en": "Crime Succeeded"},
    "crime_success_desc": {
        "fr": "Tu as {crime} et tu t'en es sorti·e avec **{gained:,}** coins !\nPortefeuille : **{wallet:,}** {coin}",
        "en": "You {crime} and got away with **{gained:,}** coins!\nWallet: **{wallet:,}** {coin}",
    },
    "crime_fail_title": {"fr": "Crime échoué", "en": "Crime Failed"},
    "crime_fail_desc": {
        "fr": "Tu as été pris·e et payé une amende de **{fine:,}** coins !\nPortefeuille : **{wallet:,}** {coin}",
        "en": "You got caught and paid a **{fine:,}** coin fine!\nWallet: **{wallet:,}** {coin}",
    },
    "crime_footer": {"fr": "Réessaie dans {h}h.", "en": "Try again in {h}h."},
    "crime_crimes_fr": [
        "braqué une boutique",
        "piraté un serveur",
        "arnaqué un trader",
        "pickpocketé quelqu'un",
    ],
    "crime_crimes_en": [
        "robbed a store",
        "hacked a server",
        "scammed a trader",
        "picked a pocket",
    ],
    # deposit / withdraw
    "deposit_title": {"fr": "Dépôt", "en": "Deposit"},
    "deposit_desc": {
        "fr": "Déposé **{amount:,}** {coin} en banque.",
        "en": "Deposited **{amount:,}** {coin} into the bank.",
    },
    "withdraw_title": {"fr": "Retrait", "en": "Withdraw"},
    "withdraw_desc": {
        "fr": "Retiré **{amount:,}** {coin} de la banque.",
        "en": "Withdrew **{amount:,}** {coin} from the bank.",
    },
    # give
    "give_title": {"fr": "Transfert", "en": "Transfer"},
    "give_desc": {
        "fr": "Tu as donné **{amount:,}** {coin} à {mention}.",
        "en": "You gave **{amount:,}** {coin} to {mention}.",
    },
    # leaderboard
    "lb_title": {"fr": "Classement — Top 10", "en": "Leaderboard — Top 10"},
    "lb_empty": {"fr": "Aucun joueur pour l'instant.", "en": "No players yet."},
    "lb_err": {
        "fr": "Impossible de charger le classement en ce moment.",
        "en": "Could not load leaderboard right now.",
    },
    # level / xp
    "lvl_title": {"fr": "Niveau — {name}", "en": "Level — {name}"},
    "lvl_level": {"fr": "Niveau", "en": "Level"},
    "lvl_xp": {"fr": "XP total", "en": "Total XP"},
    "lvl_top_title": {
        "fr": "🏅 Classement Niveaux — Top 10",
        "en": "🏅 Level Leaderboard — Top 10",
    },
    "lvl_top_empty": {
        "fr": "Aucun joueur avec de l'XP pour l'instant.",
        "en": "No players with XP yet.",
    },
    "lvl_top_err": {
        "fr": "Impossible de charger le classement en ce moment.",
        "en": "Could not load leaderboard right now.",
    },
    # errors / generic
    "err_generic": {
        "fr": "Une erreur est survenue. Réessaie dans un instant.",
        "en": "An error occurred. Please try again in a moment.",
    },
    # admin level management
    "addlevel_title": {"fr": "✅ Niveau ajouté", "en": "✅ Level Added"},
    "addlevel_desc": {
        "fr": "{mention} a reçu **+{amount}** niveau(x). Niveau actuel : **{new}**",
        "en": "{mention} received **+{amount}** level(s). Current level: **{new}**",
    },
    "removelevel_title": {"fr": "✅ Niveau retiré", "en": "✅ Level Removed"},
    "removelevel_desc": {
        "fr": "{mention} a perdu **{amount}** niveau(x). Niveau actuel : **{new}**",
        "en": "{mention} lost **{amount}** level(s). Current level: **{new}**",
    },
    "resetlevel_title": {"fr": "🔄 Niveau réinitialisé", "en": "🔄 Level Reset"},
    "resetlevel_desc": {
        "fr": "Le niveau et l'XP de {mention} ont été remis à 0.",
        "en": "{mention}'s level and XP have been reset to 0.",
    },
    # blackjack
    "bj_dealer_hidden": {"fr": "Croupier (caché)", "en": "Dealer (hidden)"},
    "bj_dealer_shown": {"fr": "Croupier — {total}", "en": "Dealer — {total}"},
    "bj_you": {"fr": "Toi — {total}", "en": "You — {total}"},
    "bj_bet_footer": {"fr": "Mise : {bet} {coin}", "en": "Bet: {bet} {coin}"},
    "bj_wallet_footer": {
        "fr": "Portefeuille : {wallet:,} {coin}",
        "en": "Wallet: {wallet:,} {coin}",
    },
    "bj_bust": {
        "fr": "💥 Bust ! Tu perds **{bet:,}** {coin}.",
        "en": "💥 Bust! You lost **{bet:,}** {coin}.",
    },
    "bj_win": {
        "fr": "🏆 Tu gagnes **{bet:,}** {coin} !",
        "en": "🏆 You win **{bet:,}** {coin}!",
    },
    "bj_push": {
        "fr": "🤝 Égalité — ta mise est remboursée.",
        "en": "🤝 Push — your bet is returned.",
    },
    "bj_lose": {
        "fr": "😞 Croupier gagne. Tu perds **{bet:,}** {coin}.",
        "en": "😞 Dealer wins. You lost **{bet:,}** {coin}.",
    },
    "bj_blackjack": {
        "fr": "🎉 Blackjack ! Tu gagnes **{delta:,}** {coin} !",
        "en": "🎉 Blackjack! You win **{delta:,}** {coin}!",
    },
    "bj_bet_range": {
        "fr": "La mise doit être entre {min:,} et {max:,} {coin}.",
        "en": "Bet must be between {min:,} and {max:,} {coin}.",
    },
    "bj_hit": {"fr": "Tirer", "en": "Hit"},
    "bj_stand": {"fr": "Rester", "en": "Stand"},
    # higher-lower
    "hl_title": {"fr": "🔢 Plus haut ou plus bas", "en": "🔢 Higher or Lower"},
    "hl_desc": {
        "fr": "Nombre actuel : **{current}**\nLe suivant sera-t-il plus haut ou plus bas ?\n\nSérie : **{streak}**",
        "en": "Current number: **{current}**\nWill the next number be higher or lower?\n\nStreak: **{streak}**",
    },
    "hl_correct": {
        "fr": "✅ Correct ! Le nombre était **{next}**",
        "en": "✅ Correct! The number was **{next}**",
    },
    "hl_correct_desc": {
        "fr": "Série : **{streak}** 🔥  ·  💰 +**{reward:,}** {coin}",
        "en": "Streak: **{streak}** 🔥  ·  💰 +**{reward:,}** {coin}",
    },
    "hl_wrong": {
        "fr": "❌ Faux ! Le nombre était **{next}**",
        "en": "❌ Wrong! The number was **{next}**",
    },
    "hl_wrong_desc": {
        "fr": "Série finale : **{streak}**  ·  💰 Total : **{total:,}** {coin} gagnés",
        "en": "Final streak: **{streak}**  ·  💰 Total earned: **{total:,}** {coin}",
    },
    "hl_higher": {"fr": "Plus haut", "en": "Higher"},
    "hl_lower": {"fr": "Plus bas", "en": "Lower"},
    # roulette
    "rl_title": {"fr": "🎰 Roulette", "en": "🎰 Roulette"},
    "rl_desc": {
        "fr": "Mise : **{bet:,}** coins\nChoisis une couleur pour lancer !",
        "en": "Bet: **{bet:,}** coins\nChoose a colour to spin!",
    },
    "rl_payouts": {"fr": "Gains", "en": "Payouts"},
    "rl_win": {
        "fr": "🎰 {emoji} {result} — Tu gagnes **{win:,}** {coin} !",
        "en": "🎰 {emoji} {result} — You win **{win:,}** {coin}!",
    },
    "rl_lose": {
        "fr": "🎰 {emoji} {result} — Tu perds **{bet:,}** {coin}.",
        "en": "🎰 {emoji} {result} — You lost **{bet:,}** {coin}.",
    },
    "rl_result_desc": {
        "fr": "Tu as misé **{choice}** avec **{bet:,}** coins.\nPortefeuille : **{wallet:,}** {coin}",
        "en": "You bet **{choice}** with **{bet:,}** coins.\nWallet: **{wallet:,}** {coin}",
    },
    "rl_red": {"fr": "rouge", "en": "red"},
    "rl_black": {"fr": "noir", "en": "black"},
    "rl_green": {"fr": "vert", "en": "green"},
    "rl_bet_range": {
        "fr": "La mise doit être entre {min:,} et {max:,} {coin}.",
        "en": "Bet must be between {min:,} and {max:,} {coin}.",
    },
    "rl_red_btn": {"fr": "Rouge  (2x)", "en": "Red  (2x)"},
    "rl_black_btn": {"fr": "Noir  (2x)", "en": "Black  (2x)"},
    "rl_green_btn": {"fr": "Vert / 0  (14x)", "en": "Green / 0  (14x)"},
    # guess-number
    "gn_title": {"fr": "🔢 Devine le nombre !", "en": "🔢 Guess the Number!"},
    "gn_desc": {
        "fr": "J'ai choisi un nombre entre **{min}** et **{max}**.\n📝 Écrivez votre nombre directement dans ce salon pour participer !\nLe premier qui trouve gagne — spam autorisé !",
        "en": "I picked a number between **{min}** and **{max}**.\n📝 Just type your number in this channel to play!\nFirst to find it wins — spam allowed!",
    },
    "gn_secret_info": {
        "fr": "🔢 Le nombre secret est **{number}** (entre {min} et {max}).\nSeul toi peux voir ce message.",
        "en": "🔢 The secret number is **{number}** (between {min} and {max}).\nOnly you can see this message.",
    },
    "gn_started_footer": {
        "fr": "Jeu lancé par {starter}",
        "en": "Game started by {starter}",
    },
    "gn_win_title": {"fr": "🎉 Trouvé !", "en": "🎉 Found it!"},
    "gn_win": {
        "fr": "{winner} a trouvé le nombre !\nC'était **{number}**.",
        "en": "{winner} found the number!\nIt was **{number}**.",
    },
    "gn_win_participants": {"fr": "👥 Participants", "en": "👥 Participants"},
    "gn_win_attempts": {"fr": "🎯 Tentatives totales", "en": "🎯 Total attempts"},
    "gn_end_title": {"fr": "🛑 Jeu arrêté", "en": "🛑 Game stopped"},
    "gn_end": {
        "fr": "Jeu arrêté par un admin.\nC'était **{number}**.",
        "en": "Game stopped by an admin.\nIt was **{number}**.",
    },
    "gn_already_running": {
        "fr": "❌ Une partie est déjà en cours dans ce salon.",
        "en": "❌ A game is already running in this channel.",
    },
    "gn_guess_btn": {"fr": "Deviner", "en": "Guess"},
    "gn_stop_not_running": {
        "fr": "❌ Aucune partie en cours dans ce salon.",
        "en": "❌ No game running in this channel.",
    },
    "err_not_your_game": {
        "fr": "❌ Ce n'est pas ta partie !",
        "en": "❌ This isn't your game!",
    },
    # pile-ou-face
    "pof_title": {"fr": "🪙 Pile ou Face", "en": "🪙 Coin Flip"},
    "pof_desc": {
        "fr": "Mise : **{amount:,} {coin}**\nChoisis Pile ou Face !",
        "en": "Bet: **{amount:,} {coin}**\nChoose Heads or Tails!",
    },
    "pof_heads": {"fr": "Pile", "en": "Heads"},
    "pof_tails": {"fr": "Face", "en": "Tails"},
    "pof_win": {
        "fr": "{result_emoji} **{result}** ! Tu gagnes **{amount:,} {coin}** !",
        "en": "{result_emoji} **{result}**! You win **{amount:,} {coin}**!",
    },
    "pof_lose": {
        "fr": "{result_emoji} **{result}** ! Tu perds **{amount:,} {coin}**.",
        "en": "{result_emoji} **{result}**! You lose **{amount:,} {coin}**.",
    },
    "pof_heads_btn": {"fr": "🪙 Pile", "en": "🪙 Heads"},
    "pof_tails_btn": {"fr": "🎭 Face", "en": "🎭 Tails"},
    "pof_bet_range": {
        "fr": "La mise doit être entre {min:,} et {max:,} {coin}.",
        "en": "Bet must be between {min:,} and {max:,} {coin}.",
    },
    "pof_wallet_footer": {
        "fr": "Portefeuille : {wallet:,} {coin}",
        "en": "Wallet: {wallet:,} {coin}",
    },
    # slots
    "sl_title": {"fr": "🎰 Machines à sous", "en": "🎰 Slot Machine"},
    "sl_desc": {
        "fr": "Mise : **{amount:,} {coin}**\nLes rouleaux tournent…",
        "en": "Bet: **{amount:,} {coin}**\nReels are spinning…",
    },
    "sl_jackpot": {
        "fr": "🎉 JACKPOT ! {display}\n3× {sym} — Tu gagnes **{win:,} {coin}** ({multiplier}x) !",
        "en": "🎉 JACKPOT! {display}\n3× {sym} — You win **{win:,} {coin}** ({multiplier}x)!",
    },
    "sl_two_kind": {
        "fr": "😐 Paire ! {display}\nTu perds seulement **{loss:,} {coin}**.",
        "en": "😐 Two of a kind! {display}\nYou only lose **{loss:,} {coin}**.",
    },
    "sl_lose": {
        "fr": "💸 Raté ! {display}\nTu perds **{amount:,} {coin}**.",
        "en": "💸 Miss! {display}\nYou lose **{amount:,} {coin}**.",
    },
    "sl_bet_range": {
        "fr": "La mise doit être entre {min:,} et {max:,} {coin}.",
        "en": "Bet must be between {min:,} and {max:,} {coin}.",
    },
    "sl_wallet_footer": {
        "fr": "Portefeuille : {wallet:,} {coin}",
        "en": "Wallet: {wallet:,} {coin}",
    },
    "sl_payouts": {"fr": "💡 Gains possibles", "en": "💡 Possible Payouts"},
    "sl_payouts_desc": {
        "fr": "💎×3 → 20x · ⭐×3 → 10x · 🍀×3 → 6x\n🍇×3 → 4x · 🍊×3 → 3x · 🍋×3 → 2.5x · 🍒×3 → 2x\nPaire → perd 50%",
        "en": "💎×3 → 20x · ⭐×3 → 10x · 🍀×3 → 6x\n🍇×3 → 4x · 🍊×3 → 3x · 🍋×3 → 2.5x · 🍒×3 → 2x\nTwo of a kind → lose 50%",
    },
    # dice
    "dice_title": {"fr": "🎲 Jeu de Dés", "en": "🎲 Dice Game"},
    "dice_desc": {
        "fr": "Mise : **{amount:,} {coin}**\nChoisis ta zone avant le lancer !",
        "en": "Bet: **{amount:,} {coin}**\nChoose your zone before the roll!",
    },
    "dice_win": {
        "fr": "🎲 {dice}\n💰 Tu gagnes **{amount:,} {coin}** !",
        "en": "🎲 {dice}\n💰 You win **{amount:,} {coin}**!",
    },
    "dice_lose": {
        "fr": "🎲 {dice}\n😞 Tu perds **{amount:,} {coin}**.",
        "en": "🎲 {dice}\n😞 You lose **{amount:,} {coin}**.",
    },
    "dice_bet_range": {
        "fr": "La mise doit être entre {min:,} et {max:,} {coin}.",
        "en": "Bet must be between {min:,} and {max:,} {coin}.",
    },
    "dice_wallet_footer": {
        "fr": "Portefeuille : {wallet:,} {coin}",
        "en": "Wallet: {wallet:,} {coin}",
    },
    "dice_payouts": {"fr": "📊 Gains", "en": "📊 Payouts"},
    "dice_payouts_desc": {
        "fr": "**Bas (≤6)** → ×2  ·  **7 exact** → ×4  ·  **Haut (≥8)** → ×2",
        "en": "**Low (≤6)** → ×2  ·  **Lucky 7** → ×4  ·  **High (≥8)** → ×2",
    },
    "dice_low_btn": {"fr": "⬇️ Bas (≤6)  ×2", "en": "⬇️ Low (≤6)  ×2"},
    "dice_seven_btn": {"fr": "🍀 7 exact  ×4", "en": "🍀 Lucky 7  ×4"},
    "dice_high_btn": {"fr": "⬆️ Haut (≥8)  ×2", "en": "⬆️ High (≥8)  ×2"},
    # shop
    "shop_err": {
        "fr": "Impossible de charger le shop pour l'instant.",
        "en": "Could not load the shop right now.",
    },
    "shop_empty": {
        "fr": "Le shop est vide pour l'instant.",
        "en": "The shop is empty for now.",
    },
    "shop_title": {"fr": "🛒 Shop", "en": "🛒 Shop"},
    "shop_desc": {
        "fr": "Utilise `/buy <item>` pour acheter. Prix en **{coin}**.",
        "en": "Use `/buy <item>` to purchase. Prices in **{coin}**.",
    },
    "shop_role_note": {
        "fr": "\n*Accorde <@&{role_id}>*",
        "en": "\n*Grants <@&{role_id}>*",
    },
    # buy
    "buy_err": {
        "fr": "Impossible de joindre le shop.",
        "en": "Could not reach the shop right now.",
    },
    "buy_not_found": {"fr": "Item introuvable.", "en": "Item not found."},
    "buy_unavailable": {
        "fr": "Cet item est actuellement indisponible.",
        "en": "This item is currently unavailable.",
    },
    "buy_insufficient": {
        "fr": "Il te faut **{price:,}** {coin} mais tu n'as que **{wallet:,}** {coin} dans ton portefeuille.",
        "en": "You need **{price:,}** {coin} but only have **{wallet:,}** {coin} in your wallet.",
    },
    "buy_title": {
        "fr": "{emoji} Achat confirmé !",
        "en": "{emoji} Purchase confirmed!",
    },
    "buy_desc": {
        "fr": "Tu as acheté **{name}** pour **{price:,}** {coin}.",
        "en": "You bought **{name}** for **{price:,}** {coin}.",
    },
    "buy_wallet": {"fr": "Portefeuille", "en": "Wallet"},
    "buy_role": {"fr": "Rôle accordé", "en": "Role granted"},
    # inventory
    "inv_empty_self": {
        "fr": "📦 Ton inventaire est vide.",
        "en": "📦 Your inventory is empty.",
    },
    "inv_empty_other": {
        "fr": "📦 {name} n'a aucun item.",
        "en": "📦 {name} has no items.",
    },
    "inv_title": {"fr": "📦 Inventaire de {name}", "en": "📦 {name}'s inventory"},
    "inv_src_buy": {"fr": "achat", "en": "purchase"},
    "inv_src_giveaway": {"fr": "giveaway", "en": "giveaway"},
    "inv_src_admin": {"fr": "admin", "en": "admin"},
    # /give-item
    "gi_title": {"fr": "🎁 Item offert", "en": "🎁 Item given"},
    "gi_desc": {
        "fr": "{emoji} **{name}** ×{qty} offert à {mention}.",
        "en": "{emoji} **{name}** ×{qty} given to {mention}.",
    },
    "gi_role": {"fr": "Rôle accordé", "en": "Role granted"},
    "gi_not_found": {
        "fr": "❌ Item introuvable. Utilise l'autocomplétion pour en choisir un.",
        "en": "❌ Item not found. Use autocomplete to select one.",
    },
    "gi_err": {
        "fr": "❌ Impossible d'ajouter l'item à l'inventaire.",
        "en": "❌ Could not add the item to the inventory.",
    },
    "gi_no_items": {
        "fr": "❌ Aucun item dans le shop. Crée-en un d'abord.",
        "en": "❌ No items in the shop. Create one first.",
    },
    "gi_notify": {
        "fr": "🎁 Tu as reçu {emoji} **{name}** ×{qty} offert par un admin !",
        "en": "🎁 You received {emoji} **{name}** ×{qty} from an admin!",
    },
    # /config
    "config_lang_set": {
        "fr": "✅ Langue changée en **Français** 🇫🇷",
        "en": "✅ Language changed to **English** 🇬🇧",
    },
    "config_lang_already": {
        "fr": "La langue est déjà réglée sur **{lang}**.",
        "en": "The language is already set to **{lang}**.",
    },
    # /set-rdm-msg
    "rdm_cfg_saved": {
        "fr": "✅ Messages aléatoires configurés !",
        "en": "✅ Random messages configured!",
    },
    "rdm_cfg_enabled": {
        "fr": "✅ Messages aléatoires **activés**.",
        "en": "✅ Random messages **enabled**.",
    },
    "rdm_cfg_disabled": {
        "fr": "✅ Messages aléatoires **désactivés**.",
        "en": "✅ Random messages **disabled**.",
    },
    "rdm_msg_added": {"fr": "Message ajouté au pool", "en": "Message added to pool"},
    "rdm_msg_removed": {
        "fr": "✅ Message supprimé du pool.",
        "en": "✅ Message removed from pool.",
    },
    "rdm_msg_not_found": {
        "fr": "❌ Aucun message avec cet ID.",
        "en": "❌ No message with that ID.",
    },
    "rdm_list_empty": {
        "fr": "❌ Le pool de messages est vide. Ajoute des messages avec `/rdm add`.",
        "en": "❌ The message pool is empty. Add messages with `/rdm add`.",
    },
    "rdm_list_title": {
        "fr": "Pool de messages aléatoires",
        "en": "Random message pool",
    },
    # command suggestion templates (random picks, {coin} substituted)
    "rdm_cmd_suggestions_fr": [
        "💰 Rappel : tu n'as pas encore fait ton `/daily` aujourd'hui !",
        "⚒️ Un peu de travail ? Lance `/work` pour gagner des {coin} !",
        "🔫 Tente ta chance avec `/crime` — ça peut rapporter gros.",
        "🃏 Envie de jouer ? `/blackjack`, `/roulette` ou `/higher-lower` t'attendent !",
        "🏦 Pense à déposer tes {coin} avec `/deposit` pour les garder en sécurité.",
        "🛒 Découvre les objets disponibles dans le `/shop` !",
        "🏆 Consulte le `/leaderboard` pour voir où tu te classes !",
        "🎁 Des giveaways sont peut-être en cours — reste à l'affût !",
    ],
    "rdm_cmd_suggestions_en": [
        "💰 Reminder: you haven't claimed your `/daily` yet today!",
        "⚒️ Need coins? Run `/work` to earn some!",
        "🔫 Feeling lucky? Try `/crime` — it can pay off big.",
        "🃏 Up for a game? `/blackjack`, `/roulette` or `/higher-lower` are waiting!",
        "🏦 Remember to `/deposit` your {coin} to keep them safe.",
        "🛒 Check out what's available in the `/shop`!",
        "🏆 Check the `/leaderboard` to see where you stand!",
        "🎁 Giveaways might be running — stay tuned!",
    ],
    # ── Tickets ───────────────────────────────────────────────────────────────
    "tkt_already_open": {
        "fr": "❌ Vous avez déjà un ticket ouvert : {channel}",
        "en": "❌ You already have an open ticket: {channel}",
    },
    "tkt_created": {
        "fr": "🎫 Ticket créé : {channel}",
        "en": "🎫 Ticket created: {channel}",
    },
    "tkt_disabled": {
        "fr": "❌ Le système de tickets est désactivé.",
        "en": "❌ The ticket system is disabled.",
    },
    "tkt_not_configured": {
        "fr": "❌ Système de tickets non configuré. Vérifiez le dashboard.",
        "en": "❌ Ticket system not configured. Check the dashboard.",
    },
    "tkt_closing": {
        "fr": "🔒 Ticket fermé par {user}. Ce salon sera supprimé dans 5 secondes.",
        "en": "🔒 Ticket closed by {user}. This channel will be deleted in 5 seconds.",
    },
    "tkt_setup_done": {
        "fr": "✅ Embed envoyé dans {channel}.",
        "en": "✅ Embed sent to {channel}.",
    },
    "tkt_setup_err_channel": {
        "fr": "❌ Salon introuvable (`{channel_id}`). Configurez l'ID dans le dashboard.",
        "en": "❌ Channel not found (`{channel_id}`). Set the correct ID in the dashboard.",
    },
    "tkt_close_not_ticket": {
        "fr": "❌ Ce salon n'est pas un ticket ouvert.",
        "en": "❌ This channel is not an open ticket.",
    },
    "tkt_add_done": {
        "fr": "✅ {user} ajouté au ticket.",
        "en": "✅ {user} added to the ticket.",
    },
    "tkt_add_err": {
        "fr": "❌ Impossible d'ajouter {user} au ticket.",
        "en": "❌ Could not add {user} to the ticket.",
    },
    "tkt_log_opened": {
        "fr": "🎫 **Ticket #{id}** ouvert par {user} → {channel}",
        "en": "🎫 **Ticket #{id}** opened by {user} → {channel}",
    },
    "tkt_log_closed": {
        "fr": "🔒 **Ticket #{id}** fermé par {closed_by}",
        "en": "🔒 **Ticket #{id}** closed by {closed_by}",
    },
}


def _t(key: str, **kwargs: object) -> str:
    """Return the translated string for the current bot language."""
    entry = STRINGS.get(key, {})
    if not isinstance(entry, dict):
        return key
    template: str = entry.get(_lang) or entry.get("en") or key
    if kwargs:
        try:
            return template.format(**kwargs)
        except (KeyError, ValueError):
            pass
    return template


def _tl(base_key: str) -> list[str]:
    """Return a translated list (e.g. job/crime lists) for the current language."""
    result = STRINGS.get(f"{base_key}_{_lang}")
    if not isinstance(result, list):
        result = STRINGS.get(f"{base_key}_en")
    return result or []


# ── Bot setup ─────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
intents.message_content = True
# NOTE: intents.members requires "Server Members Intent" enabled in the Discord
# Developer Portal (https://discord.com/developers/applications/).
# Set to True there AND uncomment the line below to activate role rewards.
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ── API helpers ───────────────────────────────────────────────────────────────

import os
import aiohttp
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Définition de l'API_BASE pour éviter le NameError et les crashs
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:10000/api")

# ── Global HTTP session (reused across all API calls) ─────────────────────────

_session: Optional[aiohttp.ClientSession] = None


async def get_http_session() -> aiohttp.ClientSession:
    """Return the shared aiohttp session, creating it if needed."""
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session


# ── Global HTTP session (reused across all API calls) ─────────────────────────

_session: Optional[aiohttp.ClientSession] = None


async def get_http_session() -> aiohttp.ClientSession:
    """Return the shared aiohttp session, creating it if needed."""
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session


async def api_post(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.post(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_patch(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.patch(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_delete(path: str) -> Optional[bool]:
    """Returns True on 204 success, False on 404, None on error."""
    try:
        s = await get_http_session()
        async with s.delete(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 204:
                return True
            if resp.status == 404:
                return False
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_put(path: str, payload: dict) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.put(
            f"{API_BASE}{path}", json=payload, timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.content_type == "application/json":
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_get_json(path: str) -> Optional[dict]:
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 200:
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def api_get_list(path: str) -> Optional[list]:
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}{path}", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 200:
                return await resp.json()
    except (aiohttp.ClientError, OSError, Exception):
        pass
    return None


async def log_to_api(level: str, message: str) -> None:
    await api_post("/bot/logs", {"level": level, "message": message})


async def send_heartbeat(connected: bool) -> None:
    payload = {
        "connected": connected,
        "botName": bot.user.name if bot.user else None,
        "botId": str(bot.user.id) if bot.user else None,
        "startedAt": _started_at.isoformat() if "_started_at" in globals() and _started_at else None,
        "lastReminderAt": _last_reminder_at.isoformat() if "_last_reminder_at" in globals() and _last_reminder_at else None,
        "remindersSentToday": _reminders_today if "_reminders_today" in globals() else 0,
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
            logger.error(
                "Reminder '%s': cannot access channel %s — %s",
                r["name"],
                channel_id,
                exc,
            )
            await log_to_api(
                "ERROR", f"Reminder '{r['name']}': cannot access channel {channel_id}"
            )
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
        logger.error(
            "Reminder '%s': no permission for channel %s", r["name"], channel_id
        )
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


async def refresh_random_activity() -> None:
    global _rdm_cfg, _rdm_messages, _rdm_next_send
    cfg = await api_get_json("/random-activity/config")
    if cfg:
        _rdm_cfg.update(cfg)
    msgs = await api_get_list("/random-activity/messages")
    if msgs is not None:
        _rdm_messages = msgs
    # Schedule first send if enabled and not yet scheduled
    if _rdm_cfg.get("enabled") and _rdm_next_send is None:
        delay = random.randint(
            _rdm_cfg.get("minIntervalMinutes", 30),
            max(
                _rdm_cfg.get("minIntervalMinutes", 30),
                _rdm_cfg.get("maxIntervalMinutes", 120),
            ),
        )
        _rdm_next_send = datetime.now(timezone.utc) + timedelta(minutes=delay)
        logger.info("Random activity: first message scheduled in %d min", delay)


async def refresh_economy_config() -> None:
    global _eco, _lang
    data = await api_get_json("/economy/config")
    if data:
        _eco.update(data)
        _lang = data.get("language", "fr")
        logger.info(
            "Economy config refreshed — currency: %s, lang: %s",
            _eco.get("currencyName", "coins"),
            _lang,
        )


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


async def refresh_ticket_config() -> None:
    global _tkts_cfg
    data = await api_get_json("/ticket/config")
    if data:
        _tkts_cfg.update(data)
        logger.info(
            "Ticket config refreshed — enabled: %s", _tkts_cfg.get("enabled", False)
        )


async def refresh_welcome_config() -> None:
    global _welcome_cfg
    data = await api_get_json("/welcome/config")
    if data:
        _welcome_cfg.update(data)
        logger.info(
            "Welcome config refreshed — join: %s, leave: %s",
            _welcome_cfg.get("joinEnabled"),
            _welcome_cfg.get("leaveEnabled"),
        )


async def refresh_custom_commands() -> None:
    global _custom_commands
    data = await api_get_json("/custom-commands")
    if isinstance(data, list):
        _custom_commands = data
        active = sum(1 for c in _custom_commands if c.get("enabled", True))
        logger.info(
            "Custom commands refreshed — %d total, %d active",
            len(_custom_commands),
            active,
        )


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

# Active guess-number games: channel_id → game state dict
_active_guess_games: dict[int, dict] = {}


@bot.event
async def on_message(message: discord.Message) -> None:
    """Award random coins for chat messages; also handles guess-number game."""
    # Ignore bots and DMs
    if message.author.bot or not message.guild:
        await bot.process_commands(message)
        return

    # ── Guess-number: detect a valid number typed in the channel ──────────────
    channel_id = message.channel.id
    if channel_id in _active_guess_games:
        game = _active_guess_games[channel_id]
        content = message.content.strip()
        try:
            guess = int(content)
            g_min = game.get("min", 1)
            g_max = game.get("max", 100)
            if g_min <= guess <= g_max:
                game["attempts"] += 1
                game["participants"].add(message.author.id)
                if guess == game["secret"]:
                    # Winner — remove game first to avoid race conditions
                    _active_guess_games.pop(channel_id, None)
                    if isinstance(message.channel, discord.TextChannel):
                        winner = (
                            message.author
                            if isinstance(message.author, discord.Member)
                            else None
                        )
                        await _gn_finish(message.channel, game, winner=winner)
                    return  # skip coins / process_commands for this message
        except ValueError:
            pass  # not a number — ignore for the game

    # ── Message reward ────────────────────────────────────────────────────────
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

    # ── Custom commands ────────────────────────────────────────────────────────
    await _handle_custom_commands(message)

    await bot.process_commands(message)


# ── Custom command handler ─────────────────────────────────────────────────────


def _apply_custom_vars(
    template: str,
    message: discord.Message,
    target: Optional[discord.Member] = None,
) -> str:
    """Replace custom command variables with runtime values."""
    author = message.author
    guild = message.guild
    ch = message.channel
    tgt = target or (author if isinstance(author, discord.Member) else author)
    return (
        template.replace("{user}", author.mention)
        .replace("{tag}", str(author))
        .replace("{name}", author.display_name)
        .replace("{server}", guild.name if guild else "")
        .replace("{channel}", ch.mention if hasattr(ch, "mention") else "")
        .replace("{target}", tgt.mention if hasattr(tgt, "mention") else str(tgt))
    )


def _resolve_reward_target(
    message: discord.Message,
    reward_target: str,
) -> Optional[discord.Member]:
    """Return the Member who should receive rewards.
    'mentioned' → first @mention in the message; returns None if no valid mention
                  (no fallback — reward is skipped when nobody is mentioned)
    'author'    → the message author
    """
    if reward_target == "mentioned":
        for m in message.mentions:
            if isinstance(m, discord.Member) and not m.bot:
                return m
        return None  # no valid mention → no reward
    if isinstance(message.author, discord.Member):
        return message.author
    return None


# In-memory guard: set of (cmd_id, author_id, target_id) already rewarded this session.
# Acts as a fast-path before the DB call and prevents races / double-fires.
_cc_rewarded: set[tuple] = set()


async def _claim_reward(cmd_id: int, author_id: int, target_id: int) -> bool:
    """Atomically claim a reward slot.
    Returns True  if this is the first time this (cmd, author, target) is rewarded.
    Returns False if already claimed, or if the DB call fails (fail-closed to avoid doubles).
    """
    key = (cmd_id, author_id, target_id)

    # Fast-path: already seen this session
    if key in _cc_rewarded:
        return False

    # api_post returns the JSON body regardless of status code (200 or 409 both send JSON).
    # On network error it returns None → fail-closed.
    result = await api_post(
        f"/custom-commands/{cmd_id}/claim-reward",
        {"authorId": str(author_id), "targetId": str(target_id)},
    )
    if result is None:
        return False  # network error → fail-closed, no reward
    granted = result.get("granted", False)
    if granted:
        _cc_rewarded.add(key)
    return granted


async def _apply_rewards(
    cmd: dict,
    target: discord.Member,
    message: discord.Message,
) -> None:
    """Give the configured rewards (role / money / XP / levels) to *target*.
    Guards against duplicate grants via DB-level unique constraint.
    """
    guild = message.guild
    if guild is None:
        return

    # ── Deduplication check ───────────────────────────────────────────────────
    cmd_id = cmd.get("id")
    author_id = message.author.id
    target_id = target.id

    if cmd_id is not None:
        granted = await _claim_reward(cmd_id, author_id, target_id)
        if not granted:
            # Already rewarded this exact pair — skip silently
            return

    # ── Role ─────────────────────────────────────────────────────────────────
    role_id = cmd.get("rewardRoleId", "").strip()
    if role_id:
        role = guild.get_role(int(role_id)) if role_id.isdigit() else None
        if role and role not in target.roles:
            try:
                await target.add_roles(role, reason="Commande personnalisée")
            except discord.Forbidden:
                pass

    # ── Money ─────────────────────────────────────────────────────────────────
    money = int(cmd.get("rewardMoney", 0))
    if money > 0:
        try:
            eco = await get_economy(target)
            await set_wallet(target.id, eco["wallet"] + money)
        except Exception:
            pass

    # ── XP and Levels ─────────────────────────────────────────────────────────
    xp_gain = int(cmd.get("rewardXp", 0))
    level_gain = int(cmd.get("rewardLevels", 0))
    if xp_gain > 0 or level_gain > 0:
        try:
            eco = await get_economy(target)
            new_xp = eco.get("xp", 0) + xp_gain
            new_level = eco.get("level", 0) + level_gain
            await api_patch(
                f"/economy/players/{target.id}",
                {"xp": new_xp, "level": new_level},
            )
        except Exception:
            pass


async def _handle_custom_commands(message: discord.Message) -> None:
    """Check all custom commands and respond if one matches."""
    if not _custom_commands:
        return

    now = time.monotonic()

    for cmd in _custom_commands:
        if not cmd.get("enabled", True):
            continue

        trigger = cmd.get("trigger", "")
        match_mode = cmd.get("matchMode", "exact")
        case_sens = cmd.get("caseSensitive", False)

        cmp_content = message.content if case_sens else message.content.lower()
        cmp_trigger = trigger if case_sens else trigger.lower()

        if match_mode == "exact":
            matched = cmp_content == cmp_trigger
        elif match_mode == "startswith":
            matched = cmp_content.startswith(cmp_trigger)
        elif match_mode == "contains":
            matched = cmp_trigger in cmp_content
        else:
            matched = False

        if not matched:
            continue

        # Check allowed channels (empty = all)
        allowed_channels = [
            c.strip() for c in cmd.get("allowedChannels", "").split(",") if c.strip()
        ]
        if allowed_channels and str(message.channel.id) not in allowed_channels:
            continue

        # Check allowed roles (empty = all)
        allowed_roles = [
            r.strip() for r in cmd.get("allowedRoles", "").split(",") if r.strip()
        ]
        if allowed_roles and isinstance(message.author, discord.Member):
            user_role_ids = {str(r.id) for r in message.author.roles}
            if not any(r in user_role_ids for r in allowed_roles):
                continue

        # Check per-user cooldown
        cooldown = int(cmd.get("cooldownSeconds", 0))
        cmd_id = cmd["id"]
        key = (cmd_id, message.author.id)
        if cooldown > 0 and now - _cc_cooldowns.get(key, 0.0) < cooldown:
            continue

        _cc_cooldowns[key] = now

        # Optionally delete the trigger message
        if cmd.get("deleteUserMessage", False):
            try:
                await message.delete()
            except Exception:
                pass

        # Resolve reward target (needed for {target} variable too)
        reward_target_str = cmd.get("rewardTarget", "mentioned")
        target_member = _resolve_reward_target(message, reward_target_str)

        # If this command requires a mention and none was given, skip entirely.
        # This prevents the response firing with {target}={author} (confusing)
        # and ensures the author never accidentally receives the reward.
        if (
            cmd.get("rewardEnabled", False)
            and reward_target_str == "mentioned"
            and target_member is None
        ):
            continue

        response_text = _apply_custom_vars(
            cmd.get("response", ""), message, target=target_member
        )
        reply_mode = cmd.get("replyToUser", False) and not cmd.get(
            "deleteUserMessage", False
        )

        if cmd.get("responseType", "message") == "embed":
            raw_color = cmd.get("embedColor", "5865F2").lstrip("#")
            try:
                color = int(raw_color, 16)
            except ValueError:
                color = 0x5865F2
            embed = discord.Embed(
                title=cmd.get("embedTitle") or None,
                description=response_text or None,
                colour=color,
            )
            footer_text = cmd.get("embedFooter", "")
            if footer_text:
                embed.set_footer(
                    text=_apply_custom_vars(footer_text, message, target=target_member)
                )
            if reply_mode:
                await message.reply(embed=embed)
            else:
                await message.channel.send(embed=embed)
        else:
            if reply_mode:
                await message.reply(response_text)
            else:
                await message.channel.send(response_text)

        # Apply rewards after sending the response
        if cmd.get("rewardEnabled", False) and target_member is not None:
            await _apply_rewards(cmd, target_member, message)

        break  # Only the first matching command fires


# ── Welcome / Leave embeds ────────────────────────────────────────────────────


def _apply_vars(template: str, member: discord.Member) -> str:
    """Replace embed variables with actual member/server values."""
    guild = member.guild
    count = guild.member_count or 0
    return (
        template.replace("{mention}", member.mention)
        .replace("{user}", member.display_name)
        .replace("{tag}", str(member))
        .replace("{server}", guild.name)
        .replace("{count}", str(count))
    )


async def _send_welcome_embed(member: discord.Member, kind: str) -> None:
    """Send a join or leave embed for *member*. kind = 'join' | 'leave'."""
    prefix = "join" if kind == "join" else "leave"
    if not _welcome_cfg.get(f"{prefix}Enabled"):
        return

    channel_id = _welcome_cfg.get(f"{prefix}ChannelId", "")
    if not channel_id:
        return

    try:
        channel = member.guild.get_channel(int(channel_id))
        if channel is None or not hasattr(channel, "send"):
            return
    except (ValueError, TypeError):
        return

    raw_color = _welcome_cfg.get(f"{prefix}EmbedColor", "")
    try:
        color_int = (
            int(raw_color.lstrip("#"), 16)
            if raw_color
            else (0x57F287 if kind == "join" else 0xED4245)
        )
    except ValueError:
        color_int = 0x57F287 if kind == "join" else 0xED4245

    title = _apply_vars(_welcome_cfg.get(f"{prefix}EmbedTitle", ""), member)
    desc = _apply_vars(_welcome_cfg.get(f"{prefix}EmbedDescription", ""), member)
    footer = _apply_vars(_welcome_cfg.get(f"{prefix}EmbedFooter", ""), member)

    embed = discord.Embed(colour=color_int)
    if title:
        embed.title = title
    if desc:
        embed.description = desc
    if footer:
        embed.set_footer(text=footer)

    show_avatar = _welcome_cfg.get(f"{prefix}ShowAvatar", True)
    if show_avatar:
        avatar_url = member.display_avatar.url
        embed.set_thumbnail(url=avatar_url)

    try:
        await channel.send(embed=embed)
    except Exception:
        logger.exception("Failed to send %s embed for %s", kind, member)


@bot.event
async def on_member_join(member: discord.Member) -> None:
    await _send_welcome_embed(member, "join")


@bot.event
async def on_member_remove(member: discord.Member) -> None:
    await _send_welcome_embed(member, "leave")


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
        reward = rule.get("rewardRoleId", "")
        remove = rule.get("removeRoleId") or ""
        if not trigger or not reward:
            continue
        if trigger not in added_ids:
            continue
        try:
            # Add reward role (if configured and not already present)
            if reward and not any(str(r.id) == reward for r in after.roles):
                reward_role = guild.get_role(int(reward))
                if reward_role is not None:
                    await after.add_roles(
                        reward_role, reason=f"Role reward: trigger <@&{trigger}>"
                    )
                    msg = f"Role reward: {after} +<@&{reward}> (trigger <@&{trigger}>)"
                    logger.info(msg)
                    await log_to_api("INFO", msg)

            # Remove role (if configured and member still has it)
            if remove and any(str(r.id) == remove for r in after.roles):
                remove_role = guild.get_role(int(remove))
                if remove_role is not None:
                    await after.remove_roles(
                        remove_role, reason=f"Role removal: trigger <@&{trigger}>"
                    )
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
    result = await api_post(
        "/economy/players",
        {
            "userId": str(user.id),
            "username": user.display_name,
            "wallet": _eco["startingWallet"],
            "bank": 0,
        },
    )
    if result:
        return result
    return {
        "userId": str(user.id),
        "username": user.display_name,
        "wallet": 0,
        "bank": 0,
    }


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
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return False
    if cfg.get("adminOnly", False) and not is_admin(interaction):
        await interaction.response.send_message(
            _t("err_cmd_admin_only"), ephemeral=True
        )
        return False
    return True


# ── /balance ──────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="balance",
    description="Check your wallet and bank balance (or another player's)",
)
@app_commands.describe(
    player="Player to look up — leave empty to check your own balance"
)
async def balance(
    interaction: discord.Interaction, player: Optional[discord.Member] = None
) -> None:
    if not await check_cmd(interaction, "balance"):
        return
    target = player or interaction.user
    eco = await get_economy(target)
    colour = 0x3498DB if player else 0x2ECC71
    embed = discord.Embed(
        title=_t("bal_title", name=target.display_name), colour=colour
    )
    embed.add_field(
        name=_t("bal_wallet"), value=f"**{eco['wallet']:,}** {_coin()}", inline=True
    )
    embed.add_field(
        name=_t("bal_bank"), value=f"**{eco['bank']:,}** {_coin()}", inline=True
    )
    embed.add_field(
        name=_t("bal_total"),
        value=f"**{eco['wallet'] + eco['bank']:,}** {_coin()}",
        inline=True,
    )
    embed.add_field(name=_t("bal_rank"), value=f"🏆 **#{eco['rank']}**", inline=False)
    await interaction.response.send_message(embed=embed)


# ── /addmoney ─────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="addmoney", description="[Admin] Add coins to a player's wallet or bank"
)
@app_commands.describe(
    player="Target player", amount="Amount to add", location="Where to add the coins"
)
@app_commands.choices(
    location=[
        app_commands.Choice(name="Wallet", value="wallet"),
        app_commands.Choice(name="Bank", value="bank"),
    ]
)
async def addmoney(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
    location: app_commands.Choice[str] = None,  # type: ignore[assignment]
) -> None:
    if not await check_cmd(interaction, "addmoney"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    target = location.value if location else "wallet"
    eco = await get_economy(player)
    if target == "bank":
        new_bank = eco["bank"] + amount
        await set_bank(player.id, new_bank)
        embed = discord.Embed(
            title=_t("addmoney_title"),
            description=_t(
                "addmoney_desc_bank",
                amount=amount,
                coin=_coin(),
                mention=player.mention,
                new=new_bank,
            ),
            colour=0x2ECC71,
        )
        await log_to_api(
            "INFO",
            f"Admin {interaction.user} added {amount} {_coin()} to {player}'s bank (new bank: {new_bank})",
        )
    else:
        new_wallet = eco["wallet"] + amount
        await set_wallet(player.id, new_wallet)
        embed = discord.Embed(
            title=_t("addmoney_title"),
            description=_t(
                "addmoney_desc_wallet",
                amount=amount,
                coin=_coin(),
                mention=player.mention,
                new=new_wallet,
            ),
            colour=0x2ECC71,
        )
        await log_to_api(
            "INFO",
            f"Admin {interaction.user} added {amount} {_coin()} to {player}'s wallet (new wallet: {new_wallet})",
        )
    await interaction.followup.send(embed=embed)


# ── /removemoney ──────────────────────────────────────────────────────────────


@bot.tree.command(
    name="removemoney",
    description="[Admin] Remove coins from a player's wallet or bank",
)
@app_commands.describe(
    player="Target player",
    amount="Amount to remove",
    location="Where to remove the coins from",
)
@app_commands.choices(
    location=[
        app_commands.Choice(name="Wallet", value="wallet"),
        app_commands.Choice(name="Bank", value="bank"),
    ]
)
async def removemoney(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
    location: app_commands.Choice[str] = None,  # type: ignore[assignment]
) -> None:
    if not await check_cmd(interaction, "removemoney"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    target = location.value if location else "wallet"
    eco = await get_economy(player)
    if target == "bank":
        new_bank = max(0, eco["bank"] - amount)
        await set_bank(player.id, new_bank)
        embed = discord.Embed(
            title=_t("removemoney_title"),
            description=_t(
                "removemoney_desc_bank",
                amount=amount,
                coin=_coin(),
                mention=player.mention,
                new=new_bank,
            ),
            colour=0xE74C3C,
        )
        await log_to_api(
            "INFO",
            f"Admin {interaction.user} removed {amount} {_coin()} from {player}'s bank (new bank: {new_bank})",
        )
    else:
        new_wallet = max(0, eco["wallet"] - amount)
        await set_wallet(player.id, new_wallet)
        embed = discord.Embed(
            title=_t("removemoney_title"),
            description=_t(
                "removemoney_desc_wallet",
                amount=amount,
                coin=_coin(),
                mention=player.mention,
                new=new_wallet,
            ),
            colour=0xE74C3C,
        )
        await log_to_api(
            "INFO",
            f"Admin {interaction.user} removed {amount} {_coin()} from {player}'s wallet (new wallet: {new_wallet})",
        )
    await interaction.followup.send(embed=embed)


# ── /setmoney ─────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="setmoney", description="[Admin] Set a player's wallet to an exact amount"
)
@app_commands.describe(player="Target player", amount="New wallet amount")
async def setmoney(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 0],
) -> None:
    if not await check_cmd(interaction, "setmoney"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    await get_economy(player)
    await set_wallet(player.id, amount)
    embed = discord.Embed(
        title=_t("setmoney_title"),
        description=_t(
            "setmoney_desc", mention=player.mention, amount=amount, coin=_coin()
        ),
        colour=0xF1C40F,
    )
    await interaction.followup.send(embed=embed)
    await log_to_api(
        "INFO", f"Admin {interaction.user} set {player}'s wallet to {amount}"
    )


# ── /resetmoney ───────────────────────────────────────────────────────────────


@bot.tree.command(
    name="resetmoney", description="[Admin] Reset a player's wallet and bank to 0"
)
@app_commands.describe(player="Target player")
async def resetmoney(interaction: discord.Interaction, player: discord.Member) -> None:
    if not await check_cmd(interaction, "resetmoney"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    await get_economy(player)
    await set_both(player.id, 0, 0)
    embed = discord.Embed(
        title=_t("resetmoney_title"),
        description=_t("resetmoney_desc", mention=player.mention, coin=_coin()),
        colour=0xE74C3C,
    )
    await interaction.followup.send(embed=embed)
    await log_to_api("INFO", f"Admin {interaction.user} reset {player}'s balance to 0")


# ── /drop-money ───────────────────────────────────────────────────────────────


class DropView(discord.ui.View):
    """Single-use button: first member to click claims the dropped coins."""

    def __init__(self, amount: int, dropper_id: int) -> None:
        super().__init__(timeout=300)  # 5 min window
        self.amount = amount
        self.dropper_id = dropper_id
        self.claimed = False

    async def on_timeout(self) -> None:
        # Disable the button and update the embed to show nobody claimed it
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]
        if self.message:
            expired_embed = discord.Embed(
                title=_t("drop_title"),
                description=_t("drop_expired"),
                colour=0x95A5A6,
            )
            try:
                await self.message.edit(embed=expired_embed, view=self)
            except Exception:
                pass

    @discord.ui.button(label="💰 Ramasser !", style=discord.ButtonStyle.success)
    async def grab(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if self.claimed:
            await interaction.response.send_message(
                "❌ Trop tard, quelqu'un d'autre a déjà ramassé ces coins !",
                ephemeral=True,
            )
            return
        self.claimed = True
        self.stop()

        # Credit the claimer
        try:
            eco = await get_economy(interaction.user)
            await set_wallet(interaction.user.id, eco["wallet"] + self.amount)
        except Exception:
            self.claimed = False
            await interaction.response.send_message(
                "❌ Erreur lors de l'attribution des coins. Réessaie.", ephemeral=True
            )
            return

        # Update button label and disable it
        button.label = _t("drop_btn")
        button.disabled = True

        claimed_embed = discord.Embed(
            title=_t("drop_title"),
            description=_t(
                "drop_claimed",
                mention=interaction.user.mention,
                amount=self.amount,
                coin=_coin(),
            ),
            colour=0x2ECC71,
        )
        await interaction.response.edit_message(embed=claimed_embed, view=self)
        await log_to_api(
            "INFO",
            f"{interaction.user} grabbed a drop of {self.amount} {_coin()} (dropped by ID {self.dropper_id})",
        )


@bot.tree.command(
    name="drop-money",
    description="[Admin] Drop coins in the channel — first member to click claims them",
)
@app_commands.describe(
    amount="Amount of coins to drop",
    message="Optional flavour text shown on the drop embed",
)
async def drop_money(
    interaction: discord.Interaction,
    amount: app_commands.Range[int, 1],
    message: str = "",
) -> None:
    if not await check_cmd(interaction, "drop-money"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)

    desc = _t("drop_desc", amount=amount, coin=_coin())
    if message:
        desc = f"*{message}*\n\n{desc}"

    embed = discord.Embed(title=_t("drop_title"), description=desc, colour=0xF1C40F)
    embed.set_footer(text=f"Lancé par {interaction.user.display_name}")

    view = DropView(amount=amount, dropper_id=interaction.user.id)
    sent = await interaction.channel.send(embed=embed, view=view)  # type: ignore[union-attr]
    view.message = sent

    await interaction.followup.send(
        _t(
            "drop_started",
            amount=amount,
            coin=_coin(),
            channel=interaction.channel.mention,
        ),  # type: ignore[union-attr]
        ephemeral=True,
    )
    await log_to_api(
        "INFO",
        f"Admin {interaction.user} dropped {amount} {_coin()} in #{interaction.channel}",
    )


# ── /addlevel ─────────────────────────────────────────────────────────────────


@bot.tree.command(name="addlevel", description="[Admin] Add levels to a player")
@app_commands.describe(player="Target player", amount="Number of levels to add")
async def addlevel(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
) -> None:
    if not await check_cmd(interaction, "addlevel"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    eco = await get_economy(player)
    new_level = eco.get("level", 0) + amount
    new_xp = eco.get("xp", 0)
    await api_patch(f"/economy/players/{player.id}", {"level": new_level, "xp": new_xp})
    embed = discord.Embed(
        title=_t("addlevel_title"),
        description=_t(
            "addlevel_desc", mention=player.mention, amount=amount, new=new_level
        ),
        colour=0x2ECC71,
    )
    await interaction.followup.send(embed=embed)
    await log_to_api(
        "INFO",
        f"Admin {interaction.user} added {amount} level(s) to {player} (new level: {new_level})",
    )


# ── /removelevel ──────────────────────────────────────────────────────────────


@bot.tree.command(name="removelevel", description="[Admin] Remove levels from a player")
@app_commands.describe(player="Target player", amount="Number of levels to remove")
async def removelevel(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
) -> None:
    if not await check_cmd(interaction, "removelevel"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    eco = await get_economy(player)
    new_level = max(0, eco.get("level", 0) - amount)
    new_xp = eco.get("xp", 0)
    await api_patch(f"/economy/players/{player.id}", {"level": new_level, "xp": new_xp})
    embed = discord.Embed(
        title=_t("removelevel_title"),
        description=_t(
            "removelevel_desc", mention=player.mention, amount=amount, new=new_level
        ),
        colour=0xE74C3C,
    )
    await interaction.followup.send(embed=embed)
    await log_to_api(
        "INFO",
        f"Admin {interaction.user} removed {amount} level(s) from {player} (new level: {new_level})",
    )


# ── /resetlevel ───────────────────────────────────────────────────────────────


@bot.tree.command(
    name="resetlevel", description="[Admin] Reset a player's level and XP to 0"
)
@app_commands.describe(player="Target player")
async def resetlevel(interaction: discord.Interaction, player: discord.Member) -> None:
    if not await check_cmd(interaction, "resetlevel"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    await interaction.response.defer()
    await get_economy(player)
    await api_patch(f"/economy/players/{player.id}", {"level": 0, "xp": 0})
    embed = discord.Embed(
        title=_t("resetlevel_title"),
        description=_t("resetlevel_desc", mention=player.mention),
        colour=0xE74C3C,
    )
    await interaction.followup.send(embed=embed)
    await log_to_api(
        "INFO", f"Admin {interaction.user} reset {player}'s level and XP to 0"
    )


# ── /daily ────────────────────────────────────────────────────────────────────


@bot.tree.command(name="daily", description="Claim your daily coin reward")
async def daily(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "daily"):
        return
    if not _eco["dailyEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastDaily"), _eco["dailyCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            _t("daily_cooldown", remaining=fmt_td(remaining)), ephemeral=True
        )
        return
    amount = _eco["dailyAmount"]
    new_wallet = eco["wallet"] + amount
    await api_patch(
        f"/economy/players/{interaction.user.id}/daily", {"wallet": new_wallet}
    )
    embed = discord.Embed(
        title=_t("daily_title"),
        description=_t("daily_desc", amount=amount, wallet=new_wallet, coin=_coin()),
        colour=0xF1C40F,
    )
    embed.set_footer(text=_t("daily_footer", h=_eco["dailyCooldownHours"]))
    await interaction.response.send_message(embed=embed)


# ── /work ─────────────────────────────────────────────────────────────────────


@bot.tree.command(name="work", description="Work to earn coins")
async def work(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "work"):
        return
    if not _eco["workEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastWork"), _eco["workCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            _t("work_cooldown", remaining=fmt_td(remaining)), ephemeral=True
        )
        return
    earned = random.randint(_eco["workMinAmount"], _eco["workMaxAmount"])
    new_wallet = eco["wallet"] + earned
    await api_patch(
        f"/economy/players/{interaction.user.id}/work", {"wallet": new_wallet}
    )
    embed = discord.Embed(
        title=_t("work_title"),
        description=_t(
            "work_desc",
            job=random.choice(_tl("work_jobs")),
            earned=earned,
            wallet=new_wallet,
            coin=_coin(),
        ),
        colour=0x2ECC71,
    )
    embed.set_footer(text=_t("work_footer", h=_eco["workCooldownHours"]))
    await interaction.response.send_message(embed=embed)


# ── /crime ────────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="crime", description="Attempt a crime for big coins — risk a fine"
)
async def crime(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "crime"):
        return
    if not _eco["crimeEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    remaining = cooldown_remaining(eco.get("lastCrime"), _eco["crimeCooldownHours"])
    if remaining:
        await interaction.response.send_message(
            _t("crime_cooldown", remaining=fmt_td(remaining)), ephemeral=True
        )
        return

    success = random.random() < (_eco["crimeWinChance"] / 100)
    if success:
        gained = random.randint(_eco["crimeWinMin"], _eco["crimeWinMax"])
        new_wallet = eco["wallet"] + gained
        await api_patch(
            f"/economy/players/{interaction.user.id}/crime", {"wallet": new_wallet}
        )
        embed = discord.Embed(
            title=_t("crime_success_title"),
            description=_t(
                "crime_success_desc",
                crime=random.choice(_tl("crime_crimes")),
                gained=gained,
                wallet=new_wallet,
                coin=_coin(),
            ),
            colour=0x9B59B6,
        )
    else:
        fine = random.randint(_eco["crimeLoseMin"], _eco["crimeLoseMax"])
        new_wallet = max(0, eco["wallet"] - fine)
        await api_patch(
            f"/economy/players/{interaction.user.id}/crime", {"wallet": new_wallet}
        )
        embed = discord.Embed(
            title=_t("crime_fail_title"),
            description=_t(
                "crime_fail_desc", fine=fine, wallet=new_wallet, coin=_coin()
            ),
            colour=0xE74C3C,
        )
    embed.set_footer(text=_t("crime_footer", h=_eco["crimeCooldownHours"]))
    await interaction.response.send_message(embed=embed)


# ── /deposit ──────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="deposit", description="Deposit coins from your wallet into the bank"
)
@app_commands.describe(amount="Amount to deposit")
async def deposit(interaction: discord.Interaction, amount: int) -> None:
    if not await check_cmd(interaction, "deposit"):
        return
    if not _eco["depositEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if amount <= 0:
        await interaction.response.send_message(
            _t("err_amount_positive"), ephemeral=True
        )
        return
    if amount > eco["wallet"]:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    new_wallet = eco["wallet"] - amount
    new_bank = eco["bank"] + amount
    await set_both(interaction.user.id, new_wallet, new_bank)
    embed = discord.Embed(
        title=_t("deposit_title"),
        description=_t("deposit_desc", amount=amount, coin=_coin()),
        colour=0x3498DB,
    )
    embed.add_field(name=_t("bal_wallet"), value=f"**{new_wallet:,}**", inline=True)
    embed.add_field(name=_t("bal_bank"), value=f"**{new_bank:,}**", inline=True)
    await interaction.response.send_message(embed=embed)


# ── /withdraw ─────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="withdraw", description="Withdraw coins from the bank into your wallet"
)
@app_commands.describe(amount="Amount to withdraw")
async def withdraw(interaction: discord.Interaction, amount: int) -> None:
    if not await check_cmd(interaction, "withdraw"):
        return
    if not _eco["withdrawEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    eco = await get_economy(interaction.user)
    if amount <= 0:
        await interaction.response.send_message(
            _t("err_amount_positive"), ephemeral=True
        )
        return
    if amount > eco["bank"]:
        await interaction.response.send_message(
            _t("err_not_enough_bank", amount=eco["bank"], coin=_coin()), ephemeral=True
        )
        return
    new_wallet = eco["wallet"] + amount
    new_bank = eco["bank"] - amount
    await set_both(interaction.user.id, new_wallet, new_bank)
    embed = discord.Embed(
        title=_t("withdraw_title"),
        description=_t("withdraw_desc", amount=amount, coin=_coin()),
        colour=0x3498DB,
    )
    embed.add_field(name=_t("bal_wallet"), value=f"**{new_wallet:,}**", inline=True)
    embed.add_field(name=_t("bal_bank"), value=f"**{new_bank:,}**", inline=True)
    await interaction.response.send_message(embed=embed)


# ── /give ─────────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="give", description="Give coins from your wallet to another player"
)
@app_commands.describe(player="Who to give to", amount="How many coins")
async def give(
    interaction: discord.Interaction,
    player: discord.Member,
    amount: app_commands.Range[int, 1],
) -> None:
    if not await check_cmd(interaction, "give"):
        return
    if not _eco["giveEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    if player.id == interaction.user.id:
        await interaction.response.send_message(
            _t("err_give_self", coin=_coin()), ephemeral=True
        )
        return
    if player.bot:
        await interaction.response.send_message(
            _t("err_give_bot", coin=_coin()), ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if amount > eco["wallet"]:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    await interaction.response.defer()
    # Deduct sender first, then credit recipient.
    # If recipient update fails, refund sender to prevent money loss.
    await set_wallet(interaction.user.id, eco["wallet"] - amount)
    eco_target = await get_economy(player)
    try:
        await set_wallet(player.id, eco_target["wallet"] + amount)
    except Exception:
        logger.error(
            "give: failed to credit %s — refunding sender", player, exc_info=True
        )
        await set_wallet(interaction.user.id, eco["wallet"])  # rollback
        await interaction.followup.send(_t("err_generic"), ephemeral=True)
        return
    embed = discord.Embed(
        title=_t("give_title"),
        description=_t(
            "give_desc", amount=amount, coin=_coin(), mention=player.mention
        ),
        colour=0x2ECC71,
    )
    await interaction.followup.send(embed=embed)


# ── /leaderboard ──────────────────────────────────────────────────────────────


@bot.tree.command(name="leaderboard", description="Show the top 10 richest players")
async def leaderboard(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "leaderboard"):
        return
    if not _eco["leaderboardEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    await interaction.response.defer()
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/economy/players", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            players: list[dict] = await resp.json()
    except Exception:
        await interaction.followup.send(_t("lb_err"), ephemeral=True)
        return

    players.sort(key=lambda p: p["wallet"] + p["bank"], reverse=True)
    top = players[:10]

    embed = discord.Embed(title=_t("lb_title"), colour=0xF1C40F)
    medals = ["\U0001f947", "\U0001f948", "\U0001f949"]
    lines = []
    for i, p in enumerate(top):
        medal = medals[i] if i < 3 else f"`{i + 1}.`"
        total = p["wallet"] + p["bank"]
        lines.append(f"{medal} **{p['username']}** — {total:,} {_coin()}")
    embed.description = "\n".join(lines) if lines else _t("lb_empty")
    await interaction.followup.send(embed=embed)


# ── /level ─────────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="level", description="Voir son niveau et son XP (ou celui d'un autre membre)"
)
@app_commands.describe(
    player="Membre dont tu veux voir le niveau — laisse vide pour toi-même"
)
async def level_cmd(
    interaction: discord.Interaction, player: Optional[discord.Member] = None
) -> None:
    if not await check_cmd(interaction, "level"):
        return
    await interaction.response.defer()
    target = player or interaction.user
    eco = await get_economy(target)
    lvl = eco.get("level", 0)
    xp = eco.get("xp", 0)
    colour = 0x3498DB if player else 0x9B59B6
    embed = discord.Embed(
        title=_t("lvl_title", name=target.display_name), colour=colour
    )
    embed.add_field(name=_t("lvl_level"), value=f"**{lvl:,}**", inline=True)
    embed.add_field(name=_t("lvl_xp"), value=f"**{xp:,}** XP", inline=True)
    if isinstance(target, discord.Member) and target.avatar:
        embed.set_thumbnail(url=target.avatar.url)
    await interaction.followup.send(embed=embed)


# ── /level-top ─────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="level-top", description="Classement des membres par niveau et XP"
)
async def level_top(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "level-top"):
        return
    await interaction.response.defer()
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/economy/players", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            players: list[dict] = await resp.json()
    except Exception:
        await interaction.followup.send(_t("lvl_top_err"), ephemeral=True)
        return

    # Sort by level desc, then xp desc as tie-breaker
    players.sort(key=lambda p: (p.get("level", 0), p.get("xp", 0)), reverse=True)
    # Only keep players who actually have xp or levels
    players = [p for p in players if p.get("level", 0) > 0 or p.get("xp", 0) > 0]
    top = players[:10]

    embed = discord.Embed(title=_t("lvl_top_title"), colour=0x9B59B6)
    medals = ["🥇", "🥈", "🥉"]
    lines = []
    for i, p in enumerate(top):
        medal = medals[i] if i < 3 else f"`{i + 1}.`"
        lvl = p.get("level", 0)
        xp = p.get("xp", 0)
        lines.append(f"{medal} **{p['username']}** — Niv. **{lvl:,}** · {xp:,} XP")
    embed.description = "\n".join(lines) if lines else _t("lvl_top_empty")
    await interaction.followup.send(embed=embed)


# ── /blackjack ────────────────────────────────────────────────────────────────

# Active-game guards — prevent the same user from running two concurrent games
# and betting the same coins twice before either resolves.
_active_bj: set[int] = set()  # user IDs with a live blackjack game
_active_rl: set[int] = set()  # user IDs with a live roulette game
_active_pof: set[int] = set()  # user IDs with a live pile-ou-face game
_active_dice: set[int] = set()  # user IDs with a live dice game

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
    def __init__(
        self,
        deck: list[str],
        player: list[str],
        dealer: list[str],
        bet: int,
        player_user: discord.User | discord.Member,
        initial_wallet: int,
    ):
        super().__init__(timeout=60)
        self.deck = deck
        self.player = player
        self.dealer = dealer
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet
        self.ended = False

    def build_embed(
        self, title: str = "\U0001f0cf Blackjack", hide_dealer: bool = True
    ) -> discord.Embed:
        embed = discord.Embed(
            title=title, colour=0x2ECC71 if not hide_dealer else 0x3498DB
        )
        dealer_name = (
            _t("bj_dealer_hidden")
            if hide_dealer
            else _t("bj_dealer_shown", total=hand_total(self.dealer))
        )
        embed.add_field(
            name=dealer_name,
            value=fmt_hand(self.dealer, hide_second=hide_dealer),
            inline=False,
        )
        embed.add_field(
            name=_t("bj_you", total=hand_total(self.player)),
            value=fmt_hand(self.player),
            inline=False,
        )
        embed.set_footer(text=_t("bj_bet_footer", bet=self.bet, coin=_coin()))
        return embed

    async def on_timeout(self) -> None:
        _active_bj.discard(self.player_user.id)

    async def end_game(self, interaction: discord.Interaction, reason: str) -> None:
        self.ended = True
        _active_bj.discard(self.player_user.id)
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        player_total = hand_total(self.player)

        if player_total > 21:
            delta = -self.bet
            result = _t("bj_bust", bet=self.bet, coin=_coin())
            colour = 0xE74C3C
        elif reason == "stand":
            while hand_total(self.dealer) < 17:
                self.dealer.append(self.deck.pop())
            dealer_total = hand_total(self.dealer)
            if dealer_total > 21 or player_total > dealer_total:
                delta = self.bet
                result = _t("bj_win", bet=self.bet, coin=_coin())
                colour = 0x2ECC71
            elif player_total == dealer_total:
                delta = 0
                result = _t("bj_push")
                colour = 0xF1C40F
            else:
                delta = -self.bet
                result = _t("bj_lose", bet=self.bet, coin=_coin())
                colour = 0xE74C3C
        else:
            delta = int(self.bet * 1.5)
            result = _t("bj_blackjack", delta=delta, coin=_coin())
            colour = 0xF1C40F

        new_wallet = max(0, self.initial_wallet + delta)
        await set_wallet(self.player_user.id, new_wallet)

        embed = self.build_embed(title=result, hide_dealer=False)
        embed.colour = colour
        embed.set_footer(text=_t("bj_wallet_footer", wallet=new_wallet, coin=_coin()))
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(
        label="Hit", style=discord.ButtonStyle.primary, emoji="\U0001f0cf"
    )
    async def hit(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if self.ended:
            return
        self.player.append(self.deck.pop())
        if hand_total(self.player) > 21:
            await self.end_game(interaction, "bust")
        else:
            await interaction.response.edit_message(embed=self.build_embed(), view=self)

    @discord.ui.button(
        label="Stand", style=discord.ButtonStyle.secondary, emoji="\U0001f6d1"
    )
    async def stand(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if self.ended:
            return
        await self.end_game(interaction, "stand")


@bot.tree.command(name="blackjack", description="Play a round of blackjack")
@app_commands.describe(bet="How many {_coin()} to bet")
async def blackjack(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "blackjack"):
        return
    if not _eco["blackjackEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    min_bet = _eco.get("blackjackMinBet", 10)
    max_bet = _eco["blackjackMaxBet"]
    if bet < min_bet or bet > max_bet:
        await interaction.response.send_message(
            _t("bj_bet_range", min=min_bet, max=max_bet, coin=_coin()), ephemeral=True
        )
        return
    if interaction.user.id in _active_bj:
        await interaction.response.send_message(
            "❌ Tu as déjà une partie de blackjack en cours !", ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    _active_bj.add(interaction.user.id)
    deck = new_deck()
    random.shuffle(deck)
    player = [deck.pop(), deck.pop()]
    dealer = [deck.pop(), deck.pop()]
    view = BlackjackView(deck, player, dealer, bet, interaction.user, eco["wallet"])
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /higher-lower ─────────────────────────────────────────────────────────────


class HLView(discord.ui.View):
    def __init__(
        self,
        current: int,
        streak: int = 0,
        player: discord.User | discord.Member | None = None,
        total_earned: int = 0,
    ):
        super().__init__(timeout=60)
        self.current = current
        self.next = random.randint(1, 100)
        self.streak = streak
        self.ended = False
        self.player = player
        self.total_earned = total_earned
        self.higher.label = _t("hl_higher")
        self.lower.label = _t("hl_lower")

    def build_embed(self) -> discord.Embed:
        return discord.Embed(
            title=_t("hl_title"),
            description=_t("hl_desc", current=self.current, streak=self.streak),
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
            reward = _eco.get("hlStreakReward", 25)
            if reward > 0 and self.player:
                eco = await get_economy(self.player)
                await set_wallet(self.player.id, eco["wallet"] + reward)
            new_total = self.total_earned + reward
            embed = discord.Embed(
                title=_t("hl_correct", next=self.next),
                description=_t(
                    "hl_correct_desc", streak=new_streak, reward=reward, coin=_coin()
                ),
                colour=0x2ECC71,
            )
            new_view = HLView(self.next, new_streak, self.player, new_total)
            await interaction.response.edit_message(embed=embed, view=new_view)
        else:
            embed = discord.Embed(
                title=_t("hl_wrong", next=self.next),
                description=_t(
                    "hl_wrong_desc",
                    streak=self.streak,
                    total=self.total_earned,
                    coin=_coin(),
                ),
                colour=0xE74C3C,
            )
            await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(
        label="Higher", style=discord.ButtonStyle.success, emoji="\u2b06\ufe0f"
    )
    async def higher(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.resolve(interaction, "higher")

    @discord.ui.button(
        label="Lower", style=discord.ButtonStyle.danger, emoji="\u2b07\ufe0f"
    )
    async def lower(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.resolve(interaction, "lower")


@bot.tree.command(
    name="higher-lower",
    description="Guess if the next number is higher or lower — earn coins per correct answer",
)
async def higher_lower(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "higher-lower"):
        return
    start = random.randint(1, 100)
    view = HLView(current=start, player=interaction.user)
    await interaction.response.send_message(embed=view.build_embed(), view=view)


# ── /roulette ─────────────────────────────────────────────────────────────────

ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


class RouletteView(discord.ui.View):
    def __init__(
        self, bet: int, player_user: discord.User | discord.Member, initial_wallet: int
    ):
        super().__init__(timeout=60)
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet

    async def on_timeout(self) -> None:
        _active_rl.discard(self.player_user.id)

    @discord.ui.button(
        label="Red  (2x)", style=discord.ButtonStyle.danger, emoji="\U0001f534"
    )
    async def red(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.spin(interaction, "red")

    @discord.ui.button(
        label="Black  (2x)", style=discord.ButtonStyle.secondary, emoji="\u26ab"
    )
    async def black(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.spin(interaction, "black")

    @discord.ui.button(
        label="Green / 0  (14x)", style=discord.ButtonStyle.success, emoji="\U0001f7e2"
    )
    async def green(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.spin(interaction, "green")

    async def spin(self, interaction: discord.Interaction, choice: str) -> None:
        _active_rl.discard(self.player_user.id)
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

        # Translate the colour name for display in the result description
        colour_labels = {
            "red": _t("rl_red"),
            "black": _t("rl_black"),
            "green": _t("rl_green"),
        }
        choice_label = colour_labels.get(choice, choice)

        if won:
            winnings = self.bet * multipliers[choice]
            delta = winnings - self.bet
            title = _t(
                "rl_win", emoji=colour_emoji, result=result, win=winnings, coin=_coin()
            )
            colour = 0x2ECC71
        else:
            delta = -self.bet
            title = _t(
                "rl_lose", emoji=colour_emoji, result=result, bet=self.bet, coin=_coin()
            )
            colour = 0xE74C3C

        new_wallet = max(0, self.initial_wallet + delta)
        await set_wallet(self.player_user.id, new_wallet)

        embed = discord.Embed(
            title=title,
            description=_t(
                "rl_result_desc",
                choice=choice_label,
                bet=self.bet,
                wallet=new_wallet,
                coin=_coin(),
            ),
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)


@bot.tree.command(name="roulette", description="Spin the roulette wheel")
@app_commands.describe(bet="How many {_coin()} to bet")
async def roulette(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "roulette"):
        return
    if not _eco["rouletteEnabled"]:
        await interaction.response.send_message(_t("err_cmd_disabled"), ephemeral=True)
        return
    min_bet = _eco.get("rouletteMinBet", 10)
    max_bet = _eco["rouletteMaxBet"]
    if bet < min_bet or bet > max_bet:
        await interaction.response.send_message(
            _t("rl_bet_range", min=min_bet, max=max_bet, coin=_coin()), ephemeral=True
        )
        return
    if interaction.user.id in _active_rl:
        await interaction.response.send_message(
            "❌ Tu as déjà une partie de roulette en cours !", ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    _active_rl.add(interaction.user.id)
    view = RouletteView(
        bet=bet, player_user=interaction.user, initial_wallet=eco["wallet"]
    )
    embed = discord.Embed(
        title=_t("rl_title"), description=_t("rl_desc", bet=bet), colour=0x9B59B6
    )
    embed.add_field(
        name=_t("rl_payouts"),
        value="Red \u2192 2x\nBlack \u2192 2x\nGreen (0) \u2192 14x",
        inline=False,
    )
    await interaction.response.send_message(embed=embed, view=view)


# ── /guess-number ─────────────────────────────────────────────────────────────
# Admin starts the game; members guess by typing in the channel; no coins.


async def _gn_finish(
    channel: discord.TextChannel, game: dict, winner: Optional[discord.Member] = None
) -> None:
    """Lock the channel and post the result embed."""
    # Lock: deny send_messages for @everyone
    try:
        await channel.set_permissions(
            channel.guild.default_role,
            send_messages=False,
            reason="Fin du jeu Devine le nombre",
        )
    except Exception:
        pass

    if winner:
        embed = discord.Embed(
            title=_t("gn_win_title"),
            description=_t("gn_win", winner=winner.mention, number=game["secret"]),
            colour=0x22C55E,
        )
    else:
        embed = discord.Embed(
            title=_t("gn_end_title"),
            description=_t("gn_end", number=game["secret"]),
            colour=0xEF4444,
        )

    embed.add_field(
        name=_t("gn_win_participants"),
        value=str(len(game["participants"])),
        inline=True,
    )
    embed.add_field(
        name=_t("gn_win_attempts"), value=str(game["attempts"]), inline=True
    )
    embed.set_footer(text=_t("gn_started_footer", starter=game["starter_name"]))

    try:
        await channel.send(embed=embed)
    except Exception:
        pass


@bot.tree.command(
    name="guess-number",
    description="[Admin] Lance une partie — les membres devinent en écrivant dans le salon",
)
@app_commands.describe(
    minimum="Borne inférieure du nombre (défaut : 1)",
    maximum="Borne supérieure du nombre (défaut : 100)",
)
async def guess_number(
    interaction: discord.Interaction,
    minimum: int = 1,
    maximum: int = 100,
) -> None:
    if not await check_cmd(interaction, "guess-number"):
        return
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    channel_id = interaction.channel_id
    if channel_id in _active_guess_games:
        await interaction.response.send_message(
            _t("gn_already_running"), ephemeral=True
        )
        return

    if minimum >= maximum:
        await interaction.response.send_message(
            "❌ La borne inférieure doit être strictement inférieure à la borne supérieure.",
            ephemeral=True,
        )
        return

    secret = random.randint(minimum, maximum)
    _active_guess_games[channel_id] = {
        "secret": secret,
        "min": minimum,
        "max": maximum,
        "starter_name": str(interaction.user),
        "attempts": 0,
        "participants": set(),
    }

    # Inform admin of the secret number — ephemeral, invisible to members
    await interaction.response.send_message(
        _t("gn_secret_info", number=secret, min=minimum, max=maximum),
        ephemeral=True,
    )

    # Send the public game embed
    embed = discord.Embed(
        title=_t("gn_title"),
        description=_t("gn_desc", min=minimum, max=maximum),
        colour=0x6366F1,
    )
    embed.set_footer(text=_t("gn_started_footer", starter=str(interaction.user)))
    await interaction.followup.send(embed=embed)


@bot.tree.command(
    name="guess-stop", description="[Admin] Arrête la partie en cours dans ce salon"
)
async def guess_stop(interaction: discord.Interaction) -> None:
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    channel_id = interaction.channel_id
    game = _active_guess_games.pop(channel_id, None)
    if game is None:
        await interaction.response.send_message(
            _t("gn_stop_not_running"), ephemeral=True
        )
        return

    await interaction.response.send_message("🛑 Partie arrêtée.", ephemeral=True)
    if isinstance(interaction.channel, discord.TextChannel):
        await _gn_finish(interaction.channel, game, winner=None)


# ── /pile-ou-face ─────────────────────────────────────────────────────────────


class CoinFlipView(discord.ui.View):
    def __init__(
        self, bet: int, player_user: discord.User | discord.Member, initial_wallet: int
    ):
        super().__init__(timeout=60)
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet
        self.ended = False
        self.pile_btn.label = _t("pof_heads_btn")
        self.face_btn.label = _t("pof_tails_btn")

    async def on_timeout(self) -> None:
        _active_pof.discard(self.player_user.id)

    async def _flip(self, interaction: discord.Interaction, choice: str) -> None:
        if self.ended:
            return
        if interaction.user.id != self.player_user.id:
            await interaction.response.send_message(
                _t("err_not_your_game"), ephemeral=True
            )
            return
        self.ended = True
        _active_pof.discard(self.player_user.id)
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        result = random.choice(["pile", "face"])
        result_emoji = "🪙" if result == "pile" else "🎭"
        result_label = _t("pof_heads") if result == "pile" else _t("pof_tails")
        won = choice == result

        if won:
            new_wallet = self.initial_wallet + self.bet
            title = _t(
                "pof_win",
                result_emoji=result_emoji,
                result=result_label,
                amount=self.bet,
                coin=_coin(),
            )
            colour = 0x2ECC71
        else:
            new_wallet = max(0, self.initial_wallet - self.bet)
            title = _t(
                "pof_lose",
                result_emoji=result_emoji,
                result=result_label,
                amount=self.bet,
                coin=_coin(),
            )
            colour = 0xE74C3C

        await set_wallet(self.player_user.id, new_wallet)
        embed = discord.Embed(
            title=title,
            description=_t("pof_wallet_footer", wallet=new_wallet, coin=_coin()),
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="🪙 Pile", style=discord.ButtonStyle.primary)
    async def pile_btn(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self._flip(interaction, "pile")

    @discord.ui.button(label="🎭 Face", style=discord.ButtonStyle.secondary)
    async def face_btn(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self._flip(interaction, "face")


@bot.tree.command(
    name="pile-ou-face",
    description="Lance une pièce et double ta mise — Pile ou Face ?",
)
@app_commands.describe(bet="Montant à miser")
async def pile_ou_face(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "pile-ou-face"):
        return
    min_bet = 10
    max_bet = _eco.get("blackjackMaxBet", 10000)
    if bet < min_bet or bet > max_bet:
        await interaction.response.send_message(
            _t("pof_bet_range", min=min_bet, max=max_bet, coin=_coin()), ephemeral=True
        )
        return
    if interaction.user.id in _active_pof:
        await interaction.response.send_message(
            "❌ Tu as déjà un jeu de pile ou face en cours !", ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    _active_pof.add(interaction.user.id)
    view = CoinFlipView(
        bet=bet, player_user=interaction.user, initial_wallet=eco["wallet"]
    )
    embed = discord.Embed(
        title=_t("pof_title"),
        description=_t("pof_desc", amount=bet, coin=_coin()),
        colour=0xF1C40F,
    )
    await interaction.response.send_message(embed=embed, view=view)


# ── /slots ────────────────────────────────────────────────────────────────────

# Symbol pool: (emoji, weight) — lower weight = rarer
_SLOT_SYMBOLS = [
    ("🍒", 400),
    ("🍋", 200),
    ("🍊", 150),
    ("🍀", 80),
    ("⭐", 50),
    ("💎", 20),
]
# Net multiplier on top of the bet (e.g. 20 means you receive 20× your bet back, net gain = 19×)
_SLOT_JACKPOTS: dict[str, float] = {
    "💎": 200,
    "⭐": 50,
    "🍀": 6,
    "🍊": 3,
    "🍋": 2.5,
    "🍒": 2,
}
_SLOT_POOL = [sym for sym, w in _SLOT_SYMBOLS for _ in range(w)]


@bot.tree.command(
    name="slots",
    description="Tente ta chance aux machines à sous — Jackpot jusqu'à 20x !",
)
@app_commands.describe(bet="Montant à miser")
async def slots_cmd(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "slots"):
        return
    min_bet = 100
    max_bet = _eco.get("blackjackMaxBet", 1000000)
    if bet < min_bet or bet > max_bet:
        await interaction.response.send_message(
            _t("sl_bet_range", min=min_bet, max=max_bet, coin=_coin()), ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return

    reels = [random.choice(_SLOT_POOL) for _ in range(3)]
    display = f"[ {reels[0]} | {reels[1]} | {reels[2]} ]"

    if reels[0] == reels[1] == reels[2]:
        sym = reels[0]
        multiplier = _SLOT_JACKPOTS.get(sym, 2)
        winnings = int(bet * multiplier)
        net = winnings - bet
        new_wallet = eco["wallet"] + net
        title = _t(
            "sl_jackpot",
            display=display,
            sym=sym,
            win=winnings,
            multiplier=multiplier,
            coin=_coin(),
        )
        colour = 0xF1C40F
    elif reels[0] == reels[1] or reels[1] == reels[2] or reels[0] == reels[2]:
        loss = max(1, bet // 2)
        net = -loss
        new_wallet = max(0, eco["wallet"] - loss)
        title = _t("sl_two_kind", display=display, loss=loss, coin=_coin())
        colour = 0xF39C12
    else:
        net = -bet
        new_wallet = max(0, eco["wallet"] - bet)
        title = _t("sl_lose", display=display, amount=bet, coin=_coin())
        colour = 0xE74C3C

    await set_wallet(interaction.user.id, new_wallet)
    embed = discord.Embed(
        title=title,
        description=_t("sl_wallet_footer", wallet=new_wallet, coin=_coin()),
        colour=colour,
    )
    embed.add_field(name=_t("sl_payouts"), value=_t("sl_payouts_desc"), inline=False)
    await interaction.response.send_message(embed=embed)
    await log_to_api(
        "INFO",
        f"{interaction.user} slots: {display} bet={bet} net={net:+d} wallet→{new_wallet}",
    )


# ── /dice ─────────────────────────────────────────────────────────────────────


class DiceView(discord.ui.View):
    def __init__(
        self, bet: int, player_user: discord.User | discord.Member, initial_wallet: int
    ):
        super().__init__(timeout=60)
        self.bet = bet
        self.player_user = player_user
        self.initial_wallet = initial_wallet
        self.ended = False
        self.low_btn.label = _t("dice_low_btn")
        self.seven_btn.label = _t("dice_seven_btn")
        self.high_btn.label = _t("dice_high_btn")

    async def on_timeout(self) -> None:
        _active_dice.discard(self.player_user.id)

    async def _roll(self, interaction: discord.Interaction, choice: str) -> None:
        if self.ended:
            return
        if interaction.user.id != self.player_user.id:
            await interaction.response.send_message(
                _t("err_not_your_game"), ephemeral=True
            )
            return
        self.ended = True
        _active_dice.discard(self.player_user.id)
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]

        d1 = random.randint(1, 6)
        d2 = random.randint(1, 6)
        total = d1 + d2
        dice_display = f"🎲 **{d1}** + **{d2}** = **{total}**"

        if choice == "low":
            won = total <= 6
            multiplier = 2
        elif choice == "seven":
            won = total == 7
            multiplier = 4
        else:  # high
            won = total >= 8
            multiplier = 2

        if won:
            gain = self.bet * (multiplier - 1)
            new_wallet = self.initial_wallet + gain
            title = _t("dice_win", dice=dice_display, amount=gain, coin=_coin())
            colour = 0x2ECC71
        else:
            new_wallet = max(0, self.initial_wallet - self.bet)
            title = _t("dice_lose", dice=dice_display, amount=self.bet, coin=_coin())
            colour = 0xE74C3C

        await set_wallet(self.player_user.id, new_wallet)
        embed = discord.Embed(
            title=title,
            description=_t("dice_wallet_footer", wallet=new_wallet, coin=_coin()),
            colour=colour,
        )
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="⬇️ Bas (≤6)  ×2", style=discord.ButtonStyle.primary)
    async def low_btn(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self._roll(interaction, "low")

    @discord.ui.button(label="🍀 7 exact  ×4", style=discord.ButtonStyle.success)
    async def seven_btn(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self._roll(interaction, "seven")

    @discord.ui.button(label="⬆️ Haut (≥8)  ×2", style=discord.ButtonStyle.danger)
    async def high_btn(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self._roll(interaction, "high")


@bot.tree.command(
    name="dice", description="Lance 2 dés — mise sur Bas (≤6), 7 exact, ou Haut (≥8) !"
)
@app_commands.describe(bet="Montant à miser")
async def dice_cmd(interaction: discord.Interaction, bet: int = 100) -> None:
    if not await check_cmd(interaction, "dice"):
        return
    min_bet = 10
    max_bet = _eco.get("blackjackMaxBet", 10000)
    if bet < min_bet or bet > max_bet:
        await interaction.response.send_message(
            _t("dice_bet_range", min=min_bet, max=max_bet, coin=_coin()), ephemeral=True
        )
        return
    if interaction.user.id in _active_dice:
        await interaction.response.send_message(
            "❌ Tu as déjà un jeu de dés en cours !", ephemeral=True
        )
        return
    eco = await get_economy(interaction.user)
    if eco["wallet"] < bet:
        await interaction.response.send_message(
            _t("err_not_enough_wallet", amount=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return
    _active_dice.add(interaction.user.id)
    view = DiceView(bet=bet, player_user=interaction.user, initial_wallet=eco["wallet"])
    embed = discord.Embed(
        title=_t("dice_title"),
        description=_t("dice_desc", amount=bet, coin=_coin()),
        colour=0x3498DB,
    )
    embed.add_field(
        name=_t("dice_payouts"), value=_t("dice_payouts_desc"), inline=False
    )
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
    await refresh_ticket_config()
    await refresh_welcome_config()
    await refresh_random_activity()
    await refresh_custom_commands()
    if _apply_command_labels():
        try:
            synced = await bot.tree.sync()
            global _last_synced_labels
            _last_synced_labels = {
                name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()
            }
            logger.info(
                "Slash commands re-synced after label change — %d commands", len(synced)
            )
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
        # Stream members one-by-one — avoids loading the full list into memory.
        try:
            async for member in guild.fetch_members(limit=None):
                total += 1
                member_role_ids = {str(r.id) for r in member.roles}
                for rule in _role_rewards:
                    trigger = rule.get("triggerRoleId", "")
                    reward = rule.get("rewardRoleId", "")
                    remove = rule.get("removeRoleId") or ""
                    if not trigger or trigger not in member_role_ids:
                        continue
                    try:
                        # Add reward role if configured and missing
                        if reward and reward not in member_role_ids:
                            reward_role = guild.get_role(int(reward))
                            if reward_role:
                                await member.add_roles(
                                    reward_role, reason="Sync: role reward"
                                )
                        # Remove role if configured and present
                        if remove and remove in member_role_ids:
                            remove_role = guild.get_role(int(remove))
                            if remove_role:
                                await member.remove_roles(
                                    remove_role, reason="Sync: role removal"
                                )
                        processed += 1
                    except Exception as exc:
                        logger.error("Sync: error on member %s: %s", member, exc)
                        errors += 1
        except Exception as exc:
            logger.error("Sync: failed to fetch members for guild %s: %s", guild, exc)
            await api_patch(
                f"/role-rewards-sync/{job_id}",
                {
                    "status": "error",
                    "total": total,
                    "processed": processed,
                    "errors": errors + 1,
                },
            )
            return

    await api_patch(
        f"/role-rewards-sync/{job_id}",
        {
            "status": "done",
            "total": total,
            "processed": processed,
            "errors": errors,
        },
    )
    logger.info(
        "Role-reward sync job #%d — done (%d members, %d actions, %d errors)",
        job_id,
        total,
        processed,
        errors,
    )


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
                if required_role_ids and not any(
                    rid in role_ids for rid in required_role_ids
                ):
                    continue
                # Must NOT have any forbidden role
                if forbidden_role_ids and any(
                    rid in role_ids for rid in forbidden_role_ids
                ):
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
    if (
        giveaway.get("requiredRoleId")
        and giveaway["requiredRoleId"] not in req_role_ids
    ):
        req_role_ids.append(giveaway["requiredRoleId"])
    if req_role_ids:
        conds.append(
            "✅ Rôles autorisés : " + " ".join(f"<@&{rid}>" for rid in req_role_ids)
        )
    for rid in giveaway.get("forbiddenRoleIds") or []:
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
            logger.error(
                "Giveaway #%d: cannot find channel %s: %s", giveaway_id, channel_id, exc
            )
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
        await api_patch(
            f"/giveaways/{giveaway_id}",
            {
                "messageId": str(msg.id),
                "guildId": str(channel.guild.id),
            },
        )
        logger.info(
            "Giveaway #%d posted in channel %s (msg %s)",
            giveaway_id,
            channel_id,
            msg.id,
        )
    except Exception as exc:
        logger.error("Giveaway #%d: failed to post: %s", giveaway_id, exc)


async def _deliver_rewards(
    winners: list[discord.User], giveaway: dict, guild: Optional[discord.Guild]
) -> None:
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
                        await api_patch(
                            f"/economy/players/{winner.id}", {"wallet": new_wallet}
                        )
                        logger.info(
                            "Giveaway reward: +%d wallet → %s",
                            reward["amount"],
                            winner.id,
                        )
                elif reward["type"] == "role" and reward.get("roleId") and guild:
                    member = guild.get_member(winner.id) or await guild.fetch_member(
                        winner.id
                    )
                    role = guild.get_role(int(reward["roleId"]))
                    if role and member:
                        await member.add_roles(
                            role, reason=f"Giveaway #{giveaway['id']} reward"
                        )
                        logger.info(
                            "Giveaway reward: role %s → %s", role.name, winner.id
                        )
                        dur_min = reward.get("roleDurationMinutes")
                        if dur_min and isinstance(dur_min, (int, float)):
                            expires = datetime.now(timezone.utc) + timedelta(
                                minutes=dur_min
                            )
                            await api_post(
                                "/temporary-roles",
                                {
                                    "userId": str(winner.id),
                                    "guildId": str(guild.id),
                                    "roleId": str(role.id),
                                    "expiresAt": expires.isoformat(),
                                    "reason": f"Giveaway #{giveaway['id']} — {_fmt_duration(dur_min)}",
                                },
                            )
                            logger.info(
                                "Temp role scheduled: %s → %s (expires in %s)",
                                role.name,
                                winner.id,
                                _fmt_duration(dur_min),
                            )
                elif reward["type"] == "item" and reward.get("itemId"):
                    item_id = reward["itemId"]
                    # Add to inventory
                    await api_post(
                        "/inventory",
                        {
                            "userId": str(winner.id),
                            "itemId": item_id,
                            "quantity": 1,
                            "source": "giveaway",
                        },
                    )
                    # Grant associated role if configured
                    item_data = await api_get_json(f"/shop/items")
                    if isinstance(item_data, list):
                        item_obj = next(
                            (it for it in item_data if it["id"] == item_id), None
                        )
                    else:
                        item_obj = None
                    if item_obj and item_obj.get("roleId") and guild:
                        try:
                            member = guild.get_member(
                                winner.id
                            ) or await guild.fetch_member(winner.id)
                            role = guild.get_role(int(item_obj["roleId"]))
                            if role and member:
                                await member.add_roles(
                                    role,
                                    reason=f"Giveaway #{giveaway['id']} item reward",
                                )
                                logger.info(
                                    "Giveaway reward: item #%s + role %s → %s",
                                    item_id,
                                    role.name,
                                    winner.id,
                                )
                        except Exception as exc:
                            logger.warning(
                                "Could not grant role for item #%s: %s", item_id, exc
                            )
                    else:
                        logger.info(
                            "Giveaway reward: item #%s added to inventory of %s",
                            item_id,
                            winner.id,
                        )
            except Exception as exc:
                logger.error(
                    "Giveaway reward delivery error for %s: %s", winner.id, exc
                )


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
    ends_ts = int(
        datetime.fromisoformat(giveaway["endsAt"].replace("Z", "+00:00")).timestamp()
    )
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
                if winners
                else "😔 Aucun participant éligible"
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
        await channel.send(
            f"{host_ping}Le giveaway **{giveaway['prize']}** s'est terminé sans participants éligibles."
        )

    logger.info(
        "Giveaway #%d ended — %d winner(s): %s", giveaway_id, len(winners), winner_ids
    )


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
                await member.remove_roles(
                    role, reason=f"Rôle temporaire expiré (entrée #{entry['id']})"
                )
                logger.info(
                    "Temp role #%s expired: removed %s from %s",
                    entry["id"],
                    role.name,
                    member,
                )
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
            embed.set_footer(
                text="⚠️ Renseignez le prix, le salon et la durée pour activer le bouton Lancer"
            )
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
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(), view=self
        )

    # ── Row 0: core info + rewards ────────────────────────────────────────────

    @discord.ui.button(
        label="📝 Infos de base", style=discord.ButtonStyle.secondary, row=0
    )
    async def btn_base(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        await interaction.response.send_modal(_BaseInfoModal(self))

    @discord.ui.button(label="📢 Salon", style=discord.ButtonStyle.secondary, row=0)
    async def btn_channel(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_ChannelSelectView(self),
        )

    @discord.ui.button(
        label="🎁 Récompenses", style=discord.ButtonStyle.secondary, row=0
    )
    async def btn_rewards(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(), view=_RewardTypeView(self)
        )

    # ── Row 1: people ─────────────────────────────────────────────────────────

    @discord.ui.button(label="👤 Host", style=discord.ButtonStyle.secondary, row=1)
    async def btn_host(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_UserSelectView(self, "host", 1, "l'organisateur"),
        )

    @discord.ui.button(
        label="💬 Mentions (rôles)", style=discord.ButtonStyle.secondary, row=1
    )
    async def btn_mentions(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_RoleSelectView(self, "mentions", "les rôles à mentionner"),
        )

    @discord.ui.button(
        label="💰 Solde min.", style=discord.ButtonStyle.secondary, row=1
    )
    async def btn_min_balance(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        await interaction.response.send_modal(_MinBalanceModal(self))

    # ── Row 2: role conditions ────────────────────────────────────────────────

    @discord.ui.button(
        label="✅ Rôles autorisés", style=discord.ButtonStyle.secondary, row=2
    )
    async def btn_allowed(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self._sync_launch_button()
        await interaction.response.edit_message(
            embed=self.cfg.summary_embed(),
            view=_RoleSelectView(self, "allowed", "les rôles autorisés"),
        )

    @discord.ui.button(
        label="🚫 Rôles interdits", style=discord.ButtonStyle.secondary, row=2
    )
    async def btn_forbidden(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
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
    async def btn_launch(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
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
    async def confirm(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        if self._selected:
            self.parent.cfg.channel_id = str(self._selected.id)
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
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
    async def confirm(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        ids = [str(r.id) for r in self._selected]
        if self.field == "allowed":
            self.parent.cfg.required_role_ids = ids
        elif self.field == "forbidden":
            self.parent.cfg.forbidden_role_ids = ids
        else:  # mentions
            self.parent.cfg.mentioned_role_ids = ids
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
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
    async def confirm(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        ids = [str(u.id) for u in self._selected]
        if self.field == "host":
            self.parent.cfg.host_id = ids[0] if ids else None
        else:
            self.parent.cfg.mentioned_user_ids = ids
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        await self._back(interaction)


class _RewardTypeView(_SubView):
    @discord.ui.select(
        placeholder="Type de récompense à ajouter",
        options=[
            discord.SelectOption(
                label="💰 Argent",
                value="money",
                description="Ajouter une somme au wallet du gagnant",
            ),
            discord.SelectOption(
                label="🎭 Rôle", value="role", description="Attribuer un rôle Discord"
            ),
            discord.SelectOption(
                label="📦 Item de boutique",
                value="item",
                description="Indiquer un item à remettre manuellement",
            ),
        ],
        row=0,
    )
    async def pick_type(
        self, interaction: discord.Interaction, sel: discord.ui.Select
    ) -> None:
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

    @discord.ui.button(
        label="🗑 Vider les récompenses", style=discord.ButtonStyle.danger, row=1
    )
    async def clear(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        self.parent.cfg.rewards = []
        await self._back(interaction)

    @discord.ui.button(label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1)
    async def back(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        await self._back(interaction)


class _RoleRewardView(_SubView):
    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__(parent)
        self._role: Optional[discord.Role] = None
        self._duration_minutes: Optional[int] = None

        sel = discord.ui.RoleSelect(
            placeholder="Rôle à attribuer au gagnant", min_values=1, max_values=1
        )
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

        confirm_btn = discord.ui.Button(
            label="✅ Ajouter ce rôle", style=discord.ButtonStyle.green, row=1
        )
        confirm_btn.callback = self._on_confirm
        self.add_item(confirm_btn)

        back_btn = discord.ui.Button(
            label="↩️ Retour", style=discord.ButtonStyle.secondary, row=1
        )
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
            reward: dict = {
                "type": "role",
                "roleId": str(self._role.id),
                "roleName": self._role.name,
            }
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
            self._role_view._dur_btn.label = (
                f"⏱ {_fmt_duration(dur)}  ·  cliquer pour modifier"
            )
            self._role_view._dur_btn.style = discord.ButtonStyle.primary
        else:
            self._role_view._dur_btn.label = (
                "⏱ Permanent  ·  cliquer pour rendre temporaire"
            )
            self._role_view._dur_btn.style = discord.ButtonStyle.secondary
        await interaction.response.edit_message(
            embed=self._role_view.parent.cfg.summary_embed(), view=self._role_view
        )


class _BaseInfoModal(discord.ui.Modal, title="Infos de base du giveaway"):
    prize_f = discord.ui.TextInput(
        label="Prix à gagner", placeholder="ex: 1 000 sheckels, Nitro…", max_length=200
    )
    duration_f = discord.ui.TextInput(
        label="Durée (minutes)", placeholder="60", max_length=6, default="60"
    )
    winners_f = discord.ui.TextInput(
        label="Nombre de gagnants", placeholder="1", max_length=3, default="1"
    )

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
    amount_f = discord.ui.TextInput(
        label="Montant à ajouter au wallet", placeholder="ex: 1000", max_length=15
    )

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            self.parent.cfg.rewards.append(
                {"type": "money", "amount": int(self.amount_f.value.strip())}
            )
        except ValueError:
            pass
        await self.parent._refresh(interaction)


class _AddItemModal(discord.ui.Modal, title="Récompense item"):
    id_f = discord.ui.TextInput(
        label="ID de l'item (boutique)", placeholder="ex: 3", max_length=10
    )
    name_f = discord.ui.TextInput(
        label="Nom de l'item (pour l'affichage)",
        placeholder="ex: Couronne VIP",
        max_length=100,
    )

    def __init__(self, parent: GiveawaySetupView) -> None:
        super().__init__()
        self.parent = parent

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            self.parent.cfg.rewards.append(
                {
                    "type": "item",
                    "itemId": int(self.id_f.value.strip()),
                    "itemName": self.name_f.value.strip(),
                }
            )
        except ValueError:
            pass
        await self.parent._refresh(interaction)


# ── /giveaway command group ───────────────────────────────────────────────────

giveaway_group = app_commands.Group(
    name="giveaway", description="Gestion des giveaways [Admin]"
)


@giveaway_group.command(
    name="start", description="Ouvrir le panneau de création de giveaway"
)
async def giveaway_start(interaction: discord.Interaction) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message(
            "❌ Commande réservée aux administrateurs.", ephemeral=True
        )
        return
    view = GiveawaySetupView(author_id=interaction.user.id)
    await interaction.response.send_message(
        embed=view.cfg.summary_embed(), view=view, ephemeral=True
    )


@giveaway_group.command(name="end", description="Terminer un giveaway immédiatement")
@app_commands.describe(giveaway_id="ID du giveaway")
async def giveaway_end(interaction: discord.Interaction, giveaway_id: int) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message(
            "❌ Commande réservée aux administrateurs.", ephemeral=True
        )
        return
    giveaway = await api_get_json(f"/giveaways/{giveaway_id}")
    if not giveaway or giveaway.get("status") != "active":
        await interaction.response.send_message(
            "❌ Giveaway introuvable ou déjà terminé.", ephemeral=True
        )
        return
    await interaction.response.defer(ephemeral=True)
    await _end_giveaway(giveaway)
    await interaction.followup.send(
        f"✅ Giveaway #{giveaway_id} terminé.", ephemeral=True
    )


@giveaway_group.command(name="reroll", description="Retirer un nouveau gagnant")
@app_commands.describe(giveaway_id="ID du giveaway")
async def giveaway_reroll(interaction: discord.Interaction, giveaway_id: int) -> None:
    if not interaction.user.guild_permissions.administrator:  # type: ignore[union-attr]
        await interaction.response.send_message(
            "❌ Commande réservée aux administrateurs.", ephemeral=True
        )
        return
    giveaway = await api_get_json(f"/giveaways/{giveaway_id}")
    if not giveaway or giveaway.get("status") != "ended":
        await interaction.response.send_message(
            "❌ Giveaway introuvable ou pas encore terminé.", ephemeral=True
        )
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
            await channel.send(
                f"🎲 **Reroll !** Nouveau(x) gagnant(s) : {mention_str} pour **{prize}** !"
            )
        except Exception:
            pass
        await interaction.followup.send(
            f"✅ Reroll effectué : {mention_str}", ephemeral=True
        )
    else:
        await interaction.followup.send(
            "❌ Aucun participant pour le reroll.", ephemeral=True
        )


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
        _last_synced_labels = {
            name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()
        }
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


# ── Command manifest ──────────────────────────────────────────────────────────

# Maps command names → dashboard category.
# Any command not listed here gets category "other" and will still appear.
_CMD_CATEGORY: dict[str, str] = {
    # Economy
    "balance": "economy",
    "addmoney": "economy",
    "removemoney": "economy",
    "setmoney": "economy",
    "resetmoney": "economy",
    "drop-money": "economy",
    "daily": "economy",
    "work": "economy",
    "crime": "economy",
    "deposit": "economy",
    "withdraw": "economy",
    "give": "economy",
    "leaderboard": "economy",
    "level": "economy",
    "level-top": "economy",
    "addlevel": "economy",
    "removelevel": "economy",
    "resetlevel": "economy",
    # Games
    "blackjack": "games",
    "higher-lower": "games",
    "roulette": "games",
    "guess-number": "games",
    "pile-ou-face": "games",
    "slots": "games",
    "dice": "games",
    # Tickets
    "ticket-setup": "tickets",
    "ticket-close": "tickets",
    "ticket-add": "tickets",
    # Guess-number control
    "guess-stop": "games",
    # Shop
    "shop": "shop",
    "buy": "shop",
    "inventory": "shop",
    "give-item": "shop",
    # Giveaway (group prefix applied below)
    "giveaway-start": "giveaway",
    "giveaway-end": "giveaway",
    "giveaway-reroll": "giveaway",
    # Config
    "config-language": "config",
    # Random activity (group prefix applied below)
    "rdm-config": "random-activity",
    "rdm-toggle": "random-activity",
    "rdm-add": "random-activity",
    "rdm-list": "random-activity",
    "rdm-remove": "random-activity",
}


def _default_label(name: str) -> str:
    """Turn a slash-command name into a human-readable default label."""
    return name.replace("-", " ").title()


async def _push_command_manifest() -> None:
    """Introspect bot.tree and push the full command list to the API manifest."""
    manifest: list[dict] = []
    for cmd in bot.tree.get_commands():
        if isinstance(cmd, app_commands.Group):
            # _cmd_name_map tracks current→original for top-level names
            orig_group = _cmd_name_map.get(cmd.name, cmd.name)
            for sub in cmd.commands:
                current_full = f"{cmd.name}-{sub.name}"
                orig_full = f"{orig_group}-{sub.name}"
                category = _CMD_CATEGORY.get(orig_full) or _CMD_CATEGORY.get(
                    current_full, "other"
                )
                manifest.append(
                    {
                        "name": current_full,
                        "defaultLabel": _default_label(current_full),
                        "description": sub.description or "",
                        "category": category,
                    }
                )
        else:
            # Use _cmd_name_map to look up original name for category resolution
            orig_name = _cmd_name_map.get(cmd.name, cmd.name)
            category = _CMD_CATEGORY.get(orig_name) or _CMD_CATEGORY.get(
                cmd.name, "other"
            )
            manifest.append(
                {
                    "name": cmd.name,
                    "defaultLabel": _default_label(cmd.name),
                    "description": cmd.description or "",
                    "category": category,
                }
            )
    if not manifest:
        return
    try:
        s = await get_http_session()
        async with s.post(
            f"{API_BASE}/commands/manifest",
            json=manifest,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 204:
                logger.info("Command manifest pushed — %d commands", len(manifest))
            else:
                logger.warning("Command manifest push returned %d", resp.status)
    except Exception:
        logger.warning("Failed to push command manifest", exc_info=True)


# ── Ready ─────────────────────────────────────────────────────────────────────


@bot.event
async def on_ready() -> None:
    if bot.user is not None:
        logger.info("Bot connected as %s (ID: %s)", bot.user, bot.user.id)

    # Register persistent views (must run before any interaction is processed)
    bot.add_view(TicketOpenView())
    bot.add_view(TicketCloseView())

    await refresh_reminders()
    await refresh_economy_config()
    await refresh_role_rewards()
    await refresh_command_configs()
    await refresh_ticket_config()
    await refresh_welcome_config()
    await refresh_random_activity()
    await refresh_custom_commands()
    _apply_command_labels()

    try:
        synced = await bot.tree.sync()
        global _last_synced_labels
        _last_synced_labels = {
            name: cfg.get("label", "") for name, cfg in _cmd_cfg.items()
        }
        logger.info("Slash commands synced — %d commands", len(synced))
        await _push_command_manifest()
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
    if not random_activity_loop.is_running():
        random_activity_loop.start()

    # Appels sécurisés pour éviter le plantage si l'API locale démarre doucement
    try:
        await send_heartbeat(connected=True)
        await log_to_api("INFO", f"Bot connected as {bot.user}")
    except Exception:
        pass

# Pre-warm the shared HTTP session
    await get_http_session()

    # Push channels & roles to API cache (safely handled against connection refused)
    try:
        s = await get_http_session()
        channels = [
            {
                "id": str(ch.id),
                "name": ch.name,
                "guildId": str(guild.id),
                "guildName": guild.name,
            }
            for guild in bot.guilds
            for ch in guild.text_channels
        ]
        await s.post(
            f"{API_BASE}/bot/channels",
            json=channels,
            timeout=aiohttp.ClientTimeout(total=5),
        )
        roles = [
            {
                "id": str(role.id),
                "name": role.name,
                "color": role.color.value,
                "guildId": str(guild.id),
                "guildName": guild.name,
            }
            for guild in bot.guilds
            for role in guild.roles
            if not role.is_default()
        ]
        await s.post(
            f"{API_BASE}/bot/roles", json=roles, timeout=aiohttp.ClientTimeout(total=5)
        )
        logger.info(
            "Channel/role lists pushed — %d channels, %d roles",
            len(channels),
            len(roles),
        )
    except (aiohttp.ClientError, OSError, ConnectionRefusedError):
        logger.warning("API not ready yet for channel/role sync, skipping for now.")

@bot.tree.error
async def on_app_command_error(
    interaction: discord.Interaction, error: app_commands.AppCommandError
) -> None:
    """Global handler for slash command errors.
    Silently drops expired-interaction errors (code 10062) which happen when
    Discord's 3-second window passes before the bot responds — usually during
    reconnects or heavy load. Logs everything else and notifies the user.
    """
    original = getattr(error, "original", error)
    if isinstance(original, discord.NotFound) and getattr(original, "code", 0) == 10062:
        return  # interaction token expired — nothing we can do, ignore silently
    logger.error(
        "App command error in '%s': %s",
        getattr(interaction.command, "name", "?"),
        error,
        exc_info=error,
    )
    msg = f"❌ {_t('err_generic')}"
    try:
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    except Exception:
        pass

    # Push text channels to API cache (used by the dashboard giveaway form)
    try:
        channels = [
            {
                "id": str(ch.id),
                "name": ch.name,
                "guildId": str(ch.guild.id),
                "guildName": ch.guild.name,
            }
            for guild in bot.guilds
            for ch in guild.text_channels
        ]
        s = await get_http_session()
        await s.post(
            f"{API_BASE}/bot/channels",
            json=channels,
            timeout=aiohttp.ClientTimeout(total=5),
        )
    except Exception:
        logger.warning("Failed to push channel list to API", exc_info=True)


# ── /shop ─────────────────────────────────────────────────────────────────────


@bot.tree.command(name="shop", description="Browse items available in the shop")
async def shop_cmd(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "shop"):
        return
    await interaction.response.defer()
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            items: list[dict] = await resp.json()
    except Exception:
        await interaction.followup.send(_t("shop_err"), ephemeral=True)
        return

    enabled = [it for it in items if it.get("enabled", True)]
    enabled.sort(key=lambda it: (it.get("position", 0), it.get("id", 0)))

    if not enabled:
        await interaction.followup.send(_t("shop_empty"), ephemeral=True)
        return

    embed = discord.Embed(
        title=_t("shop_title"),
        description=_t("shop_desc", coin=_coin()),
        colour=0x9B59B6,
    )
    for it in enabled:
        emoji = it.get("emoji", "🛍️")
        name = it.get("name", "?")
        price = it.get("price", 0)
        desc = it.get("description") or ""
        role_id = it.get("roleId")
        role_note = _t("shop_role_note", role_id=role_id) if role_id else ""
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
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=3)
        ) as resp:
            items: list[dict] = await resp.json()
    except Exception:
        return []
    enabled = [it for it in items if it.get("enabled", True)]
    return [
        app_commands.Choice(
            name=f"{it.get('emoji', '')} {it['name']} — {it['price']:,} {_coin()}",
            value=str(it["id"]),
        )
        for it in enabled
        if current.lower() in it["name"].lower()
    ][:25]


@bot.tree.command(name="buy", description="Buy an item from the shop")
@app_commands.describe(item="Item to buy (type to search)")
@app_commands.autocomplete(item=_shop_items_autocomplete)
async def buy_cmd(interaction: discord.Interaction, item: str) -> None:
    if not await check_cmd(interaction, "buy"):
        return
    # Fetch shop items
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            items: list[dict] = await resp.json()
    except Exception:
        await interaction.response.send_message(_t("buy_err"), ephemeral=True)
        return

    # Find the item by id or name
    target: dict | None = None
    for it in items:
        if str(it.get("id")) == item or it.get("name", "").lower() == item.lower():
            target = it
            break

    if not target:
        await interaction.response.send_message(_t("buy_not_found"), ephemeral=True)
        return
    if not target.get("enabled", True):
        await interaction.response.send_message(_t("buy_unavailable"), ephemeral=True)
        return

    price = target.get("price", 0)
    eco = await get_economy(interaction.user)

    if eco["wallet"] < price:
        await interaction.response.send_message(
            _t("buy_insufficient", price=price, wallet=eco["wallet"], coin=_coin()),
            ephemeral=True,
        )
        return

    # Deduct wallet
    new_wallet = eco["wallet"] - price
    await set_wallet(interaction.user.id, new_wallet)

    # Record in inventory
    await api_post(
        "/inventory",
        {
            "userId": str(interaction.user.id),
            "itemId": target["id"],
            "quantity": 1,
            "source": "buy",
        },
    )

    # Grant Discord role if configured
    role_granted = False
    role_id = target.get("roleId")
    if role_id and interaction.guild:
        try:
            role = interaction.guild.get_role(int(role_id))
            if role and isinstance(interaction.user, discord.Member):
                await interaction.user.add_roles(
                    role, reason=f"Shop purchase: {target['name']}"
                )
                role_granted = True
        except Exception:
            pass

    emoji = target.get("emoji", "🛍️")
    name = target.get("name", "?")
    embed = discord.Embed(
        title=_t("buy_title", emoji=emoji),
        description=_t("buy_desc", name=name, price=price, coin=_coin()),
        colour=0x2ECC71,
    )
    embed.add_field(
        name=_t("buy_wallet"), value=f"**{new_wallet:,}** {_coin()}", inline=True
    )
    if role_granted:
        embed.add_field(name=_t("buy_role"), value=f"<@&{role_id}>", inline=True)
    await interaction.response.send_message(embed=embed)
    await log_to_api(
        "INFO",
        f"{interaction.user} bought '{name}' for {price} {_coin()} (wallet → {new_wallet})",
    )


# ── /inventory ────────────────────────────────────────────────────────────────


@bot.tree.command(
    name="inventory", description="View your item inventory (or another member's)"
)
@app_commands.describe(
    member="Member whose inventory to view (leave empty for your own)"
)
async def inventory_cmd(
    interaction: discord.Interaction, member: Optional[discord.Member] = None
) -> None:
    if not await check_cmd(interaction, "inventory"):
        return
    await interaction.response.defer(ephemeral=True)

    target = member or interaction.user
    entries = await api_get_list(f"/inventory/{target.id}")
    if not entries:
        msg = (
            _t("inv_empty_other", name=target.display_name)
            if member
            else _t("inv_empty_self")
        )
        await interaction.followup.send(msg, ephemeral=True)
        return

    src_map = {
        "buy": _t("inv_src_buy"),
        "giveaway": _t("inv_src_giveaway"),
        "admin": _t("inv_src_admin"),
    }
    lines: list[str] = []
    for e in entries:
        item = e.get("item") or {}
        emoji = item.get("emoji", "📦")
        name = item.get("name") or f"Item #{e['itemId']}"
        qty = e.get("quantity", 1)
        src_label = src_map.get(e.get("source", "buy"), e.get("source", ""))
        qty_str = f" ×{qty}" if qty > 1 else ""
        lines.append(f"{emoji} **{name}**{qty_str}  ·  _{src_label}_")

    n = len(entries)
    embed = discord.Embed(
        title=_t("inv_title", name=target.display_name),
        description="\n".join(lines),
        colour=0x9B59B6,
    )
    embed.set_footer(text=f"{n} item{'s' if n > 1 else ''}")
    await interaction.followup.send(embed=embed, ephemeral=True)


# ── /give-item ────────────────────────────────────────────────────────────────


async def _all_items_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=3)
        ) as resp:
            items: list[dict] = await resp.json()
    except Exception:
        return []
    return [
        app_commands.Choice(
            name=f"{it.get('emoji', '')} {it['name']}{'' if it.get('enabled', True) else ' [off]'}",
            value=str(it["id"]),
        )
        for it in items
        if current.lower() in it["name"].lower()
    ][:25]


@bot.tree.command(name="give-item", description="Give a shop item to a player [Admin]")
@app_commands.describe(
    member="Player to receive the item",
    item="Item to give (autocomplete)",
    quantity="Number of copies to give (default 1)",
)
@app_commands.autocomplete(item=_all_items_autocomplete)
async def give_item(
    interaction: discord.Interaction,
    member: discord.Member,
    item: str,
    quantity: int = 1,
) -> None:
    if not await check_cmd(interaction, "give-item"):
        return
    if (
        not isinstance(interaction.user, discord.Member)
        or not interaction.user.guild_permissions.administrator
    ):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    # Fetch all shop items
    try:
        s = await get_http_session()
        async with s.get(
            f"{API_BASE}/shop/items", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            items: list[dict] = await resp.json()
    except Exception:
        await interaction.response.send_message(_t("gi_err"), ephemeral=True)
        return

    if not items:
        await interaction.response.send_message(_t("gi_no_items"), ephemeral=True)
        return

    # Find item by id (autocomplete) or name fallback
    target: dict | None = None
    for it in items:
        if str(it.get("id")) == item or it.get("name", "").lower() == item.lower():
            target = it
            break

    if not target:
        await interaction.response.send_message(_t("gi_not_found"), ephemeral=True)
        return

    qty = max(1, quantity)

    # Add to inventory via API
    result = await api_post(
        "/inventory",
        {
            "userId": str(member.id),
            "itemId": target["id"],
            "quantity": qty,
            "source": "admin",
        },
    )
    if result is None:
        await interaction.response.send_message(_t("gi_err"), ephemeral=True)
        return

    # Grant Discord role if item has one configured
    role_granted = False
    role_id = target.get("roleId")
    if role_id and interaction.guild:
        try:
            role = interaction.guild.get_role(int(role_id))
            if role:
                await member.add_roles(
                    role, reason=f"Admin give-item: {target['name']}"
                )
                role_granted = True
        except Exception:
            pass

    emoji = target.get("emoji", "📦")
    name = target.get("name", "?")

    embed = discord.Embed(
        title=_t("gi_title"),
        description=_t(
            "gi_desc", emoji=emoji, name=name, qty=qty, mention=member.mention
        ),
        colour=0x2ECC71,
    )
    if role_granted:
        embed.add_field(name=_t("gi_role"), value=f"<@&{role_id}>", inline=True)

    await interaction.response.send_message(embed=embed)

    # DM the recipient (best-effort — fails silently if DMs are closed)
    try:
        await member.send(_t("gi_notify", emoji=emoji, name=name, qty=qty))
    except Exception:
        pass

    await log_to_api(
        "INFO",
        f"Admin {interaction.user} gave '{name}' ×{qty} to {member} (id={member.id})",
    )


# ── Random activity loop ──────────────────────────────────────────────────────


@tasks.loop(minutes=1)
async def random_activity_loop() -> None:
    global _rdm_next_send
    if not _rdm_cfg.get("enabled"):
        return

    channel_id_str = _rdm_cfg.get("channelId", "")
    if not channel_id_str:
        return

    now = datetime.now(timezone.utc)
    if _rdm_next_send is None or now < _rdm_next_send:
        return

    # Pick a message: from pool or a command suggestion
    pool = [m for m in _rdm_messages if m.get("enabled", True)]
    include_suggestions = _rdm_cfg.get("includeCommandSuggestions", True)

    candidates: list[str] = [m["content"] for m in pool]
    if include_suggestions:
        suggestions = _tl("rdm_cmd_suggestions")
        candidates += [s.format(coin=_coin()) for s in suggestions]

    if not candidates:
        # Nothing to send — reschedule anyway
        _rdm_next_send = _next_rdm_time()
        return

    text = random.choice(candidates)
    topic = _rdm_cfg.get("topic", "").strip()
    if topic:
        text = f"**[{topic}]**\n{text}"

    try:
        channel_id = int(channel_id_str)
        channel = bot.get_channel(channel_id)
        if channel and hasattr(channel, "send"):
            await channel.send(text)  # type: ignore[union-attr]
            logger.info("Random activity: message sent to channel %s", channel_id)
        else:
            logger.warning("Random activity: channel %s not found", channel_id)
    except Exception as exc:
        logger.error("Random activity: failed to send message: %s", exc)

    _rdm_next_send = _next_rdm_time()


def _next_rdm_time() -> datetime:
    lo = max(1, _rdm_cfg.get("minIntervalMinutes", 30))
    hi = max(lo, _rdm_cfg.get("maxIntervalMinutes", 120))
    delay = random.randint(lo, hi)
    return datetime.now(timezone.utc) + timedelta(minutes=delay)


@random_activity_loop.before_loop
async def before_random_activity_loop() -> None:
    await bot.wait_until_ready()


# ── /rdm group ────────────────────────────────────────────────────────────────

rdm_group = app_commands.Group(
    name="rdm", description="[Admin] Gérer les messages aléatoires du bot"
)


def _rdm_merged(update: dict) -> dict:
    """Merge partial update dict with current _rdm_cfg for a full PUT body."""
    return {
        "enabled": update.get("enabled", _rdm_cfg.get("enabled", False)),
        "channelId": update.get("channelId", _rdm_cfg.get("channelId", "")),
        "topic": update.get("topic", _rdm_cfg.get("topic", "")),
        "minIntervalMinutes": update.get(
            "minIntervalMinutes", _rdm_cfg.get("minIntervalMinutes", 30)
        ),
        "maxIntervalMinutes": update.get(
            "maxIntervalMinutes", _rdm_cfg.get("maxIntervalMinutes", 120)
        ),
        "includeCommandSuggestions": update.get(
            "includeCommandSuggestions", _rdm_cfg.get("includeCommandSuggestions", True)
        ),
    }


@rdm_group.command(
    name="config",
    description="[Admin] Voir ou modifier la configuration des messages aléatoires",
)
@app_commands.describe(
    enabled="Activer ou désactiver les messages aléatoires",
    channel="Salon Discord où envoyer les messages",
    topic="Sujet / contexte des messages",
    min_interval="Intervalle minimum en minutes",
    max_interval="Intervalle maximum en minutes",
    command_suggestions="Inclure des suggestions de commandes aléatoires",
)
async def rdm_config(
    interaction: discord.Interaction,
    enabled: Optional[bool] = None,
    channel: Optional[discord.TextChannel] = None,
    topic: Optional[str] = None,
    min_interval: Optional[app_commands.Range[int, 1, 10080]] = None,
    max_interval: Optional[app_commands.Range[int, 1, 10080]] = None,
    command_suggestions: Optional[bool] = None,
) -> None:
    if not await check_cmd(interaction, "rdm-config"):
        return

    update: dict = {}
    if enabled is not None:
        update["enabled"] = enabled
    if channel is not None:
        update["channelId"] = str(channel.id)
    if topic is not None:
        update["topic"] = topic
    if min_interval is not None:
        update["minIntervalMinutes"] = min_interval
    if max_interval is not None:
        update["maxIntervalMinutes"] = max_interval
    if command_suggestions is not None:
        update["includeCommandSuggestions"] = command_suggestions

    if not update:
        # No args — show current config
        next_ts = _rdm_next_send.strftime("%H:%M UTC") if _rdm_next_send else "—"
        active = len([m for m in _rdm_messages if m.get("enabled", True)])
        lines = [
            f"**Activé :** {'✅' if _rdm_cfg.get('enabled', False) else '❌'}",
            (
                f"**Salon :** <#{_rdm_cfg['channelId']}>"
                if _rdm_cfg.get("channelId")
                else "**Salon :** non défini"
            ),
            f"**Sujet :** {_rdm_cfg.get('topic') or '—'}",
            f"**Intervalle :** {_rdm_cfg.get('minIntervalMinutes', 30)}–{_rdm_cfg.get('maxIntervalMinutes', 120)} min",
            f"**Suggestions de commandes :** {'✅' if _rdm_cfg.get('includeCommandSuggestions', True) else '❌'}",
            f"**Pool :** {active} actif(s) / {len(_rdm_messages)} total",
            f"**Prochain envoi :** {next_ts}",
        ]
        embed = discord.Embed(
            title="🔀 Messages aléatoires — Config",
            description="\n".join(lines),
            colour=0x6366F1,
        )
        embed.set_footer(
            text="Modifiez directement depuis le Dashboard → Msgs aléatoires"
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    await api_put("/random-activity/config", _rdm_merged(update))
    await refresh_random_activity()

    if "enabled" in update and len(update) == 1:
        msg = _t("rdm_cfg_enabled") if enabled else _t("rdm_cfg_disabled")
    else:
        msg = _t("rdm_cfg_saved")
    await interaction.response.send_message(msg, ephemeral=True)


@rdm_group.command(
    name="toggle",
    description="[Admin] Activer ou désactiver les messages aléatoires en un clic",
)
async def rdm_toggle(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "rdm-toggle"):
        return
    new_state = not _rdm_cfg.get("enabled", False)
    await api_put("/random-activity/config", _rdm_merged({"enabled": new_state}))
    await refresh_random_activity()
    await interaction.response.send_message(
        _t("rdm_cfg_enabled") if new_state else _t("rdm_cfg_disabled"),
        ephemeral=True,
    )


@rdm_group.command(
    name="add", description="[Admin] Ajouter un message au pool des messages aléatoires"
)
@app_commands.describe(message="Le texte du message à ajouter au pool")
async def rdm_add(interaction: discord.Interaction, message: str) -> None:
    if not await check_cmd(interaction, "rdm-add"):
        return
    result = await api_post("/random-activity/messages", {"content": message.strip()})
    if result and "id" in result:
        await refresh_random_activity()
        active = len([m for m in _rdm_messages if m.get("enabled", True)])
        embed = discord.Embed(
            title=f"✅ {_t('rdm_msg_added')}",
            description=f"> {message.strip()[:300]}",
            colour=0x22C55E,
        )
        embed.set_footer(
            text=f"ID #{result['id']} • {active} message(s) actif(s) dans le pool"
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
    else:
        await interaction.response.send_message(_t("rdm_cfg_saved"), ephemeral=True)


@rdm_group.command(
    name="list", description="[Admin] Lister tous les messages du pool avec leurs IDs"
)
async def rdm_list(interaction: discord.Interaction) -> None:
    if not await check_cmd(interaction, "rdm-list"):
        return
    if not _rdm_messages:
        await interaction.response.send_message(_t("rdm_list_empty"), ephemeral=True)
        return
    lines = []
    for m in _rdm_messages:
        status = "✅" if m.get("enabled", True) else "❌"
        preview = m["content"][:80] + ("…" if len(m["content"]) > 80 else "")
        lines.append(f"`#{m['id']}` {status} {preview}")
    description = "\n".join(lines)[:4000]
    active = len([m for m in _rdm_messages if m.get("enabled", True)])
    embed = discord.Embed(
        title=f"🔀 {_t('rdm_list_title')} — {active} actif(s) / {len(_rdm_messages)} total",
        description=description,
        colour=0x6366F1,
    )
    embed.set_footer(text="/rdm remove <id> • /rdm add <message> • /rdm toggle")
    await interaction.response.send_message(embed=embed, ephemeral=True)


@rdm_group.command(
    name="remove",
    description="[Admin] Supprimer un message du pool (voir les IDs avec /rdm list)",
)
@app_commands.describe(id="L'ID du message à supprimer (obtenu avec /rdm list)")
async def rdm_remove(interaction: discord.Interaction, id: int) -> None:
    if not await check_cmd(interaction, "rdm-remove"):
        return
    result = await api_delete(f"/random-activity/messages/{id}")
    if result is True:
        await refresh_random_activity()
        await interaction.response.send_message(_t("rdm_msg_removed"), ephemeral=True)
    elif result is False:
        await interaction.response.send_message(_t("rdm_msg_not_found"), ephemeral=True)
    else:
        await interaction.response.send_message(_t("rdm_cfg_saved"), ephemeral=True)


bot.tree.add_command(rdm_group)


# ── /config ───────────────────────────────────────────────────────────────────

config_group = app_commands.Group(
    name="config", description="[Admin] Configure bot settings"
)


@config_group.command(
    name="language",
    description="[Admin] Change the bot language / Changer la langue du bot",
)
@app_commands.describe(language="Bot language")
@app_commands.choices(
    language=[
        app_commands.Choice(name="Français 🇫🇷", value="fr"),
        app_commands.Choice(name="English 🇬🇧", value="en"),
    ]
)
async def config_language(
    interaction: discord.Interaction, language: app_commands.Choice[str]
) -> None:
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return
    if language.value == _lang:
        lang_name = "Français" if _lang == "fr" else "English"
        await interaction.response.send_message(
            _t("config_lang_already", lang=lang_name), ephemeral=True
        )
        return
    await api_patch("/economy/config", {"language": language.value})
    await refresh_economy_config()
    await interaction.response.send_message(_t("config_lang_set"), ephemeral=True)
    logger.info("Language changed to %s by %s", language.value, interaction.user)


bot.tree.add_command(config_group)


# ── Ticket system ─────────────────────────────────────────────────────────────


async def _ticket_log(msg: str) -> None:
    """Send a log message to the configured log channel."""
    log_id = _tkts_cfg.get("logChannelId", "")
    if not log_id:
        return
    try:
        ch = bot.get_channel(int(log_id))
        if ch and hasattr(ch, "send"):
            await ch.send(msg)
    except Exception:
        pass


class TicketCloseView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Fermer le ticket",
        style=discord.ButtonStyle.danger,
        custom_id="ticket:close",
        emoji="🔒",
    )
    async def close_ticket(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        channel = interaction.channel
        if not isinstance(channel, discord.TextChannel):
            await interaction.response.send_message(
                "❌ Action invalide.", ephemeral=True
            )
            return

        # Mark ticket closed via API
        result = await api_patch(
            f"/tickets/channel/{channel.id}",
            {
                "status": "closed",
                "closedBy": str(interaction.user.id),
                "closedByName": str(interaction.user),
            },
        )
        if result is None:
            await interaction.response.send_message(
                _t("tkt_close_not_ticket"), ephemeral=True
            )
            return

        await interaction.response.send_message(
            _t("tkt_closing", user=interaction.user.mention)
        )

        ticket_id = result.get("id", "?")
        await _ticket_log(
            _t("tkt_log_closed", id=ticket_id, closed_by=str(interaction.user))
        )

        await asyncio.sleep(5)
        try:
            await channel.delete(
                reason=f"Ticket #{ticket_id} fermé par {interaction.user}"
            )
        except discord.Forbidden:
            pass


class TicketOpenView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Ouvrir un ticket",
        style=discord.ButtonStyle.primary,
        custom_id="ticket:open",
        emoji="🎫",
    )
    async def open_ticket(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if not _tkts_cfg.get("enabled"):
            await interaction.response.send_message(_t("tkt_disabled"), ephemeral=True)
            return

        guild = interaction.guild
        if guild is None:
            return

        # Check for existing open ticket
        existing = await api_get_list("/tickets?status=open")
        if existing:
            for tkt in existing:
                if tkt.get("userId") == str(interaction.user.id):
                    ch = (
                        guild.get_channel(int(tkt["channelId"]))
                        if tkt.get("channelId")
                        else None
                    )
                    mention = ch.mention if ch else f"<#{tkt['channelId']}>"
                    await interaction.response.send_message(
                        _t("tkt_already_open", channel=mention), ephemeral=True
                    )
                    return

        await interaction.response.defer(ephemeral=True)

        # Resolve optional category
        category: Optional[discord.CategoryChannel] = None
        cat_id = _tkts_cfg.get("categoryId", "")
        if cat_id:
            try:
                found = guild.get_channel(int(cat_id))
                if isinstance(found, discord.CategoryChannel):
                    category = found
            except ValueError:
                pass

        # Build permission overwrites
        overwrites: dict = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            interaction.user: discord.PermissionOverwrite(
                view_channel=True,
                send_messages=True,
                read_message_history=True,
                attach_files=True,
            ),
        }
        if bot.user:
            overwrites[bot.user] = discord.PermissionOverwrite(
                view_channel=True,
                send_messages=True,
                manage_channels=True,
                manage_messages=True,
            )
        staff_id = _tkts_cfg.get("staffRoleId", "")
        if staff_id:
            try:
                role = guild.get_role(int(staff_id))
                if role:
                    overwrites[role] = discord.PermissionOverwrite(
                        view_channel=True,
                        send_messages=True,
                        read_message_history=True,
                        manage_messages=True,
                        manage_channels=True,
                    )
            except ValueError:
                pass

        # Create ticket channel
        safe_name = re.sub(r"[^a-z0-9]", "", interaction.user.name.lower()) or "user"
        channel_name = f"ticket-{safe_name}"
        try:
            ticket_channel = await guild.create_text_channel(
                channel_name,
                category=category,
                overwrites=overwrites,
                topic=f"Ticket de {interaction.user} | {interaction.user.id}",
            )
        except discord.Forbidden:
            await interaction.followup.send(
                "❌ Permissions insuffisantes pour créer le salon.", ephemeral=True
            )
            return
        except Exception as e:
            await interaction.followup.send(f"❌ Erreur : {e}", ephemeral=True)
            return

        # Record in API
        result = await api_post(
            "/tickets",
            {
                "userId": str(interaction.user.id),
                "userName": str(interaction.user),
                "channelId": str(ticket_channel.id),
            },
        )
        ticket_id = result.get("id", "?") if result else "?"

        # Send welcome message in ticket channel
        welcome_text = _tkts_cfg.get("welcomeMessage", "").replace(
            "{user}", interaction.user.mention
        )
        embed = discord.Embed(
            title=f"🎫 Ticket #{ticket_id}",
            description=welcome_text,
            colour=0x5865F2,
        )
        embed.set_footer(text=f"Ouvert par {interaction.user} · {interaction.user.id}")
        try:
            await ticket_channel.send(
                content=f"{interaction.user.mention} <@&1528407563190800435>",
                embed=embed,
                view=TicketCloseView(),
            )
        except Exception:
            pass

        # Log
        await _ticket_log(
            _t(
                "tkt_log_opened",
                id=ticket_id,
                user=str(interaction.user),
                channel=ticket_channel.mention,
            )
        )

        await interaction.followup.send(
            _t("tkt_created", channel=ticket_channel.mention), ephemeral=True
        )


# ── /ticket group ─────────────────────────────────────────────────────────────

ticket_group = app_commands.Group(
    name="ticket", description="[Admin] Système de tickets"
)


@ticket_group.command(
    name="setup",
    description="[Admin] Envoyer l'embed de ticket dans le salon configuré",
)
async def ticket_setup(interaction: discord.Interaction) -> None:
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    await refresh_ticket_config()

    panel_id = _tkts_cfg.get("panelChannelId", "")
    if not panel_id:
        await interaction.response.send_message(
            _t("tkt_not_configured"), ephemeral=True
        )
        return

    guild = interaction.guild
    if guild is None:
        return

    try:
        panel_ch = guild.get_channel(int(panel_id))
        if panel_ch is None or not hasattr(panel_ch, "send"):
            raise ValueError
    except (ValueError, TypeError):
        await interaction.response.send_message(
            _t("tkt_setup_err_channel", channel_id=panel_id), ephemeral=True
        )
        return

    color_hex = _tkts_cfg.get("embedColor", "5865F2").lstrip("#")
    try:
        color_int = int(color_hex, 16)
    except ValueError:
        color_int = 0x5865F2

    embed = discord.Embed(
        title=_tkts_cfg.get("embedTitle", "🎫 Support"),
        description=_tkts_cfg.get("embedDescription", ""),
        colour=color_int,
    )

    await interaction.response.defer(ephemeral=True)
    try:
        await panel_ch.send(embed=embed, view=TicketOpenView())
        await interaction.followup.send(
            _t("tkt_setup_done", channel=panel_ch.mention), ephemeral=True
        )
    except Exception as e:
        await interaction.followup.send(f"❌ Erreur : {e}", ephemeral=True)


@ticket_group.command(name="close", description="[Admin] Fermer le ticket de ce salon")
async def ticket_close_cmd(interaction: discord.Interaction) -> None:
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    channel = interaction.channel
    if not isinstance(channel, discord.TextChannel):
        await interaction.response.send_message(
            _t("tkt_close_not_ticket"), ephemeral=True
        )
        return

    result = await api_patch(
        f"/tickets/channel/{channel.id}",
        {
            "status": "closed",
            "closedBy": str(interaction.user.id),
            "closedByName": str(interaction.user),
        },
    )
    if result is None:
        await interaction.response.send_message(
            _t("tkt_close_not_ticket"), ephemeral=True
        )
        return

    await interaction.response.send_message(
        _t("tkt_closing", user=interaction.user.mention)
    )
    ticket_id = result.get("id", "?")
    await _ticket_log(
        _t("tkt_log_closed", id=ticket_id, closed_by=str(interaction.user))
    )
    await asyncio.sleep(5)
    try:
        await channel.delete(reason=f"Ticket #{ticket_id} fermé par {interaction.user}")
    except discord.Forbidden:
        pass


@ticket_group.command(
    name="add", description="[Admin] Ajouter un membre au ticket actuel"
)
@app_commands.describe(member="Membre à ajouter")
async def ticket_add(interaction: discord.Interaction, member: discord.Member) -> None:
    if not is_admin(interaction):
        await interaction.response.send_message(_t("err_admin_perm"), ephemeral=True)
        return

    channel = interaction.channel
    if not isinstance(channel, discord.TextChannel):
        await interaction.response.send_message(
            _t("tkt_close_not_ticket"), ephemeral=True
        )
        return

    try:
        await channel.set_permissions(
            member,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            attach_files=True,
        )
        await interaction.response.send_message(_t("tkt_add_done", user=member.mention))
    except Exception:
        await interaction.response.send_message(
            _t("tkt_add_err", user=member.mention), ephemeral=True
        )


bot.tree.add_command(ticket_group)


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

import discord
from discord.ext import commands


# --- 1. CLASSE DU BOUTON DE REDÉMARRAGE ---
class RestartView(discord.ui.View):
    def __init__(self, owner_id):
        super().__init__(timeout=None)  # Le bouton ne périme pas
        self.owner_id = owner_id

    @discord.ui.button(
        label="Redémarrer le Bot 🔄",
        style=discord.ButtonStyle.danger,
        custom_id="restart_bot_btn",
    )
    async def restart_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        # Vérification des permissions : seul le créateur du bot peut cliquer
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message(
                "❌ Seul le propriétaire du bot peut exécuter cette action.",
                ephemeral=True,
            )
            return

        # Confirmation dans Discord
        await interaction.response.send_message(
            "🔄 **Redémarrage en cours...** La connexion va être relancée.",
            ephemeral=True,
        )

        # Ferme proprement le bot (Replit relancera automatiquement le script)
        await interaction.client.close()


# --- 2. COMMANDE POUR AFFICHER L'OVERVIEW / PANNEAU DE CONTRÔLE ---
@bot.command(name="overview")
async def overview(ctx):
    # Création du message de présentation (Embed)
    embed = discord.Embed(
        title="🎮 Dashboard & Overview du Bot",
        description="Gestion globale de l'état du bot et des commandes.",
        color=discord.Color.blue(),
    )
    embed.add_field(name="Statut", value="🟢 En ligne & opérationnel", inline=True)
    embed.add_field(
        name="Commande",
        value="Utilise le bouton ci-dessous pour relancer l'instance.",
        inline=False,
    )
    
    # Association du bouton au message (le ctx fonctionne ici car c'est une commande)
    view = RestartView(owner_id=ctx.author.id)
    await ctx.send(embed=embed, view=view)
    

# Association du bouton au message
    view = RestartView(owner_id=ctx.author.id)
    await ctx.send(embed=embed, view=view)

    if __name__ == "__main__":
        keep_alive()
        bot.run(os.environ.get("DISCORD_TOKEN"))
