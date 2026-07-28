import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ── In-memory state (no DB needed — just a trigger mechanism) ─────────────────

type Status = "idle" | "pending" | "running" | "done" | "error";

let job: { status: Status; requestedAt: Date | null; completedAt: Date | null } = {
  status: "idle",
  requestedAt: null,
  completedAt: null,
};

function toJob() {
  return {
    status:      job.status,
    requestedAt: job.requestedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

// ── Programmatic trigger (used by other routes) ───────────────────────────────

export function triggerSync(): void {
  job = { status: "pending", requestedAt: new Date(), completedAt: null };
}

// ── POST /command-sync — trigger a re-sync ────────────────────────────────────

router.post("/command-sync", (_req, res): void => {
  triggerSync();
  res.status(201).json(toJob());
});

// ── GET /command-sync — dashboard polls this ──────────────────────────────────

router.get("/command-sync", (_req, res): void => {
  res.json(toJob());
});

// ── PATCH /command-sync — bot calls this to update status ─────────────────────

router.patch("/command-sync", (req, res): void => {
  const { status } = req.body as { status?: string };
  if (status) {
    job.status = status as Status;
    if (status === "done" || status === "error") {
      job.completedAt = new Date();
    }
  }
  res.json(toJob());
});

export default router;
