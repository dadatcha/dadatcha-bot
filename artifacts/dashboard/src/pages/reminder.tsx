import { useState } from 'react';
import {
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDeleteReminder,
  getListRemindersQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow, NumberField } from '@/components/ui/field-row';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Bell, Plus, Trash2 } from 'lucide-react';

// ── types ──────────────────────────────────────────────────────────────────

type ReminderDraft = {
  name: string;
  channelId: string;
  enabled: boolean;
  intervalMinutes: number;
  message: string;
};

type RemoteReminder = ReminderDraft & { id: number; createdAt: string; updatedAt: string };

// ── per-card component ─────────────────────────────────────────────────────

function ReminderCard({ reminder, onDeleted }: { reminder: RemoteReminder; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateReminder();
  const del = useDeleteReminder();

  const [form, setForm] = useState<ReminderDraft>({
    name: reminder.name,
    channelId: reminder.channelId,
    enabled: reminder.enabled,
    intervalMinutes: reminder.intervalMinutes,
    message: reminder.message,
  });
  const [saved, setSaved] = useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const p = (u: Partial<ReminderDraft>) => setForm(f => ({ ...f, ...u }));

  function save() {
    update.mutate(
      { id: reminder.id, data: form },
      {
        onSuccess: () => {
          setSaved(form);
          qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
          toast({ title: `"${form.name}" saved` });
        },
        onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
      },
    );
  }

  function remove() {
    if (!confirm(`Delete reminder "${reminder.name}"?`)) return;
    del.mutate(
      { id: reminder.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
          onDeleted();
          toast({ title: `"${reminder.name}" deleted` });
        },
        onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
      },
    );
  }

  return (
    <ModuleCard
      title={form.name}
      description={`Channel ${form.channelId || '—'}  ·  every ${form.intervalMinutes} min`}
      icon={Bell}
      iconColor="text-yellow-500"
      enabled={form.enabled}
      onToggle={v => p({ enabled: v })}
      onSave={save}
      saving={update.isPending}
      dirty={dirty}
      extra={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={remove}
          disabled={del.isPending}
          title="Delete reminder"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      }
    >
      <div className="space-y-5">
        <FieldRow label="Name" hint="Friendly label shown in the dashboard.">
          <Input value={form.name} onChange={e => p({ name: e.target.value })} placeholder="Reminder name" />
        </FieldRow>

        <FieldRow label="Channel ID" hint="Discord channel where reminders are posted.">
          <Input
            value={form.channelId}
            onChange={e => p({ channelId: e.target.value })}
            placeholder="Channel ID"
            className="font-mono text-sm"
          />
        </FieldRow>

        <FieldRow label="Interval" hint="How often (in minutes) the bot checks.">
          <NumberField
            value={form.intervalMinutes}
            onChange={v => p({ intervalMinutes: v })}
            min={1}
            suffix="min"
          />
        </FieldRow>

        <div className="space-y-2">
          <p className="text-sm font-medium leading-none">Reminder message</p>
          <p className="text-xs text-muted-foreground">
            Sent when the last message in the channel is not from the bot.
          </p>
          <Textarea
            value={form.message}
            onChange={e => p({ message: e.target.value })}
            rows={7}
            className="font-mono text-sm resize-none"
            placeholder="Enter reminder message…"
          />
        </div>
      </div>
    </ModuleCard>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

const DEFAULT_MESSAGE = `Here is the lotto channel.
You can play many games to win money.
Here are all the commands:
/blackjack
/higher-lower
/roulette

Many other commands are available in the #cmds🤖

/balance /crime /deposit /withdraw /work
And more!`;

export default function Reminder() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: reminders = [], isLoading } = useListReminders();
  const create = useCreateReminder();

  function addReminder() {
    create.mutate(
      {
        data: {
          name: `Reminder ${(reminders.length ?? 0) + 1}`,
          channelId: '',
          enabled: true,
          intervalMinutes: 60,
          message: DEFAULT_MESSAGE,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
          toast({ title: 'New reminder added' });
        },
        onError: () => toast({ title: 'Could not add reminder', variant: 'destructive' }),
      },
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reminders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatic lotto channel reminders — each runs independently.
          </p>
        </div>
        <Button onClick={addReminder} disabled={create.isPending} className="gap-2">
          <Plus className="h-4 w-4" />
          Add reminder
        </Button>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {!isLoading && reminders.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          No reminders yet. Click <strong>Add reminder</strong> to create one.
        </div>
      )}

      <div className="space-y-4">
        {reminders.map(r => (
          <ReminderCard
            key={r.id}
            reminder={r as RemoteReminder}
            onDeleted={() => qc.invalidateQueries({ queryKey: getListRemindersQueryKey() })}
          />
        ))}
      </div>
    </div>
  );
}
