import { useState } from 'react';
import { Shuffle, Plus, Trash2, Pencil, Check, X, ToggleLeft, ToggleRight, Sparkles, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  useGetRandomActivityConfig,
  useUpdateRandomActivityConfig,
  useListRandomMessages,
  useCreateRandomMessage,
  useUpdateRandomMessage,
  useDeleteRandomMessage,
} from '@workspace/api-client-react';

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

  // seed form once data arrives
  const current = form ?? (cfg ? {
    enabled: cfg.enabled,
    channelId: cfg.channelId,
    topic: cfg.topic,
    minIntervalMinutes: cfg.minIntervalMinutes,
    maxIntervalMinutes: cfg.maxIntervalMinutes,
    includeCommandSuggestions: cfg.includeCommandSuggestions,
  } : null);

  function patch(partial: Partial<typeof current>) {
    if (!current) return;
    setForm({ ...current, ...partial } as typeof current);
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

  if (isLoading || !current) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-5">
      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
        <div>
          <p className="text-sm font-medium">Activer les messages aléatoires</p>
          <p className="text-xs text-muted-foreground mt-0.5">Le bot enverra des messages à intervalles aléatoires</p>
        </div>
        <Switch
          checked={current.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
      </div>

      {/* Channel */}
      <div className="space-y-1.5">
        <Label>ID du salon Discord</Label>
        <Input
          placeholder="ex: 1234567890123456789"
          value={current.channelId}
          onChange={(e) => patch({ channelId: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Salon où le bot postera les messages aléatoires</p>
      </div>

      {/* Topic */}
      <div className="space-y-1.5">
        <Label>Sujet / contexte</Label>
        <Input
          placeholder="ex: jeux d'argent Discord, économie virtuelle…"
          value={current.topic}
          onChange={(e) => patch({ topic: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Utilisé comme contexte pour varier les messages (affiché dans le message si le sujet est mentionné)
        </p>
      </div>

      {/* Interval */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Intervalle minimum (minutes)</Label>
          <Input
            type="number" min={1}
            value={current.minIntervalMinutes}
            onChange={(e) => patch({ minIntervalMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Intervalle maximum (minutes)</Label>
          <Input
            type="number" min={1}
            value={current.maxIntervalMinutes}
            onChange={(e) => patch({ maxIntervalMinutes: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* Command suggestions */}
      <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <div>
            <p className="text-sm font-medium">Suggestions de commandes aléatoires</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Le bot rappelle parfois des commandes : <span className="font-mono">/daily</span>, <span className="font-mono">/work</span>, <span className="font-mono">/crime</span>…
            </p>
          </div>
        </div>
        <Switch
          checked={current.includeCommandSuggestions}
          onCheckedChange={(v) => patch({ includeCommandSuggestions: v })}
        />
      </div>

      <Button onClick={handleSave} disabled={isPending}>
        {isPending ? 'Sauvegarde…' : 'Sauvegarder'}
      </Button>
    </div>
  );
}

// ── Message card ──────────────────────────────────────────────────────────────

function MessageCard({ msg }: { msg: { id: number; content: string; enabled: boolean } }) {
  const { toast } = useToast();
  const { mutate: update } = useUpdateRandomMessage();
  const { mutate: remove } = useDeleteRandomMessage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);

  function saveEdit() {
    if (!draft.trim()) return;
    update({ id: msg.id, data: { content: draft.trim(), enabled: msg.enabled } }, {
      onSuccess: () => { setEditing(false); toast({ title: 'Message mis à jour' }); },
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function toggleEnabled() {
    update({ id: msg.id, data: { content: msg.content, enabled: !msg.enabled } }, {
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function handleDelete() {
    remove({ id: msg.id }, {
      onSuccess: () => toast({ title: 'Message supprimé' }),
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  return (
    <div className={`p-4 rounded-lg border bg-card transition-opacity ${msg.enabled ? '' : 'opacity-50'}`}>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit}><Check className="w-3.5 h-3.5 mr-1" />Sauvegarder</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(msg.content); setEditing(false); }}>
              <X className="w-3.5 h-3.5 mr-1" />Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm flex-1 whitespace-pre-wrap">{msg.content}</p>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" title={msg.enabled ? 'Désactiver' : 'Activer'} onClick={toggleEnabled}>
              {msg.enabled
                ? <ToggleRight className="w-4 h-4 text-green-500" />
                : <ToggleLeft  className="w-4 h-4 text-zinc-500" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New message form ───────────────────────────────────────────────────────────

function NewMessageForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const { mutate: create, isPending } = useCreateRandomMessage();
  const [content, setContent] = useState('');

  function handleCreate() {
    if (!content.trim()) return;
    create({ data: { content: content.trim() } }, {
      onSuccess: () => { setContent(''); onCreated(); toast({ title: 'Message ajouté' }); },
      onError:   () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="Tape le message que le bot enverra aléatoirement…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
      />
      <Button onClick={handleCreate} disabled={isPending || !content.trim()}>
        <Plus className="w-4 h-4 mr-1.5" />
        {isPending ? 'Ajout…' : 'Ajouter le message'}
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RandomActivity() {
  const { data: messages = [], isLoading } = useListRandomMessages();
  const [adding, setAdding] = useState(false);

  const enabled  = messages.filter(m => m.enabled);
  const disabled = messages.filter(m => !m.enabled);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
          <Shuffle className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Messages aléatoires</h1>
          <p className="text-sm text-muted-foreground">
            Le bot envoie des messages et suggestions de commandes à des moments aléatoires
          </p>
        </div>
      </div>

      {/* Configuration */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h2 className="text-base font-semibold">Configuration</h2>
        </div>
        <ConfigPanel />
      </section>

      {/* Message pool */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shuffle className="w-4 h-4 text-indigo-400" />
            <h2 className="text-base font-semibold">
              Pool de messages
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {enabled.length} actif{enabled.length !== 1 ? 's' : ''} / {messages.length} total
              </span>
            </h2>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
            {adding ? <X className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            {adding ? 'Annuler' : 'Ajouter'}
          </Button>
        </div>

        {adding && (
          <NewMessageForm onCreated={() => setAdding(false)} />
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

        {!isLoading && messages.length === 0 && (
          <div className="text-center py-10 border rounded-lg border-dashed">
            <Shuffle className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Aucun message dans le pool.</p>
            <p className="text-xs text-muted-foreground mt-1">Ajoute des messages que le bot enverra aléatoirement.</p>
          </div>
        )}

        {enabled.length > 0 && (
          <div className="space-y-2">
            {enabled.map(m => <MessageCard key={m.id} msg={m} />)}
          </div>
        )}

        {disabled.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer select-none">
              {disabled.length} message{disabled.length !== 1 ? 's' : ''} désactivé{disabled.length !== 1 ? 's' : ''}
            </summary>
            <div className="space-y-2 mt-2">
              {disabled.map(m => <MessageCard key={m.id} msg={m} />)}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
