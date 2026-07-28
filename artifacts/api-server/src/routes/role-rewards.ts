import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, roleRewardsTable } from "@workspace/db";
import {
  ListRoleRewardsResponse,
  CreateRoleRewardBody,
  CreateRoleRewardResponse,
  UpdateRoleRewardBody,
  UpdateRoleRewardParams,
  UpdateRoleRewardResponse,
  DeleteRoleRewardParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function toRoleReward(r: typeof roleRewardsTable.$inferSelect) {
  return {
    id: r.id,
    triggerRoleId: r.triggerRoleId,
    rewardRoleId: r.rewardRoleId,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

router.get("/role-rewards", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(roleRewardsTable)
    .orderBy(asc(roleRewardsTable.id));
  res.json(ListRoleRewardsResponse.parse(rows.map(toRoleReward)));
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post("/role-rewards", async (req, res): Promise<void> => {
  const parsed = CreateRoleRewardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [created] = await db
    .insert(roleRewardsTable)
    .values({
      triggerRoleId: d.triggerRoleId,
      rewardRoleId: d.rewardRoleId,
      enabled: d.enabled ?? true,
    })
    .returning();
  res.status(201).json(CreateRoleRewardResponse.parse(toRoleReward(created)));
});

// ── Update ────────────────────────────────────────────────────────────────────

router.put("/role-rewards/:id", async (req, res): Promise<void> => {
  const params = UpdateRoleRewardParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateRoleRewardBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const d = parsed.data;
  const [updated] = await db
    .update(roleRewardsTable)
    .set({
      triggerRoleId: d.triggerRoleId,
      rewardRoleId: d.rewardRoleId,
      enabled: d.enabled ?? true,
    })
    .where(eq(roleRewardsTable.id, params.data.id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json(UpdateRoleRewardResponse.parse(toRoleReward(updated)));
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/role-rewards/:id", async (req, res): Promise<void> => {
  const params = DeleteRoleRewardParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [deleted] = await db
    .delete(roleRewardsTable)
    .where(eq(roleRewardsTable.id, params.data.id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Rule not found" }); return; }
  res.status(204).end();
});

export default router;
