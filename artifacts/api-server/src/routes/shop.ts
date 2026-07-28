import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, shopItemsTable } from "@workspace/db";
import {
  ListShopItemsResponse,
  CreateShopItemBody,
  CreateShopItemResponse,
  UpdateShopItemBody,
  UpdateShopItemParams,
  UpdateShopItemResponse,
  DeleteShopItemParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function toShopItem(r: typeof shopItemsTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    price: r.price,
    roleId: r.roleId ?? null,
    emoji: r.emoji,
    enabled: r.enabled,
    position: r.position,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

router.get("/shop/items", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(shopItemsTable)
    .orderBy(asc(shopItemsTable.position), asc(shopItemsTable.id));
  res.json(ListShopItemsResponse.parse(rows.map(toShopItem)));
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post("/shop/items", async (req, res): Promise<void> => {
  const parsed = CreateShopItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  // Auto-position: max existing position + 1
  const existing = await db.select().from(shopItemsTable);
  const nextPos = existing.length > 0 ? Math.max(...existing.map(r => r.position)) + 1 : 0;
  const [created] = await db
    .insert(shopItemsTable)
    .values({
      name: d.name,
      description: d.description ?? null,
      price: d.price,
      roleId: d.roleId ?? null,
      emoji: d.emoji ?? "🛍️",
      enabled: d.enabled ?? true,
      position: d.position ?? nextPos,
    })
    .returning();
  res.status(201).json(CreateShopItemResponse.parse(toShopItem(created)));
});

// ── Update ────────────────────────────────────────────────────────────────────

router.put("/shop/items/:id", async (req, res): Promise<void> => {
  const params = UpdateShopItemParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateShopItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const d = parsed.data;
  const [updated] = await db
    .update(shopItemsTable)
    .set({
      name: d.name,
      description: d.description ?? null,
      price: d.price,
      roleId: d.roleId ?? null,
      emoji: d.emoji ?? "🛍️",
      enabled: d.enabled ?? true,
      position: d.position ?? 0,
    })
    .where(eq(shopItemsTable.id, params.data.id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(UpdateShopItemResponse.parse(toShopItem(updated)));
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/shop/items/:id", async (req, res): Promise<void> => {
  const params = DeleteShopItemParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [deleted] = await db
    .delete(shopItemsTable)
    .where(eq(shopItemsTable.id, params.data.id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Item not found" }); return; }
  res.status(204).end();
});

export default router;
