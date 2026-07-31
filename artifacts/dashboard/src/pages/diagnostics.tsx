import { useState, useEffect, useCallback } from 'react';
import { useListCommandConfigs } from '@workspace/api-client-react';
import { Search, Zap, CheckCircle2, XCircle, AlertTriangle, ChevronRight, Terminal, Coins, Gamepad2, ShoppingBag, Gift, Settings, Shuffle, MessageSquareCode, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = { id: number; level: string; message: string; createdAt: string };

type Check = { ok: boolean; label: string; detail: string; severity: 'ok' | 'warning' | 'error' };

type SlashDiag = {
  commandType: 'slash';
  name: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  adminOnly: boolean;
  recentLogs: LogEntry[];
  checks: Check[];
};

type CustomDiag = {
  commandType: 'custom';
  config: {
    id: number; trigger: string; matchMode: string; caseSensitive: boolean;
    responseType: string; response: string; embedTitle: string; embedColor: string;
    embedFooter: string; enabled: boolean; deleteUserMessage: boolean; replyToUser: boolean;
    allowedChannels: string; allowedRoles: string; cooldownSeconds: number;
    rewardEnabled: boolean; rewardTarget: string; rewardRoleId: string;
    rewardMoney: number; rewardXp: number; rewardLevels: number;
    createdAt: string; updatedAt: string;
  };
  recentLogs: LogEntry[];
  checks: Check[];
  rewardStats: { totalGrants: number; recentGrants: { authorId: string; targetId: string; grantedAt: string }[] } | null;
};

type Diag = SlashDiag | CustomDiag;

type Selected = { type: 'slash'; name: string } | { type: 'custom'; id: number; trigger: string };

type CmdConfig = { name: string; label: string; description: string; category: string; enabled: boolean; adminOnly: boolean };
type CustomCmd = { id: number; trigger: string; enabled: boolean };

// ── Category meta ──────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  economy:           { label: 'Économie',         icon: Coins,              color: 'text-yellow-500' },
  games:             { label: 'Jeux',             icon: Gamepad2,           color: 'text-purple-500' },
  shop:              { label: 'Shop',             icon: ShoppingBag,        color: 'text-violet-500' },
  giveaway:          { label: 'Giveaway',         icon: Gift,               color: 'text-pink-500'   },
  config:            { label: 'Config',           icon: Settings,           color: 'text-slate-500'  },
  'random-activity': { label: 'Msgs aléatoires',  icon: Shuffle,            color: 'text-indigo-500' },
};

// ── LOG level styles ───────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, string> = {
  INFO:    'bg-blue-50  text-blue-700  border-blue-200',
  WARN:    'bg-yellow-50 text-yellow-700 border-yellow-200',
  WARNING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  ERROR:   'bg-red-50   text-red-700   border-red-200',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

import { getApiBase } from '@/lib/api-url';
const base = () => getApiBase();

async function fetchDiag(sel: Selected): Promise<Diag> {
  const url =
    sel.type === 'slash'
      ? `${base()}/api/diagnostics/slash/${encodeURIComponent(sel.name)}`
      : `${base()}/api/diagnostics/custom/${sel.id}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Check badge ───────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: Check }) {
  const icon =
    check.severity === 'error'   ? <XCircle      className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /> :
    check.severity === 'warning' ? <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" /> :
                                   <CheckCircle2  className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />;
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b last:border-0">
      {icon}
      <div>
        <p className="text-sm font-medium leading-none mb-0.5">{check.label}</p>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
      </div>
    </div>
  );
}

// ── Config table row ──────────────────────────────────────────────────────────

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}

// ── Log list ──────────────────────────────────────────────────────────────────

function LogList({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Aucun log récent pour cette commande.</p>;
  }
  return (
    <div className="divide-y divide-border max-h-64 overflow-y-auto">
      {logs.map(log => (
        <div key={log.id} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/20">
          <span className={cn('flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border font-mono', LEVEL_STYLE[log.level] ?? LEVEL_STYLE.INFO)}>
            {log.level}
          </span>
          <span className="flex-1 text-xs font-mono break-all leading-relaxed">{log.message}</span>
          <span className="flex-shrink-0 text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">{formatTimestamp(log.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Diagnostic panel ──────────────────────────────────────────────────────────

function DiagPanel({ diag }: { diag: Diag }) {
  if (diag.commandType === 'slash') {
    const meta = CATEGORY_META[diag.category] ?? { label: diag.category, icon: Terminal, color: 'text-muted-foreground' };
    const Icon = meta.icon;
    const errors   = diag.checks.filter(c => c.severity === 'error').length;
    const warnings = diag.checks.filter(c => c.severity === 'warning').length;

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Icon className={cn('w-4 h-4', meta.color)} />
              <span className="text-xs text-muted-foreground">{meta.label}</span>
            </div>
            <h2 className="text-xl font-bold">/{diag.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{diag.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', diag.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
              {diag.enabled ? 'Activée' : 'Désactivée'}
            </span>
            {diag.adminOnly && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">Admin only</span>
            )}
          </div>
        </div>

        {/* Health summary */}
        {(errors > 0 || warnings > 0) && (
          <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border', errors > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700')}>
            {errors > 0 ? <XCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {errors > 0 ? `${errors} problème${errors > 1 ? 's' : ''} détecté${errors > 1 ? 's' : ''}` : `${warnings} avertissement${warnings > 1 ? 's' : ''}`}
          </div>
        )}
        {errors === 0 && warnings === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-green-50 border-green-200 text-green-700">
            <CheckCircle2 className="w-4 h-4" />
            Tout est en ordre
          </div>
        )}

        {/* Checks */}
        <div className="bg-card border border-border rounded-xl px-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">Vérifications</p>
          {diag.checks.map((c, i) => <CheckRow key={i} check={c} />)}
        </div>

        {/* Config */}
        <div className="bg-card border border-border rounded-xl px-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">Configuration</p>
          <ConfigRow label="Nom interne" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{diag.name}</code>} />
          <ConfigRow label="Label affiché" value={diag.label} />
          <ConfigRow label="Catégorie" value={diag.category} />
          <ConfigRow label="Admin only" value={diag.adminOnly ? 'Oui' : 'Non'} />
        </div>

        {/* Logs */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logs récents</p>
            <span className="text-xs text-muted-foreground">{diag.recentLogs.length} entrée{diag.recentLogs.length !== 1 ? 's' : ''}</span>
          </div>
          <LogList logs={diag.recentLogs} />
        </div>
      </div>
    );
  }

  // Custom command
  const cmd = diag.config;
  const errors   = diag.checks.filter(c => c.severity === 'error').length;
  const warnings = diag.checks.filter(c => c.severity === 'warning').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MessageSquareCode className="w-4 h-4 text-indigo-500" />
            <span className="text-xs text-muted-foreground">Commande personnalisée</span>
          </div>
          <h2 className="text-xl font-bold font-mono">{cmd.trigger}</h2>
          <p className="text-sm text-muted-foreground mt-1">Mode : {cmd.matchMode} · Réponse : {cmd.responseType}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', cmd.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
            {cmd.enabled ? 'Activée' : 'Désactivée'}
          </span>
          {cmd.rewardEnabled && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Rewards actives</span>
          )}
        </div>
      </div>

      {/* Health summary */}
      {(errors > 0 || warnings > 0) && (
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border', errors > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700')}>
          {errors > 0 ? <XCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {errors > 0 ? `${errors} problème${errors > 1 ? 's' : ''} détecté${errors > 1 ? 's' : ''}` : `${warnings} avertissement${warnings > 1 ? 's' : ''}`}
        </div>
      )}
      {errors === 0 && warnings === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-green-50 border-green-200 text-green-700">
          <CheckCircle2 className="w-4 h-4" />
          Tout est en ordre
        </div>
      )}

      {/* Checks */}
      <div className="bg-card border border-border rounded-xl px-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">Vérifications</p>
        {diag.checks.map((c, i) => <CheckRow key={i} check={c} />)}
      </div>

      {/* Config */}
      <div className="bg-card border border-border rounded-xl px-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">Configuration</p>
        <ConfigRow label="Trigger" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{cmd.trigger}</code>} />
        <ConfigRow label="Mode de détection" value={cmd.matchMode} />
        <ConfigRow label="Casse sensible" value={cmd.caseSensitive ? 'Oui' : 'Non'} />
        <ConfigRow label="Type de réponse" value={cmd.responseType} />
        {cmd.responseType === 'embed' && cmd.embedTitle && (
          <ConfigRow label="Titre embed" value={cmd.embedTitle} />
        )}
        {cmd.deleteUserMessage && <ConfigRow label="Supprimer le message" value="Oui" />}
        {cmd.replyToUser      && <ConfigRow label="Répondre en mention"  value="Oui" />}
        {cmd.cooldownSeconds > 0 && (
          <ConfigRow label="Cooldown" value={`${cmd.cooldownSeconds}s`} />
        )}
        {cmd.allowedChannels?.trim() && (
          <ConfigRow label="Salons autorisés" value={cmd.allowedChannels} />
        )}
        {cmd.allowedRoles?.trim() && (
          <ConfigRow label="Rôles autorisés" value={cmd.allowedRoles} />
        )}
        <ConfigRow label="Créée le" value={formatTimestamp(cmd.createdAt)} />
        <ConfigRow label="Mise à jour" value={formatTimestamp(cmd.updatedAt)} />
      </div>

      {/* Reward stats */}
      {diag.rewardStats && (
        <div className="bg-card border border-border rounded-xl px-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">Statistiques de rewards</p>
          <ConfigRow label="Total de grants" value={<span className="font-bold text-indigo-600">{diag.rewardStats.totalGrants}</span>} />
          {diag.rewardStats.recentGrants.length > 0 && (
            <div className="py-2">
              <p className="text-xs text-muted-foreground mb-2">Derniers grants</p>
              <div className="space-y-1">
                {diag.rewardStats.recentGrants.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-muted-foreground">{g.authorId} → {g.targetId}</span>
                    <span className="text-muted-foreground">{formatTimestamp(g.grantedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logs récents</p>
          <span className="text-xs text-muted-foreground">{diag.recentLogs.length} entrée{diag.recentLogs.length !== 1 ? 's' : ''}</span>
        </div>
        <LogList logs={diag.recentLogs} />
      </div>
    </div>
  );
}

// ── Command list item ─────────────────────────────────────────────────────────

function CmdItem({
  label, active, enabled, onClick,
}: { label: string; active: boolean; enabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors text-left gap-2',
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-foreground',
      )}
    >
      <span className="truncate">{label}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!enabled && (
          <span className="text-[9px] font-bold uppercase bg-red-100 text-red-600 px-1 rounded">off</span>
        )}
        {active && <ChevronRight className="w-3 h-3" />}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Diagnostics() {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [diag,     setDiag]     = useState<Diag | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [customCmds, setCustomCmds] = useState<CustomCmd[]>([]);

  const { data: slashCmds = [], isLoading: slashLoading } = useListCommandConfigs();

  // Fetch custom commands
  useEffect(() => {
    fetch(`${base()}/api/custom-commands`)
      .then(r => r.json())
      .then(data => setCustomCmds(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Load diagnostic whenever selection changes
  const load = useCallback(async (sel: Selected) => {
    setLoading(true);
    setError(null);
    setDiag(null);
    try {
      const d = await fetchDiag(sel);
      setDiag(d);
    } catch {
      setError('Impossible de charger le diagnostic.');
    } finally {
      setLoading(false);
    }
  }, []);

  const select = (sel: Selected) => {
    setSelected(sel);
    load(sel);
  };

  const refresh = () => {
    if (selected) load(selected);
  };

  // Group slash commands by category
  const grouped = (slashCmds as CmdConfig[]).reduce<Record<string, CmdConfig[]>>((acc, c) => {
    const cat = c.category ?? 'other';
    (acc[cat] ??= []).push(c);
    return acc;
  }, {});

  const q = search.toLowerCase();

  const filteredGroups = Object.entries(grouped).map(([cat, cmds]) => ({
    cat,
    cmds: cmds.filter(c =>
      !q || c.name.includes(q) || c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    ),
  })).filter(({ cmds }) => cmds.length > 0);

  const filteredCustom = customCmds.filter(c =>
    !q || c.trigger.toLowerCase().includes(q)
  );

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Left: command list ──────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r bg-card">
        <div className="p-3 border-b">
          <h1 className="text-sm font-bold mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-500" />
            Diagnostics
          </h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {slashLoading && <p className="text-xs text-muted-foreground text-center py-4">Chargement…</p>}

          {filteredGroups.map(({ cat, cmds }) => {
            const meta = CATEGORY_META[cat] ?? { label: cat.charAt(0).toUpperCase() + cat.slice(1), icon: Terminal, color: 'text-muted-foreground' };
            const Icon = meta.icon;
            return (
              <div key={cat}>
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <Icon className={cn('w-3 h-3', meta.color)} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                </div>
                {cmds.map(cmd => (
                  <CmdItem
                    key={cmd.name}
                    label={`/${cmd.name}`}
                    enabled={cmd.enabled}
                    active={selected?.type === 'slash' && selected.name === cmd.name}
                    onClick={() => select({ type: 'slash', name: cmd.name })}
                  />
                ))}
              </div>
            );
          })}

          {filteredCustom.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-1 mb-1">
                <MessageSquareCode className="w-3 h-3 text-indigo-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Personnalisées</span>
              </div>
              {filteredCustom.map(cmd => (
                <CmdItem
                  key={cmd.id}
                  label={cmd.trigger}
                  enabled={cmd.enabled}
                  active={selected?.type === 'custom' && selected.id === cmd.id}
                  onClick={() => select({ type: 'custom', id: cmd.id, trigger: cmd.trigger })}
                />
              ))}
            </div>
          )}

          {!slashLoading && filteredGroups.length === 0 && filteredCustom.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Aucun résultat</p>
          )}
        </div>
      </aside>

      {/* ── Right: diagnostic panel ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {!selected && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center">
              <Zap className="w-7 h-7 text-indigo-500" />
            </div>
            <h2 className="text-lg font-semibold">Sélectionnez une commande</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              Choisissez une commande slash ou personnalisée dans la liste pour afficher son diagnostic complet.
            </p>
          </div>
        )}

        {selected && (
          <div className="p-6 max-w-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Dernière analyse à {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-1.5 h-7 text-xs">
                <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                Relancer
              </Button>
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <p className="text-sm">Analyse en cours…</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {diag && !loading && <DiagPanel diag={diag} />}
          </div>
        )}
      </main>
    </div>
  );
}
