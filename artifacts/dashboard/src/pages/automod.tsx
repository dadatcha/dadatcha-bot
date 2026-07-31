import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ShieldAlert, Trash2, Plus, Save, RotateCcw } from 'lucide-react';
import { getApiBase } from '@/lib/api-url';

const API = getApiBase();

type Action = 'delete' | 'warn' | 'timeout' | 'kick' | 'ban';

interface AutomodConfig {
  enabled: boolean;
  logChannelId: string;
  ignoredRoleIds: string[];
  ignoredChannelIds: string[];
  badWordsEnabled: boolean;
  badWords: string[];
  badWordsAction: Action;
  badWordsTimeoutMinutes: number;
  spamEnabled: boolean;
  spamMaxMessages: number;
  spamWindowSeconds: number;
  spamAction: Action;
  spamTimeoutMinutes: number;
  capsEnabled: boolean;
  capsPercent: number;
  capsMinLength: number;
  capsAction: Action;
  linksEnabled: boolean;
  linksWhitelist: string[];
  linksAction: Action;
  linksTimeoutMinutes: number;
  mentionEnabled: boolean;
  mentionMax: number;
  mentionAction: Action;
  mentionTimeoutMinutes: number;
  sendWarnDm: boolean;
}

const DEFAULTS: AutomodConfig = {
  enabled: false, logChannelId: '', ignoredRoleIds: [], ignoredChannelIds: [],
  badWordsEnabled: false, badWords: [], badWordsAction: 'delete', badWordsTimeoutMinutes: 10,
  spamEnabled: false, spamMaxMessages: 5, spamWindowSeconds: 5, spamAction: 'timeout', spamTimeoutMinutes: 5,
  capsEnabled: false, capsPercent: 70, capsMinLength: 10, capsAction: 'delete',
  linksEnabled: false, linksWhitelist: [], linksAction: 'delete', linksTimeoutMinutes: 5,
  mentionEnabled: false, mentionMax: 5, mentionAction: 'delete', mentionTimeoutMinutes: 5,
  sendWarnDm: true,
};

const ACTION_LABELS: Record<Action, string> = {
  delete: '🗑️ Supprimer',
  warn: '⚠️ Avertir (DM)',
  timeout: '⏱️ Timeout',
  kick: '👢 Kick',
  ban: '🔨 Ban',
};

function ActionSelect({ value, onChange, showTimeout }: {
  value: Action; onChange: (v: Action) => void; showTimeout?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange as (v: string) => void}>
      <SelectTrigger className="w-44 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(ACTION_LABELS) as [Action, string][])
          .filter(([k]) => showTimeout !== false || k !== 'timeout')
          .map(([k, label]) => (
            <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function TagInput({ tags, onChange, placeholder }: {
  tags: string[]; onChange: (t: string[]) => void; placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder} className="h-8 text-xs flex-1" />
        <Button type="button" size="sm" variant="outline" onClick={add} className="h-8 px-2">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(t => (
          <Badge key={t} variant="secondary" className="text-xs gap-1 pr-1">
            {t}
            <button type="button" onClick={() => onChange(tags.filter(x => x !== t))}
              className="hover:text-destructive">
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function RuleCard({ title, icon, enabled, onToggle, children }: {
  title: string; icon: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border transition-colors ${enabled ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-border'}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="font-medium text-sm">{title}</span>
          {enabled && <Badge variant="outline" className="text-[10px] text-indigo-400 border-indigo-400/40">Actif</Badge>}
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && (
        <>
          <Separator />
          <div className="px-4 py-3 space-y-3">{children}</div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Label className="text-xs text-muted-foreground w-36 flex-shrink-0">{label}</Label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; className?: string;
}) {
  return (
    <Input type="number" value={value} min={min} max={max}
      onChange={e => onChange(Number(e.target.value))}
      className={`h-8 text-xs w-20 ${className ?? ''}`} />
  );
}

export default function Automod() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<AutomodConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const upd = <K extends keyof AutomodConfig>(key: K, value: AutomodConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    fetch(`${API}/api/automod/config`)
      .then(r => r.json())
      .then(d => { setCfg({ ...DEFAULTS, ...d }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/automod/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setCfg({ ...DEFAULTS, ...d });
      toast({ title: 'Automodération sauvegardée ✅' });
    } catch {
      toast({ title: 'Erreur lors de la sauvegarde', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
      Chargement…
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <ShieldAlert className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Automodération</h1>
            <p className="text-xs text-muted-foreground">Protection automatique du serveur</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCfg(DEFAULTS)} className="h-8 text-xs gap-1">
            <RotateCcw className="w-3 h-3" /> Réinitialiser
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs gap-1">
            <Save className="w-3 h-3" /> {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </Button>
        </div>
      </div>

      {/* Global toggle */}
      <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-card">
        <div>
          <p className="text-sm font-medium">Activer l'automodération</p>
          <p className="text-xs text-muted-foreground mt-0.5">Active tous les modules ci-dessous</p>
        </div>
        <Switch checked={cfg.enabled} onCheckedChange={v => upd('enabled', v)} />
      </div>

      {/* General settings */}
      <div className="rounded-lg border px-4 py-3 space-y-3 bg-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paramètres généraux</p>
        <Row label="Salon de logs">
          <Input value={cfg.logChannelId} onChange={e => upd('logChannelId', e.target.value)}
            placeholder="ID du salon" className="h-8 text-xs w-48" />
        </Row>
        <Row label="DM d'avertissement">
          <Switch checked={cfg.sendWarnDm} onCheckedChange={v => upd('sendWarnDm', v)} />
          <span className="text-xs text-muted-foreground">Envoyer un DM à l'utilisateur lors d'une sanction</span>
        </Row>
        <Row label="Rôles ignorés">
          <div className="flex-1">
            <TagInput tags={cfg.ignoredRoleIds} onChange={v => upd('ignoredRoleIds', v)} placeholder="ID du rôle + Entrée" />
          </div>
        </Row>
        <Row label="Salons ignorés">
          <div className="flex-1">
            <TagInput tags={cfg.ignoredChannelIds} onChange={v => upd('ignoredChannelIds', v)} placeholder="ID du salon + Entrée" />
          </div>
        </Row>
      </div>

      {/* Rule cards */}
      <div className="space-y-3">
        {/* Bad words */}
        <RuleCard title="Mots interdits" icon="🤬" enabled={cfg.badWordsEnabled} onToggle={v => upd('badWordsEnabled', v)}>
          <Row label="Mots à bloquer">
            <div className="flex-1">
              <TagInput tags={cfg.badWords} onChange={v => upd('badWords', v)} placeholder="mot + Entrée" />
            </div>
          </Row>
          <Row label="Action">
            <ActionSelect value={cfg.badWordsAction} onChange={v => upd('badWordsAction', v)} showTimeout />
            {cfg.badWordsAction === 'timeout' && (
              <>
                <NumInput value={cfg.badWordsTimeoutMinutes} onChange={v => upd('badWordsTimeoutMinutes', v)} min={1} max={40320} />
                <span className="text-xs text-muted-foreground">min</span>
              </>
            )}
          </Row>
        </RuleCard>

        {/* Spam */}
        <RuleCard title="Anti-spam" icon="💬" enabled={cfg.spamEnabled} onToggle={v => upd('spamEnabled', v)}>
          <Row label="Seuil">
            <NumInput value={cfg.spamMaxMessages} onChange={v => upd('spamMaxMessages', v)} min={2} max={50} />
            <span className="text-xs text-muted-foreground">messages en</span>
            <NumInput value={cfg.spamWindowSeconds} onChange={v => upd('spamWindowSeconds', v)} min={1} max={60} />
            <span className="text-xs text-muted-foreground">secondes</span>
          </Row>
          <Row label="Action">
            <ActionSelect value={cfg.spamAction} onChange={v => upd('spamAction', v)} showTimeout />
            {cfg.spamAction === 'timeout' && (
              <>
                <NumInput value={cfg.spamTimeoutMinutes} onChange={v => upd('spamTimeoutMinutes', v)} min={1} max={40320} />
                <span className="text-xs text-muted-foreground">min</span>
              </>
            )}
          </Row>
        </RuleCard>

        {/* Caps */}
        <RuleCard title="Anti-majuscules" icon="🔠" enabled={cfg.capsEnabled} onToggle={v => upd('capsEnabled', v)}>
          <Row label="Seuil">
            <NumInput value={cfg.capsPercent} onChange={v => upd('capsPercent', v)} min={10} max={100} />
            <span className="text-xs text-muted-foreground">% de majuscules, minimum</span>
            <NumInput value={cfg.capsMinLength} onChange={v => upd('capsMinLength', v)} min={1} max={500} />
            <span className="text-xs text-muted-foreground">caractères</span>
          </Row>
          <Row label="Action">
            <ActionSelect value={cfg.capsAction} onChange={v => upd('capsAction', v)} />
          </Row>
        </RuleCard>

        {/* Links */}
        <RuleCard title="Anti-liens" icon="🔗" enabled={cfg.linksEnabled} onToggle={v => upd('linksEnabled', v)}>
          <Row label="Domaines autorisés">
            <div className="flex-1">
              <TagInput tags={cfg.linksWhitelist} onChange={v => upd('linksWhitelist', v)} placeholder="discord.com + Entrée" />
              <p className="text-[10px] text-muted-foreground mt-1">Laisser vide = bloquer tous les liens</p>
            </div>
          </Row>
          <Row label="Action">
            <ActionSelect value={cfg.linksAction} onChange={v => upd('linksAction', v)} showTimeout />
            {cfg.linksAction === 'timeout' && (
              <>
                <NumInput value={cfg.linksTimeoutMinutes} onChange={v => upd('linksTimeoutMinutes', v)} min={1} max={40320} />
                <span className="text-xs text-muted-foreground">min</span>
              </>
            )}
          </Row>
        </RuleCard>

        {/* Mass mention */}
        <RuleCard title="Anti-mentions" icon="📢" enabled={cfg.mentionEnabled} onToggle={v => upd('mentionEnabled', v)}>
          <Row label="Seuil">
            <NumInput value={cfg.mentionMax} onChange={v => upd('mentionMax', v)} min={2} max={50} />
            <span className="text-xs text-muted-foreground">mentions dans un message</span>
          </Row>
          <Row label="Action">
            <ActionSelect value={cfg.mentionAction} onChange={v => upd('mentionAction', v)} showTimeout />
            {cfg.mentionAction === 'timeout' && (
              <>
                <NumInput value={cfg.mentionTimeoutMinutes} onChange={v => upd('mentionTimeoutMinutes', v)} min={1} max={40320} />
                <span className="text-xs text-muted-foreground">min</span>
              </>
            )}
          </Row>
        </RuleCard>
      </div>

      {/* Save bottom */}
      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={save} disabled={saving} className="gap-1">
          <Save className="w-3 h-3" /> {saving ? 'Sauvegarde…' : 'Sauvegarder les modifications'}
        </Button>
      </div>
    </div>
  );
}
