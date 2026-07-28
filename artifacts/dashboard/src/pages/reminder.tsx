import { useState, useEffect } from 'react';
import { useGetBotConfig, useUpdateBotConfig, getGetBotConfigQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow, NumberField } from '@/components/ui/field-row';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Bell, Hash } from 'lucide-react';

export default function Reminder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: remote } = useGetBotConfig({ query: { queryKey: getGetBotConfigQueryKey() } });
  const update = useUpdateBotConfig();

  const [form, setForm] = useState({ channelId: '', reminderEnabled: false, reminderIntervalMinutes: 1, reminderMessage: '' });
  const [saved, setSaved] = useState(form);

  useEffect(() => {
    if (remote) { setForm(remote); setSaved(remote); }
  }, [remote]);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const p = (u: Partial<typeof form>) => setForm(f => ({ ...f, ...u }));

  function save() {
    update.mutate(
      { data: form },
      {
        onSuccess: (data) => {
          setForm(data); setSaved(data);
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
          toast({ title: 'Reminder configuration saved' });
        },
        onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
      }
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reminder</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Automatic lotto channel reminders</p>
      </div>

      <ModuleCard
        title="Auto-reminder"
        description="Sends the reminder message to the configured channel whenever the last message wasn't from the bot."
        icon={Bell} iconColor="text-yellow-500"
        enabled={form.reminderEnabled}
        onToggle={(v) => p({ reminderEnabled: v })}
        onSave={save}
        saving={update.isPending}
        dirty={dirty}>

        <div className="space-y-5">
          <FieldRow label="Channel ID" hint="Discord channel where reminders are posted.">
            <Input
              value={form.channelId}
              onChange={e => p({ channelId: e.target.value })}
              placeholder="Channel ID"
              className="font-mono text-sm"
            />
          </FieldRow>

          <FieldRow label="Interval" hint="How often (in minutes) the bot checks.">
            <NumberField value={form.reminderIntervalMinutes} onChange={(v) => p({ reminderIntervalMinutes: v })} min={1} suffix="min" />
          </FieldRow>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Reminder message</Label>
            <p className="text-xs text-muted-foreground">This message is sent when the last channel message wasn't from the bot.</p>
            <Textarea
              value={form.reminderMessage}
              onChange={e => p({ reminderMessage: e.target.value })}
              rows={8}
              className="font-mono text-sm resize-none"
              placeholder="Enter reminder message…"
            />
          </div>
        </div>
      </ModuleCard>
    </div>
  );
}
