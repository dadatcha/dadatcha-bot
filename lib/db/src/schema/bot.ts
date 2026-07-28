import { pgTable, text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
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

// Custom slash commands
export const botCommandsTable = pgTable("bot_commands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  response: text("response").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotCommandSchema = createInsertSchema(botCommandsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBotCommand = z.infer<typeof insertBotCommandSchema>;
export type BotCommand = typeof botCommandsTable.$inferSelect;

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
