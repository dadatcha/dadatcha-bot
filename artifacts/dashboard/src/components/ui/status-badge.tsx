import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: 'online' | 'offline';
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const isOnline = status === 'online';
  
  return (
    <div className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-medium', className)}>
      <div className={cn(
        'w-2 h-2 rounded-full',
        isOnline ? 'bg-green-500 animate-pulse-subtle' : 'bg-muted-foreground'
      )} />
      {isOnline ? 'ONLINE' : 'OFFLINE'}
    </div>
  );
}
