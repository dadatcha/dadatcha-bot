import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, randomActivityConfigTable, randomMessagesTable } from "@workspace/db";
import {
  GetRandomActivityConfigResponse,
  UpdateRandomActivityConfigBody,
  ListRandomMessagesResponse,
  CreateRandomMessageBody,
  CreateRandomMessageResponse,
  UpdateRandomMessageBody,
  UpdateRandomMessageParams,
  UpdateRandomMessageResponse,
  DeleteRandomMessageParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Ensure single-row config exists ──────────────────────────────────────────

async function ensureConfig() {
  const rows = await db.select().from(randomActivityConfigTable);
  if (rows.length === 0) {
    await db.insert(randomActivityConfigTable).values({ id: 1 });
  }
}

function toConfig(r: typeof randomActivityConfigTable.$inferSelect) {
  return {
    id: r.id,
    enabled: r.enabled,
    channelId: r.channelId,
    topic: r.topic,
    minIntervalMinutes: r.minIntervalMinutes,
    maxIntervalMinutes: r.maxIntervalMinutes,
    includeCommandSuggestions: r.includeCommandSuggestions,
    nextSendAt: r.nextSendAt?.toISOString() ?? null,
  };
}

function toMessage(r: typeof randomMessagesTable.$inferSelect) {
  return {
    id: r.id,
    content: r.content,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

router.get("/random-activity/config", async (_req, res): Promise<void> => {
  await ensureConfig();
  const [row] = await db.select().from(randomActivityConfigTable).where(eq(randomActivityConfigTable.id, 1));
  res.json(GetRandomActivityConfigResponse.parse(toConfig(row)));
});

router.put("/random-activity/config", async (req, res): Promise<void> => {
  const parsed = UpdateRandomActivityConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await ensureConfig();
  const [updated] = await db
    .update(randomActivityConfigTable)
    .set(parsed.data as Partial<typeof randomActivityConfigTable.$inferInsert>)
    .where(eq(randomActivityConfigTable.id, 1))
    .returning();
  res.json(GetRandomActivityConfigResponse.parse(toConfig(updated)));
});

// ── Messages ──────────────────────────────────────────────────────────────────

router.get("/random-activity/messages", async (_req, res): Promise<void> => {
  const rows = await db.select().from(randomMessagesTable).orderBy(asc(randomMessagesTable.id));
  res.json(ListRandomMessagesResponse.parse(rows.map(toMessage)));
});

router.post("/random-activity/messages", async (req, res): Promise<void> => {
  const parsed = CreateRandomMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [created] = await db
    .insert(randomMessagesTable)
    .values({ content: parsed.data.content, enabled: parsed.data.enabled ?? true })
    .returning();
  res.status(201).json(CreateRandomMessageResponse.parse(toMessage(created)));
});

router.put("/random-activity/messages/:id", async (req, res): Promise<void> => {
  const params = UpdateRandomMessageParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateRandomMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db
    .update(randomMessagesTable)
    .set({ content: parsed.data.content, enabled: parsed.data.enabled })
    .where(eq(randomMessagesTable.id, params.data.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(UpdateRandomMessageResponse.parse(toMessage(updated)));
});

router.delete("/random-activity/messages/:id", async (req, res): Promise<void> => {
  const params = DeleteRandomMessageParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db
    .delete(randomMessagesTable)
    .where(eq(randomMessagesTable.id, params.data.id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Message not found" }); return; }
  res.status(204).end();
});

export default router;
