import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, roleRewardsSyncJobsTable } from "@workspace/db";

const router: IRouter = Router();

function toSyncJob(r: typeof roleRewardsSyncJobsTable.$inferSelect) {
  return {
    id:          r.id,
    status:      r.status,
    total:       r.total    ?? null,
    processed:   r.processed ?? null,
    errors:      r.errors   ?? null,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

// ── Trigger a new sync ─────────────────────────────────────────────────────────

router.post("/role-rewards-sync", async (_req, res): Promise<void> => {
  const [job] = await db
    .insert(roleRewardsSyncJobsTable)
    .values({ status: "pending" })
    .returning();
  res.status(201).json(toSyncJob(job));
});

// ── Latest job status (polled by dashboard) ────────────────────────────────────

router.get("/role-rewards-sync", async (_req, res): Promise<void> => {
  const [job] = await db
    .select()
    .from(roleRewardsSyncJobsTable)
    .orderBy(desc(roleRewardsSyncJobsTable.id))
    .limit(1);
  res.json(job ? toSyncJob(job) : null);
});

// ── Internal update (called by bot) ───────────────────────────────────────────

router.patch("/role-rewards-sync/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }

  const { status, total, processed, errors } = req.body as {
    status?: string; total?: number; processed?: number; errors?: number;
  };

  const [updated] = await db
    .update(roleRewardsSyncJobsTable)
    .set({
      ...(status    !== undefined ? { status }    : {}),
      ...(total     !== undefined ? { total }     : {}),
      ...(processed !== undefined ? { processed } : {}),
      ...(errors    !== undefined ? { errors }    : {}),
      ...((status === "done" || status === "error")
        ? { completedAt: new Date() }
        : {}),
    })
    .where(eq(roleRewardsSyncJobsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "job not found" }); return; }
  res.json(toSyncJob(updated));
});

export default router;
