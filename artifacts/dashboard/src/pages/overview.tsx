import { useState } from 'react';
import { useGetBotStatus } from '@workspace/api-client-react';
import { formatUptime, formatRelativeTime } from '@/lib/utils';
import { Activity, Clock, Bell, Wifi, WifiOff, Hash, Bot, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { getApiBase } from '@/lib/api-url';
const BASE = getApiBase();

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

export default function Overview() {
  const { data: s, isLoading } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

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

  return (
    <div className="p-8 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live status of your Discord bot</p>
        </div>
        <div className="flex items-center gap-3">
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestart}
            disabled={restarting}
            className="gap-2"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? 'Redémarrage…' : 'Redémarrer le bot'}
          </Button>
        </div>
      </div>

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

      {/* Offline banner */}
      {!isLoading && !s?.connected && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
          <WifiOff className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-700">Bot is offline</p>
            <p className="text-sm text-zinc-500 mt-0.5">
              The bot is not sending heartbeats. Make sure the "Lotto Discord Bot" workflow is running.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
