import { useState } from 'react';
import {
  useListGiveaways,
  useCreateGiveaway,
  useDeleteGiveaway,
  getListGiveawaysQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Gift, Plus, Trash2, Trophy, Clock, Users, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  createdAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeLeft(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Expiré';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ── GiveawayCard ──────────────────────────────────────────────────────────────

function GiveawayCard({ giveaway, onDeleted }: { giveaway: Giveaway; onDeleted: () => void }) {
  const { toast } = useToast();
  const del = useDeleteGiveaway();
  const active = giveaway.status === 'active';

  function remove() {
    if (!confirm(`Supprimer le giveaway "${giveaway.prize}" ?`)) return;
    del.mutate(
      { id: giveaway.id },
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🎉</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{giveaway.prize}</p>
            <p className="text-xs text-muted-foreground">
              {active
                ? <>Fin <span className="font-medium text-yellow-600">{timeLeft(giveaway.endsAt)}</span> · {formatDate(giveaway.endsAt)}</>
                : <>Terminé le {formatDate(giveaway.endedAt ?? giveaway.endsAt)}</>
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border',
            active
              ? 'text-yellow-700 bg-yellow-100 border-yellow-300'
              : 'text-muted-foreground bg-muted border-border',
          )}>
            {active ? 'Actif' : 'Terminé'}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={remove} disabled={del.isPending}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Hash className="w-3 h-3 shrink-0" />
          <span className="truncate font-mono">{giveaway.channelId}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="w-3 h-3 shrink-0" />
          <span>{giveaway.winnersCount} gagnant{giveaway.winnersCount > 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{formatDate(giveaway.createdAt)}</span>
        </div>
      </div>

      {!active && giveaway.winners.length > 0 && (
        <div className="flex items-center gap-2 pt-1 border-t">
          <Trophy className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
          <p className="text-xs font-medium text-muted-foreground">
            Gagnant{giveaway.winners.length > 1 ? 's' : ''} :{' '}
            {giveaway.winners.map(id => <code key={id} className="bg-muted px-1 rounded text-[10px] mr-1">{id}</code>)}
          </p>
        </div>
      )}

      {!active && giveaway.winners.length === 0 && giveaway.endedAt && (
        <p className="text-xs text-muted-foreground border-t pt-1">Aucun participant</p>
      )}
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const create = useCreateGiveaway();
  const [form, setForm] = useState({
    prize: '',
    channelId: '',
    durationMinutes: 60,
    winnersCount: 1,
  });

  const p = (u: Partial<typeof form>) => setForm(f => ({ ...f, ...u }));
  const valid = form.prize.trim() && form.channelId.trim() && form.durationMinutes >= 1 && form.winnersCount >= 1;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    create.mutate(
      { data: { prize: form.prize.trim(), channelId: form.channelId.trim(), durationMinutes: form.durationMinutes, winnersCount: form.winnersCount } },
      {
        onSuccess: () => {
          toast({ title: '🎉 Giveaway créé !' });
          setForm({ prize: '', channelId: '', durationMinutes: 60, winnersCount: 1 });
          onCreated();
        },
        onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
      },
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-4">
      <p className="text-sm font-semibold">Nouveau giveaway</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Prix 🎁</label>
          <Input placeholder="ex: 1000 sheckels, Nitro, …" value={form.prize} onChange={e => p({ prize: e.target.value })} />
        </div>

        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">ID du salon Discord</label>
          <Input placeholder="123456789012345678" value={form.channelId} onChange={e => p({ channelId: e.target.value })} className="font-mono text-sm" />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Durée (minutes)</label>
          <Input type="number" min={1} value={form.durationMinutes} onChange={e => p({ durationMinutes: Number(e.target.value) })} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Nombre de gagnants</label>
          <Input type="number" min={1} value={form.winnersCount} onChange={e => p({ winnersCount: Number(e.target.value) })} />
        </div>
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
  const { data: giveaways = [], isLoading } = useListGiveaways({
    query: { refetchInterval: 15000 },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });

  const active = (giveaways as Giveaway[]).filter(g => g.status === 'active');
  const past   = (giveaways as Giveaway[]).filter(g => g.status !== 'active');

  return (
    <div className="p-8 space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Giveaways</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Crée et gère les giveaways Discord. Le bot poste l'embed et sélectionne les gagnants automatiquement.
          </p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
          <Gift className="h-4 w-4" />
          {showForm ? 'Annuler' : 'Nouveau giveaway'}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <CreateForm onCreated={() => { refresh(); setShowForm(false); }} />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {/* Active */}
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">En cours ({active.length})</h2>
          {active.map(g => <GiveawayCard key={g.id} giveaway={g} onDeleted={refresh} />)}
        </section>
      )}

      {/* Past */}
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Terminés ({past.length})</h2>
          {past.map(g => <GiveawayCard key={g.id} giveaway={g} onDeleted={refresh} />)}
        </section>
      )}

      {/* Empty */}
      {!isLoading && active.length === 0 && past.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          Aucun giveaway. Clique sur <strong>Nouveau giveaway</strong> pour commencer.
        </div>
      )}
    </div>
  );
}
