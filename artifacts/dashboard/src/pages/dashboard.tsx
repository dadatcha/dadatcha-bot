import { useGetBotStatus, getGetBotStatusQueryKey } from '@workspace/api-client-react';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatUptime, formatRelativeTime } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useGetBotStatus({
    query: {
      refetchInterval: 5000,
      queryKey: getGetBotStatusQueryKey(),
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    }, 5000);
    return () => clearInterval(interval);
  }, [queryClient]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bot status and activity overview
          </p>
        </div>
        <StatusBadge 
          status={status?.connected ? 'online' : 'offline'} 
          data-testid="status-badge"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Bot Name"
          value={status?.botName || 'Not connected'}
          loading={isLoading}
          mono
          data-testid="stat-botname"
        />
        <StatCard
          label="Bot ID"
          value={status?.botId || '—'}
          loading={isLoading}
          mono
          className="font-mono text-xs"
          data-testid="stat-botid"
        />
        <StatCard
          label="Uptime"
          value={formatUptime(status?.uptimeSeconds ?? null)}
          loading={isLoading}
          mono
          data-testid="stat-uptime"
        />
        <StatCard
          label="Reminders Today"
          value={status?.remindersSentToday ?? 0}
          loading={isLoading}
          valueClassName="text-primary"
          data-testid="stat-reminders"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          label="Last Reminder"
          value={formatRelativeTime(status?.lastReminderAt ?? null)}
          loading={isLoading}
          data-testid="stat-last-reminder"
        />
        <StatCard
          label="Last Seen"
          value={formatRelativeTime(status?.lastSeenAt ?? null)}
          loading={isLoading}
          data-testid="stat-last-seen"
        />
      </div>

      {!status?.connected && !isLoading && (
        <div className="bg-card border border-destructive/50 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-destructive mt-1.5" />
            <div>
              <h3 className="font-semibold text-destructive">Bot Offline</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The bot is not currently connected to Discord. Start the bot process to enable monitoring.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
