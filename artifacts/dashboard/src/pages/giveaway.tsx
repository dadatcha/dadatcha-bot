import { useState } from 'react';
import {
  useListGiveaways,
  useCreateGiveaway,
  useDeleteGiveaway,
  getListGiveawaysQueryKey,
} from '@workspace/api-client-react';
import { getApiBase } from '@/lib/api-url';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Gift, Plus, Trash2, Trophy, Clock, Users, Hash,
  Shield, Coins, UserCheck, Ban, User, MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type GiveawayReward =
  | { type: 'money'; amount: number }
  | { type: 'role'; roleId: string; roleName: string }
  | { type: 'item'; itemId: number; itemName: string };

type Giveaway = {
  id: number;
  channelId: string;
  messageId: string | null;
  prize: string;
  winnersCount: number;
  endsAt: string;
  endedAt: string | null;
  winners: string[];
  status: string;
  requiredRoleId: string | null;
  requiredMinBalance: number | null;
  requiredRoleIds: string[];
  forbiddenRoleIds: string[];
  hostId: string | null;
  mentionedRoleIds: string[];
  rewards: GiveawayReward[];
  createdAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeLeft(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Expiré';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function rewardLabel(r: GiveawayReward): string {
  if (r.type === 'money') return `💰 ${r.amount.toLocaleString('fr-FR')} pièces`;
  if (r.type === 'role') return `🎭 ${r.roleName}`;
  if (r.type === 'item') return `📦 ${r.itemName}`;
  return '?';
}

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({ icon: Icon, children, color = 'default' }: {
  icon: React.ElementType;
  children: React.ReactNode;
  color?: 'default' | 'indigo' | 'red' | 'amber' | 'green' | 'blue';
}) {
  const cls: Record<string, string> = {
    default: 'bg-muted text-muted-foreground border-border',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    red:    'bg-red-50 text-red-700 border-red-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    green:  'bg-green-50 text-green-700 border-green-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium border rounded-full px-2 py-0.5', cls[color])}>
      <Icon className="w-2.5 h-2.5 shrink-0" />
      {children}
    </span>
  );
}

// ── GiveawayCard ──────────────────────────────────────────────────────────────

function GiveawayCard({ g, onDeleted }: { g: Giveaway; onDeleted: () => void }) {
  const { toast } = useToast();
  const del = useDeleteGiveaway();
  const active = g.status === 'active';

  // Merge legacy + new role lists
  const allowedRoles = [...new Set([...(g.requiredRoleIds ?? []), ...(g.requiredRoleId ? [g.requiredRoleId] : [])])];

  function remove() {
    if (!confirm(`Supprimer le giveaway "${g.prize}" ?`)) return;
    del.mutate(
      { id: g.id },
      {
        onSuccess: () => { onDeleted(); toast({ title: 'Giveaway supprimé' }); },
        onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
      },
    );
  }

  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-3',
      active ? 'border-yellow-300 bg-yellow-50/40' : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">🎉</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{g.prize}</p>
            <p className="text-xs text-muted-foreground">
              {active
                ? <>Fin <span className="font-medium text-yellow-600">{timeLeft(g.endsAt)}</span> · {fmt(g.endsAt)}</>
                : <>Terminé le {fmt(g.endedAt ?? g.endsAt)}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border',
            active ? 'text-yellow-700 bg-yellow-100 border-yellow-300' : 'text-muted-foreground bg-muted border-border',
          )}>
            {active ? 'Actif' : 'Terminé'}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={remove} disabled={del.isPending}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><Hash className="w-3 h-3" /><span className="truncate font-mono">{g.channelId}</span></div>
        <div className="flex items-center gap-1.5"><Users className="w-3 h-3" />{g.winnersCount} gagnant{g.winnersCount > 1 ? 's' : ''}</div>
        <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />{fmt(g.createdAt)}</div>
      </div>

      {/* People */}
      {(g.hostId || g.mentionedRoleIds?.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {g.hostId && (
            <Chip icon={User} color="blue">Host <code className="font-mono text-[9px]">{g.hostId}</code></Chip>
          )}
          {g.mentionedRoleIds?.map(rid => (
            <Chip key={rid} icon={MessageCircle} color="blue">@&amp;<code className="font-mono text-[9px]">{rid}</code></Chip>
          ))}
        </div>
      )}

      {/* Conditions */}
      {(allowedRoles.length > 0 || (g.forbiddenRoleIds ?? []).length > 0 || g.requiredMinBalance) && (
        <div className="flex flex-wrap gap-1.5">
          {allowedRoles.map(rid => (
            <Chip key={rid} icon={UserCheck} color="green"><code className="font-mono text-[9px]">{rid}</code></Chip>
          ))}
          {(g.forbiddenRoleIds ?? []).map(rid => (
            <Chip key={rid} icon={Ban} color="red"><code className="font-mono text-[9px]">{rid}</code></Chip>
          ))}
          {g.requiredMinBalance && (
            <Chip icon={Coins} color="amber">Min {g.requiredMinBalance.toLocaleString('fr-FR')}</Chip>
          )}
        </div>
      )}

      {/* Rewards */}
      {g.rewards?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {g.rewards.map((r, i) => (
            <Chip key={i} icon={Gift} color="indigo">{rewardLabel(r)}</Chip>
          ))}
        </div>
      )}

      {/* Winners */}
      {!active && g.winners.length > 0 && (
        <div className="flex items-start gap-2 pt-1 border-t">
          <Trophy className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {g.winners.map(id => <code key={id} className="bg-muted px-1 rounded text-[10px] mr-1">{id}</code>)}
          </p>
        </div>
      )}
      {!active && g.winners.length === 0 && g.endedAt && (
        <p className="text-xs text-muted-foreground border-t pt-1">Aucun participant éligible</p>
      )}
    </div>
  );
}

// ── Channel selector ──────────────────────────────────────────────────────────

type BotChannel = { id: string; name: string; guildId: string; guildName: string };

function useChannels() {
  const [channels, setChannels] = useState<BotChannel[]>([]);
  useState(() => {
    const base = getApiBase();
    fetch(`${base}/api/bot/channels`)
      .then(r => r.ok ? r.json() : [])
      .then(setChannels)
      .catch(() => {});
  });
  return channels;
}

function ChannelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const channels = useChannels();

  if (channels.length === 0) {
    return (
      <Input
        placeholder="ID du salon Discord"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="font-mono text-sm"
      />
    );
  }

  // Group by guild
  const guilds = [...new Set(channels.map(c => c.guildId))];

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">— Choisir un salon —</option>
      {guilds.map(gid => {
        const gChannels = channels.filter(c => c.guildId === gid);
        const guildName = gChannels[0]?.guildName ?? gid;
        return (
          <optgroup key={gid} label={`🏠 ${guildName}`}>
            {gChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const create = useCreateGiveaway();
  const [form, setForm] = useState({
    prize: '', channelId: '', durationMinutes: 60, winnersCount: 1,
    hostId: '', mentionedRoleIds: '',
    requiredRoleIds: '', forbiddenRoleIds: '',
    requiredMinBalance: '',
    // rewards added as chips
    rewards: [] as Array<{ type: string; amount?: number; roleId?: string; roleName?: string; itemId?: number; itemName?: string }>,
    rewardType: 'money' as 'money' | 'role' | 'item',
    rewardAmount: '', rewardRoleId: '', rewardRoleName: '', rewardItemId: '', rewardItemName: '',
  });

  const p = (u: Partial<typeof form>) => setForm(f => ({ ...f, ...u }));
  const valid = form.prize.trim() && form.channelId.trim() && form.durationMinutes >= 1 && form.winnersCount >= 1;

  function addReward() {
    if (form.rewardType === 'money' && form.rewardAmount) {
      p({ rewards: [...form.rewards, { type: 'money', amount: Number(form.rewardAmount) }], rewardAmount: '' });
    } else if (form.rewardType === 'role' && form.rewardRoleId) {
      p({ rewards: [...form.rewards, { type: 'role', roleId: form.rewardRoleId, roleName: form.rewardRoleName || form.rewardRoleId }], rewardRoleId: '', rewardRoleName: '' });
    } else if (form.rewardType === 'item' && form.rewardItemId) {
      p({ rewards: [...form.rewards, { type: 'item', itemId: Number(form.rewardItemId), itemName: form.rewardItemName || `Item #${form.rewardItemId}` }], rewardItemId: '', rewardItemName: '' });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const data: any = {
      prize: form.prize.trim(),
      channelId: form.channelId.trim(),
      durationMinutes: form.durationMinutes,
      winnersCount: form.winnersCount,
      rewards: form.rewards,
    };
    if (form.hostId.trim()) data.hostId = form.hostId.trim();
    if (form.mentionedRoleIds.trim()) data.mentionedRoleIds = form.mentionedRoleIds.split(',').map(s => s.trim()).filter(Boolean);
    if (form.requiredRoleIds.trim()) data.requiredRoleIds = form.requiredRoleIds.split(',').map(s => s.trim()).filter(Boolean);
    if (form.forbiddenRoleIds.trim()) data.forbiddenRoleIds = form.forbiddenRoleIds.split(',').map(s => s.trim()).filter(Boolean);
    if (form.requiredMinBalance.trim()) data.requiredMinBalance = Number(form.requiredMinBalance);

    create.mutate({ data }, {
      onSuccess: () => {
        toast({ title: '🎉 Giveaway créé !' });
        setForm({ prize: '', channelId: '', durationMinutes: 60, winnersCount: 1, hostId: '', mentionedRoleIds: '', requiredRoleIds: '', forbiddenRoleIds: '', requiredMinBalance: '', rewards: [], rewardType: 'money', rewardAmount: '', rewardRoleId: '', rewardRoleName: '', rewardItemId: '', rewardItemName: '' });
        onCreated();
      },
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-5">
      <p className="text-sm font-semibold">Nouveau giveaway</p>

      {/* Core */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Prix 🎁</label>
          <Input placeholder="ex: 1 000 sheckels, Nitro…" value={form.prize} onChange={e => p({ prize: e.target.value })} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Salon Discord</label>
          <ChannelSelect value={form.channelId} onChange={v => p({ channelId: v })} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Durée (minutes)</label>
          <Input type="number" min={1} value={form.durationMinutes} onChange={e => p({ durationMinutes: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Nb gagnants</label>
          <Input type="number" min={1} value={form.winnersCount} onChange={e => p({ winnersCount: Number(e.target.value) })} />
        </div>
      </div>

      {/* People */}
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personnes</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" /> ID Host (optionnel)</label>
            <Input placeholder="ID utilisateur" value={form.hostId} onChange={e => p({ hostId: e.target.value })} className="font-mono text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Rôles à mentionner (IDs, virgule)</label>
            <Input placeholder="ID1, ID2, …" value={form.mentionedRoleIds} onChange={e => p({ mentionedRoleIds: e.target.value })} className="font-mono text-sm" />
          </div>
        </div>
      </div>

      {/* Conditions */}
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conditions d'éligibilité</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" /> Rôles autorisés (IDs, virgule)</label>
            <Input placeholder="ID1, ID2, …" value={form.requiredRoleIds} onChange={e => p({ requiredRoleIds: e.target.value })} className="font-mono text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Ban className="w-3 h-3" /> Rôles interdits (IDs, virgule)</label>
            <Input placeholder="ID1, ID2, …" value={form.forbiddenRoleIds} onChange={e => p({ forbiddenRoleIds: e.target.value })} className="font-mono text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Coins className="w-3 h-3" /> Solde minimum</label>
            <Input type="number" min={0} placeholder="0" value={form.requiredMinBalance} onChange={e => p({ requiredMinBalance: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Rewards */}
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Récompenses supplémentaires</p>

        {form.rewards.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.rewards.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
                {r.type === 'money' ? `💰 ${r.amount?.toLocaleString('fr-FR')} pièces` : r.type === 'role' ? `🎭 ${r.roleName}` : `📦 ${r.itemName}`}
                <button type="button" onClick={() => p({ rewards: form.rewards.filter((_, j) => j !== i) })} className="ml-0.5 hover:text-red-600">×</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end flex-wrap">
          <select value={form.rewardType} onChange={e => p({ rewardType: e.target.value as any })} className="text-xs border rounded px-2 py-1.5 bg-background">
            <option value="money">💰 Argent</option>
            <option value="role">🎭 Rôle</option>
            <option value="item">📦 Item</option>
          </select>
          {form.rewardType === 'money' && (
            <Input type="number" placeholder="Montant" className="w-32 text-sm" value={form.rewardAmount} onChange={e => p({ rewardAmount: e.target.value })} />
          )}
          {form.rewardType === 'role' && (<>
            <Input placeholder="ID du rôle" className="w-40 font-mono text-sm" value={form.rewardRoleId} onChange={e => p({ rewardRoleId: e.target.value })} />
            <Input placeholder="Nom (affichage)" className="w-32 text-sm" value={form.rewardRoleName} onChange={e => p({ rewardRoleName: e.target.value })} />
          </>)}
          {form.rewardType === 'item' && (<>
            <Input type="number" placeholder="ID item" className="w-24 text-sm" value={form.rewardItemId} onChange={e => p({ rewardItemId: e.target.value })} />
            <Input placeholder="Nom de l'item" className="w-36 text-sm" value={form.rewardItemName} onChange={e => p({ rewardItemName: e.target.value })} />
          </>)}
          <Button type="button" variant="outline" size="sm" onClick={addReward} className="shrink-0">+ Ajouter</Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Depuis Discord, utilisez le panneau interactif de <code>/giveaway start</code> pour configurer les récompenses plus facilement.
        </p>
      </div>

      <Button type="submit" disabled={!valid || create.isPending} className="w-full gap-2">
        <Plus className="h-4 w-4" />
        {create.isPending ? 'Création…' : 'Créer le giveaway'}
      </Button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Giveaway() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const { data: giveaways = [], isLoading } = useListGiveaways({ query: { refetchInterval: 15000 } });

  const refresh = () => qc.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
  const active = (giveaways as Giveaway[]).filter(g => g.status === 'active');
  const past   = (giveaways as Giveaway[]).filter(g => g.status !== 'active');

  return (
    <div className="p-8 space-y-8 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Giveaways</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Crée via <code className="text-xs bg-muted px-1 rounded">/giveaway start</code> sur Discord pour le panneau interactif complet, ou utilise le formulaire ci-dessous.
          </p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
          <Gift className="h-4 w-4" />
          {showForm ? 'Annuler' : 'Nouveau giveaway'}
        </Button>
      </div>

      {showForm && <CreateForm onCreated={() => { refresh(); setShowForm(false); }} />}
      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">En cours ({active.length})</h2>
          {active.map(g => <GiveawayCard key={g.id} g={g} onDeleted={refresh} />)}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Terminés ({past.length})</h2>
          {past.map(g => <GiveawayCard key={g.id} g={g} onDeleted={refresh} />)}
        </section>
      )}

      {!isLoading && active.length === 0 && past.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          Aucun giveaway. Lance <code className="text-xs bg-muted px-1 rounded">/giveaway start</code> sur Discord ou clique sur <strong>Nouveau giveaway</strong>.
        </div>
      )}
    </div>
  );
}
