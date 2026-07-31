import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigTable, botLogsTable, botStatusTable, remindersTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  GetBotConfigResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
  GetLogsQueryParams,
  GetLogsResponse,
  AddLogBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Restart flag (set by dashboard, consumed by next heartbeat) ───────────────
let _restartFlag = false;

// ── Status ────────────────────────────────────────────────────────────────────

router.get("/bot/status", async (req, res): Promise<void> => {
  const [row] = await db.select().from(botStatusTable).where(eq(botStatusTable.id, 1));

  if (!row) {
    res.json(GetBotStatusResponse.parse({
      connected: false,
      botName: null,
      botId: null,
      uptimeSeconds: null,
      lastReminderAt: null,
      remindersSentToday: 0,
      lastSeenAt: null,
    }));
    return;
  }

  const uptimeSeconds = row.startedAt
    ? Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 1000)
    : null;

  res.json(GetBotStatusResponse.parse({
    connected: row.connected,
    botName: row.botName ?? null,
    botId: row.botId ?? null,
    uptimeSeconds,
    lastReminderAt: row.lastReminderAt?.toISOString() ?? null,
    remindersSentToday: row.remindersSentToday,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  }));
});

// Called by the Python bot heartbeat
router.post("/bot/heartbeat", async (req, res): Promise<void> => {
  const { connected, botName, botId, startedAt, lastReminderAt, remindersSentToday } = req.body as {
    connected: boolean;
    botName?: string;
    botId?: string;
    startedAt?: string;
    lastReminderAt?: string;
    remindersSentToday?: number;
  };

  const [existing] = await db.select().from(botStatusTable).where(eq(botStatusTable.id, 1));

  const values = {
    connected,
    botName: botName ?? null,
    botId: botId ?? null,
    startedAt: startedAt ? new Date(startedAt) : null,
    lastReminderAt: lastReminderAt ? new Date(lastReminderAt) : (existing?.lastReminderAt ?? null),
    remindersSentToday: remindersSentToday ?? 0,
    lastSeenAt: new Date(),
  };

  if (existing) {
    await db.update(botStatusTable).set(values).where(eq(botStatusTable.id, 1));
  } else {
    await db.insert(botStatusTable).values({ id: 1, ...values });
  }

  const restartRequested = _restartFlag;
  if (_restartFlag) _restartFlag = false;
  res.status(200).json({ restartRequested });
});

// ── Restart ───────────────────────────────────────────────────────────────────

router.post("/bot/restart", (_req, res): void => {
  _restartFlag = true;
  res.status(200).json({ ok: true, message: "Restart queued — bot will restart within 30 s" });
});

// ── Config ────────────────────────────────────────────────────────────────────

async function ensureConfig() {
  const [row] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, 1));
  if (!row) {
    const [inserted] = await db.insert(botConfigTable).values({ id: 1 }).returning();
    return inserted;
  }
  return row;
}

router.get("/bot/config", async (req, res): Promise<void> => {
  const row = await ensureConfig();
  res.json(GetBotConfigResponse.parse({
    channelId: row.channelId,
    reminderEnabled: row.reminderEnabled,
    reminderIntervalMinutes: row.reminderIntervalMinutes,
    reminderMessage: row.reminderMessage,
  }));
});

router.put("/bot/config", async (req, res): Promise<void> => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await ensureConfig();

  const updates: Partial<typeof botConfigTable.$inferInsert> = {};
  if (parsed.data.channelId !== undefined) updates.channelId = parsed.data.channelId;
  if (parsed.data.reminderEnabled !== undefined) updates.reminderEnabled = parsed.data.reminderEnabled;
  if (parsed.data.reminderIntervalMinutes !== undefined) updates.reminderIntervalMinutes = parsed.data.reminderIntervalMinutes;
  if (parsed.data.reminderMessage !== undefined) updates.reminderMessage = parsed.data.reminderMessage;

  const [updated] = await db
    .update(botConfigTable)
    .set(updates)
    .where(eq(botConfigTable.id, 1))
    .returning();

  res.json(UpdateBotConfigResponse.parse({
    channelId: updated.channelId,
    reminderEnabled: updated.reminderEnabled,
    reminderIntervalMinutes: updated.reminderIntervalMinutes,
    reminderMessage: updated.reminderMessage,
  }));
});

// ── Reminders ─────────────────────────────────────────────────────────────────

type ReminderBodyType = {
  name: string;
  channelId: string;
  enabled?: boolean;
  intervalMinutes: number;
  message: string;
};

function parseReminderBody(body: unknown): { data: ReminderBodyType } | { error: string } {
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || b.name.trim() === "") return { error: "name is required" };
  if (typeof b.channelId !== "string") return { error: "channelId must be a string" };
  if (typeof b.intervalMinutes !== "number" || b.intervalMinutes < 1) return { error: "intervalMinutes must be >= 1" };
  if (typeof b.message !== "string") return { error: "message is required" };
  return {
    data: {
      name: b.name.trim(),
      channelId: b.channelId.trim(),
      enabled: typeof b.enabled === "boolean" ? b.enabled : true,
      intervalMinutes: Math.floor(b.intervalMinutes),
      message: b.message,
    },
  };
}

function formatReminder(r: typeof remindersTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    channelId: r.channelId,
    enabled: r.enabled,
    intervalMinutes: r.intervalMinutes,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/bot/reminders", async (req, res): Promise<void> => {
  const rows = await db.select().from(remindersTable).orderBy(remindersTable.createdAt);
  res.json(rows.map(formatReminder));
});

router.post("/bot/reminders", async (req, res): Promise<void> => {
  const parsed = parseReminderBody(req.body);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const [row] = await db.insert(remindersTable).values(parsed.data).returning();
  res.status(201).json(formatReminder(row));
});

router.put("/bot/reminders/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = parseReminderBody(req.body);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const [row] = await db.update(remindersTable).set(parsed.data).where(eq(remindersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatReminder(row));
});

router.delete("/bot/reminders/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(remindersTable).where(eq(remindersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

// ── Logs ──────────────────────────────────────────────────────────────────────

router.get("/bot/logs", async (req, res): Promise<void> => {
  const query = GetLogsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;

  const rows = await db
    .select()
    .from(botLogsTable)
    .orderBy(botLogsTable.createdAt)
    .limit(limit);

  res.json(GetLogsResponse.parse(rows.map(r => ({
    id: r.id,
    level: r.level,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }))));
});

router.post("/bot/logs", async (req, res): Promise<void> => {
  const parsed = AddLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.insert(botLogsTable).values({
    level: parsed.data.level.toUpperCase(),
    message: parsed.data.message,
  });

  res.sendStatus(201);
});

// ── Channels cache ─────────────────────────────────────────────────────────────
// In-memory — repopulated by the bot on every on_ready event.

let _channelsCache: Array<{ id: string; name: string; guildId: string; guildName: string }> = [];

router.post("/bot/channels", (req, res): void => {
  if (Array.isArray(req.body)) _channelsCache = req.body;
  res.sendStatus(204);
});

router.get("/bot/channels", (_req, res): void => {
  res.json(_channelsCache);
});

// ── Roles cache ───────────────────────────────────────────────────────────────
// In-memory — repopulated by the bot on every on_ready event.

let _rolesCache: Array<{ id: string; name: string; color: number; guildId: string; guildName: string }> = [];

router.post("/bot/roles", (req, res): void => {
  if (Array.isArray(req.body)) _rolesCache = req.body;
  res.sendStatus(204);
});

router.get("/bot/roles", (_req, res): void => {
  res.json(_rolesCache);
});

export default router;
