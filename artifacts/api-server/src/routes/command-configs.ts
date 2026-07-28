import { Router, type IRouter } from "express";
import { eq, notInArray } from "drizzle-orm";
import { db, commandConfigsTable, commandManifestTable } from "@workspace/db";
import { triggerSync } from "./command-sync";
import {
  ListCommandConfigsResponse,
  UpdateCommandConfigBody,
  UpdateCommandConfigParams,
  UpdateCommandConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Static fallback registry (used only when the bot hasn't pushed a manifest yet) ──

const KNOWN_COMMANDS = [
  { name: "balance",        defaultLabel: "Balance",        description: "Voir son solde ou celui d'un autre joueur (option facultative)", category: "economy" },
  { name: "addmoney",       defaultLabel: "Add Money",       description: "Ajouter des coins à un joueur [Admin]", category: "economy" },
  { name: "removemoney",    defaultLabel: "Remove Money",    description: "Retirer des coins à un joueur [Admin]", category: "economy" },
  { name: "setmoney",       defaultLabel: "Set Money",       description: "Définir le solde exact d'un joueur [Admin]", category: "economy" },
  { name: "resetmoney",     defaultLabel: "Reset Money",     description: "Remettre le solde à 0 [Admin]", category: "economy" },
  { name: "daily",          defaultLabel: "Daily",           description: "Récompense quotidienne", category: "economy" },
  { name: "work",           defaultLabel: "Work",            description: "Travailler pour gagner des coins", category: "economy" },
  { name: "crime",          defaultLabel: "Crime",           description: "Tenter un crime (gain ou perte)", category: "economy" },
  { name: "deposit",        defaultLabel: "Deposit",         description: "Déposer des coins en banque", category: "economy" },
  { name: "withdraw",       defaultLabel: "Withdraw",        description: "Retirer des coins de la banque", category: "economy" },
  { name: "give",           defaultLabel: "Give",            description: "Donner des coins à un autre joueur", category: "economy" },
  { name: "leaderboard",    defaultLabel: "Leaderboard",     description: "Top 10 des joueurs les plus riches", category: "economy" },
  { name: "level",          defaultLabel: "Level",           description: "Voir son niveau et son XP (ou celui d'un autre membre)", category: "economy" },
  { name: "level-top",      defaultLabel: "Level Top",       description: "Classement des membres par niveau et XP", category: "economy" },
  { name: "addlevel",       defaultLabel: "Add Level",       description: "Ajouter des niveaux à un joueur [Admin]", category: "economy" },
  { name: "removelevel",    defaultLabel: "Remove Level",    description: "Retirer des niveaux à un joueur [Admin]", category: "economy" },
  { name: "resetlevel",     defaultLabel: "Reset Level",     description: "Remettre le niveau et l'XP d'un joueur à 0 [Admin]", category: "economy" },
  { name: "blackjack",      defaultLabel: "Blackjack",       description: "Jouer au blackjack", category: "games" },
  { name: "higher-lower",   defaultLabel: "Higher / Lower",  description: "Deviner si le chiffre suivant est plus haut ou plus bas", category: "games" },
  { name: "roulette",       defaultLabel: "Roulette",        description: "Jouer à la roulette", category: "games" },
  { name: "guess-number",   defaultLabel: "Guess the Number", description: "Deviner un nombre entre 1 et 100 [pari]", category: "games" },
  { name: "shop",           defaultLabel: "Shop",            description: "Voir les items disponibles", category: "shop" },
  { name: "buy",            defaultLabel: "Buy",             description: "Acheter un item du shop", category: "shop" },
  { name: "inventory",      defaultLabel: "Inventory",       description: "Voir son inventaire d'items", category: "shop" },
  { name: "give-item",      defaultLabel: "Give Item",       description: "Donner un item à un joueur [Admin]", category: "shop" },
  { name: "giveaway-start", defaultLabel: "Giveaway Start",  description: "Ouvrir le panneau de création de giveaway [Admin]", category: "giveaway" },
  { name: "giveaway-end",   defaultLabel: "Giveaway End",    description: "Terminer un giveaway immédiatement [Admin]", category: "giveaway" },
  { name: "giveaway-reroll",defaultLabel: "Giveaway Reroll", description: "Retirer un nouveau gagnant [Admin]", category: "giveaway" },
  { name: "config-language",defaultLabel: "Config Language", description: "Changer la langue du bot [Admin]", category: "config" },
  { name: "rdm-config",     defaultLabel: "Rdm Config",      description: "Voir ou modifier la config des msgs aléatoires [Admin]", category: "random-activity" },
  { name: "rdm-toggle",     defaultLabel: "Rdm Toggle",      description: "Activer / désactiver les msgs aléatoires en un clic [Admin]", category: "random-activity" },
  { name: "rdm-add",        defaultLabel: "Rdm Add",         description: "Ajouter un message au pool [Admin]", category: "random-activity" },
  { name: "rdm-list",       defaultLabel: "Rdm List",        description: "Lister tous les messages du pool avec leurs IDs [Admin]", category: "random-activity" },
  { name: "rdm-remove",     defaultLabel: "Rdm Remove",      description: "Supprimer un message du pool par son ID [Admin]", category: "random-activity" },
];

function mergeEntry(
  src: { name: string; defaultLabel: string; description: string; category: string },
  row: typeof commandConfigsTable.$inferSelect | undefined
) {
  return {
    name:        src.name,
    label:       row?.label ?? src.defaultLabel,
    description: src.description,
    category:    src.category,
    enabled:     row?.enabled  ?? true,
    adminOnly:   row?.adminOnly ?? false,
  };
}

// ── POST /commands/manifest ───────────────────────────────────────────────────
// Called by the bot after every sync to register its full command tree.

router.post("/commands/manifest", async (req, res): Promise<void> => {
  const entries = req.body as Array<{
    name: string; defaultLabel: string; description: string; category: string;
  }>;

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "entries must be a non-empty array" }); return;
  }

  // Upsert every entry
  for (const e of entries) {
    await db
      .insert(commandManifestTable)
      .values({ name: e.name, defaultLabel: e.defaultLabel, description: e.description, category: e.category })
      .onConflictDoUpdate({
        target: commandManifestTable.name,
        set: {
          defaultLabel: e.defaultLabel,
          description:  e.description,
          category:     e.category,
          updatedAt:    new Date(),
        },
      });
  }

  // Remove commands that no longer exist in the bot
  const names = entries.map(e => e.name);
  await db.delete(commandManifestTable).where(notInArray(commandManifestTable.name, names));

  res.status(204).send();
});

// ── GET /command-configs ──────────────────────────────────────────────────────

router.get("/command-configs", async (_req, res): Promise<void> => {
  const [manifest, configs] = await Promise.all([
    db.select().from(commandManifestTable),
    db.select().from(commandConfigsTable),
  ]);

  const configMap = new Map(configs.map(r => [r.commandName, r]));

  // Use live manifest from bot; fall back to static list if bot hasn't pushed yet
  const source = manifest.length > 0 ? manifest : KNOWN_COMMANDS;
  const result = source.map(cmd => mergeEntry(cmd, configMap.get(cmd.name)));

  res.json(ListCommandConfigsResponse.parse(result));
});

// ── PUT /command-configs/:name ────────────────────────────────────────────────

router.put("/command-configs/:name", async (req, res): Promise<void> => {
  const params = UpdateCommandConfigParams.safeParse({ name: req.params.name });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { name } = params.data;

  // Accept if the name is in the live manifest OR in the static fallback
  const [manifestEntry] = await db
    .select()
    .from(commandManifestTable)
    .where(eq(commandManifestTable.name, name));

  const staticEntry = KNOWN_COMMANDS.find(c => c.name === name);

  if (!manifestEntry && !staticEntry) {
    res.status(404).json({ error: "Unknown command" }); return;
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

  const src = manifestEntry ?? staticEntry!;
  triggerSync();
  res.json(UpdateCommandConfigResponse.parse(mergeEntry(src, upserted)));
});

export default router;
