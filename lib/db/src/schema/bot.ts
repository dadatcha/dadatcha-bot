import { pgTable, text, serial, boolean, integer, timestamp, bigint, index, uniqueIndex, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Bot configuration (single row, id=1)
export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().default("1531418977677475992"),
  reminderEnabled: boolean("reminder_enabled").notNull().default(true),
  reminderIntervalMinutes: integer("reminder_interval_minutes").notNull().default(1),
  reminderMessage: text("reminder_message").notNull().default(`Here is the lotto channel.
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
And more!`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotConfigSchema = createInsertSchema(botConfigTable).omit({ id: true, updatedAt: true });
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type BotConfig = typeof botConfigTable.$inferSelect;

// Multiple reminders
export const remindersTable = pgTable("reminders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Reminder"),
  channelId: text("channel_id").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertReminderSchema = createInsertSchema(remindersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type Reminder = typeof remindersTable.$inferSelect;

// Activity logs
export const botLogsTable = pgTable("bot_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("INFO"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotLogSchema = createInsertSchema(botLogsTable).omit({ id: true, createdAt: true });
export type InsertBotLog = z.infer<typeof insertBotLogSchema>;
export type BotLog = typeof botLogsTable.$inferSelect;

// Bot runtime status (single row, written by bot heartbeat)
export const botStatusTable = pgTable("bot_status", {
  id: serial("id").primaryKey(),
  connected: boolean("connected").notNull().default(false),
  botName: text("bot_name"),
  botId: text("bot_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  remindersSentToday: integer("reminders_sent_today").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

// Economy command configuration (single row, id=1)
export const economyConfigTable = pgTable("economy_config", {
  id: serial("id").primaryKey(),
  startingWallet: integer("starting_wallet").notNull().default(200),
  balanceEnabled: boolean("balance_enabled").notNull().default(true),
  moneyEnabled: boolean("money_enabled").notNull().default(true),
  dailyEnabled: boolean("daily_enabled").notNull().default(true),
  dailyAmount: integer("daily_amount").notNull().default(500),
  dailyCooldownHours: integer("daily_cooldown_hours").notNull().default(24),
  workEnabled: boolean("work_enabled").notNull().default(true),
  workMinAmount: integer("work_min_amount").notNull().default(50),
  workMaxAmount: integer("work_max_amount").notNull().default(200),
  workCooldownHours: integer("work_cooldown_hours").notNull().default(1),
  crimeEnabled: boolean("crime_enabled").notNull().default(true),
  crimeWinMin: integer("crime_win_min").notNull().default(100),
  crimeWinMax: integer("crime_win_max").notNull().default(500),
  crimeLoseMin: integer("crime_lose_min").notNull().default(50),
  crimeLoseMax: integer("crime_lose_max").notNull().default(200),
  crimeWinChance: integer("crime_win_chance").notNull().default(60),
  crimeCooldownHours: integer("crime_cooldown_hours").notNull().default(2),
  depositEnabled: boolean("deposit_enabled").notNull().default(true),
  withdrawEnabled: boolean("withdraw_enabled").notNull().default(true),
  giveEnabled: boolean("give_enabled").notNull().default(true),
  leaderboardEnabled: boolean("leaderboard_enabled").notNull().default(true),
  blackjackEnabled: boolean("blackjack_enabled").notNull().default(true),
  blackjackMinBet: integer("blackjack_min_bet").notNull().default(10),
  blackjackMaxBet: integer("blackjack_max_bet").notNull().default(1000),
  rouletteEnabled: boolean("roulette_enabled").notNull().default(true),
  rouletteMinBet: integer("roulette_min_bet").notNull().default(10),
  rouletteMaxBet: integer("roulette_max_bet").notNull().default(1000),
  hlEnabled: boolean("hl_enabled").notNull().default(true),
  hlMinBet: integer("hl_min_bet").notNull().default(10),
  hlMaxBet: integer("hl_max_bet").notNull().default(500),
  hlStreakReward: integer("hl_streak_reward").notNull().default(25),
  guessEnabled: boolean("guess_enabled").notNull().default(true),
  guessMinBet: integer("guess_min_bet").notNull().default(10),
  guessMaxBet: integer("guess_max_bet").notNull().default(1000),
  guessMaxAttempts: integer("guess_max_attempts").notNull().default(7),
  currencyName: text("currency_name").notNull().default("coins"),
  messageRewardEnabled: boolean("message_reward_enabled").notNull().default(false),
  messageRewardMin: integer("message_reward_min").notNull().default(1),
  messageRewardMax: integer("message_reward_max").notNull().default(10),
  messageRewardCooldownSeconds: integer("message_reward_cooldown_seconds").notNull().default(60),
  language: text("language").notNull().default("fr"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EconomyConfig = typeof economyConfigTable.$inferSelect;

// Player economy
export const userEconomyTable = pgTable("user_economy", {
  userId: text("user_id").primaryKey(),
  username: text("username").notNull(),
  wallet: bigint("wallet", { mode: "number" }).notNull().default(0),
  bank: bigint("bank", { mode: "number" }).notNull().default(0),
  xp: bigint("xp", { mode: "number" }).notNull().default(0),
  level: integer("level").notNull().default(0),
  lastDaily: timestamp("last_daily", { withTimezone: true }),
  lastWork: timestamp("last_work", { withTimezone: true }),
  lastCrime: timestamp("last_crime", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserEconomySchema = createInsertSchema(userEconomyTable).omit({ updatedAt: true });
export type InsertUserEconomy = z.infer<typeof insertUserEconomySchema>;
export type UserEconomy = typeof userEconomyTable.$inferSelect;

// Shop items
export const shopItemsTable = pgTable("shop_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: bigint("price", { mode: "number" }).notNull().default(0),
  roleId: text("role_id"),
  emoji: text("emoji").notNull().default("🛍️"),
  enabled: boolean("enabled").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShopItem = typeof shopItemsTable.$inferSelect;

// User inventory — tracks items owned by each Discord user
export const userInventoryTable = pgTable("user_inventory", {
  id:          serial("id").primaryKey(),
  userId:      text("user_id").notNull(),
  itemId:      integer("item_id").notNull().references(() => shopItemsTable.id, { onDelete: "cascade" }),
  quantity:    integer("quantity").notNull().default(1),
  source:      text("source").notNull().default("buy"), // "buy" | "giveaway" | "admin"
  acquiredAt:  timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("inv_user_idx").on(t.userId)]);

export type UserInventory = typeof userInventoryTable.$inferSelect;

// Role rewards — automatically assign/remove roles when member gains triggerRoleId
export const roleRewardsTable = pgTable("role_rewards", {
  id: serial("id").primaryKey(),
  triggerRoleId: text("trigger_role_id").notNull(),
  rewardRoleId: text("reward_role_id").notNull(),
  removeRoleId: text("remove_role_id"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoleReward = typeof roleRewardsTable.$inferSelect;

// Sync jobs — track "apply rules to all members" requests from the dashboard
export const roleRewardsSyncJobsTable = pgTable("role_rewards_sync_jobs", {
  id:          serial("id").primaryKey(),
  status:      text("status").notNull().default("pending"), // pending | running | done | error
  total:       integer("total"),
  processed:   integer("processed"),
  errors:      integer("errors"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type RoleRewardsSyncJob = typeof roleRewardsSyncJobsTable.$inferSelect;

// Per-command visibility/permission config
export const commandConfigsTable = pgTable("command_configs", {
  commandName: text("command_name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  adminOnly: boolean("admin_only").notNull().default(false),
  label: text("label"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CommandConfig = typeof commandConfigsTable.$inferSelect;

// Bot-pushed command manifest — source of truth for what commands exist
export const commandManifestTable = pgTable("command_manifest", {
  name:         text("name").primaryKey(),
  defaultLabel: text("default_label").notNull(),
  description:  text("description").notNull().default(""),
  category:     text("category").notNull().default("other"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CommandManifest = typeof commandManifestTable.$inferSelect;

// Giveaways
export const giveawaysTable = pgTable("giveaways", {
  id:           serial("id").primaryKey(),
  channelId:    text("channel_id").notNull(),
  messageId:    text("message_id"),
  guildId:      text("guild_id").notNull().default(""),
  prize:        text("prize").notNull(),
  winnersCount: integer("winners_count").notNull().default(1),
  endsAt:       timestamp("ends_at", { withTimezone: true }).notNull(),
  endedAt:      timestamp("ended_at", { withTimezone: true }),
  winners:             text("winners").array().notNull().default([]),
  status:              text("status").notNull().default("active"), // active | ended | cancelled
  requiredRoleId:      text("required_role_id"),        // legacy single (kept for compat)
  requiredMinBalance:  integer("required_min_balance"),
  // v2 fields
  requiredRoleIds:     text("required_role_ids").array().notNull().default([]),
  forbiddenRoleIds:    text("forbidden_role_ids").array().notNull().default([]),
  hostId:              text("host_id"),
  mentionedUserIds:    text("mentioned_user_ids").array().notNull().default([]),
  mentionedRoleIds:    text("mentioned_role_ids").array().notNull().default([]),
  rewards:             json("rewards").$type<GiveawayReward[]>().notNull().default([]),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GiveawayReward =
  | { type: "money"; amount: number }
  | { type: "role"; roleId: string; roleName: string; roleDurationMinutes?: number }
  | { type: "item"; itemId: number; itemName: string };

// Temporary roles — track roles that must be removed after a delay
export const temporaryRolesTable = pgTable("temporary_roles", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  guildId:   text("guild_id").notNull(),
  roleId:    text("role_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  reason:    text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tmp_role_expires_idx").on(t.expiresAt)]);

export type TemporaryRole = typeof temporaryRolesTable.$inferSelect;

export type Giveaway = typeof giveawaysTable.$inferSelect;

// Random activity — periodic random messages + command suggestions
export const randomActivityConfigTable = pgTable("random_activity_config", {
  id:                       serial("id").primaryKey(),
  enabled:                  boolean("enabled").notNull().default(false),
  channelId:                text("channel_id").notNull().default(""),
  topic:                    text("topic").notNull().default(""),
  minIntervalMinutes:       integer("min_interval_minutes").notNull().default(30),
  maxIntervalMinutes:       integer("max_interval_minutes").notNull().default(120),
  includeCommandSuggestions: boolean("include_command_suggestions").notNull().default(true),
  nextSendAt:               timestamp("next_send_at", { withTimezone: true }),
});

export type RandomActivityConfig = typeof randomActivityConfigTable.$inferSelect;

export const randomMessagesTable = pgTable("random_messages", {
  id:        serial("id").primaryKey(),
  content:   text("content").notNull(),
  enabled:   boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RandomMessage = typeof randomMessagesTable.$inferSelect;

// ── Ticket system ─────────────────────────────────────────────────────────────

// Single-row config (id = 1)
export const ticketConfigTable = pgTable("ticket_config", {
  id:               serial("id").primaryKey(),
  enabled:          boolean("enabled").notNull().default(false),
  panelChannelId:   text("panel_channel_id").notNull().default(""),
  categoryId:       text("category_id").notNull().default(""),
  staffRoleId:      text("staff_role_id").notNull().default(""),
  embedTitle:       text("embed_title").notNull().default("🎫 Support"),
  embedDescription: text("embed_description").notNull().default("Cliquez sur le bouton ci-dessous pour ouvrir un ticket de support.\nUn membre du staff vous répondra dès que possible."),
  embedColor:       text("embed_color").notNull().default("5865F2"),
  logChannelId:     text("log_channel_id").notNull().default(""),
  welcomeMessage:   text("welcome_message").notNull().default("Bonjour {user} ! Un membre du staff va vous répondre bientôt."),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TicketConfig = typeof ticketConfigTable.$inferSelect;

// One row per ticket
export const ticketsTable = pgTable("tickets", {
  id:           serial("id").primaryKey(),
  userId:       text("user_id").notNull(),
  userName:     text("user_name").notNull().default(""),
  channelId:    text("channel_id").notNull(),
  status:       text("status").notNull().default("open"), // open | closed
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt:     timestamp("closed_at", { withTimezone: true }),
  closedBy:     text("closed_by"),
  closedByName: text("closed_by_name"),
});

export type Ticket = typeof ticketsTable.$inferSelect;

// ── Welcome / Leave embeds ────────────────────────────────────────────────────

export const welcomeConfigTable = pgTable("welcome_config", {
  id:                    serial("id").primaryKey(),
  // join
  joinEnabled:           boolean("join_enabled").notNull().default(false),
  joinChannelId:         text("join_channel_id").notNull().default(""),
  joinEmbedTitle:        text("join_embed_title").notNull().default("Bienvenue sur {server} ! 🎉"),
  joinEmbedDescription:  text("join_embed_description").notNull().default("Bienvenue {mention}, tu es le **{count}ème** membre !"),
  joinEmbedColor:        text("join_embed_color").notNull().default("57F287"),
  joinEmbedFooter:       text("join_embed_footer").notNull().default(""),
  joinShowAvatar:        boolean("join_show_avatar").notNull().default(true),
  // leave
  leaveEnabled:          boolean("leave_enabled").notNull().default(false),
  leaveChannelId:        text("leave_channel_id").notNull().default(""),
  leaveEmbedTitle:       text("leave_embed_title").notNull().default("{user} a quitté le serveur. 👋"),
  leaveEmbedDescription: text("leave_embed_description").notNull().default("Nous sommes maintenant **{count}** membres."),
  leaveEmbedColor:       text("leave_embed_color").notNull().default("ED4245"),
  leaveEmbedFooter:      text("leave_embed_footer").notNull().default(""),
  leaveShowAvatar:       boolean("leave_show_avatar").notNull().default(true),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WelcomeConfig = typeof welcomeConfigTable.$inferSelect;

// ── Custom commands ───────────────────────────────────────────────────────────

export const customCommandsTable = pgTable("custom_commands", {
  id:                serial("id").primaryKey(),
  trigger:           text("trigger").notNull(),
  matchMode:         text("match_mode").notNull().default("exact"),       // exact | startswith | contains
  caseSensitive:     boolean("case_sensitive").notNull().default(false),
  responseType:      text("response_type").notNull().default("message"),  // message | embed
  response:          text("response").notNull().default(""),
  embedTitle:        text("embed_title").notNull().default(""),
  embedColor:        text("embed_color").notNull().default("5865F2"),
  embedFooter:       text("embed_footer").notNull().default(""),
  enabled:           boolean("enabled").notNull().default(true),
  deleteUserMessage: boolean("delete_user_message").notNull().default(false),
  replyToUser:       boolean("reply_to_user").notNull().default(false),
  allowedChannels:   text("allowed_channels").notNull().default(""),  // comma-separated channel IDs
  allowedRoles:      text("allowed_roles").notNull().default(""),     // comma-separated role IDs
  cooldownSeconds:   integer("cooldown_seconds").notNull().default(0),
  // ── Optional rewards ─────────────────────────────────────────────────────────
  rewardEnabled:     boolean("reward_enabled").notNull().default(false),
  rewardTarget:      text("reward_target").notNull().default("mentioned"), // mentioned | author
  rewardRoleId:      text("reward_role_id").notNull().default(""),   // Discord role ID to assign
  rewardMoney:       integer("reward_money").notNull().default(0),   // coins added to wallet
  rewardXp:          integer("reward_xp").notNull().default(0),      // XP points added
  rewardLevels:      integer("reward_levels").notNull().default(0),  // levels added
  createdAt:         timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at",  { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomCommandSchema = createInsertSchema(customCommandsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomCommand = z.infer<typeof insertCustomCommandSchema>;
export type CustomCommand = typeof customCommandsTable.$inferSelect;

// ── Automoderation config (single row, id=1) ─────────────────────────────────

export const automodConfigTable = pgTable("automod_config", {
  id:                     serial("id").primaryKey(),
  enabled:                boolean("enabled").notNull().default(false),
  logChannelId:           text("log_channel_id").notNull().default(""),
  ignoredRoleIds:         text("ignored_role_ids").array().notNull().default([]),
  ignoredChannelIds:      text("ignored_channel_ids").array().notNull().default([]),
  // Bad words
  badWordsEnabled:        boolean("bad_words_enabled").notNull().default(false),
  badWords:               text("bad_words").array().notNull().default([]),
  badWordsAction:         text("bad_words_action").notNull().default("delete"),   // delete|warn|timeout|kick|ban
  badWordsTimeoutMinutes: integer("bad_words_timeout_minutes").notNull().default(10),
  // Spam
  spamEnabled:            boolean("spam_enabled").notNull().default(false),
  spamMaxMessages:        integer("spam_max_messages").notNull().default(5),
  spamWindowSeconds:      integer("spam_window_seconds").notNull().default(5),
  spamAction:             text("spam_action").notNull().default("timeout"),
  spamTimeoutMinutes:     integer("spam_timeout_minutes").notNull().default(5),
  // Caps
  capsEnabled:            boolean("caps_enabled").notNull().default(false),
  capsPercent:            integer("caps_percent").notNull().default(70),
  capsMinLength:          integer("caps_min_length").notNull().default(10),
  capsAction:             text("caps_action").notNull().default("delete"),
  // Links
  linksEnabled:           boolean("links_enabled").notNull().default(false),
  linksWhitelist:         text("links_whitelist").array().notNull().default([]),
  linksAction:            text("links_action").notNull().default("delete"),
  linksTimeoutMinutes:    integer("links_timeout_minutes").notNull().default(5),
  // Mass mention
  mentionEnabled:         boolean("mention_enabled").notNull().default(false),
  mentionMax:             integer("mention_max").notNull().default(5),
  mentionAction:          text("mention_action").notNull().default("delete"),
  mentionTimeoutMinutes:  integer("mention_timeout_minutes").notNull().default(5),
  // General
  sendWarnDm:             boolean("send_warn_dm").notNull().default(true),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AutomodConfig = typeof automodConfigTable.$inferSelect;

// Reward deduplication log — one row per (cmd, author, target) pair
export const ccRewardLogTable = pgTable("cc_reward_log", {
  id:        serial("id").primaryKey(),
  cmdId:     integer("cmd_id").notNull(),
  authorId:  text("author_id").notNull(),
  targetId:  text("target_id").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cc_reward_log_unique").on(t.cmdId, t.authorId, t.targetId),
]);
