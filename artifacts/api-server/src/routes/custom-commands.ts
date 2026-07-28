import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, customCommandsTable } from "@workspace/db";

const router: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function toCmd(row: typeof customCommandsTable.$inferSelect) {
  return {
    id:                row.id,
    trigger:           row.trigger,
    matchMode:         row.matchMode,
    caseSensitive:     row.caseSensitive,
    responseType:      row.responseType,
    response:          row.response,
    embedTitle:        row.embedTitle,
    embedColor:        row.embedColor,
    embedFooter:       row.embedFooter,
    enabled:           row.enabled,
    deleteUserMessage: row.deleteUserMessage,
    replyToUser:       row.replyToUser,
    allowedChannels:   row.allowedChannels,
    allowedRoles:      row.allowedRoles,
    cooldownSeconds:   row.cooldownSeconds,
    rewardEnabled:     row.rewardEnabled,
    rewardTarget:      row.rewardTarget,
    rewardRoleId:      row.rewardRoleId,
    rewardMoney:       row.rewardMoney,
    rewardXp:          row.rewardXp,
    rewardLevels:      row.rewardLevels,
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt.toISOString(),
  };
}

function fromBody(d: Partial<typeof customCommandsTable.$inferInsert>) {
  return {
    trigger:           (d.trigger ?? "").trim(),
    matchMode:         d.matchMode         ?? "exact",
    caseSensitive:     d.caseSensitive      ?? false,
    responseType:      d.responseType       ?? "message",
    response:          d.response           ?? "",
    embedTitle:        d.embedTitle         ?? "",
    embedColor:        d.embedColor         ?? "5865F2",
    embedFooter:       d.embedFooter        ?? "",
    enabled:           d.enabled            ?? true,
    deleteUserMessage: d.deleteUserMessage  ?? false,
    replyToUser:       d.replyToUser        ?? false,
    allowedChannels:   d.allowedChannels    ?? "",
    allowedRoles:      d.allowedRoles       ?? "",
    cooldownSeconds:   d.cooldownSeconds    ?? 0,
    rewardEnabled:     d.rewardEnabled      ?? false,
    rewardTarget:      d.rewardTarget       ?? "mentioned",
    rewardRoleId:      d.rewardRoleId       ?? "",
    rewardMoney:       d.rewardMoney        ?? 0,
    rewardXp:          d.rewardXp           ?? 0,
    rewardLevels:      d.rewardLevels       ?? 0,
  };
}

// ── GET /custom-commands ──────────────────────────────────────────────────────

router.get("/custom-commands", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(customCommandsTable)
    .orderBy(asc(customCommandsTable.createdAt));
  res.json(rows.map(toCmd));
});

// ── POST /custom-commands ─────────────────────────────────────────────────────

router.post("/custom-commands", async (req, res): Promise<void> => {
  const d = req.body as Partial<typeof customCommandsTable.$inferInsert>;
  if (!d.trigger?.trim()) {
    res.status(400).json({ error: "trigger is required" }); return;
  }
  const [row] = await db.insert(customCommandsTable).values(fromBody(d)).returning();
  res.status(201).json(toCmd(row));
});

// ── PUT /custom-commands/:id ──────────────────────────────────────────────────

router.put("/custom-commands/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const d = req.body as Partial<typeof customCommandsTable.$inferInsert>;
  if (!d.trigger?.trim()) {
    res.status(400).json({ error: "trigger is required" }); return;
  }
  const [row] = await db
    .update(customCommandsTable)
    .set({ ...fromBody(d), updatedAt: new Date() })
    .where(eq(customCommandsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Command not found" }); return; }
  res.json(toCmd(row));
});

// ── PATCH /custom-commands/:id ─────────────────────────────────────────────────

router.patch("/custom-commands/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const d = req.body as Partial<typeof customCommandsTable.$inferInsert>;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const fields: (keyof typeof d)[] = [
    "enabled", "trigger", "matchMode", "caseSensitive", "responseType",
    "response", "embedTitle", "embedColor", "embedFooter",
    "deleteUserMessage", "replyToUser", "allowedChannels", "allowedRoles",
    "cooldownSeconds", "rewardEnabled", "rewardTarget", "rewardRoleId",
    "rewardMoney", "rewardXp", "rewardLevels",
  ];
  for (const f of fields) {
    if (d[f] !== undefined) set[f] = d[f];
  }

  const [row] = await db
    .update(customCommandsTable)
    .set(set as Parameters<typeof db.update>[0] extends infer T ? T : never)
    .where(eq(customCommandsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Command not found" }); return; }
  res.json(toCmd(row));
});

// ── DELETE /custom-commands/:id ───────────────────────────────────────────────

router.delete("/custom-commands/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db
    .delete(customCommandsTable)
    .where(eq(customCommandsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Command not found" }); return; }
  res.status(204).send();
});

export default router;
