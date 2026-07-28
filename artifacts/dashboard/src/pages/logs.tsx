import { useEffect } from 'react';
import { useGetLogs, getGetLogsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const LOG_LEVEL_COLORS = {
  INFO: 'bg-green-500/10 text-green-600 border-green-500/20',
  WARN: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  ERROR: 'bg-red-500/10 text-red-600 border-red-500/20',
  DEBUG: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
};

export default function Logs() {
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useGetLogs(
    { limit: 200 },
    { query: { queryKey: getGetLogsQueryKey({ limit: 200 }) } }
  );

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetLogsQueryKey({ limit: 200 }) });
    }, 5000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const formatLogTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="p-8 space-y-6 h-screen flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live bot activity feed (auto-refreshes every 5s)
        </p>
      </div>

      <div className="flex-1 bg-card border border-card-border rounded-lg overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-2 font-mono text-sm">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading logs...</div>
            ) : logs && logs.length > 0 ? (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2 rounded hover:bg-muted/30 transition-colors"
                  data-testid={`log-${log.id}`}
                >
                  <span className="text-muted-foreground text-xs shrink-0 mt-0.5">
                    {formatLogTime(log.createdAt)}
                  </span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-bold border shrink-0',
                      LOG_LEVEL_COLORS[log.level as keyof typeof LOG_LEVEL_COLORS] || 'bg-muted text-muted-foreground'
                    )}
                  >
                    {log.level}
                  </span>
                  <span className="flex-1 break-words">{log.message}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No logs available
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
