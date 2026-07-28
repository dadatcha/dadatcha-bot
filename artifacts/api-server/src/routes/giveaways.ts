import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, giveawaysTable } from "@workspace/db";

const router: IRouter = Router();

function toGiveaway(r: typeof giveawaysTable.$inferSelect) {
  return {
    id:                 r.id,
    channelId:          r.channelId,
    messageId:          r.messageId ?? null,
    guildId:            r.guildId,
    prize:              r.prize,
    winnersCount:       r.winnersCount,
    endsAt:             r.endsAt.toISOString(),
    endedAt:            r.endedAt?.toISOString() ?? null,
    winners:            r.winners ?? [],
    status:             r.status,
    requiredRoleId:     r.requiredRoleId ?? null,
    requiredMinBalance: r.requiredMinBalance ?? null,
    requiredRoleIds:    r.requiredRoleIds ?? [],
    forbiddenRoleIds:   r.forbiddenRoleIds ?? [],
    hostId:             r.hostId ?? null,
    mentionedUserIds:   r.mentionedUserIds ?? [],
    rewards:            (r.rewards as any[]) ?? [],
    createdAt:          r.createdAt.toISOString(),
  };
}

// ── GET /giveaways ─────────────────────────────────────────────────────────────

router.get("/giveaways", async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };
  let rows = await db.select().from(giveawaysTable).orderBy(desc(giveawaysTable.createdAt));
  if (status) rows = rows.filter(r => r.status === status);
  res.json(rows.map(toGiveaway));
});

// ── POST /giveaways ────────────────────────────────────────────────────────────

router.post("/giveaways", async (req, res): Promise<void> => {
  const {
    channelId, prize, winnersCount, durationMinutes,
    requiredRoleId, requiredMinBalance,
    requiredRoleIds, forbiddenRoleIds,
    hostId, mentionedUserIds, rewards,
  } = req.body as {
    channelId?: string; prize?: string; winnersCount?: number; durationMinutes?: number;
    requiredRoleId?: string; requiredMinBalance?: number;
    requiredRoleIds?: string[]; forbiddenRoleIds?: string[];
    hostId?: string; mentionedUserIds?: string[]; rewards?: any[];
  };
  if (!channelId || !prize || !durationMinutes) {
    res.status(400).json({ error: "channelId, prize, durationMinutes are required" }); return;
  }
  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);
  const [row] = await db.insert(giveawaysTable).values({
    channelId,
    prize,
    winnersCount:       winnersCount ?? 1,
    endsAt,
    requiredRoleId:     requiredRoleId || null,
    requiredMinBalance: requiredMinBalance ?? null,
    requiredRoleIds:    requiredRoleIds ?? [],
    forbiddenRoleIds:   forbiddenRoleIds ?? [],
    hostId:             hostId || null,
    mentionedUserIds:   mentionedUserIds ?? [],
    rewards:            rewards ?? [],
  }).returning();
  res.status(201).json(toGiveaway(row));
});

// ── GET /giveaways/:id ─────────────────────────────────────────────────────────

router.get("/giveaways/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toGiveaway(row));
});

// ── PATCH /giveaways/:id ───────────────────────────────────────────────────────

router.patch("/giveaways/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { messageId, guildId, status } = req.body as { messageId?: string; guildId?: string; status?: string };
  const updates: Partial<typeof giveawaysTable.$inferInsert> = {};
  if (messageId !== undefined) updates.messageId = messageId;
  if (guildId   !== undefined) updates.guildId   = guildId;
  if (status    !== undefined) updates.status    = status;
  const [row] = await db.update(giveawaysTable).set(updates).where(eq(giveawaysTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toGiveaway(row));
});

// ── DELETE /giveaways/:id ──────────────────────────────────────────────────────

router.delete("/giveaways/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(giveawaysTable).where(eq(giveawaysTable.id, id));
  res.status(204).send();
});

// ── POST /giveaways/:id/end ────────────────────────────────────────────────────

router.post("/giveaways/:id/end", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { winners } = req.body as { winners?: string[] };
  const [row] = await db
    .update(giveawaysTable)
    .set({ status: "ended", endedAt: new Date(), winners: winners ?? [] })
    .where(eq(giveawaysTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toGiveaway(row));
});

// ── POST /giveaways/:id/reroll ─────────────────────────────────────────────────

router.post("/giveaways/:id/reroll", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { winners } = req.body as { winners?: string[] };
  const [row] = await db
    .update(giveawaysTable)
    .set({ winners: winners ?? [] })
    .where(eq(giveawaysTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toGiveaway(row));
});

export default router;
