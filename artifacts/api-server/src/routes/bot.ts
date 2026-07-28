import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, botConfigTable, botLogsTable, botStatusTable } from "@workspace/db";
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

  res.sendStatus(204);
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

export default router;
