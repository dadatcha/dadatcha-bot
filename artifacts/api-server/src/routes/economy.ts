import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, userEconomyTable } from "@workspace/db";
import {
  ListPlayersResponse,
  GetPlayerResponse,
  UpdatePlayerBalanceBody,
  UpdatePlayerBalanceResponse,
  UpdatePlayerBalanceParams,
  GetPlayerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function toPlayer(r: typeof userEconomyTable.$inferSelect) {
  return {
    userId: r.userId,
    username: r.username,
    wallet: r.wallet,
    bank: r.bank,
    total: r.wallet + r.bank,
    lastDaily: r.lastDaily?.toISOString() ?? null,
    lastWork: r.lastWork?.toISOString() ?? null,
    lastCrime: r.lastCrime?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── List all players ──────────────────────────────────────────────────────────

router.get("/economy/players", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(userEconomyTable)
    .orderBy(desc(userEconomyTable.wallet));
  res.json(ListPlayersResponse.parse(rows.map(toPlayer)));
});

// ── Get one player ────────────────────────────────────────────────────────────

router.get("/economy/players/:userId", async (req, res): Promise<void> => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select()
    .from(userEconomyTable)
    .where(eq(userEconomyTable.userId, params.data.userId));

  if (!row) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json(GetPlayerResponse.parse(toPlayer(row)));
});

// ── Create / upsert player (called by bot on first encounter) ─────────────────

router.post("/economy/players", async (req, res): Promise<void> => {
  const { userId, username, wallet, bank } = req.body as {
    userId?: string;
    username?: string;
    wallet?: number;
    bank?: number;
  };

  if (!userId || !username) {
    res.status(400).json({ error: "userId and username are required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(userEconomyTable)
    .where(eq(userEconomyTable.userId, userId));

  if (existing) {
    // Update username in case it changed
    const [updated] = await db
      .update(userEconomyTable)
      .set({ username })
      .where(eq(userEconomyTable.userId, userId))
      .returning();
    res.json(toPlayer(updated));
    return;
  }

  const [created] = await db
    .insert(userEconomyTable)
    .values({
      userId,
      username,
      wallet: wallet ?? 200,
      bank: bank ?? 0,
    })
    .returning();

  res.status(201).json(toPlayer(created));
});

// ── Dashboard admin: update wallet / bank ────────────────────────────────────

router.patch("/economy/players/:userId", async (req, res): Promise<void> => {
  const params = UpdatePlayerBalanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePlayerBalanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(userEconomyTable)
    .where(eq(userEconomyTable.userId, params.data.userId));

  if (!existing) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const updates: Partial<typeof userEconomyTable.$inferInsert> = {};
  if (parsed.data.wallet !== undefined) updates.wallet = parsed.data.wallet;
  if (parsed.data.bank !== undefined) updates.bank = parsed.data.bank;

  const [updated] = await db
    .update(userEconomyTable)
    .set(updates)
    .where(eq(userEconomyTable.userId, params.data.userId))
    .returning();

  res.json(UpdatePlayerBalanceResponse.parse(toPlayer(updated)));
});

// ── Internal bot endpoints: reset cooldowns + update wallet ──────────────────
// These are called only by the Python bot and are not in the OpenAPI spec.

router.patch("/economy/players/:userId/daily", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };

  const updates: Partial<typeof userEconomyTable.$inferInsert> = {
    lastDaily: new Date(),
  };
  if (wallet !== undefined) updates.wallet = wallet;

  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

router.patch("/economy/players/:userId/work", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };

  const updates: Partial<typeof userEconomyTable.$inferInsert> = {
    lastWork: new Date(),
  };
  if (wallet !== undefined) updates.wallet = wallet;

  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

router.patch("/economy/players/:userId/crime", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };

  const updates: Partial<typeof userEconomyTable.$inferInsert> = {
    lastCrime: new Date(),
  };
  if (wallet !== undefined) updates.wallet = wallet;

  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

export default router;
