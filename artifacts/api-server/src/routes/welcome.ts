import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, welcomeConfigTable } from "@workspace/db";

const router: IRouter = Router();

type Row = typeof welcomeConfigTable.$inferSelect;

function toDto(r: Row) {
  return {
    joinEnabled:           r.joinEnabled,
    joinChannelId:         r.joinChannelId,
    joinEmbedTitle:        r.joinEmbedTitle,
    joinEmbedDescription:  r.joinEmbedDescription,
    joinEmbedColor:        r.joinEmbedColor,
    joinEmbedFooter:       r.joinEmbedFooter,
    joinShowAvatar:        r.joinShowAvatar,
    leaveEnabled:          r.leaveEnabled,
    leaveChannelId:        r.leaveChannelId,
    leaveEmbedTitle:       r.leaveEmbedTitle,
    leaveEmbedDescription: r.leaveEmbedDescription,
    leaveEmbedColor:       r.leaveEmbedColor,
    leaveEmbedFooter:      r.leaveEmbedFooter,
    leaveShowAvatar:       r.leaveShowAvatar,
    updatedAt:             r.updatedAt.toISOString(),
  };
}

const DEFAULTS = {
  joinEnabled: false, joinChannelId: "",
  joinEmbedTitle: "Bienvenue sur {server} ! 🎉",
  joinEmbedDescription: "Bienvenue {mention}, tu es le **{count}ème** membre !",
  joinEmbedColor: "57F287", joinEmbedFooter: "", joinShowAvatar: true,
  leaveEnabled: false, leaveChannelId: "",
  leaveEmbedTitle: "{user} a quitté le serveur. 👋",
  leaveEmbedDescription: "Nous sommes maintenant **{count}** membres.",
  leaveEmbedColor: "ED4245", leaveEmbedFooter: "", leaveShowAvatar: true,
  updatedAt: new Date().toISOString(),
};

// GET /welcome/config
router.get("/welcome/config", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(welcomeConfigTable).where(eq(welcomeConfigTable.id, 1));
  res.json(row ? toDto(row) : DEFAULTS);
});

// PUT /welcome/config
router.put("/welcome/config", async (req, res): Promise<void> => {
  const d = req.body as Partial<Omit<typeof DEFAULTS, "updatedAt">>;
  const [row] = await db
    .insert(welcomeConfigTable)
    .values({ id: 1, ...d })
    .onConflictDoUpdate({
      target: welcomeConfigTable.id,
      set: { ...d, updatedAt: new Date() },
    })
    .returning();
  res.json(toDto(row));
});

export default router;
