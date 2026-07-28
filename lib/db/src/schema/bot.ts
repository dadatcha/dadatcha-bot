import { pgTable, text, serial, boolean, integer, timestamp, bigint } from "drizzle-orm/pg-core";
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
