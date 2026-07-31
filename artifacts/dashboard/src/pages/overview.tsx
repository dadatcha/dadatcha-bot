import { useState, useEffect, useRef, useCallback } from 'react';
import { useGetBotStatus } from '@workspace/api-client-react';
import { formatUptime, formatRelativeTime } from '@/lib/utils';
import {
  Activity, Clock, Bell, Wifi, WifiOff, Hash, Bot,
  RotateCcw, RefreshCw, CheckCircle2, XCircle, Loader2, Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import { getApiBase } from '@/lib/api-url';
const BASE = getApiBase();

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = 'idle' | 'pending' | 'running' | 'done' | 'error';

interface SyncJob {
  status: SyncStatus;
  requestedAt: string | null;
  completedAt: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ label, value, icon: Icon, accent = false }: {
  label: string; value: React.ReactNode; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${accent ? 'bg-indigo-50 text-indigo-600' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-xl font-bold font-mono">{value}</p>
      </div>
    </div>
  );
}

const SYNC_LABELS: Record<SyncStatus, string> = {
  idle:    'Synchroniser avec Discord',
  pending: 'En attente…',
  running: 'Synchronisation…',
  done:    'Synchronisé ✓',
  error:   'Erreur — Réessayer',
};

const SYNC_ICONS: Record<SyncStatus, React.ElementType> = {
  idle:    RefreshCw,
  pending: Loader2,
  running: Loader2,
  done:    CheckCircle2,
  error:   XCircle,
};

function SyncStatusBadge({ job }: { job: SyncJob | null }) {
  if (!job || job.status === 'idle') return null;

  const colours: Record<SyncStatus, string> = {
    idle:    '',
    pending: 'bg-amber-50 border-amber-200 text-amber-700',
    running: 'bg-blue-50 border-blue-200 text-blue-700',
    done:    'bg-green-50 border-green-200 text-green-700',
    error:   'bg-red-50 border-red-200 text-red-700',
  };

  const msgs: Record<SyncStatus, string> = {
    idle:    '',
    pending: "La synchronisation est en file d'attente — le bot va la prendre en charge.",
    running: "Synchronisation des commandes avec l'API Discord en cours\u2026",
    done:    'Les commandes slash sont à jour sur Discord.',
    error:   "La synchronisation a échoué. Vérifiez que le bot est en ligne et réessayez.",
  };

  return (
    <div className={`text-sm px-4 py-3 rounded-lg border ${colours[job.status]}`}>
      {msgs[job.status]}
      {job.completedAt && (
        <span className="ml-2 text-xs opacity-60">
          {new Date(job.completedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Overview() {
  const { data: s, isLoading } = useGetBotStatus({ query: { refetchInterval: 5000 } });

  // Restart
  const [restarting, setRestarting]   = useState(false);
  const [restartMsg, setRestartMsg]   = useState<string | null>(null);

  // Sync
  const [syncing, setSyncing]         = useState(false);
  const [syncJob, setSyncJob]         = useState<SyncJob | null>(null);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollSync = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/command-sync`);
      if (!r.ok) return;
      const job: SyncJob = await r.json();
      setSyncJob(job);
      if (job.status === 'done' || job.status === 'error') {
        stopPoll();
        setSyncing(false);
      }
    } catch { /* ignore transient errors */ }
  }, [stopPoll]);

  // Kick off polling whenever we enter an active state
  useEffect(() => {
    if (syncing) {
      stopPoll();
      pollRef.current = setInterval(pollSync, 1500);
    }
    return stopPoll;
  }, [syncing, pollSync, stopPoll]);

  // Also fetch initial sync state on mount
  useEffect(() => {
    fetch(`${BASE}/api/command-sync`)
      .then(r => r.ok ? r.json() : null)
      .then((job: SyncJob | null) => { if (job) setSyncJob(job); })
      .catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncJob(null);
    try {
      const r = await fetch(`${BASE}/api/command-sync`, { method: 'POST' });
      if (r.ok) {
        const job: SyncJob = await r.json();
        setSyncJob(job);
      } else {
        setSyncJob({ status: 'error', requestedAt: null, completedAt: null });
        setSyncing(false);
      }
    } catch {
      setSyncJob({ status: 'error', requestedAt: null, completedAt: null });
      setSyncing(false);
    }
  }

  async function handleRestart() {
    setRestarting(true);
    setRestartMsg(null);
    try {
      const resp = await fetch(`${BASE}/api/bot/restart`, { method: 'POST' });
      if (resp.ok) {
        setRestartMsg('✅ Redémarrage demandé — le bot va se relancer sous 30 s.');
      } else {
        setRestartMsg('❌ Erreur lors de la demande de redémarrage.');
      }
    } catch {
      setRestartMsg('❌ Impossible de contacter le serveur.');
    } finally {
      setRestarting(false);
    }
  }

  const syncStatus: SyncStatus = syncing
    ? (syncJob?.status ?? 'pending')
    : (syncJob?.status ?? 'idle');

  const SyncIcon = SYNC_ICONS[syncStatus];
  const isActiveSyncing = syncStatus === 'pending' || syncStatus === 'running';

  return (
    <div className="p-8 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live status of your Discord bot</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isLoading && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${
              s?.connected
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-zinc-50 border-zinc-200 text-zinc-500'
            }`}>
              {s?.connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {s?.connected ? 'Online' : 'Offline'}
            </div>
          )}

          {/* ── Sync button ── */}
          <Button
            variant={syncStatus === 'done' ? 'default' : syncStatus === 'error' ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleSync}
            disabled={isActiveSyncing}
            className="gap-2"
          >
            <SyncIcon className={`w-3.5 h-3.5 ${isActiveSyncing ? 'animate-spin' : ''}`} />
            {SYNC_LABELS[syncStatus]}
          </Button>

          {/* ── Restart button ── */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestart}
            disabled={restarting}
            className="gap-2"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? 'Redémarrage…' : 'Redémarrer'}
          </Button>
        </div>
      </div>

      {/* Sync status banner */}
      <SyncStatusBadge job={syncJob} />

      {/* Restart feedback */}
      {restartMsg && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${
          restartMsg.startsWith('✅')
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {restartMsg}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatTile
          label="Bot Name"
          value={isLoading ? '…' : (s?.botName ?? '—')}
          icon={Bot}
        />
        <StatTile
          label="Uptime"
          value={isLoading ? '…' : formatUptime(s?.uptimeSeconds ?? null)}
          icon={Clock}
          accent
        />
        <StatTile
          label="Reminders Today"
          value={isLoading ? '…' : (s?.remindersSentToday ?? 0)}
          icon={Bell}
          accent
        />
        <StatTile
          label="Bot ID"
          value={<span className="text-sm">{isLoading ? '…' : (s?.botId ?? '—')}</span>}
          icon={Hash}
        />
        <StatTile
          label="Last Reminder"
          value={<span className="text-sm">{isLoading ? '…' : formatRelativeTime(s?.lastReminderAt ?? null)}</span>}
          icon={Activity}
        />
        <StatTile
          label="Last Heartbeat"
          value={<span className="text-sm">{isLoading ? '…' : formatRelativeTime(s?.lastSeenAt ?? null)}</span>}
          icon={Activity}
        />
      </div>

      {/* Sync flow explanation */}
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="w-4 h-4 text-indigo-500" />
          Comment fonctionne la synchronisation
        </div>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Cliquez <strong>Synchroniser avec Discord</strong> — l'API passe en état <em>pending</em>.</li>
          <li>Le bot détecte le changement lors de son prochain heartbeat (~10 s) et lance <code>tree.sync()</code>.</li>
          <li>Les commandes slash apparaissent dans Discord en moins d'une minute.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          La synchronisation est aussi déclenchée automatiquement à chaque modification de commande depuis le dashboard.
        </p>
      </div>

      {/* Offline banner */}
      {!isLoading && !s?.connected && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
          <WifiOff className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-700">Bot is offline</p>
            <p className="text-sm text-zinc-500 mt-0.5">
              Le bot n'envoie pas de heartbeats. Vérifiez que le workflow "Lotto Discord Bot" est actif
              et que la variable <code>API_BASE</code> pointe vers <code>https://dadatcha-api.onrender.com/api</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
