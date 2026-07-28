import { useGetLogs, getGetLogsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { formatTimestamp } from '@/lib/utils';

const LEVEL_STYLE: Record<string, string> = {
  INFO: 'bg-blue-50 text-blue-700 border-blue-200',
  WARN: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  WARNING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  ERROR: 'bg-red-50 text-red-700 border-red-200',
};

export default function Logs() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useGetLogs(
    { limit: 100 },
    { query: { refetchInterval: 5000, queryKey: getGetLogsQueryKey({ limit: 100 }) } }
  );

  useEffect(() => {
    const id = setInterval(() => queryClient.invalidateQueries({ queryKey: getGetLogsQueryKey({ limit: 100 }) }), 5000);
    return () => clearInterval(id);
  }, [queryClient]);

  const sorted = [...logs].reverse();

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live bot activity feed — refreshes every 5 seconds</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-muted-foreground">Live</span>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading && (
          <div className="py-10 text-center text-muted-foreground text-sm">Loading logs…</div>
        )}
        {!isLoading && sorted.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">No log entries yet.</div>
        )}
        {!isLoading && sorted.length > 0 && (
          <div className="divide-y divide-card-border">
            {sorted.map((log) => (
              <div key={log.id} className="flex items-start gap-4 px-5 py-3 hover:bg-muted/20 transition-colors">
                <span className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border font-mono tracking-wide ${LEVEL_STYLE[log.level] ?? LEVEL_STYLE.INFO}`}>
                  {log.level}
                </span>
                <span className="flex-1 text-sm font-mono break-all">{log.message}</span>
                <span className="flex-shrink-0 text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                  {formatTimestamp(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isLoading && sorted.length > 0 && (
        <p className="text-xs text-muted-foreground">{sorted.length} entries — showing most recent first</p>
      )}
    </div>
  );
}
