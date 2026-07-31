import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, automodConfigTable } from "@workspace/db";

const router: IRouter = Router();

type Row = typeof automodConfigTable.$inferSelect;

function toDto(r: Row) {
  return {
    enabled:                r.enabled,
    logChannelId:           r.logChannelId,
    ignoredRoleIds:         r.ignoredRoleIds,
    ignoredChannelIds:      r.ignoredChannelIds,
    badWordsEnabled:        r.badWordsEnabled,
    badWords:               r.badWords,
    badWordsAction:         r.badWordsAction,
    badWordsTimeoutMinutes: r.badWordsTimeoutMinutes,
    spamEnabled:            r.spamEnabled,
    spamMaxMessages:        r.spamMaxMessages,
    spamWindowSeconds:      r.spamWindowSeconds,
    spamAction:             r.spamAction,
    spamTimeoutMinutes:     r.spamTimeoutMinutes,
    capsEnabled:            r.capsEnabled,
    capsPercent:            r.capsPercent,
    capsMinLength:          r.capsMinLength,
    capsAction:             r.capsAction,
    linksEnabled:           r.linksEnabled,
    linksWhitelist:         r.linksWhitelist,
    linksAction:            r.linksAction,
    linksTimeoutMinutes:    r.linksTimeoutMinutes,
    mentionEnabled:         r.mentionEnabled,
    mentionMax:             r.mentionMax,
    mentionAction:          r.mentionAction,
    mentionTimeoutMinutes:  r.mentionTimeoutMinutes,
    sendWarnDm:             r.sendWarnDm,
    updatedAt:              r.updatedAt.toISOString(),
  };
}

const DEFAULTS: ReturnType<typeof toDto> = {
  enabled: false,
  logChannelId: "",
  ignoredRoleIds: [],
  ignoredChannelIds: [],
  badWordsEnabled: false,
  badWords: [],
  badWordsAction: "delete",
  badWordsTimeoutMinutes: 10,
  spamEnabled: false,
  spamMaxMessages: 5,
  spamWindowSeconds: 5,
  spamAction: "timeout",
  spamTimeoutMinutes: 5,
  capsEnabled: false,
  capsPercent: 70,
  capsMinLength: 10,
  capsAction: "delete",
  linksEnabled: false,
  linksWhitelist: [],
  linksAction: "delete",
  linksTimeoutMinutes: 5,
  mentionEnabled: false,
  mentionMax: 5,
  mentionAction: "delete",
  mentionTimeoutMinutes: 5,
  sendWarnDm: true,
  updatedAt: new Date().toISOString(),
};

// GET /automod/config
router.get("/automod/config", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(automodConfigTable).where(eq(automodConfigTable.id, 1));
  res.json(row ? toDto(row) : DEFAULTS);
});

// PUT /automod/config
router.put("/automod/config", async (req, res): Promise<void> => {
  const { updatedAt: _ignored, ...d } = req.body as Record<string, unknown>;
  const [row] = await db
    .insert(automodConfigTable)
    .values({ id: 1, ...d })
    .onConflictDoUpdate({
      target: automodConfigTable.id,
      set: { ...d, updatedAt: new Date() },
    })
    .returning();
  res.json(toDto(row));
});

export default router;
