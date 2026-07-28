import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, botConfigTable, botCommandsTable, botLogsTable, botStatusTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  GetBotConfigResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
  ListCommandsResponse,
  CreateCommandBody,
  CreateCommandResponse,
  UpdateCommandParams,
  UpdateCommandBody,
  UpdateCommandResponse,
  DeleteCommandParams,
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

// ── Commands ──────────────────────────────────────────────────────────────────

router.get("/bot/commands", async (req, res): Promise<void> => {
  const rows = await db.select().from(botCommandsTable).orderBy(botCommandsTable.createdAt);
  res.json(ListCommandsResponse.parse(rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    response: r.response,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  }))));
});

router.post("/bot/commands", async (req, res): Promise<void> => {
  const parsed = CreateCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(botCommandsTable)
    .where(eq(botCommandsTable.name, parsed.data.name));
  if (existing.length > 0) {
    res.status(409).json({ error: `Command /${parsed.data.name} already exists` });
    return;
  }

  const [row] = await db.insert(botCommandsTable).values({
    name: parsed.data.name,
    description: parsed.data.description,
    response: parsed.data.response,
    enabled: parsed.data.enabled ?? true,
  }).returning();

  res.status(201).json(CreateCommandResponse.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    response: row.response,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  }));
});

router.patch("/bot/commands/:name", async (req, res): Promise<void> => {
  const params = UpdateCommandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof botCommandsTable.$inferInsert> = {};
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.response !== undefined) updates.response = parsed.data.response;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

  const [row] = await db
    .update(botCommandsTable)
    .set(updates)
    .where(eq(botCommandsTable.name, params.data.name))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Command not found" });
    return;
  }

  res.json(UpdateCommandResponse.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    response: row.response,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  }));
});

router.delete("/bot/commands/:name", async (req, res): Promise<void> => {
  const params = DeleteCommandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .delete(botCommandsTable)
    .where(eq(botCommandsTable.name, params.data.name))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Command not found" });
    return;
  }

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

export default router;
