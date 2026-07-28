import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commandConfigsTable } from "@workspace/db";
import { triggerSync } from "./command-sync";
import {
  ListCommandConfigsResponse,
  UpdateCommandConfigBody,
  UpdateCommandConfigParams,
  UpdateCommandConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Static command registry ───────────────────────────────────────────────────

const KNOWN_COMMANDS = [
  { name: "balance",      label: "Balance",       description: "Voir son solde ou celui d'un autre joueur (option facultative)", category: "economy" },
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
  { name: "roulette",       label: "Roulette",          description: "Jouer à la roulette",                                 category: "games" },
  { name: "guess-number",  label: "Guess the Number", description: "Deviner un nombre entre 1 et 100 [pari]",              category: "games" },
  { name: "shop",            label: "Shop",            description: "Voir les items disponibles",                   category: "shop" },
  { name: "buy",             label: "Buy",             description: "Acheter un item du shop",                      category: "shop" },
  { name: "inventory",       label: "Inventory",       description: "Voir son inventaire d'items",                  category: "shop" },
  { name: "giveaway-start",  label: "Giveaway Start",  description: "Ouvrir le panneau de création de giveaway [Admin]", category: "giveaway" },
  { name: "giveaway-end",    label: "Giveaway End",    description: "Terminer un giveaway immédiatement [Admin]",          category: "giveaway" },
  { name: "giveaway-reroll", label: "Giveaway Reroll", description: "Retirer un nouveau gagnant [Admin]",                  category: "giveaway" },
  { name: "config-language", label: "Config Language", description: "Changer la langue du bot [Admin]",                          category: "config"          },
  { name: "rdm-config",     label: "Rdm Config",      description: "Voir ou modifier la config des msgs aléatoires [Admin]",  category: "random-activity" },
  { name: "rdm-toggle",     label: "Rdm Toggle",      description: "Activer / désactiver les msgs aléatoires en un clic [Admin]", category: "random-activity" },
  { name: "rdm-add",        label: "Rdm Add",         description: "Ajouter un message au pool [Admin]",                     category: "random-activity" },
  { name: "rdm-list",       label: "Rdm List",        description: "Lister tous les messages du pool avec leurs IDs [Admin]", category: "random-activity" },
  { name: "rdm-remove",     label: "Rdm Remove",      description: "Supprimer un message du pool par son ID [Admin]",        category: "random-activity" },
] as const;

const KNOWN_COMMAND_NAMES = new Set(KNOWN_COMMANDS.map(c => c.name));

function merge(
  known: typeof KNOWN_COMMANDS[number],
  row: typeof commandConfigsTable.$inferSelect | undefined
) {
  return {
    name:        known.name,
    label:       row?.label ?? known.label,
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
      label:     d.label ?? null,
    })
    .onConflictDoUpdate({
      target: commandConfigsTable.commandName,
      set: {
        ...(d.enabled   !== undefined && { enabled:   d.enabled }),
        ...(d.adminOnly !== undefined && { adminOnly: d.adminOnly }),
        ...(d.label     !== undefined && { label:     d.label }),
        updatedAt: new Date(),
      },
    })
    .returning();

  const known = KNOWN_COMMANDS.find(c => c.name === name)!;
  triggerSync();
  res.json(UpdateCommandConfigResponse.parse(merge(known, upserted)));
});

export default router;
