import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, userEconomyTable, economyConfigTable } from "@workspace/db";
import {
  ListPlayersResponse,
  GetPlayerResponse,
  UpdatePlayerBalanceBody,
  UpdatePlayerBalanceResponse,
  UpdatePlayerBalanceParams,
  GetPlayerParams,
  GetEconomyConfigResponse,
  UpdateEconomyConfigBody,
  UpdateEconomyConfigResponse,
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

async function ensureEconomyConfig() {
  const [row] = await db.select().from(economyConfigTable).where(eq(economyConfigTable.id, 1));
  if (!row) {
    const [inserted] = await db.insert(economyConfigTable).values({ id: 1 }).returning();
    return inserted;
  }
  return row;
}

function toEconomyConfig(r: typeof economyConfigTable.$inferSelect) {
  return {
    startingWallet: r.startingWallet,
    balanceEnabled: r.balanceEnabled,
    moneyEnabled: r.moneyEnabled,
    dailyEnabled: r.dailyEnabled,
    dailyAmount: r.dailyAmount,
    dailyCooldownHours: r.dailyCooldownHours,
    workEnabled: r.workEnabled,
    workMinAmount: r.workMinAmount,
    workMaxAmount: r.workMaxAmount,
    workCooldownHours: r.workCooldownHours,
    crimeEnabled: r.crimeEnabled,
    crimeWinMin: r.crimeWinMin,
    crimeWinMax: r.crimeWinMax,
    crimeLoseMin: r.crimeLoseMin,
    crimeLoseMax: r.crimeLoseMax,
    crimeWinChance: r.crimeWinChance,
    crimeCooldownHours: r.crimeCooldownHours,
    depositEnabled: r.depositEnabled,
    withdrawEnabled: r.withdrawEnabled,
    giveEnabled: r.giveEnabled,
    leaderboardEnabled: r.leaderboardEnabled,
    blackjackEnabled: r.blackjackEnabled,
    blackjackMinBet: r.blackjackMinBet,
    blackjackMaxBet: r.blackjackMaxBet,
    rouletteEnabled: r.rouletteEnabled,
    rouletteMinBet: r.rouletteMinBet,
    rouletteMaxBet: r.rouletteMaxBet,
    hlEnabled: r.hlEnabled,
    hlMinBet: r.hlMinBet,
    hlMaxBet: r.hlMaxBet,
    hlStreakReward: r.hlStreakReward,
    guessEnabled: r.guessEnabled,
    guessMinBet: r.guessMinBet,
    guessMaxBet: r.guessMaxBet,
    guessMaxAttempts: r.guessMaxAttempts,
    currencyName: r.currencyName ?? "coins",
    messageRewardEnabled: r.messageRewardEnabled,
    messageRewardMin: r.messageRewardMin,
    messageRewardMax: r.messageRewardMax,
    messageRewardCooldownSeconds: r.messageRewardCooldownSeconds,
    language: r.language ?? "fr",
  };
}

// ── Economy config ────────────────────────────────────────────────────────────

router.get("/economy/config", async (req, res): Promise<void> => {
  const row = await ensureEconomyConfig();
  res.json(GetEconomyConfigResponse.parse(toEconomyConfig(row)));
});

router.patch("/economy/config", async (req, res): Promise<void> => {
  const parsed = UpdateEconomyConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await ensureEconomyConfig();
  const [updated] = await db.update(economyConfigTable)
    .set(parsed.data as Partial<typeof economyConfigTable.$inferInsert>)
    .where(eq(economyConfigTable.id, 1)).returning();
  res.json(UpdateEconomyConfigResponse.parse(toEconomyConfig(updated)));
});

router.put("/economy/config", async (req, res): Promise<void> => {
  const parsed = UpdateEconomyConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureEconomyConfig();
  const [updated] = await db
    .update(economyConfigTable)
    .set(parsed.data as Partial<typeof economyConfigTable.$inferInsert>)
    .where(eq(economyConfigTable.id, 1))
    .returning();
  res.json(UpdateEconomyConfigResponse.parse(toEconomyConfig(updated)));
});

// ── Players ───────────────────────────────────────────────────────────────────

router.get("/economy/players", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      userId: userEconomyTable.userId,
      username: userEconomyTable.username,
      wallet: userEconomyTable.wallet,
      bank: userEconomyTable.bank,
      lastDaily: userEconomyTable.lastDaily,
      lastWork: userEconomyTable.lastWork,
      lastCrime: userEconomyTable.lastCrime,
      updatedAt: userEconomyTable.updatedAt,
      rank: sql<number>`cast(rank() over (order by (${userEconomyTable.wallet} + ${userEconomyTable.bank}) desc) as int)`,
    })
    .from(userEconomyTable)
    .orderBy(desc(sql`${userEconomyTable.wallet} + ${userEconomyTable.bank}`));
  res.json(ListPlayersResponse.parse(rows.map(r => ({
    ...toPlayer(r as typeof userEconomyTable.$inferSelect),
    rank: r.rank,
  }))));
});

router.get("/economy/players/:userId", async (req, res): Promise<void> => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(userEconomyTable).where(eq(userEconomyTable.userId, params.data.userId));
  if (!row) { res.status(404).json({ error: "Player not found" }); return; }
  const [rankRow] = await db
    .select({ rank: sql<number>`cast(count(*) + 1 as int)` })
    .from(userEconomyTable)
    .where(sql`(${userEconomyTable.wallet} + ${userEconomyTable.bank}) > (${row.wallet + row.bank})`);
  const rank = rankRow?.rank ?? 1;
  res.json(GetPlayerResponse.parse({ ...toPlayer(row), rank }));
});

router.post("/economy/players", async (req, res): Promise<void> => {
  const { userId, username, wallet, bank } = req.body as { userId?: string; username?: string; wallet?: number; bank?: number };
  if (!userId || !username) { res.status(400).json({ error: "userId and username are required" }); return; }
  const [existing] = await db.select().from(userEconomyTable).where(eq(userEconomyTable.userId, userId));
  if (existing) {
    const [updated] = await db.update(userEconomyTable).set({ username }).where(eq(userEconomyTable.userId, userId)).returning();
    res.json(toPlayer(updated));
    return;
  }
  const [created] = await db.insert(userEconomyTable).values({ userId, username, wallet: wallet ?? 200, bank: bank ?? 0 }).returning();
  res.status(201).json(toPlayer(created));
});

router.patch("/economy/players/:userId", async (req, res): Promise<void> => {
  const params = UpdatePlayerBalanceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdatePlayerBalanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(userEconomyTable).where(eq(userEconomyTable.userId, params.data.userId));
  if (!existing) { res.status(404).json({ error: "Player not found" }); return; }
  const updates: Partial<typeof userEconomyTable.$inferInsert> = {};
  if (parsed.data.wallet !== undefined) updates.wallet = parsed.data.wallet;
  if (parsed.data.bank !== undefined) updates.bank = parsed.data.bank;
  const [updated] = await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, params.data.userId)).returning();
  const [rankRow] = await db
    .select({ rank: sql<number>`cast(count(*) + 1 as int)` })
    .from(userEconomyTable)
    .where(sql`(${userEconomyTable.wallet} + ${userEconomyTable.bank}) > (${updated.wallet + updated.bank})`);
  res.json(UpdatePlayerBalanceResponse.parse({ ...toPlayer(updated), rank: rankRow?.rank ?? 1 }));
});

// ── Internal bot cooldown endpoints ──────────────────────────────────────────

router.patch("/economy/players/:userId/daily", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };
  const updates: Partial<typeof userEconomyTable.$inferInsert> = { lastDaily: new Date() };
  if (wallet !== undefined) updates.wallet = wallet;
  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

router.patch("/economy/players/:userId/work", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };
  const updates: Partial<typeof userEconomyTable.$inferInsert> = { lastWork: new Date() };
  if (wallet !== undefined) updates.wallet = wallet;
  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

router.patch("/economy/players/:userId/crime", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { wallet } = req.body as { wallet?: number };
  const updates: Partial<typeof userEconomyTable.$inferInsert> = { lastCrime: new Date() };
  if (wallet !== undefined) updates.wallet = wallet;
  await db.update(userEconomyTable).set(updates).where(eq(userEconomyTable.userId, userId));
  res.sendStatus(204);
});

export default router;
