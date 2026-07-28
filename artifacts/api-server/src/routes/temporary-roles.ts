import { Router, type IRouter } from "express";
import { eq, lte, isNull } from "drizzle-orm";
import { db, temporaryRolesTable } from "@workspace/db";

const router: IRouter = Router();

function toEntry(r: typeof temporaryRolesTable.$inferSelect) {
  return {
    id:        r.id,
    userId:    r.userId,
    guildId:   r.guildId,
    roleId:    r.roleId,
    expiresAt: r.expiresAt.toISOString(),
    removedAt: r.removedAt?.toISOString() ?? null,
    reason:    r.reason ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── List (optionally pending-removal only) ────────────────────────────────────

router.get("/temporary-roles", async (req, res): Promise<void> => {
  const pendingOnly = req.query.pendingRemoval === "true";
  const rows = pendingOnly
    ? await db.select().from(temporaryRolesTable)
        .where(eq(temporaryRolesTable.removedAt, null as any))
    : await db.select().from(temporaryRolesTable);
  res.json(rows.map(toEntry));
});

// ── Pending removal (expired + not yet removed) ───────────────────────────────

router.get("/temporary-roles/pending", async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db.select().from(temporaryRolesTable)
    .where(lte(temporaryRolesTable.expiresAt, now));
  // Filter out already removed in JS (drizzle isNull support varies)
  const pending = rows.filter(r => r.removedAt === null);
  res.json(pending.map(toEntry));
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post("/temporary-roles", async (req, res): Promise<void> => {
  const { userId, guildId, roleId, expiresAt, reason } = req.body as {
    userId?: string; guildId?: string; roleId?: string; expiresAt?: string; reason?: string;
  };
  if (!userId || !guildId || !roleId || !expiresAt) {
    res.status(400).json({ error: "userId, guildId, roleId and expiresAt are required" });
    return;
  }
  const [row] = await db.insert(temporaryRolesTable).values({
    userId, guildId, roleId,
    expiresAt: new Date(expiresAt),
    reason: reason ?? null,
  }).returning();
  res.status(201).json(toEntry(row));
});

// ── Mark removed ──────────────────────────────────────────────────────────────

router.patch("/temporary-roles/:id/removed", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(temporaryRolesTable)
    .set({ removedAt: new Date() })
    .where(eq(temporaryRolesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toEntry(row));
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/temporary-roles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(temporaryRolesTable)
    .where(eq(temporaryRolesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

export default router;
