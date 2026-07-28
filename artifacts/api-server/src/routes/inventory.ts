import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, userInventoryTable, shopItemsTable } from "@workspace/db";

const router: IRouter = Router();

async function toEntry(r: typeof userInventoryTable.$inferSelect) {
  const [item] = await db.select().from(shopItemsTable).where(eq(shopItemsTable.id, r.itemId));
  return {
    id:         r.id,
    userId:     r.userId,
    itemId:     r.itemId,
    quantity:   r.quantity,
    source:     r.source,
    acquiredAt: r.acquiredAt.toISOString(),
    item: item ? {
      id:          item.id,
      name:        item.name,
      description: item.description ?? null,
      price:       item.price,
      roleId:      item.roleId ?? null,
      emoji:       item.emoji,
    } : null,
  };
}

// ── GET /inventory?userId= ─────────────────────────────────────────────────────

router.get("/inventory", async (req, res): Promise<void> => {
  const { userId } = req.query as { userId?: string };
  const rows = userId
    ? await db.select().from(userInventoryTable).where(eq(userInventoryTable.userId, userId)).orderBy(desc(userInventoryTable.acquiredAt))
    : await db.select().from(userInventoryTable).orderBy(desc(userInventoryTable.acquiredAt));
  const entries = await Promise.all(rows.map(toEntry));
  res.json(entries);
});

// ── GET /inventory/:userId ─────────────────────────────────────────────────────

router.get("/inventory/:userId", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(userInventoryTable)
    .where(eq(userInventoryTable.userId, req.params.userId))
    .orderBy(desc(userInventoryTable.acquiredAt));
  const entries = await Promise.all(rows.map(toEntry));
  res.json(entries);
});

// ── POST /inventory ────────────────────────────────────────────────────────────

router.post("/inventory", async (req, res): Promise<void> => {
  const { userId, itemId, quantity, source } = req.body as {
    userId?: string; itemId?: number; quantity?: number; source?: string;
  };
  if (!userId || !itemId) {
    res.status(400).json({ error: "userId and itemId are required" }); return;
  }

  // Check item exists
  const [item] = await db.select().from(shopItemsTable).where(eq(shopItemsTable.id, itemId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  const [row] = await db.insert(userInventoryTable).values({
    userId,
    itemId,
    quantity: quantity ?? 1,
    source:   source ?? "admin",
  }).returning();
  res.status(201).json(await toEntry(row));
});

// ── DELETE /inventory/:id ──────────────────────────────────────────────────────

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(userInventoryTable).where(eq(userInventoryTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

export default router;
