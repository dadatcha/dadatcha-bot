import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, inviteTrackingTable, inviteUsesTable } from "@workspace/db";

const router: IRouter = Router();

function total(r: typeof inviteTrackingTable.$inferSelect) {
  return r.regularInvites + r.bonusInvites - r.leftInvites;
}

function toDto(r: typeof inviteTrackingTable.$inferSelect) {
  return {
    userId:         r.userId,
    username:       r.username,
    guildId:        r.guildId,
    regularInvites: r.regularInvites,
    bonusInvites:   r.bonusInvites,
    leftInvites:    r.leftInvites,
    total:          total(r),
    updatedAt:      r.updatedAt.toISOString(),
  };
}

// GET /invites — all stats sorted by total desc
router.get("/invites", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inviteTrackingTable);
  rows.sort((a, b) => total(b) - total(a));
  res.json(rows.map(toDto));
});

// GET /invites/:userId — stats for one user (returns zeros if no record)
router.get("/invites/:userId", async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(inviteTrackingTable)
    .where(eq(inviteTrackingTable.userId, req.params.userId));
  if (!row) {
    res.json({ userId: req.params.userId, username: "", guildId: "", regularInvites: 0, bonusInvites: 0, leftInvites: 0, total: 0, updatedAt: new Date().toISOString() });
    return;
  }
  res.json(toDto(row));
});

// POST /invites/join — called by bot when a member joins
// body: { inviterId, inviterName, inviteeId, inviteeName, inviteCode, guildId }
router.post("/invites/join", async (req, res): Promise<void> => {
  const { inviterId, inviterName, inviteeId, inviteeName, inviteCode, guildId } = req.body as Record<string, string>;

  // Upsert inviter stats (+1 regular)
  await db
    .insert(inviteTrackingTable)
    .values({ userId: inviterId, username: inviterName, guildId, regularInvites: 1 })
    .onConflictDoUpdate({
      target: inviteTrackingTable.userId,
      set: {
        username:       inviterName,
        regularInvites: sql`${inviteTrackingTable.regularInvites} + 1`,
        updatedAt:      new Date(),
      },
    });

  // Record the join (invitee unique — ignore if already present)
  await db
    .insert(inviteUsesTable)
    .values({ inviterId, inviterName, inviteeId, inviteeName, inviteCode })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(inviteTrackingTable)
    .where(eq(inviteTrackingTable.userId, inviterId));
  res.status(201).json(row ? toDto(row) : {});
});

// POST /invites/leave — called by bot when an invited member leaves
// body: { inviteeId }
router.post("/invites/leave", async (req, res): Promise<void> => {
  const { inviteeId } = req.body as Record<string, string>;

  // Find the inviter from join records
  const [use] = await db
    .select()
    .from(inviteUsesTable)
    .where(eq(inviteUsesTable.inviteeId, inviteeId));

  if (!use || use.left) { res.status(204).send(); return; }

  // Mark as left
  await db
    .update(inviteUsesTable)
    .set({ left: true })
    .where(eq(inviteUsesTable.id, use.id));

  // Decrement inviter's leftInvites counter
  await db
    .update(inviteTrackingTable)
    .set({
      leftInvites: sql`${inviteTrackingTable.leftInvites} + 1`,
      updatedAt:   new Date(),
    })
    .where(eq(inviteTrackingTable.userId, use.inviterId));

  res.status(204).send();
});

// PATCH /invites/:userId/bonus — admin: adjust bonus invites
// body: { delta: number (positive = add, negative = remove), username?, guildId? }
router.patch("/invites/:userId/bonus", async (req, res): Promise<void> => {
  const { delta, username, guildId } = req.body as { delta: number; username?: string; guildId?: string };
  const { userId } = req.params;

  const [existing] = await db
    .select()
    .from(inviteTrackingTable)
    .where(eq(inviteTrackingTable.userId, userId));

  if (existing) {
    const [row] = await db
      .update(inviteTrackingTable)
      .set({ bonusInvites: sql`${inviteTrackingTable.bonusInvites} + ${delta}`, updatedAt: new Date() })
      .where(eq(inviteTrackingTable.userId, userId))
      .returning();
    res.json(toDto(row));
  } else {
    // Create record on the fly (member never invited anyone yet)
    const [row] = await db
      .insert(inviteTrackingTable)
      .values({ userId, username: username ?? userId, guildId: guildId ?? "", bonusInvites: delta })
      .returning();
    res.json(toDto(row));
  }
});

export default router;
