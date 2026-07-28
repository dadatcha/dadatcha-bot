import { pgTable, text, serial, boolean, integer, timestamp, bigint, index } from "drizzle-orm/pg-core";
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
  blackjackMaxBet: integer("blackjack_max_bet").notNull().default(1000),
  rouletteEnabled: boolean("roulette_enabled").notNull().default(true),
  rouletteMaxBet: integer("roulette_max_bet").notNull().default(1000),
  hlEnabled: boolean("hl_enabled").notNull().default(true),
  currencyName: text("currency_name").notNull().default("coins"),
  messageRewardEnabled: boolean("message_reward_enabled").notNull().default(false),
  messageRewardMin: integer("message_reward_min").notNull().default(1),
  messageRewardMax: integer("message_reward_max").notNull().default(10),
  messageRewardCooldownSeconds: integer("message_reward_cooldown_seconds").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EconomyConfig = typeof economyConfigTable.$inferSelect;

// Player economy
export const userEconomyTable = pgTable("user_economy", {
  userId: text("user_id").primaryKey(),
  username: text("username").notNull(),
  wallet: bigint("wallet", { mode: "number" }).notNull().default(0),
  bank: bigint("bank", { mode: "number" }).notNull().default(0),
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
  price: integer("price").notNull().default(0),
  roleId: text("role_id"),
  emoji: text("emoji").notNull().default("🛍️"),
  enabled: boolean("enabled").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShopItem = typeof shopItemsTable.$inferSelect;

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
  winners:      text("winners").array().notNull().default([]),
  status:       text("status").notNull().default("active"), // active | ended | cancelled
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Giveaway = typeof giveawaysTable.$inferSelect;
