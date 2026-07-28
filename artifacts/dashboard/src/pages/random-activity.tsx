import { useState } from 'react';
import {
  Shuffle, Plus, Trash2, Pencil, Check, X,
  Terminal, Clock, MessageSquare, Power, Hash,
  AlignLeft, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { MentionTextarea } from '@/components/ui/mention-textarea';
import { Switch }   from '@/components/ui/switch';
import { Label }    from '@/components/ui/label';
import { cn }       from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useGetRandomActivityConfig,
  useUpdateRandomActivityConfig,
  useListRandomMessages,
  useCreateRandomMessage,
  useUpdateRandomMessage,
  useDeleteRandomMessage,
} from '@workspace/api-client-react';

// ── Interval presets ──────────────────────────────────────────────────────────

const PRESETS = [
  { label: '30 min',  min: 30,  max: 60  },
  { label: '1 h',     min: 60,  max: 120 },
  { label: '2 h',     min: 120, max: 240 },
  { label: '4 h',     min: 240, max: 480 },
];

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
      enabled
        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
        : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/20',
    )}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500',
      )} />
      {enabled ? 'Actif' : 'Inactif'}
    </span>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────────

function ConfigPanel() {
  const { toast } = useToast();
  const { data: cfg, isLoading } = useGetRandomActivityConfig();
  const { mutate: save, isPending } = useUpdateRandomActivityConfig();

  const [form, setForm] = useState<{
    enabled: boolean;
    channelId: string;
    topic: string;
    minIntervalMinutes: number;
    maxIntervalMinutes: number;
    includeCommandSuggestions: boolean;
  } | null>(null);

  const current = form ?? (cfg ? {
    enabled:                   cfg.enabled,
    channelId:                 cfg.channelId,
    topic:                     cfg.topic,
    minIntervalMinutes:        cfg.minIntervalMinutes,
    maxIntervalMinutes:        cfg.maxIntervalMinutes,
    includeCommandSuggestions: cfg.includeCommandSuggestions,
  } : null);

  const dirty = current && cfg && (
    current.enabled                   !== cfg.enabled                   ||
    current.channelId                 !== cfg.channelId                 ||
    current.topic                     !== cfg.topic                     ||
    current.minIntervalMinutes        !== cfg.minIntervalMinutes        ||
    current.maxIntervalMinutes        !== cfg.maxIntervalMinutes        ||
    current.includeCommandSuggestions !== cfg.includeCommandSuggestions
  );

  function patch(partial: Partial<NonNullable<typeof current>>) {
    if (!current) return;
    setForm({ ...current, ...partial });
  }

  function handleSave() {
    if (!current) return;
    if (current.minIntervalMinutes > current.maxIntervalMinutes) {
      toast({ title: 'Intervalle invalide', description: 'Le minimum doit être ≤ au maximum.', variant: 'destructive' });
      return;
    }
    save({ data: current }, {
      onSuccess: () => { setForm(null); toast({ title: 'Configuration sauvegardée' }); },
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function handleReset() { setForm(null); }

  if (isLoading || !current) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted rounded-lg" />)}
      </div>
    );
  }

  const activePreset = PRESETS.find(
    p => p.min === current.minIntervalMinutes && p.max === current.maxIntervalMinutes,
  );

  return (
    <div className="space-y-5">

      {/* Enable */}
      <div
        className={cn(
          'flex items-center justify-between p-4 rounded-xl border-2 transition-colors cursor-pointer',
          current.enabled
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-border bg-card',
        )}
        onClick={() => patch({ enabled: !current.enabled })}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
            current.enabled ? 'bg-emerald-500/20' : 'bg-muted',
          )}>
            <Power className={cn('w-4 h-4', current.enabled ? 'text-emerald-400' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className="text-sm font-medium leading-none">Activer les messages aléatoires</p>
            <p className="text-xs text-muted-foreground mt-1">Le bot postera dans le salon configuré</p>
          </div>
        </div>
        <Switch checked={current.enabled} onCheckedChange={(v) => patch({ enabled: v })} onClick={e => e.stopPropagation()} />
      </div>

      {/* Channel */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Salon</Label>
        <div className="relative">
          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 font-mono text-sm"
            placeholder="ID du salon Discord"
            value={current.channelId}
            onChange={(e) => patch({ channelId: e.target.value })}
          />
        </div>
      </div>

      {/* Topic */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Sujet / contexte</Label>
        <div className="relative">
          <AlignLeft className="absolute left-3 top-3 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 text-sm"
            placeholder="ex : économie virtuelle, jeux Discord…"
            value={current.topic}
            onChange={(e) => patch({ topic: e.target.value })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Préfixe optionnel ajouté aux messages si défini
        </p>
      </div>

      {/* Interval */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Intervalle</Label>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border">
          <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm">Toutes les</span>
          <Input
            type="number" min={1} max={10080}
            className="w-20 h-7 text-center text-sm px-1"
            value={current.minIntervalMinutes}
            onChange={(e) => patch({ minIntervalMinutes: Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">à</span>
          <Input
            type="number" min={1} max={10080}
            className="w-20 h-7 text-center text-sm px-1"
            value={current.maxIntervalMinutes}
            onChange={(e) => patch({ maxIntervalMinutes: Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">min</span>
        </div>
        <div className="flex gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => patch({ minIntervalMinutes: p.min, maxIntervalMinutes: p.max })}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                activePreset?.label === p.label
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                  : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestions */}
      <div
        className={cn(
          'flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-colors',
          current.includeCommandSuggestions ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-border bg-card',
        )}
        onClick={() => patch({ includeCommandSuggestions: !current.includeCommandSuggestions })}
      >
        <div className="flex items-center gap-2.5">
          <Terminal className={cn('w-4 h-4', current.includeCommandSuggestions ? 'text-indigo-400' : 'text-muted-foreground')} />
          <div>
            <p className="text-sm font-medium leading-none">Suggestions de commandes</p>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono">/daily</span>, <span className="font-mono">/work</span>, <span className="font-mono">/crime</span>…
            </p>
          </div>
        </div>
        <Switch
          checked={current.includeCommandSuggestions}
          onCheckedChange={(v) => patch({ includeCommandSuggestions: v })}
          onClick={e => e.stopPropagation()}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={isPending || !dirty} className="flex-1">
          {isPending ? 'Sauvegarde…' : 'Sauvegarder'}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={handleReset} size="icon">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Message card ──────────────────────────────────────────────────────────────

function MessageCard({ msg }: { msg: { id: number; content: string; enabled: boolean } }) {
  const { toast } = useToast();
  const { mutate: update, isPending: saving } = useUpdateRandomMessage();
  const { mutate: remove, isPending: deleting } = useDeleteRandomMessage();
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(msg.content);
  const [confirm,  setConfirm]  = useState(false);

  function saveEdit() {
    if (!draft.trim()) return;
    update({ id: msg.id, data: { content: draft.trim(), enabled: msg.enabled } }, {
      onSuccess: () => { setEditing(false); },
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function toggleEnabled() {
    update({ id: msg.id, data: { content: msg.content, enabled: !msg.enabled } }, {
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function handleDelete() {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
    remove({ id: msg.id }, {
      onSuccess: () => toast({ title: 'Message supprimé' }),
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  return (
    <div className={cn(
      'group rounded-xl border bg-card transition-all',
      !msg.enabled && 'opacity-50',
      saving && 'opacity-70',
    )}>
      {editing ? (
        <div className="p-3 space-y-2">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            rows={3}
            className="text-sm"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{draft.length} car.</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => { setDraft(msg.content); setEditing(false); }}>
                Annuler
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={!draft.trim() || saving}>
                <Check className="w-3.5 h-3.5 mr-1" />Sauvegarder
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3.5">
          <p className="text-sm flex-1 leading-relaxed whitespace-pre-wrap min-w-0">{msg.content}</p>
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={toggleEnabled}
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                msg.enabled
                  ? 'text-emerald-400 hover:bg-emerald-500/10'
                  : 'text-zinc-500 hover:bg-zinc-500/10',
              )}
              title={msg.enabled ? 'Désactiver' : 'Activer'}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setEditing(true)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                confirm
                  ? 'bg-destructive/15 text-destructive'
                  : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
              )}
              title={confirm ? 'Cliquer encore pour confirmer' : 'Supprimer'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New message form (always visible) ────────────────────────────────────────

function AddMessageForm() {
  const { toast } = useToast();
  const { mutate: create, isPending } = useCreateRandomMessage();
  const [content, setContent] = useState('');
  const MAX = 500;

  function handleCreate() {
    if (!content.trim()) return;
    create({ data: { content: content.trim() } }, {
      onSuccess: () => { setContent(''); toast({ title: 'Message ajouté au pool' }); },
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate();
  }

  return (
    <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
      <MentionTextarea
        placeholder="Nouveau message… (Ctrl+Entrée pour ajouter)"
        value={content}
        onChange={v => setContent(v.slice(0, MAX))}
        rows={2}
        className="text-sm bg-transparent border-none focus-visible:ring-0 p-0 placeholder:text-muted-foreground/50"
        hideHint
      />
      <div className="flex items-center justify-between">
        <span className={cn('text-xs', content.length > MAX * 0.9 ? 'text-amber-400' : 'text-muted-foreground')}>
          {content.length}/{MAX}
        </span>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={isPending || !content.trim()}
          className="h-7 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {isPending ? 'Ajout…' : 'Ajouter'}
        </Button>
      </div>
    </div>
  );
}

// ── Message pool ──────────────────────────────────────────────────────────────

function MessagePool() {
  const { data: messages = [], isLoading } = useListRandomMessages();
  const [showDisabled, setShowDisabled] = useState(false);

  const enabled  = messages.filter(m => m.enabled);
  const disabled = messages.filter(m => !m.enabled);

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold">Pool de messages</span>
          <span className="px-1.5 py-0.5 rounded-md bg-muted text-xs text-muted-foreground tabular-nums">
            {enabled.length}/{messages.length}
          </span>
        </div>
      </div>

      {/* Add form (always visible) */}
      <AddMessageForm />

      {/* List */}
      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-xl" />)}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Shuffle className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">Aucun message pour l'instant</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Utilise le champ ci-dessus pour commencer</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {enabled.map(m => <MessageCard key={m.id} msg={m} />)}
          </div>

          {disabled.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => setShowDisabled(v => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1.5"
              >
                {showDisabled ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {disabled.length} désactivé{disabled.length > 1 ? 's' : ''}
              </button>
              {showDisabled && (
                <div className="space-y-1.5">
                  {disabled.map(m => <MessageCard key={m.id} msg={m} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RandomActivity() {
  const { data: cfg } = useGetRandomActivityConfig();

  const enabled = cfg?.enabled ?? false;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
            enabled ? 'bg-indigo-500/20' : 'bg-muted',
          )}>
            <Shuffle className={cn('w-5 h-5', enabled ? 'text-indigo-400' : 'text-muted-foreground')} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Messages aléatoires</h1>
              <StatusPill enabled={enabled} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Le bot envoie des messages dans un salon à intervalles aléatoires
            </p>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

        {/* Left — Config */}
        <div className="rounded-xl border bg-card p-5 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Configuration</p>
          <ConfigPanel />
        </div>

        {/* Right — Pool */}
        <div className="rounded-xl border bg-card p-5">
          <MessagePool />
        </div>

      </div>
    </div>
  );
}
