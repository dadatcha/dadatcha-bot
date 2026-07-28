import { useState, useEffect, useCallback } from 'react';
import { Ticket, Settings, Plus, RefreshCw, Clock, CheckCircle2, Trash2, Hash, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow } from '@/components/ui/field-row';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketConfig = {
  enabled: boolean;
  panelChannelId: string;
  categoryId: string;
  staffRoleId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  logChannelId: string;
  welcomeMessage: string;
  updatedAt: string;
};

type TicketEntry = {
  id: number;
  userId: string;
  userName: string;
  channelId: string;
  status: 'open' | 'closed';
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const base = () => import.meta.env.BASE_URL.replace(/\/$/, '');

function fmt(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function elapsed(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

// ── Config panel ──────────────────────────────────────────────────────────────

function ConfigPanel() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<TicketConfig | null>(null);
  const [draft, setDraft] = useState<TicketConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${base()}/api/ticket/config`)
      .then(r => r.json())
      .then((d: TicketConfig) => { setCfg(d); setDraft(d); })
      .catch(() => toast({ title: 'Erreur chargement config', variant: 'destructive' }));
  }, []);

  const p = (u: Partial<TicketConfig>) => setDraft(prev => prev ? { ...prev, ...u } : prev);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(draft);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch(`${base()}/api/ticket/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error();
      const saved: TicketConfig = await r.json();
      setCfg(saved); setDraft(saved);
      toast({ title: 'Configuration sauvegardée ✓' });
    } catch {
      toast({ title: 'Erreur lors de la sauvegarde', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!draft) return <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>;

  return (
    <div className="space-y-4">
      <ModuleCard
        title="Système de tickets"
        description="Créez un embed interactif pour que les membres ouvrent un ticket en un clic."
        icon={Ticket}
        iconColor="text-indigo-500"
        enabled={draft.enabled}
        onToggle={v => p({ enabled: v })}
        onSave={save}
        saving={saving}
        dirty={dirty}
      >
        {/* Channels */}
        <FieldRow label="Salon du panel" hint="Salon où envoyer l'embed avec le bouton (ID Discord).">
          <Input value={draft.panelChannelId} onChange={e => p({ panelChannelId: e.target.value })}
            placeholder="ID du salon" className="font-mono text-sm" />
        </FieldRow>
        <FieldRow label="Catégorie Discord" hint="ID de la catégorie où créer les salons de tickets.">
          <Input value={draft.categoryId} onChange={e => p({ categoryId: e.target.value })}
            placeholder="ID catégorie" className="font-mono text-sm" />
        </FieldRow>
        <FieldRow label="Rôle staff" hint="ID du rôle qui peut voir tous les tickets.">
          <Input value={draft.staffRoleId} onChange={e => p({ staffRoleId: e.target.value })}
            placeholder="ID du rôle staff" className="font-mono text-sm" />
        </FieldRow>
        <FieldRow label="Salon de logs" hint="ID du salon pour les logs d'ouverture/fermeture. Vide = pas de logs.">
          <Input value={draft.logChannelId} onChange={e => p({ logChannelId: e.target.value })}
            placeholder="ID salon logs (optionnel)" className="font-mono text-sm" />
        </FieldRow>

        {/* Embed */}
        <div className="pt-2 border-t mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Embed</p>
        </div>
        <FieldRow label="Titre" hint="Titre de l'embed affiché dans le salon du panel.">
          <Input value={draft.embedTitle} onChange={e => p({ embedTitle: e.target.value })}
            placeholder="🎫 Support" />
        </FieldRow>
        <FieldRow label="Description" hint="Texte principal de l'embed.">
          <textarea
            value={draft.embedDescription}
            onChange={e => p({ embedDescription: e.target.value })}
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Cliquez sur le bouton pour ouvrir un ticket…"
          />
        </FieldRow>
        <FieldRow label="Couleur" hint="Couleur de la barre latérale de l'embed (hex sans #).">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded border shrink-0" style={{ background: `#${draft.embedColor}` }} />
            <Input value={draft.embedColor} onChange={e => p({ embedColor: e.target.value.replace('#', '') })}
              placeholder="5865F2" className="font-mono text-sm w-32" maxLength={6} />
          </div>
        </FieldRow>

        {/* Welcome */}
        <div className="pt-2 border-t mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Message de bienvenue</p>
        </div>
        <FieldRow label="Message" hint="Envoyé dans le salon du ticket. {user} = mention du membre.">
          <textarea
            value={draft.welcomeMessage}
            onChange={e => p({ welcomeMessage: e.target.value })}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Bonjour {user} ! Un membre du staff va vous répondre bientôt."
          />
        </FieldRow>
      </ModuleCard>

      {/* Setup hint */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 text-sm text-indigo-700 dark:text-indigo-300 space-y-1">
        <p className="font-semibold">Après avoir sauvegardé :</p>
        <p>Lancez <code className="bg-indigo-100 dark:bg-indigo-900/40 px-1 rounded">/ticket setup</code> dans n'importe quel salon Discord pour envoyer l'embed dans le salon configuré ci-dessus.</p>
      </div>
    </div>
  );
}

// ── Ticket row ─────────────────────────────────────────────────────────────────

function TicketRow({ ticket, onDelete }: { ticket: TicketEntry; onDelete: () => void }) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!confirm('Supprimer ce ticket de la base ?')) return;
    setDeleting(true);
    try {
      await fetch(`${base()}/api/tickets/${ticket.id}`, { method: 'DELETE' });
      toast({ title: 'Ticket supprimé' });
      onDelete();
    } catch {
      toast({ title: 'Erreur', variant: 'destructive' });
    } finally { setDeleting(false); }
  }

  const isOpen = ticket.status === 'open';

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
      isOpen ? 'border-border bg-card' : 'border-border bg-muted/30 opacity-70',
    )}>
      {/* Status icon */}
      <div className="shrink-0">
        {isOpen
          ? <Clock className="w-4 h-4 text-indigo-500" />
          : <CheckCircle2 className="w-4 h-4 text-green-500" />}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5',
            isOpen
              ? 'text-indigo-600 bg-indigo-50 border-indigo-200'
              : 'text-muted-foreground bg-muted border-border',
          )}>
            {isOpen ? 'Ouvert' : 'Fermé'}
          </span>
          <span className="text-xs font-mono text-muted-foreground">#{ticket.id}</span>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="w-3 h-3" />
            <span className="font-medium text-foreground">{ticket.userName || ticket.userId}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Hash className="w-3 h-3" />
            <span className="font-mono">{ticket.channelId}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
          <span>Ouvert {fmt(ticket.createdAt)}</span>
          {ticket.closedAt && ticket.closedByName && (
            <span>· Fermé par <span className="font-medium">{ticket.closedByName}</span> {fmt(ticket.closedAt)}</span>
          )}
        </div>
      </div>

      {/* Elapsed */}
      {isOpen && (
        <span className="shrink-0 text-xs text-muted-foreground font-mono">
          {elapsed(ticket.createdAt)}
        </span>
      )}

      {/* Delete */}
      <Button
        variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={del} disabled={deleting}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ── Tickets list ──────────────────────────────────────────────────────────────

function TicketsList() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/api/tickets' : `/api/tickets?status=${filter}`;
      const r = await fetch(`${base()}${url}`);
      setTickets(await r.json());
    } catch {
      toast({ title: 'Erreur chargement tickets', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const tabs: { key: typeof filter; label: string }[] = [
    { key: 'all',    label: 'Tous' },
    { key: 'open',   label: 'Ouverts' },
    { key: 'closed', label: 'Fermés' },
  ];

  const openCount   = tickets.filter(t => t.status === 'open').length;
  const closedCount = tickets.filter(t => t.status === 'closed').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                filter === tab.key
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.key === 'open'   && openCount   > 0 && <span className="ml-1.5 text-xs bg-indigo-100 text-indigo-600 px-1.5 rounded-full">{openCount}</span>}
              {tab.key === 'closed' && closedCount > 0 && <span className="ml-1.5 text-xs bg-muted-foreground/20 px-1.5 rounded-full">{closedCount}</span>}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Actualiser
        </Button>
      </div>

      {/* List */}
      {loading && <div className="py-10 text-center text-muted-foreground text-sm">Chargement…</div>}
      {!loading && tickets.length === 0 && (
        <div className="py-14 text-center">
          <Ticket className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Aucun ticket{filter !== 'all' ? ` ${filter === 'open' ? 'ouvert' : 'fermé'}` : ''}.</p>
        </div>
      )}
      <div className="space-y-2">
        {tickets.map(t => (
          <TicketRow key={t.id} ticket={t} onDelete={load} />
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Tickets() {
  const [tab, setTab] = useState<'config' | 'tickets'>('config');

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Système de tickets — les membres ouvrent un ticket en cliquant sur un bouton dans un embed Discord.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('config')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            tab === 'config' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <Settings className="w-3.5 h-3.5" /> Configuration
        </button>
        <button
          onClick={() => setTab('tickets')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            tab === 'tickets' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <Ticket className="w-3.5 h-3.5" /> Tickets
        </button>
      </div>

      {tab === 'config'  && <ConfigPanel />}
      {tab === 'tickets' && <TicketsList />}
    </div>
  );
}
