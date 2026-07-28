import { useState } from 'react';
import { MessageSquareCode, Plus, Pencil, Trash2, ChevronDown, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomCommand = {
  id: number;
  trigger: string;
  matchMode: string;
  caseSensitive: boolean;
  responseType: string;
  response: string;
  embedTitle: string;
  embedColor: string;
  embedFooter: string;
  enabled: boolean;
  deleteUserMessage: boolean;
  replyToUser: boolean;
  allowedChannels: string;
  allowedRoles: string;
  cooldownSeconds: number;
  rewardEnabled: boolean;
  rewardTarget: string;
  rewardRoleId: string;
  rewardMoney: number;
  rewardXp: number;
  rewardLevels: number;
  createdAt: string;
  updatedAt: string;
};

type FormState = Omit<CustomCommand, 'id' | 'createdAt' | 'updatedAt'>;

const EMPTY_FORM: FormState = {
  trigger: '',
  matchMode: 'exact',
  caseSensitive: false,
  responseType: 'message',
  response: '',
  embedTitle: '',
  embedColor: '5865F2',
  embedFooter: '',
  enabled: true,
  deleteUserMessage: false,
  replyToUser: false,
  allowedChannels: '',
  allowedRoles: '',
  cooldownSeconds: 0,
  rewardEnabled: false,
  rewardTarget: 'mentioned',
  rewardRoleId: '',
  rewardMoney: 0,
  rewardXp: 0,
  rewardLevels: 0,
};

const base = () => import.meta.env.BASE_URL.replace(/\/$/, '');

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useCustomCommands() {
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${base()}/api/custom-commands`);
      if (r.ok) setCommands(await r.json());
    } finally {
      setLoading(false);
    }
  };

  return { commands, setCommands, loading, load };
}

// ── Live embed preview ────────────────────────────────────────────────────────

function EmbedPreview({ title, description, color, footer }: {
  title: string; description: string; color: string; footer: string;
}) {
  const vars: Record<string, string> = {
    '{user}': '@MemberName', '{tag}': 'MemberName', '{name}': 'MemberName',
    '{server}': 'Mon Serveur', '{channel}': '#general',
  };
  const replace = (s: string) =>
    Object.entries(vars).reduce((a, [k, v]) => a.replaceAll(k, v), s);

  const borderColor = color ? `#${color.replace('#', '')}` : '#5865F2';

  return (
    <div className="rounded-lg bg-[#2b2d31] text-white text-sm p-3 border-l-4" style={{ borderColor }}>
      {title && <p className="font-semibold text-white text-[13px] mb-1">{replace(title)}</p>}
      {description && (
        <p className="text-[#dbdee1] text-xs leading-relaxed whitespace-pre-wrap">{replace(description)}</p>
      )}
      {footer && (
        <p className="text-[#80848e] text-[11px] mt-2 pt-1 border-t border-white/10">{replace(footer)}</p>
      )}
    </div>
  );
}

// ── Variable chips ─────────────────────────────────────────────────────────────

function VarChips({ onInsert }: { onInsert: (v: string) => void }) {
  const vars = ['{user}', '{tag}', '{name}', '{server}', '{channel}'];
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {vars.map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="px-2 py-0.5 rounded text-[11px] font-mono border transition-colors"
          style={{
            background: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))',
            borderColor: 'hsl(var(--border))',
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ── Toggle group ──────────────────────────────────────────────────────────────

function ToggleGroup({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-md border overflow-hidden" style={{ borderColor: 'hsl(var(--border))' }}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 px-3 py-1.5 text-sm font-medium transition-colors',
            i > 0 && 'border-l',
            value === o.value
              ? 'bg-indigo-600 text-white'
              : 'hover:bg-muted text-muted-foreground',
          )}
          style={value !== o.value ? { borderColor: 'hsl(var(--border))' } : {}}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
      <div className="pt-1.5">
        <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>{label}</p>
        {hint && <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Command form (modal) ──────────────────────────────────────────────────────

function CommandForm({
  form, setForm, onSave, onCancel, saving,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const insertVar = (field: 'response' | 'embedTitle' | 'embedFooter') => (v: string) =>
    setForm(f => ({ ...f, [field]: (f[field] as string) + v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center gap-2">
            <MessageSquareCode className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              {form.trigger ? `Modifier — ${form.trigger}` : 'Nouvelle commande'}
            </h2>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-2 flex-1">

          {/* ── Déclencheur ── */}
          <div className="pt-4 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>Déclencheur</h3>
          </div>

          <Field label="Mot / phrase" hint="Le texte qui déclenche la commande">
            <Input
              value={form.trigger}
              onChange={e => set('trigger', e.target.value)}
              placeholder="!aide, bonjour, !règles…"
            />
          </Field>

          <Field label="Mode de détection">
            <ToggleGroup
              value={form.matchMode}
              options={[
                { value: 'exact', label: 'Exact' },
                { value: 'startswith', label: 'Commence par' },
                { value: 'contains', label: 'Contient' },
              ]}
              onChange={v => set('matchMode', v)}
            />
          </Field>

          <Field label="Sensible à la casse" hint="Distingue majuscules et minuscules">
            <Switch checked={form.caseSensitive} onCheckedChange={v => set('caseSensitive', v)} />
          </Field>

          {/* ── Réponse ── */}
          <div className="pt-5 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>Réponse</h3>
          </div>

          <Field label="Type de réponse">
            <ToggleGroup
              value={form.responseType}
              options={[
                { value: 'message', label: 'Message simple' },
                { value: 'embed', label: 'Embed Discord' },
              ]}
              onChange={v => set('responseType', v)}
            />
          </Field>

          {form.responseType === 'embed' && (
            <Field label="Titre de l'embed">
              <>
                <Input
                  value={form.embedTitle}
                  onChange={e => set('embedTitle', e.target.value)}
                  placeholder="📋 Règles du serveur"
                  className="mb-1"
                />
                <VarChips onInsert={insertVar('embedTitle')} />
              </>
            </Field>
          )}

          <Field
            label={form.responseType === 'embed' ? 'Description' : 'Message'}
            hint="Variables disponibles ci-dessous"
          >
            <>
              <textarea
                value={form.response}
                onChange={e => set('response', e.target.value)}
                rows={4}
                placeholder={form.responseType === 'embed' ? 'Contenu de l\'embed…' : 'Texte envoyé par le bot…'}
                className="w-full rounded-md border px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{
                  background: 'hsl(var(--input))',
                  borderColor: 'hsl(var(--border))',
                  color: 'hsl(var(--foreground))',
                }}
              />
              <VarChips onInsert={insertVar('response')} />
            </>
          </Field>

          {form.responseType === 'embed' && (
            <>
              <Field label="Couleur de l'embed">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={`#${form.embedColor.replace('#', '')}`}
                    onChange={e => set('embedColor', e.target.value.replace('#', ''))}
                    className="w-8 h-8 rounded cursor-pointer border-0"
                  />
                  <Input
                    value={form.embedColor}
                    onChange={e => set('embedColor', e.target.value.replace('#', ''))}
                    placeholder="5865F2"
                    className="w-36 font-mono"
                  />
                </div>
              </Field>

              <Field label="Footer de l'embed">
                <>
                  <Input
                    value={form.embedFooter}
                    onChange={e => set('embedFooter', e.target.value)}
                    placeholder="Texte de bas d'embed…"
                    className="mb-1"
                  />
                  <VarChips onInsert={insertVar('embedFooter')} />
                </>
              </Field>

              {(form.response || form.embedTitle) && (
                <Field label="Aperçu live">
                  <EmbedPreview
                    title={form.embedTitle}
                    description={form.response}
                    color={form.embedColor}
                    footer={form.embedFooter}
                  />
                </Field>
              )}
            </>
          )}

          {/* ── Comportement ── */}
          <div className="pt-5 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>Comportement</h3>
          </div>

          <Field label="Répondre au message" hint="Utilise la réponse Discord (→ mention)">
            <Switch checked={form.replyToUser} onCheckedChange={v => set('replyToUser', v)} />
          </Field>

          <Field label="Supprimer le message" hint="Supprime le message de l'utilisateur après déclenchement">
            <Switch checked={form.deleteUserMessage} onCheckedChange={v => set('deleteUserMessage', v)} />
          </Field>

          <Field label="Cooldown (secondes)" hint="0 = pas de limite par membre">
            <Input
              type="number"
              min={0}
              value={form.cooldownSeconds}
              onChange={e => set('cooldownSeconds', Math.max(0, parseInt(e.target.value) || 0))}
              className="w-28"
            />
          </Field>

          {/* ── Restrictions ── */}
          <div className="pt-5 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>Restrictions</h3>
          </div>

          <Field label="Salons autorisés" hint="IDs séparés par des virgules — vide = tous">
            <Input
              value={form.allowedChannels}
              onChange={e => set('allowedChannels', e.target.value)}
              placeholder="123456789012345678, 987654321…"
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Rôles autorisés" hint="IDs séparés par des virgules — vide = tous">
            <Input
              value={form.allowedRoles}
              onChange={e => set('allowedRoles', e.target.value)}
              placeholder="123456789012345678, 987654321…"
              className="font-mono text-xs"
            />
          </Field>

          {/* ── Récompenses ── */}
          <div className="pt-5 pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>Récompenses <span className="normal-case font-normal">(optionnel)</span></h3>
          </div>

          <Field label="Activer les récompenses" hint="Donne rôle / argent / XP / niveaux à un membre">
            <Switch checked={form.rewardEnabled} onCheckedChange={v => set('rewardEnabled', v)} />
          </Field>

          {form.rewardEnabled && (
            <>
              <Field label="Cible de la récompense" hint="Qui reçoit la récompense ?">
                <ToggleGroup
                  value={form.rewardTarget}
                  options={[
                    { value: 'mentioned', label: 'Membre mentionné' },
                    { value: 'author', label: 'Auteur du message' },
                  ]}
                  onChange={v => set('rewardTarget', v)}
                />
                {form.rewardTarget === 'mentioned' && (
                  <p className="text-xs mt-1.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Utilisez <code className="font-mono">{'{target}'}</code> dans la réponse pour mentionner la cible.
                  </p>
                )}
              </Field>

              <Field label="Rôle à donner" hint="ID Discord du rôle — vide = aucun">
                <Input
                  value={form.rewardRoleId}
                  onChange={e => set('rewardRoleId', e.target.value)}
                  placeholder="123456789012345678"
                  className="font-mono text-xs"
                />
              </Field>

              <Field label="Argent (wallet)" hint="Montant de sheckels ajouté — 0 = aucun">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={form.rewardMoney}
                    onChange={e => set('rewardMoney', Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-32"
                  />
                  <span className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>sheckels</span>
                </div>
              </Field>

              <Field label="XP" hint="Points d'expérience ajoutés — 0 = aucun">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={form.rewardXp}
                    onChange={e => set('rewardXp', Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-32"
                  />
                  <span className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>XP</span>
                </div>
              </Field>

              <Field label="Niveaux" hint="Niveaux ajoutés directement — 0 = aucun">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={form.rewardLevels}
                    onChange={e => set('rewardLevels', Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-32"
                  />
                  <span className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>niveaux</span>
                </div>
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <Button variant="outline" onClick={onCancel} disabled={saving}>Annuler</Button>
          <Button
            onClick={onSave}
            disabled={saving || !form.trigger.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Command row ────────────────────────────────────────────────────────────────

function CommandRow({
  cmd,
  onEdit,
  onDelete,
  onToggle,
}: {
  cmd: CustomCommand;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (v: boolean) => void;
}) {
  const modeLabel: Record<string, string> = {
    exact: 'Exact', startswith: 'Commence par', contains: 'Contient',
  };
  const typeLabel: Record<string, string> = { message: 'Message', embed: 'Embed' };

  return (
    <div
      className="flex items-center gap-4 px-5 py-4 border-b transition-colors hover:bg-muted/30"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      {/* Enabled toggle */}
      <Switch checked={cmd.enabled} onCheckedChange={onToggle} />

      {/* Trigger */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code
            className="text-sm font-mono font-semibold px-1.5 py-0.5 rounded"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}
          >
            {cmd.trigger}
          </code>
          <span
            className="text-xs px-1.5 py-0.5 rounded border"
            style={{ color: 'hsl(var(--muted-foreground))', borderColor: 'hsl(var(--border))' }}
          >
            {modeLabel[cmd.matchMode] ?? cmd.matchMode}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded border"
            style={{ color: 'hsl(var(--muted-foreground))', borderColor: 'hsl(var(--border))' }}
          >
            {typeLabel[cmd.responseType] ?? cmd.responseType}
          </span>
          {!cmd.enabled && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
              Désactivée
            </span>
          )}
        </div>
        {cmd.response && (
          <p className="text-xs mt-1 truncate max-w-lg" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {cmd.response.slice(0, 120)}{cmd.response.length > 120 ? '…' : ''}
          </p>
        )}
      </div>

      {/* Meta */}
      <div className="hidden md:flex flex-col items-end text-right gap-0.5 shrink-0">
        {cmd.cooldownSeconds > 0 && (
          <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
            ⏱ {cmd.cooldownSeconds}s cooldown
          </span>
        )}
        {cmd.allowedChannels && (
          <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
            📌 salons limités
          </span>
        )}
        {cmd.allowedRoles && (
          <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
            🔒 rôles limités
          </span>
        )}
        {cmd.rewardEnabled && (
          <span className="text-[11px] text-amber-400">
            🎁 récompenses actives
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          title="Modifier"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-md hover:bg-red-500/10 hover:text-red-400 transition-colors"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          title="Supprimer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomCommands() {
  const { toast } = useToast();
  const { commands, setCommands, loading, load } = useCustomCommands();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Load on mount
  useState(() => { load(); });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (cmd: CustomCommand) => {
    setEditingId(cmd.id);
    setForm({
      trigger: cmd.trigger,
      matchMode: cmd.matchMode,
      caseSensitive: cmd.caseSensitive,
      responseType: cmd.responseType,
      response: cmd.response,
      embedTitle: cmd.embedTitle,
      embedColor: cmd.embedColor,
      embedFooter: cmd.embedFooter,
      enabled: cmd.enabled,
      deleteUserMessage: cmd.deleteUserMessage,
      replyToUser: cmd.replyToUser,
      allowedChannels: cmd.allowedChannels,
      allowedRoles: cmd.allowedRoles,
      cooldownSeconds: cmd.cooldownSeconds,
      rewardEnabled: cmd.rewardEnabled,
      rewardTarget: cmd.rewardTarget,
      rewardRoleId: cmd.rewardRoleId,
      rewardMoney: cmd.rewardMoney,
      rewardXp: cmd.rewardXp,
      rewardLevels: cmd.rewardLevels,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = editingId
        ? `${base()}/api/custom-commands/${editingId}`
        : `${base()}/api/custom-commands`;
      const method = editingId ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: editingId ? 'Commande mise à jour ✓' : 'Commande créée ✓' });
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      toast({ title: 'Erreur', description: String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer cette commande ?')) return;
    const r = await fetch(`${base()}/api/custom-commands/${id}`, { method: 'DELETE' });
    if (r.ok || r.status === 204) {
      setCommands(c => c.filter(x => x.id !== id));
      toast({ title: 'Commande supprimée' });
    } else {
      toast({ title: 'Erreur lors de la suppression', variant: 'destructive' });
    }
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    const r = await fetch(`${base()}/api/custom-commands/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) {
      setCommands(c => c.map(x => x.id === id ? { ...x, enabled } : x));
    } else {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const filtered = commands.filter(c =>
    !search || c.trigger.toLowerCase().includes(search.toLowerCase()) ||
    c.response.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/10 flex items-center justify-center">
            <MessageSquareCode className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              Commandes personnalisées
            </h1>
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Le bot répond automatiquement quand un membre écrit le déclencheur.
            </p>
          </div>
        </div>
        <Button
          onClick={openCreate}
          className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nouvelle commande
        </Button>
      </div>

      {/* Variables help */}
      <div
        className="rounded-lg px-4 py-3 mb-5 text-sm"
        style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
      >
        <strong style={{ color: 'hsl(var(--foreground))' }}>Variables disponibles dans les réponses :</strong>
        {' '}
        <code>{'{user}'}</code> mention · <code>{'{tag}'}</code> nom · <code>{'{name}'}</code> surnom · <code>{'{server}'}</code> serveur · <code>{'{channel}'}</code> salon
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Rechercher par déclencheur ou contenu…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* List */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        {/* Table header */}
        <div
          className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-widest"
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
        >
          {loading ? 'Chargement…' : `${filtered.length} commande${filtered.length !== 1 ? 's' : ''}`}
        </div>

        {!loading && filtered.length === 0 && (
          <div className="px-5 py-12 text-center" style={{ color: 'hsl(var(--muted-foreground))' }}>
            <MessageSquareCode className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Aucune commande personnalisée</p>
            <p className="text-xs mt-1">Cliquez sur « Nouvelle commande » pour commencer.</p>
          </div>
        )}

        {filtered.map(cmd => (
          <CommandRow
            key={cmd.id}
            cmd={cmd}
            onEdit={() => openEdit(cmd)}
            onDelete={() => handleDelete(cmd.id)}
            onToggle={v => handleToggle(cmd.id, v)}
          />
        ))}
      </div>

      {/* Modal */}
      {showForm && (
        <CommandForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
