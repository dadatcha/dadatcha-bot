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
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt.toISOString(),
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
  const [row] = await db
    .insert(customCommandsTable)
    .values({
      trigger:           d.trigger.trim(),
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
    })
    .returning();
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
    .set({
      trigger:           d.trigger.trim(),
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
      updatedAt:         new Date(),
    })
    .where(eq(customCommandsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Command not found" }); return; }
  res.json(toCmd(row));
});

// ── PATCH /custom-commands/:id ─────────────────────────────────────────────────
// Partial update — used for quick enable/disable toggle

router.patch("/custom-commands/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const d = req.body as Partial<typeof customCommandsTable.$inferInsert>;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.enabled           !== undefined) set.enabled           = d.enabled;
  if (d.trigger           !== undefined) set.trigger           = d.trigger;
  if (d.matchMode         !== undefined) set.matchMode         = d.matchMode;
  if (d.caseSensitive     !== undefined) set.caseSensitive     = d.caseSensitive;
  if (d.responseType      !== undefined) set.responseType      = d.responseType;
  if (d.response          !== undefined) set.response          = d.response;
  if (d.embedTitle        !== undefined) set.embedTitle        = d.embedTitle;
  if (d.embedColor        !== undefined) set.embedColor        = d.embedColor;
  if (d.embedFooter       !== undefined) set.embedFooter       = d.embedFooter;
  if (d.deleteUserMessage !== undefined) set.deleteUserMessage = d.deleteUserMessage;
  if (d.replyToUser       !== undefined) set.replyToUser       = d.replyToUser;
  if (d.allowedChannels   !== undefined) set.allowedChannels   = d.allowedChannels;
  if (d.allowedRoles      !== undefined) set.allowedRoles      = d.allowedRoles;
  if (d.cooldownSeconds   !== undefined) set.cooldownSeconds   = d.cooldownSeconds;

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
