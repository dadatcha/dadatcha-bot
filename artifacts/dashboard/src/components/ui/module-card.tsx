import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModuleCardProps = {
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor?: string;
  enabled: boolean;
  onToggle: (val: boolean) => void;
  onSave: () => void;
  saving?: boolean;
  dirty?: boolean;
  children?: React.ReactNode;
};

export function ModuleCard({
  title, description, icon: Icon, iconColor = 'text-indigo-500',
  enabled, onToggle, onSave, saving = false, dirty = false, children,
}: ModuleCardProps) {
  return (
    <div className={cn(
      'rounded-xl border bg-card transition-opacity',
      !enabled && 'opacity-60'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-card-border">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 p-2 rounded-lg bg-muted', iconColor)}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">{description}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>

      {/* Body */}
      {children && (
        <div className={cn('p-5 space-y-4', !enabled && 'pointer-events-none select-none')}>
          {children}
        </div>
      )}

      {/* Footer */}
      <div className={cn(
        'flex items-center justify-end px-5 py-3 border-t border-card-border',
        !children && 'rounded-b-xl'
      )}>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !dirty}
          className="gap-1.5 h-8 text-xs"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
