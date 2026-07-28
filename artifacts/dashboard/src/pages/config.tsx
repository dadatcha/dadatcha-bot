import { useState, useEffect } from 'react';
import { useGetBotConfig, useUpdateBotConfig, getGetBotConfigQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Config() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: config, isLoading } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey() },
  });
  const updateConfig = useUpdateBotConfig();

  const [form, setForm] = useState({
    channelId: '',
    reminderEnabled: false,
    reminderIntervalMinutes: 60,
    reminderMessage: '',
  });

  useEffect(() => {
    if (config) {
      setForm({
        channelId: config.channelId,
        reminderEnabled: config.reminderEnabled,
        reminderIntervalMinutes: config.reminderIntervalMinutes,
        reminderMessage: config.reminderMessage,
      });
    }
  }, [config]);

  const handleSave = () => {
    updateConfig.mutate(
      { data: form },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
          toast({ title: 'Configuration saved' });
        },
        onError: () => {
          toast({ title: 'Failed to save configuration', variant: 'destructive' });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bot settings and reminder configuration
        </p>
      </div>

      <div className="bg-card border border-card-border rounded-lg p-6 space-y-6 max-w-2xl">
        <div className="space-y-2">
          <Label htmlFor="channelId" className="text-sm font-mono uppercase tracking-wider">
            Channel ID
          </Label>
          <Input
            id="channelId"
            value={form.channelId}
            onChange={(e) => setForm({ ...form, channelId: e.target.value })}
            placeholder="Discord channel ID"
            className="font-mono"
            data-testid="input-channel-id"
          />
          <p className="text-xs text-muted-foreground">
            The Discord channel where reminders will be sent
          </p>
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label htmlFor="reminderEnabled" className="text-sm font-mono uppercase tracking-wider">
              Reminders Enabled
            </Label>
            <p className="text-xs text-muted-foreground">
              Toggle automatic reminder messages
            </p>
          </div>
          <Switch
            id="reminderEnabled"
            checked={form.reminderEnabled}
            onCheckedChange={(checked) => setForm({ ...form, reminderEnabled: checked })}
            data-testid="toggle-reminders"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="interval" className="text-sm font-mono uppercase tracking-wider">
            Reminder Interval (minutes)
          </Label>
          <Input
            id="interval"
            type="number"
            value={form.reminderIntervalMinutes}
            onChange={(e) => setForm({ ...form, reminderIntervalMinutes: Number(e.target.value) })}
            placeholder="60"
            min="1"
            data-testid="input-interval"
          />
          <p className="text-xs text-muted-foreground">
            How often to send reminder messages
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message" className="text-sm font-mono uppercase tracking-wider">
            Reminder Message
          </Label>
          <Textarea
            id="message"
            value={form.reminderMessage}
            onChange={(e) => setForm({ ...form, reminderMessage: e.target.value })}
            placeholder="Enter your reminder message here..."
            rows={6}
            className="font-mono text-sm"
            data-testid="textarea-message"
          />
          <p className="text-xs text-muted-foreground">
            The message content that will be sent to the channel
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="w-full"
          data-testid="button-save-config"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateConfig.isPending ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}
