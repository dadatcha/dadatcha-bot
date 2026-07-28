import { useState, useEffect, useMemo } from 'react';
import {
  useGetEconomyConfig, useUpdateEconomyConfig, getGetEconomyConfigQueryKey, getGetEconomyConfigQueryOptions,
  useListPlayers, useUpdatePlayerBalance, getListPlayersQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow, NumberField } from '@/components/ui/field-row';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Coins, TrendingUp, Skull,
  Gift, Trophy, Sparkles, Eye, Pencil, Check, X, Search, Users, MessageCircle, RefreshCw,
  Spade, Target, ArrowUpDown, Hash,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Cfg = {
  startingWallet: number;
  balanceEnabled: boolean; moneyEnabled: boolean;
  dailyEnabled: boolean; dailyAmount: number; dailyCooldownHours: number;
  workEnabled: boolean; workMinAmount: number; workMaxAmount: number; workCooldownHours: number;
  crimeEnabled: boolean; crimeWinMin: number; crimeWinMax: number;
  crimeLoseMin: number; crimeLoseMax: number; crimeWinChance: number; crimeCooldownHours: number;
  depositEnabled: boolean; withdrawEnabled: boolean; giveEnabled: boolean; leaderboardEnabled: boolean;
  blackjackEnabled: boolean; blackjackMinBet: number; blackjackMaxBet: number;
  rouletteEnabled: boolean; rouletteMinBet: number; rouletteMaxBet: number;
  hlEnabled: boolean; hlMinBet: number; hlMaxBet: number; hlStreakReward: number;
  guessEnabled: boolean; guessMinBet: number; guessMaxBet: number; guessMaxAttempts: number;
  currencyName: string;
  messageRewardEnabled: boolean; messageRewardMin: number; messageRewardMax: number; messageRewardCooldownSeconds: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function useDirty<T extends object>(remote: T | undefined) {
  const [local, setLocal] = useState<T | null>(null);
  useEffect(() => { if (remote && !local) setLocal(remote); }, [remote]);
  const patch = (updates: Partial<T>) => setLocal(p => p ? { ...p, ...updates } : null);
  const isDirty = local && remote ? JSON.stringify(local) !== JSON.stringify(remote) : false;
  return { local: local ?? remote, patch, isDirty: !!isDirty, reset: () => setLocal(null) };
}

// ── Economy settings tab ──────────────────────────────────────────────────────

function EconomySettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: cfg } = useGetEconomyConfig({ query: { queryKey: getGetEconomyConfigQueryKey() } });
  const update = useUpdateEconomyConfig();

  const [form, setForm] = useState<Cfg | null>(null);
  const [saved, setSaved] = useState<Cfg | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (cfg && !form) { setForm(cfg as Cfg); setSaved(cfg as Cfg); }
  }, [cfg]);

  const dirty = form && saved ? JSON.stringify(form) !== JSON.stringify(saved) : false;
  const p = (u: Partial<Cfg>) => setForm(f => f ? { ...f, ...u } : null);

  const syncConfig = async () => {
    setSyncing(true);
    try {
      const fresh = await queryClient.fetchQuery({ ...getGetEconomyConfigQueryOptions(), staleTime: 0 });
      if (fresh) { setForm(fresh as Cfg); setSaved(fresh as Cfg); }
      toast({ title: 'Configuration synchronisée' });
    } catch {
      toast({ title: 'Erreur de synchronisation', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  function saveModule(fields: Partial<Cfg>) {
    if (!form) return;
    const payload = { ...fields };
    update.mutate(
      { data: payload as Parameters<typeof update.mutate>[0]['data'] },
      {
        onSuccess: (data) => {
          setForm(data as Cfg); setSaved(data as Cfg);
          queryClient.invalidateQueries({ queryKey: getGetEconomyConfigQueryKey() });
          toast({ title: 'Saved' });
        },
        onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
      }
    );
  }

  if (!form) return <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>;

  const c = form.currencyName || 'coins';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={syncConfig} disabled={syncing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          Synchroniser
        </Button>
      </div>
      {/* Currency name */}
      <ModuleCard title="Currency" description="Name of the virtual currency shown in all bot messages."
        icon={Sparkles} iconColor="text-violet-500"
        enabled={true} onToggle={() => {}}
        onSave={() => saveModule({ currencyName: form.currencyName })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Currency name" hint={`Shown after every amount — e.g. "500 ${c}".`}>
          <input
            value={form.currencyName}
            onChange={e => p({ currencyName: e.target.value })}
            placeholder="coins"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </FieldRow>
      </ModuleCard>

      {/* Starting wallet / balance */}
      <ModuleCard title="/balance" description="Show a player's wallet and bank balance."
        icon={Eye} enabled={form.balanceEnabled && form.moneyEnabled}
        onToggle={(v) => p({ balanceEnabled: v, moneyEnabled: v })}
        onSave={() => saveModule({ balanceEnabled: form.balanceEnabled, moneyEnabled: form.moneyEnabled, startingWallet: form.startingWallet })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Starting wallet" hint={`${c} given to new players on first command.`}>
          <NumberField value={form.startingWallet} onChange={(v) => p({ startingWallet: v })} min={0} suffix={c} />
        </FieldRow>
      </ModuleCard>

      {/* Daily */}
      <ModuleCard title="/daily" description={`Claim a daily ${c} reward once every 24 hours.`}
        icon={Gift} iconColor="text-yellow-500"
        enabled={form.dailyEnabled} onToggle={(v) => p({ dailyEnabled: v })}
        onSave={() => saveModule({ dailyEnabled: form.dailyEnabled, dailyAmount: form.dailyAmount, dailyCooldownHours: form.dailyCooldownHours })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Reward amount" hint={`${c} awarded per claim.`}>
          <NumberField value={form.dailyAmount} onChange={(v) => p({ dailyAmount: v })} min={1} suffix={c} />
        </FieldRow>
        <FieldRow label="Cooldown" hint="Hours between claims.">
          <NumberField value={form.dailyCooldownHours} onChange={(v) => p({ dailyCooldownHours: v })} min={1} suffix="h" />
        </FieldRow>
      </ModuleCard>

      {/* Work */}
      <ModuleCard title="/work" description={`Earn ${c} by working. Has a cooldown between uses.`}
        icon={TrendingUp} iconColor="text-green-500"
        enabled={form.workEnabled} onToggle={(v) => p({ workEnabled: v })}
        onSave={() => saveModule({ workEnabled: form.workEnabled, workMinAmount: form.workMinAmount, workMaxAmount: form.workMaxAmount, workCooldownHours: form.workCooldownHours })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Min earnings">
          <NumberField value={form.workMinAmount} onChange={(v) => p({ workMinAmount: v })} min={1} suffix={c} />
        </FieldRow>
        <FieldRow label="Max earnings">
          <NumberField value={form.workMaxAmount} onChange={(v) => p({ workMaxAmount: v })} min={1} suffix={c} />
        </FieldRow>
        <FieldRow label="Cooldown">
          <NumberField value={form.workCooldownHours} onChange={(v) => p({ workCooldownHours: v })} min={1} suffix="h" />
        </FieldRow>
      </ModuleCard>

      {/* Crime */}
      <ModuleCard title="/crime" description={`High-risk earn: chance of big reward or fine in ${c}.`}
        icon={Skull} iconColor="text-red-500"
        enabled={form.crimeEnabled} onToggle={(v) => p({ crimeEnabled: v })}
        onSave={() => saveModule({ crimeEnabled: form.crimeEnabled, crimeWinMin: form.crimeWinMin, crimeWinMax: form.crimeWinMax, crimeLoseMin: form.crimeLoseMin, crimeLoseMax: form.crimeLoseMax, crimeWinChance: form.crimeWinChance, crimeCooldownHours: form.crimeCooldownHours })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Win chance">
          <NumberField value={form.crimeWinChance} onChange={(v) => p({ crimeWinChance: Math.min(100, Math.max(0, v)) })} min={0} max={100} suffix="%" />
        </FieldRow>
        <FieldRow label="Win min">
          <NumberField value={form.crimeWinMin} onChange={(v) => p({ crimeWinMin: v })} min={1} suffix={c} />
        </FieldRow>
        <FieldRow label="Win max">
          <NumberField value={form.crimeWinMax} onChange={(v) => p({ crimeWinMax: v })} min={1} suffix={c} />
        </FieldRow>
        <FieldRow label="Fine min">
          <NumberField value={form.crimeLoseMin} onChange={(v) => p({ crimeLoseMin: v })} min={0} suffix={c} />
        </FieldRow>
        <FieldRow label="Fine max">
          <NumberField value={form.crimeLoseMax} onChange={(v) => p({ crimeLoseMax: v })} min={0} suffix={c} />
        </FieldRow>
        <FieldRow label="Cooldown">
          <NumberField value={form.crimeCooldownHours} onChange={(v) => p({ crimeCooldownHours: v })} min={1} suffix="h" />
        </FieldRow>
      </ModuleCard>

      {/* Deposit / Withdraw / Give / Leaderboard */}
      <ModuleCard title="Transfers & misc" description="/deposit, /withdraw, /give, /leaderboard — bank and player transfers."
        icon={Coins} iconColor="text-indigo-500"
        enabled={form.depositEnabled || form.withdrawEnabled || form.giveEnabled || form.leaderboardEnabled}
        onToggle={(v) => p({ depositEnabled: v, withdrawEnabled: v, giveEnabled: v, leaderboardEnabled: v })}
        onSave={() => saveModule({ depositEnabled: form.depositEnabled, withdrawEnabled: form.withdrawEnabled, giveEnabled: form.giveEnabled, leaderboardEnabled: form.leaderboardEnabled })}
        saving={update.isPending} dirty={dirty}>
        <div className="space-y-3">
          {([
            ['depositEnabled', '/deposit', `Move ${c} from wallet to bank`],
            ['withdrawEnabled', '/withdraw', `Move ${c} from bank to wallet`],
            ['giveEnabled', '/give', `Transfer ${c} to another player`],
            ['leaderboardEnabled', '/leaderboard', 'Show top 10 richest players'],
          ] as [keyof Cfg, string, string][]).map(([key, cmd, desc]) => (
            <div key={key} className="flex items-center justify-between py-1">
              <div>
                <span className="text-sm font-mono font-medium text-indigo-600">{cmd}</span>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch checked={form[key] as boolean} onCheckedChange={(v) => p({ [key]: v } as Partial<Cfg>)} />
            </div>
          ))}
        </div>
      </ModuleCard>

      {/* Message reward */}
      <ModuleCard title="Coins par message" description={`Récompense aléatoire en ${c} à chaque message envoyé dans le serveur.`}
        icon={MessageCircle} iconColor="text-emerald-500"
        enabled={form.messageRewardEnabled} onToggle={(v) => p({ messageRewardEnabled: v })}
        onSave={() => saveModule({ messageRewardEnabled: form.messageRewardEnabled, messageRewardMin: form.messageRewardMin, messageRewardMax: form.messageRewardMax, messageRewardCooldownSeconds: form.messageRewardCooldownSeconds })}
        saving={update.isPending} dirty={dirty}>
        <FieldRow label="Minimum" hint={`Minimum de ${c} accordés par message.`}>
          <NumberField value={form.messageRewardMin} onChange={(v) => p({ messageRewardMin: v })} min={0} suffix={c} />
        </FieldRow>
        <FieldRow label="Maximum" hint={`Maximum de ${c} accordés par message.`}>
          <NumberField value={form.messageRewardMax} onChange={(v) => p({ messageRewardMax: v })} min={0} suffix={c} />
        </FieldRow>
        <FieldRow label="Cooldown" hint="Délai minimum entre deux récompenses pour le même joueur.">
          <NumberField value={form.messageRewardCooldownSeconds} onChange={(v) => p({ messageRewardCooldownSeconds: v })} min={1} suffix="s" />
        </FieldRow>
      </ModuleCard>

      {/* ── Games ─────────────────────────────────────────────────────────── */}
      <div className="pt-2">
        <h2 className="text-base font-semibold tracking-tight mb-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-violet-100 text-violet-600"><Spade className="w-3.5 h-3.5" /></span>
          Jeux
        </h2>
        <div className="space-y-4">

          {/* Blackjack */}
          <ModuleCard title="/blackjack" description={`Jeu de blackjack — mise en ${c}, le croupier tire jusqu'à 17.`}
            icon={Spade} iconColor="text-violet-600"
            enabled={form.blackjackEnabled} onToggle={(v) => p({ blackjackEnabled: v })}
            onSave={() => saveModule({ blackjackEnabled: form.blackjackEnabled, blackjackMinBet: form.blackjackMinBet, blackjackMaxBet: form.blackjackMaxBet })}
            saving={update.isPending} dirty={dirty}>
            <FieldRow label="Mise minimum">
              <NumberField value={form.blackjackMinBet} onChange={(v) => p({ blackjackMinBet: v })} min={1} suffix={c} />
            </FieldRow>
            <FieldRow label="Mise maximum">
              <NumberField value={form.blackjackMaxBet} onChange={(v) => p({ blackjackMaxBet: v })} min={1} suffix={c} />
            </FieldRow>
          </ModuleCard>

          {/* Roulette */}
          <ModuleCard title="/roulette" description={`Roulette — Rouge/Noir ×2, Vert ×14.`}
            icon={Target} iconColor="text-rose-500"
            enabled={form.rouletteEnabled} onToggle={(v) => p({ rouletteEnabled: v })}
            onSave={() => saveModule({ rouletteEnabled: form.rouletteEnabled, rouletteMinBet: form.rouletteMinBet, rouletteMaxBet: form.rouletteMaxBet })}
            saving={update.isPending} dirty={dirty}>
            <FieldRow label="Mise minimum">
              <NumberField value={form.rouletteMinBet} onChange={(v) => p({ rouletteMinBet: v })} min={1} suffix={c} />
            </FieldRow>
            <FieldRow label="Mise maximum">
              <NumberField value={form.rouletteMaxBet} onChange={(v) => p({ rouletteMaxBet: v })} min={1} suffix={c} />
            </FieldRow>
          </ModuleCard>

          {/* Higher-Lower */}
          <ModuleCard title="/higher-lower" description="Devine si le prochain nombre est plus haut ou plus bas — série de bonnes réponses = coins."
            icon={ArrowUpDown} iconColor="text-purple-500"
            enabled={form.hlEnabled} onToggle={(v) => p({ hlEnabled: v })}
            onSave={() => saveModule({ hlEnabled: form.hlEnabled, hlStreakReward: form.hlStreakReward })}
            saving={update.isPending} dirty={dirty}>
            <FieldRow label="Récompense par bonne réponse" hint={`${c} gagnés à chaque bonne réponse dans la série.`}>
              <NumberField value={form.hlStreakReward} onChange={(v) => p({ hlStreakReward: v })} min={0} suffix={c} />
            </FieldRow>
          </ModuleCard>

          {/* Guess-Number */}
          <ModuleCard title="/guess-number" description={`Devine un nombre entre 1 et 100 — mise en ${c}, multiplicateur décroissant par tentative.`}
            icon={Hash} iconColor="text-indigo-500"
            enabled={form.guessEnabled} onToggle={(v) => p({ guessEnabled: v })}
            onSave={() => saveModule({ guessEnabled: form.guessEnabled, guessMinBet: form.guessMinBet, guessMaxBet: form.guessMaxBet, guessMaxAttempts: form.guessMaxAttempts })}
            saving={update.isPending} dirty={dirty}>
            <FieldRow label="Mise minimum">
              <NumberField value={form.guessMinBet} onChange={(v) => p({ guessMinBet: v })} min={1} suffix={c} />
            </FieldRow>
            <FieldRow label="Mise maximum">
              <NumberField value={form.guessMaxBet} onChange={(v) => p({ guessMaxBet: v })} min={1} suffix={c} />
            </FieldRow>
            <FieldRow label="Tentatives max" hint="Entre 1 et 10. Affecte aussi les multiplicateurs disponibles.">
              <NumberField value={form.guessMaxAttempts} onChange={(v) => p({ guessMaxAttempts: Math.min(10, Math.max(1, v)) })} min={1} max={10} />
            </FieldRow>
          </ModuleCard>

        </div>
      </div>
    </div>
  );
}

// ── Players tab ───────────────────────────────────────────────────────────────

function PlayersTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: players = [], isLoading } = useListPlayers({ query: { refetchInterval: 10000, queryKey: getListPlayersQueryKey() } });
  const updateBalance = useUpdatePlayerBalance();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ userId: string; wallet: string; bank: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncPlayers = async () => {
    setSyncing(true);
    await queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey() });
    await queryClient.refetchQueries({ queryKey: getListPlayersQueryKey() });
    setSyncing(false);
    toast({ title: 'Liste synchronisée' });
  };

  type P = typeof players[number];
  const sorted = useMemo(() => [...players].sort((a, b) => b.total - a.total), [players]);
  const filtered = useMemo(() => search.trim() ? sorted.filter(p => p.username.toLowerCase().includes(search.toLowerCase())) : sorted, [sorted, search]);
  const circulation = useMemo(() => players.reduce((s, p) => s + p.total, 0), [players]);

  const saveEdit = () => {
    if (!editing) return;
    const wallet = parseInt(editing.wallet, 10);
    const bank = parseInt(editing.bank, 10);
    if (isNaN(wallet) || isNaN(bank) || wallet < 0 || bank < 0) { toast({ title: 'Invalid amount', variant: 'destructive' }); return; }
    updateBalance.mutate({ userId: editing.userId, data: { wallet, bank } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey() }); toast({ title: 'Balance updated' }); setEditing(null); },
      onError: () => toast({ title: 'Failed', variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Players', value: players.length, icon: Users },
          { label: 'Coins in circulation', value: circulation.toLocaleString(), icon: Coins },
          { label: 'Richest', value: sorted[0]?.username ?? '—', icon: Trophy },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><Icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
              <p className="font-bold font-mono">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Sync */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Filter by username…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" size="sm" onClick={syncPlayers} disabled={syncing} className="gap-2 shrink-0">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          Synchroniser
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-muted/30">
              {['#', 'Player', 'Wallet', 'Bank', 'Total', ''].map(h => (
                <th key={h} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${h === 'Wallet' || h === 'Bank' || h === 'Total' ? 'text-right' : h === '' ? '' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">No players yet.</td></tr>
            )}
            {filtered.map((player) => {
              const rank = sorted.indexOf(player) + 1;
              const isEditing = editing?.userId === player.userId;
              return (
                <tr key={player.userId} className="border-b border-card-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground w-10">
                    <span className={rank <= 3 ? 'text-indigo-600 font-bold' : ''}>{rank}</span>
                  </td>
                  <td className="px-4 py-3 font-medium">{player.username}</td>
                  {isEditing ? (
                    <>
                      <td className="px-4 py-2 text-right">
                        <Input type="number" min="0" value={editing.wallet} onChange={e => setEditing({ ...editing, wallet: e.target.value })} className="w-28 text-right font-mono text-sm h-8 ml-auto" />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Input type="number" min="0" value={editing.bank} onChange={e => setEditing({ ...editing, bank: e.target.value })} className="w-28 text-right font-mono text-sm h-8 ml-auto" />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {((parseInt(editing.wallet) || 0) + (parseInt(editing.bank) || 0)).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={saveEdit} disabled={updateBalance.isPending} className="h-7 w-7 p-0 text-indigo-600 hover:text-indigo-700"><Check className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-7 w-7 p-0 text-muted-foreground"><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{player.wallet.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{player.bank.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-indigo-600">{player.total.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ userId: player.userId, wallet: String(player.wallet), bank: String(player.bank) })} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></Button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Economy() {
  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Economy</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure economy commands and manage player balances</p>
      </div>
      <Tabs defaultValue="commands">
        <TabsList className="mb-6">
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="players">Players</TabsTrigger>
        </TabsList>
        <TabsContent value="commands"><EconomySettings /></TabsContent>
        <TabsContent value="players"><PlayersTab /></TabsContent>
      </Tabs>
    </div>
  );
}
