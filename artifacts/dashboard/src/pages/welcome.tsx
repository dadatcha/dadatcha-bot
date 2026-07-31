import { useState, useEffect } from 'react';
import { UserPlus, UserMinus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MentionTextarea } from '@/components/ui/mention-textarea';
import { Switch } from '@/components/ui/switch';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow } from '@/components/ui/field-row';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type WelcomeConfig = {
  joinEnabled: boolean; joinChannelId: string;
  joinEmbedTitle: string; joinEmbedDescription: string;
  joinEmbedColor: string; joinEmbedFooter: string; joinShowAvatar: boolean;
  leaveEnabled: boolean; leaveChannelId: string;
  leaveEmbedTitle: string; leaveEmbedDescription: string;
  leaveEmbedColor: string; leaveEmbedFooter: string; leaveShowAvatar: boolean;
  updatedAt: string;
};

import { getApiBase } from '@/lib/api-url';
const base = () => getApiBase();

// ── Live embed preview ────────────────────────────────────────────────────────

function EmbedPreview({
  title, description, color, footer, showAvatar, side,
}: {
  title: string; description: string; color: string;
  footer: string; showAvatar: boolean; side: 'join' | 'leave';
}) {
  const vars: Record<string, string> = {
    '{server}': 'Mon Serveur', '{mention}': '@Nouveau Membre',
    '{user}': 'Nouveau Membre', '{count}': '42',
    '{tag}': 'Nouveau Membre#0001',
  };
  function replace(s: string) {
    return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(k, v), s);
  }
  const borderColor = color ? `#${color}` : (side === 'join' ? '#57F287' : '#ED4245');

  return (
    <div className="rounded-lg bg-[#2b2d31] text-white text-sm p-3 border-l-4 flex gap-3" style={{ borderColor }}>
      <div className="flex-1 min-w-0 space-y-1">
        {title && <p className="font-semibold text-white text-[13px] leading-tight">{replace(title)}</p>}
        {description && (
          <p className="text-[#dbdee1] text-xs leading-relaxed whitespace-pre-wrap">{replace(description)}</p>
        )}
        {footer && <p className="text-[#80848e] text-[11px] mt-1 pt-1 border-t border-white/10">{replace(footer)}</p>}
      </div>
      {showAvatar && (
        <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
          NM
        </div>
      )}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  side, enabled, onToggle, channelId, onChannelId,
  title, onTitle, description, onDescription,
  color, onColor, footer, onFooter,
  showAvatar, onShowAvatar,
}: {
  side: 'join' | 'leave'; enabled: boolean; onToggle: (v: boolean) => void;
  channelId: string; onChannelId: (v: string) => void;
  title: string; onTitle: (v: string) => void;
  description: string; onDescription: (v: string) => void;
  color: string; onColor: (v: string) => void;
  footer: string; onFooter: (v: string) => void;
  showAvatar: boolean; onShowAvatar: (v: boolean) => void;
}) {
  const isJoin = side === 'join';
  const Icon = isJoin ? UserPlus : UserMinus;
  const accentColor = isJoin ? 'text-green-500' : 'text-red-500';
  const label = isJoin ? "Arrivée de membres" : "Départ de membres";
  const desc = isJoin
    ? "Embed envoyé quand un membre rejoint le serveur."
    : "Embed envoyé quand un membre quitte le serveur.";

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 p-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            isJoin ? 'bg-green-100 dark:bg-green-950/40' : 'bg-red-100 dark:bg-red-950/40')}>
            <Icon className={cn('w-5 h-5', accentColor)} />
          </div>
          <div>
            <p className="font-semibold text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>

      {/* Fields */}
      <div className={cn('border-t px-5 py-4 space-y-4 transition-opacity', !enabled && 'opacity-50 pointer-events-none')}>
        <FieldRow label="Salon" hint="ID Discord du salon où envoyer l'embed.">
          <Input value={channelId} onChange={e => onChannelId(e.target.value)}
            placeholder="ID du salon" className="font-mono text-sm" />
        </FieldRow>

        <div className="pt-1 border-t">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Embed</p>
        </div>

        <FieldRow label="Titre" hint="Variables : {server}, {user}, {mention}, {count}, {tag}">
          <Input value={title} onChange={e => onTitle(e.target.value)} placeholder="Titre de l'embed" />
        </FieldRow>
        <FieldRow label="Description" hint="Variables : {server}, {user}, {mention}, {count}, {tag}">
          <MentionTextarea
            value={description}
            onChange={onDescription}
            rows={3}
            placeholder="Texte de l'embed…"
          />
        </FieldRow>
        <FieldRow label="Couleur" hint="Hex sans #">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded border shrink-0" style={{ background: `#${color || (isJoin ? '57F287' : 'ED4245')}` }} />
            <Input value={color} onChange={e => onColor(e.target.value.replace('#', ''))}
              placeholder={isJoin ? '57F287' : 'ED4245'} className="font-mono text-sm w-32" maxLength={6} />
          </div>
        </FieldRow>
        <FieldRow label="Pied de page" hint="Vide = aucun footer.">
          <Input value={footer} onChange={e => onFooter(e.target.value)} placeholder="Texte du footer (optionnel)" />
        </FieldRow>
        <FieldRow label="Avatar en miniature" hint="Afficher l'avatar du membre à droite de l'embed.">
          <Switch checked={showAvatar} onCheckedChange={onShowAvatar} />
        </FieldRow>

        {/* Preview */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Aperçu</p>
          <EmbedPreview title={title} description={description} color={color}
            footer={footer} showAvatar={showAvatar} side={side} />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Welcome() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<WelcomeConfig | null>(null);
  const [draft, setDraft] = useState<WelcomeConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${base()}/api/welcome/config`)
      .then(r => r.json())
      .then((d: WelcomeConfig) => { setCfg(d); setDraft(d); })
      .catch(() => toast({ title: 'Erreur chargement config', variant: 'destructive' }));
  }, []);

  const p = (u: Partial<WelcomeConfig>) => setDraft(prev => prev ? { ...prev, ...u } : prev);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(draft);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch(`${base()}/api/welcome/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error();
      const saved: WelcomeConfig = await r.json();
      setCfg(saved); setDraft(saved);
      toast({ title: 'Configuration sauvegardée ✓' });
    } catch {
      toast({ title: 'Erreur lors de la sauvegarde', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!draft) return <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Arrivées & Départs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Embeds personnalisés envoyés quand un membre rejoint ou quitte le serveur.
          </p>
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0',
            dirty && !saving
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
      </div>

      {/* Variables hint */}
      <div className="rounded-xl border bg-muted/40 p-4 text-sm space-y-1">
        <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-2">Variables disponibles</p>
        <div className="flex flex-wrap gap-2">
          {[
            ['{mention}', 'Mention (@Membre)'],
            ['{user}', 'Nom du membre'],
            ['{tag}', 'Nom#0000'],
            ['{server}', 'Nom du serveur'],
            ['{count}', "Nombre de membres"],
          ].map(([v, d]) => (
            <div key={v} className="flex items-center gap-1.5 bg-background border rounded-md px-2 py-1">
              <code className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{v}</code>
              <span className="text-xs text-muted-foreground">— {d}</span>
            </div>
          ))}
        </div>
      </div>

      <SectionCard
        side="join" enabled={draft.joinEnabled} onToggle={v => p({ joinEnabled: v })}
        channelId={draft.joinChannelId} onChannelId={v => p({ joinChannelId: v })}
        title={draft.joinEmbedTitle} onTitle={v => p({ joinEmbedTitle: v })}
        description={draft.joinEmbedDescription} onDescription={v => p({ joinEmbedDescription: v })}
        color={draft.joinEmbedColor} onColor={v => p({ joinEmbedColor: v })}
        footer={draft.joinEmbedFooter} onFooter={v => p({ joinEmbedFooter: v })}
        showAvatar={draft.joinShowAvatar} onShowAvatar={v => p({ joinShowAvatar: v })}
      />

      <SectionCard
        side="leave" enabled={draft.leaveEnabled} onToggle={v => p({ leaveEnabled: v })}
        channelId={draft.leaveChannelId} onChannelId={v => p({ leaveChannelId: v })}
        title={draft.leaveEmbedTitle} onTitle={v => p({ leaveEmbedTitle: v })}
        description={draft.leaveEmbedDescription} onDescription={v => p({ leaveEmbedDescription: v })}
        color={draft.leaveEmbedColor} onColor={v => p({ leaveEmbedColor: v })}
        footer={draft.leaveEmbedFooter} onFooter={v => p({ leaveEmbedFooter: v })}
        showAvatar={draft.leaveShowAvatar} onShowAvatar={v => p({ leaveShowAvatar: v })}
      />
    </div>
  );
}
