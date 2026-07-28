import { Router, type IRouter } from "express";
import { eq, ilike, desc, count } from "drizzle-orm";
import {
  db,
  commandConfigsTable,
  commandManifestTable,
  customCommandsTable,
  ccRewardLogTable,
  botLogsTable,
  economyConfigTable,
} from "@workspace/db";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getEcoConfig() {
  const [row] = await db.select().from(economyConfigTable).where(eq(economyConfigTable.id, 1));
  return row ?? null;
}

async function getRecentLogs(keyword: string, limit = 25) {
  return db
    .select()
    .from(botLogsTable)
    .where(ilike(botLogsTable.message, `%${keyword}%`))
    .orderBy(desc(botLogsTable.id))
    .limit(limit);
}

// ── Economy feature-flag map ──────────────────────────────────────────────────

const ECO_CHECKS: Record<string, { field: string; label: string }> = {
  balance:             { field: "balanceEnabled",     label: "Balance activé dans Economy" },
  addmoney:            { field: "moneyEnabled",       label: "Commandes money activées" },
  removemoney:         { field: "moneyEnabled",       label: "Commandes money activées" },
  setmoney:            { field: "moneyEnabled",       label: "Commandes money activées" },
  resetmoney:          { field: "moneyEnabled",       label: "Commandes money activées" },
  daily:               { field: "dailyEnabled",       label: "Daily activé" },
  work:                { field: "workEnabled",        label: "Work activé" },
  crime:               { field: "crimeEnabled",       label: "Crime activé" },
  deposit:             { field: "depositEnabled",     label: "Dépôt activé" },
  withdraw:            { field: "withdrawEnabled",    label: "Retrait activé" },
  give:                { field: "giveEnabled",        label: "Give activé" },
  "give-money":        { field: "giveEnabled",        label: "Give activé" },
  leaderboard:         { field: "leaderboardEnabled", label: "Leaderboard activé" },
  blackjack:           { field: "blackjackEnabled",   label: "Blackjack activé" },
  gblackjack:          { field: "blackjackEnabled",   label: "Blackjack activé" },
  roulette:            { field: "rouletteEnabled",    label: "Roulette activé" },
  groulette:           { field: "rouletteEnabled",    label: "Roulette activé" },
  "higher-lower":      { field: "hlEnabled",          label: "Higher/Lower activé" },
  "ghigher-lower":     { field: "hlEnabled",          label: "Higher/Lower activé" },
  "guess-number":      { field: "guessEnabled",       label: "Guess the Number activé" },
  "gguess-the-number": { field: "guessEnabled",       label: "Guess the Number activé" },
};

const ADMIN_RECOMMENDED = new Set([
  "addmoney", "removemoney", "setmoney", "resetmoney",
  "addlevel", "removelevel", "resetlevel", "give-item",
]);

// ── GET /api/diagnostics/slash/:name ─────────────────────────────────────────

router.get("/diagnostics/slash/:name", async (req, res): Promise<void> => {
  const { name } = req.params;

  const [manifestRows, configRows, eco, recentLogs] = await Promise.all([
    db.select().from(commandManifestTable).where(eq(commandManifestTable.name, name)),
    db.select().from(commandConfigsTable).where(eq(commandConfigsTable.commandName, name)),
    getEcoConfig(),
    getRecentLogs(name),
  ]);

  if (!manifestRows[0]) {
    res.status(404).json({ error: "Command not found in manifest" });
    return;
  }

  const manifest = manifestRows[0];
  const cfg = configRows[0] ?? null;
  const enabled = cfg?.enabled ?? true;
  const adminOnly = cfg?.adminOnly ?? false;
  const effectiveLabel = cfg?.label ?? manifest.defaultLabel;

  type Check = { ok: boolean; label: string; detail: string; severity: "ok" | "warning" | "error" };
  const checks: Check[] = [];

  // Check 1: command enabled
  checks.push({
    ok: enabled,
    label: "Commande activée",
    detail: enabled
      ? "La commande répond aux membres."
      : "La commande est désactivée — elle ne répondra pas.",
    severity: enabled ? "ok" : "error",
  });

  // Check 2: economy feature flag
  const ecoCheck = ECO_CHECKS[name];
  if (ecoCheck && eco) {
    const featureOn = (eco as Record<string, unknown>)[ecoCheck.field] as boolean;
    checks.push({
      ok: featureOn,
      label: ecoCheck.label,
      detail: featureOn
        ? "Fonctionnalité activée dans la config Economy."
        : `"${ecoCheck.label}" est désactivé dans Economy — la commande échouera.`,
      severity: featureOn ? "ok" : "error",
    });
  }

  // Check 3: admin-only recommendation
  if (ADMIN_RECOMMENDED.has(name) && !adminOnly) {
    checks.push({
      ok: false,
      label: "Admin only recommandé",
      detail: "Cette commande modifie des données de joueurs. Il est fortement recommandé de l'activer en Admin only.",
      severity: "warning",
    });
  } else if (adminOnly) {
    checks.push({
      ok: true,
      label: "Admin only activé",
      detail: "Seuls les administrateurs peuvent utiliser cette commande.",
      severity: "ok",
    });
  }

  res.json({
    commandType: "slash",
    name,
    label: effectiveLabel,
    description: manifest.description,
    category: manifest.category,
    enabled,
    adminOnly,
    recentLogs: recentLogs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    checks,
  });
});

// ── GET /api/diagnostics/custom/:id ──────────────────────────────────────────

router.get("/diagnostics/custom/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [cmdRows] = await Promise.all([
    db.select().from(customCommandsTable).where(eq(customCommandsTable.id, id)),
  ]);

  if (!cmdRows[0]) {
    res.status(404).json({ error: "Custom command not found" });
    return;
  }

  const cmd = cmdRows[0];

  const [grants, recentLogs, [countRow]] = await Promise.all([
    db
      .select()
      .from(ccRewardLogTable)
      .where(eq(ccRewardLogTable.cmdId, id))
      .orderBy(desc(ccRewardLogTable.grantedAt))
      .limit(10),
    getRecentLogs(cmd.trigger),
    db.select({ value: count() }).from(ccRewardLogTable).where(eq(ccRewardLogTable.cmdId, id)),
  ]);

  type Check = { ok: boolean; label: string; detail: string; severity: "ok" | "warning" | "error" };
  const checks: Check[] = [];

  checks.push({
    ok: cmd.enabled,
    label: "Commande activée",
    detail: cmd.enabled ? "La commande est active." : "La commande est désactivée.",
    severity: cmd.enabled ? "ok" : "error",
  });

  checks.push({
    ok: cmd.trigger.length > 0,
    label: "Trigger configuré",
    detail:
      cmd.trigger.length > 0
        ? `Trigger : "${cmd.trigger}" (mode : ${cmd.matchMode})`
        : "Aucun trigger défini — la commande ne se déclenchera jamais.",
    severity: cmd.trigger.length > 0 ? "ok" : "error",
  });

  const hasResponse =
    cmd.responseType === "embed"
      ? cmd.embedTitle.length > 0 || cmd.response.length > 0
      : cmd.response.length > 0;
  checks.push({
    ok: hasResponse,
    label: "Réponse configurée",
    detail: hasResponse
      ? `Type : ${cmd.responseType === "embed" ? "Embed" : "Message"}`
      : "Aucune réponse configurée — le bot ne répondra rien.",
    severity: hasResponse ? "ok" : "warning",
  });

  if (cmd.rewardEnabled) {
    const hasReward =
      cmd.rewardLevels > 0 ||
      cmd.rewardMoney > 0 ||
      cmd.rewardXp > 0 ||
      cmd.rewardRoleId.length > 0;

    if (!hasReward) {
      checks.push({
        ok: false,
        label: "Rewards activées mais vides",
        detail: "Les rewards sont activées mais aucun niveau / XP / coins / rôle n'est configuré.",
        severity: "warning",
      });
    } else {
      const parts: string[] = [];
      if (cmd.rewardLevels > 0) parts.push(`+${cmd.rewardLevels} niv.`);
      if (cmd.rewardXp > 0)     parts.push(`+${cmd.rewardXp} XP`);
      if (cmd.rewardMoney > 0)  parts.push(`+${cmd.rewardMoney} coins`);
      if (cmd.rewardRoleId)     parts.push(`rôle ${cmd.rewardRoleId}`);
      checks.push({
        ok: true,
        label: "Rewards configurées",
        detail: `Cible : ${cmd.rewardTarget === "mentioned" ? "@mentionné" : "auteur"} · ${parts.join(" · ")}`,
        severity: "ok",
      });
    }

    if (cmd.rewardTarget === "mentioned") {
      checks.push({
        ok: true,
        label: "Mention requise",
        detail: "La commande ne s'exécutera que si un @utilisateur est mentionné.",
        severity: "ok",
      });
    }
  }

  if (cmd.cooldownSeconds > 0) {
    checks.push({
      ok: true,
      label: "Cooldown actif",
      detail: `${cmd.cooldownSeconds}s entre deux utilisations par membre.`,
      severity: "ok",
    });
  }

  if (cmd.allowedChannels?.trim()) {
    checks.push({
      ok: true,
      label: "Restriction de salon",
      detail: `Uniquement dans : ${cmd.allowedChannels}`,
      severity: "ok",
    });
  }

  if (cmd.allowedRoles?.trim()) {
    checks.push({
      ok: true,
      label: "Restriction de rôle",
      detail: `Uniquement pour les rôles : ${cmd.allowedRoles}`,
      severity: "ok",
    });
  }

  res.json({
    commandType: "custom",
    config: {
      ...cmd,
      createdAt: cmd.createdAt.toISOString(),
      updatedAt: cmd.updatedAt.toISOString(),
    },
    recentLogs: recentLogs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    checks,
    rewardStats: cmd.rewardEnabled
      ? {
          totalGrants: Number(countRow?.value ?? 0),
          recentGrants: grants.map(g => ({
            authorId: g.authorId,
            targetId: g.targetId,
            grantedAt: g.grantedAt.toISOString(),
          })),
        }
      : null,
  });
});

export default router;
