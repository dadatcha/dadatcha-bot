import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number | null;
  className?: string;
  valueClassName?: string;
  mono?: boolean;
  loading?: boolean;
}

export function StatCard({ label, value, className, valueClassName, mono = false, loading = false }: StatCardProps) {
  return (
    <div className={cn('bg-card border border-card-border rounded-lg p-4', className)}>
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className={cn(
        'text-2xl font-bold text-card-foreground',
        mono && 'font-mono',
        valueClassName
      )}>
        {loading ? (
          <div className="h-8 w-24 bg-muted animate-pulse rounded" />
        ) : (
          value ?? '—'
        )}
      </div>
    </div>
  );
}
