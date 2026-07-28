import { useState } from 'react';
import {
  useListCommandConfigs, useUpdateCommandConfig,
  getListCommandConfigsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Terminal, Coins, Gamepad2, ShoppingBag, Lock, Eye, EyeOff, Pencil, Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type CmdConfig = {
  name: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  adminOnly: boolean;
};

// ── Category meta ──────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  economy: { label: 'Économie',  icon: Coins,        color: 'text-yellow-500' },
  games:   { label: 'Jeux',     icon: Gamepad2,      color: 'text-purple-500' },
  shop:    { label: 'Shop',     icon: ShoppingBag,   color: 'text-violet-500' },
};

// ── Single command row ─────────────────────────────────────────────────────────

function CommandRow({ cmd, onSaved }: { cmd: CmdConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const update = useUpdateCommandConfig();

  const [enabled,      setEnabled]      = useState(cmd.enabled);
  const [adminOnly,    setAdminOnly]    = useState(cmd.adminOnly);
  const [label,        setLabel]        = useState(cmd.label);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft,   setLabelDraft]   = useState(cmd.label);

  const dirty = enabled !== cmd.enabled || adminOnly !== cmd.adminOnly || label !== cmd.label;

  function save(overrides?: { label?: string }) {
    const finalLabel = overrides?.label ?? label;
    update.mutate(
      { name: cmd.name, data: { enabled, adminOnly, label: finalLabel } },
      {
        onSuccess: () => { toast({ title: `/${cmd.name} sauvegardé` }); onSaved(); },
        onError:   () => toast({ title: 'Erreur de sauvegarde', variant: 'destructive' }),
      }
    );
  }

  function commitLabel() {
    const trimmed = labelDraft.trim() || cmd.label;
    setLabel(trimmed);
    setLabelDraft(trimmed);
    setEditingLabel(false);
    update.mutate(
      { name: cmd.name, data: { enabled, adminOnly, label: trimmed } },
      {
        onSuccess: () => { toast({ title: `Nom mis à jour` }); onSaved(); },
        onError:   () => toast({ title: 'Erreur de sauvegarde', variant: 'destructive' }),
      }
    );
  }

  function cancelLabel() {
    setLabelDraft(label);
    setEditingLabel(false);
  }

  return (
    <div className={cn(
      'grid items-center gap-4 px-4 py-3 rounded-lg border transition-colors',
      'grid-cols-[1fr_auto_auto_auto]',
      !enabled && 'opacity-60',
      dirty ? 'border-indigo-200 bg-indigo-50/30' : 'border-border bg-card',
    )}>
      {/* Name + label + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded text-foreground shrink-0">
            /{cmd.name}
          </code>

          {/* Editable label */}
          {editingLabel ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') cancelLabel(); }}
                className="h-6 text-xs px-2 w-36"
              />
              <Button size="sm" variant="ghost" onClick={commitLabel} className="h-6 w-6 p-0 text-indigo-600"><Check className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" onClick={cancelLabel}  className="h-6 w-6 p-0 text-muted-foreground"><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <button
              onClick={() => { setLabelDraft(label); setEditingLabel(true); }}
              className="group flex items-center gap-1 text-xs font-medium text-foreground hover:text-indigo-600 transition-colors"
            >
              {label}
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          )}

          {!enabled && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-orange-500 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">
              <EyeOff className="w-2.5 h-2.5" /> Masquée
            </span>
          )}
          {adminOnly && enabled && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
              <Lock className="w-2.5 h-2.5" /> Admin
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{cmd.description}</p>
      </div>

      {/* Activée toggle */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Activée</span>
        <Switch
          checked={enabled}
          onCheckedChange={v => {
            setEnabled(v);
            if (!v) setAdminOnly(false);
          }}
        />
      </div>

      {/* Admin only toggle */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Admin only</span>
        <Switch
          checked={adminOnly}
          disabled={!enabled}
          onCheckedChange={setAdminOnly}
        />
      </div>

      {/* Save button */}
      <Button
        size="sm"
        variant={dirty ? 'default' : 'ghost'}
        onClick={() => save()}
        disabled={!dirty || update.isPending}
        className={cn('h-7 px-3 text-xs', !dirty && 'opacity-0 pointer-events-none')}
      >
        {update.isPending ? '…' : 'Sauvegarder'}
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Commands() {
  const queryClient = useQueryClient();
  const { data: configs = [], isLoading } = useListCommandConfigs({
    query: { queryKey: getListCommandConfigsQueryKey() },
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListCommandConfigsQueryKey() });
  }

  // Group by category
  const grouped = (configs as CmdConfig[]).reduce<Record<string, CmdConfig[]>>((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {});

  const categoryOrder = ['economy', 'games', 'shop'];

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Commandes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Contrôle quelles commandes sont <span className="font-medium">actives</span> sur Discord et lesquelles sont réservées aux <span className="font-medium">administrateurs</span>.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" />
          <strong>Activée</strong> — la commande répond aux membres
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <strong>Admin only</strong> — seuls les administrateurs peuvent l'utiliser
        </span>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>
      )}

      {categoryOrder.map(cat => {
        const cmds = grouped[cat];
        if (!cmds?.length) return null;
        const meta = CATEGORY_META[cat] ?? { label: cat, icon: Terminal, color: 'text-muted-foreground' };
        const Icon = meta.icon;

        return (
          <section key={cat} className="space-y-2">
            {/* Section header */}
            <div className="flex items-center gap-2 pb-1 border-b">
              <Icon className={cn('w-4 h-4', meta.color)} />
              <h2 className="text-sm font-semibold">{meta.label}</h2>
              <span className="text-xs text-muted-foreground ml-auto">
                {cmds.filter(c => c.enabled).length}/{cmds.length} actives
              </span>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 pb-0.5">
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14 text-center">Activée</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-16 text-center">Admin only</span>
              <span className="w-20" />
            </div>

            {/* Rows */}
            <div className="space-y-1.5">
              {cmds.map(cmd => (
                <CommandRow key={cmd.name} cmd={cmd} onSaved={refresh} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
