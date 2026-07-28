import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commandConfigsTable } from "@workspace/db";
import {
  ListCommandConfigsResponse,
  UpdateCommandConfigBody,
  UpdateCommandConfigParams,
  UpdateCommandConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Static command registry ───────────────────────────────────────────────────

const KNOWN_COMMANDS = [
  { name: "balance",      label: "Balance",       description: "Voir son solde (wallet + banque)", category: "economy" },
  { name: "money",        label: "Money",         description: "Voir le solde d'un autre joueur",  category: "economy" },
  { name: "addmoney",     label: "Add Money",     description: "Ajouter des coins à un joueur [Admin]", category: "economy" },
  { name: "removemoney",  label: "Remove Money",  description: "Retirer des coins à un joueur [Admin]", category: "economy" },
  { name: "setmoney",     label: "Set Money",     description: "Définir le solde exact d'un joueur [Admin]", category: "economy" },
  { name: "resetmoney",   label: "Reset Money",   description: "Remettre le solde à 0 [Admin]",    category: "economy" },
  { name: "daily",        label: "Daily",         description: "Récompense quotidienne",            category: "economy" },
  { name: "work",         label: "Work",          description: "Travailler pour gagner des coins",  category: "economy" },
  { name: "crime",        label: "Crime",         description: "Tenter un crime (gain ou perte)",   category: "economy" },
  { name: "deposit",      label: "Deposit",       description: "Déposer des coins en banque",       category: "economy" },
  { name: "withdraw",     label: "Withdraw",      description: "Retirer des coins de la banque",    category: "economy" },
  { name: "give",         label: "Give",          description: "Donner des coins à un autre joueur", category: "economy" },
  { name: "leaderboard",  label: "Leaderboard",   description: "Top 10 des joueurs les plus riches", category: "economy" },
  { name: "blackjack",    label: "Blackjack",     description: "Jouer au blackjack",                category: "games" },
  { name: "higher-lower", label: "Higher / Lower", description: "Deviner si le chiffre suivant est plus haut ou plus bas", category: "games" },
  { name: "roulette",     label: "Roulette",      description: "Jouer à la roulette",               category: "games" },
  { name: "shop",         label: "Shop",          description: "Voir les items disponibles",         category: "shop" },
  { name: "buy",          label: "Buy",           description: "Acheter un item du shop",            category: "shop" },
] as const;

const KNOWN_COMMAND_NAMES = new Set(KNOWN_COMMANDS.map(c => c.name));

function merge(
  known: typeof KNOWN_COMMANDS[number],
  row: typeof commandConfigsTable.$inferSelect | undefined
) {
  return {
    name:        known.name,
    label:       known.label,
    description: known.description,
    category:    known.category,
    enabled:     row?.enabled  ?? true,
    adminOnly:   row?.adminOnly ?? false,
  };
}

// ── GET /command-configs ──────────────────────────────────────────────────────

router.get("/command-configs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(commandConfigsTable);
  const rowMap = new Map(rows.map(r => [r.commandName, r]));
  const result = KNOWN_COMMANDS.map(cmd => merge(cmd, rowMap.get(cmd.name)));
  res.json(ListCommandConfigsResponse.parse(result));
});

// ── PUT /command-configs/:name ────────────────────────────────────────────────

router.put("/command-configs/:name", async (req, res): Promise<void> => {
  const params = UpdateCommandConfigParams.safeParse({ name: req.params.name });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { name } = params.data;
  if (!KNOWN_COMMAND_NAMES.has(name as any)) {
    res.status(404).json({ error: "Unknown command" });
    return;
  }

  const parsed = UpdateCommandConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const d = parsed.data;
  const [upserted] = await db
    .insert(commandConfigsTable)
    .values({
      commandName: name,
      enabled:   d.enabled  ?? true,
      adminOnly: d.adminOnly ?? false,
    })
    .onConflictDoUpdate({
      target: commandConfigsTable.commandName,
      set: {
        enabled:   d.enabled  ?? true,
        adminOnly: d.adminOnly ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();

  const known = KNOWN_COMMANDS.find(c => c.name === name)!;
  res.json(UpdateCommandConfigResponse.parse(merge(known, upserted)));
});

export default router;
