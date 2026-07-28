import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, ticketConfigTable, ticketsTable } from "@workspace/db";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConfig() {
  const [row] = await db.select().from(ticketConfigTable).where(eq(ticketConfigTable.id, 1));
  return row ?? null;
}

function toConfig(row: typeof ticketConfigTable.$inferSelect) {
  return {
    enabled:          row.enabled,
    panelChannelId:   row.panelChannelId,
    categoryId:       row.categoryId,
    staffRoleId:      row.staffRoleId,
    embedTitle:       row.embedTitle,
    embedDescription: row.embedDescription,
    embedColor:       row.embedColor,
    logChannelId:     row.logChannelId,
    welcomeMessage:   row.welcomeMessage,
    updatedAt:        row.updatedAt.toISOString(),
  };
}

function toTicket(row: typeof ticketsTable.$inferSelect) {
  return {
    id:           row.id,
    userId:       row.userId,
    userName:     row.userName,
    channelId:    row.channelId,
    status:       row.status,
    createdAt:    row.createdAt.toISOString(),
    closedAt:     row.closedAt?.toISOString() ?? null,
    closedBy:     row.closedBy ?? null,
    closedByName: row.closedByName ?? null,
  };
}

// ── GET /ticket/config ────────────────────────────────────────────────────────

router.get("/ticket/config", async (_req, res): Promise<void> => {
  const row = await getConfig();
  if (!row) {
    // Return defaults if no row yet
    res.json({
      enabled: false, panelChannelId: "", categoryId: "", staffRoleId: "",
      embedTitle: "🎫 Support",
      embedDescription: "Cliquez sur le bouton ci-dessous pour ouvrir un ticket de support.\nUn membre du staff vous répondra dès que possible.",
      embedColor: "5865F2", logChannelId: "",
      welcomeMessage: "Bonjour {user} ! Un membre du staff va vous répondre bientôt.",
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  res.json(toConfig(row));
});

// ── PUT /ticket/config ────────────────────────────────────────────────────────

router.put("/ticket/config", async (req, res): Promise<void> => {
  const d = req.body as Partial<{
    enabled: boolean; panelChannelId: string; categoryId: string;
    staffRoleId: string; embedTitle: string; embedDescription: string;
    embedColor: string; logChannelId: string; welcomeMessage: string;
  }>;

  const [row] = await db
    .insert(ticketConfigTable)
    .values({
      id: 1,
      enabled:          d.enabled          ?? false,
      panelChannelId:   d.panelChannelId   ?? "",
      categoryId:       d.categoryId       ?? "",
      staffRoleId:      d.staffRoleId      ?? "",
      embedTitle:       d.embedTitle       ?? "🎫 Support",
      embedDescription: d.embedDescription ?? "Cliquez sur le bouton ci-dessous pour ouvrir un ticket de support.\nUn membre du staff vous répondra dès que possible.",
      embedColor:       d.embedColor       ?? "5865F2",
      logChannelId:     d.logChannelId     ?? "",
      welcomeMessage:   d.welcomeMessage   ?? "Bonjour {user} ! Un membre du staff va vous répondre bientôt.",
    })
    .onConflictDoUpdate({
      target: ticketConfigTable.id,
      set: {
        ...(d.enabled          !== undefined && { enabled:          d.enabled }),
        ...(d.panelChannelId   !== undefined && { panelChannelId:   d.panelChannelId }),
        ...(d.categoryId       !== undefined && { categoryId:       d.categoryId }),
        ...(d.staffRoleId      !== undefined && { staffRoleId:      d.staffRoleId }),
        ...(d.embedTitle       !== undefined && { embedTitle:       d.embedTitle }),
        ...(d.embedDescription !== undefined && { embedDescription: d.embedDescription }),
        ...(d.embedColor       !== undefined && { embedColor:       d.embedColor }),
        ...(d.logChannelId     !== undefined && { logChannelId:     d.logChannelId }),
        ...(d.welcomeMessage   !== undefined && { welcomeMessage:   d.welcomeMessage }),
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(toConfig(row));
});

// ── GET /tickets ──────────────────────────────────────────────────────────────

router.get("/tickets", async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };
  const rows = status
    ? await db.select().from(ticketsTable).where(eq(ticketsTable.status, status)).orderBy(desc(ticketsTable.createdAt))
    : await db.select().from(ticketsTable).orderBy(desc(ticketsTable.createdAt));
  res.json(rows.map(toTicket));
});

// ── POST /tickets ─────────────────────────────────────────────────────────────

router.post("/tickets", async (req, res): Promise<void> => {
  const { userId, userName, channelId } = req.body as {
    userId?: string; userName?: string; channelId?: string;
  };
  if (!userId || !channelId) {
    res.status(400).json({ error: "userId and channelId are required" }); return;
  }
  const [row] = await db
    .insert(ticketsTable)
    .values({ userId, userName: userName ?? "", channelId })
    .returning();
  res.status(201).json(toTicket(row));
});

// ── PATCH /tickets/channel/:channelId ─────────────────────────────────────────
// Lets the bot close a ticket by channel ID (no ticket ID needed in the button)

router.patch("/tickets/channel/:channelId", async (req, res): Promise<void> => {
  const { channelId } = req.params;
  const { status, closedBy, closedByName } = req.body as {
    status?: string; closedBy?: string; closedByName?: string;
  };
  const rows = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.channelId, channelId));

  const open = rows.find(r => r.status === "open");
  if (!open) { res.status(404).json({ error: "No open ticket for this channel" }); return; }

  const [updated] = await db
    .update(ticketsTable)
    .set({
      status:       status       ?? "closed",
      closedBy:     closedBy     ?? null,
      closedByName: closedByName ?? null,
      closedAt:     new Date(),
    })
    .where(eq(ticketsTable.id, open.id))
    .returning();

  res.json(toTicket(updated));
});

// ── PATCH /tickets/:id ────────────────────────────────────────────────────────

router.patch("/tickets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status, closedBy, closedByName } = req.body as {
    status?: string; closedBy?: string; closedByName?: string;
  };
  const [updated] = await db
    .update(ticketsTable)
    .set({
      ...(status       !== undefined && { status }),
      ...(closedBy     !== undefined && { closedBy }),
      ...(closedByName !== undefined && { closedByName }),
      ...(status === "closed"        && { closedAt: new Date() }),
    })
    .where(eq(ticketsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.json(toTicket(updated));
});

// ── DELETE /tickets/:id ───────────────────────────────────────────────────────

router.delete("/tickets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(ticketsTable).where(eq(ticketsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.status(204).send();
});

export default router;
