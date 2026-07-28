import { useState, useEffect } from 'react';
import {
  useGetEconomyConfig, useUpdateEconomyConfig, getGetEconomyConfigQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow, NumberField } from '@/components/ui/field-row';
import { Spade, Dices, ArrowUpDown } from 'lucide-react';

type Cfg = {
  blackjackEnabled: boolean; blackjackMaxBet: number;
  rouletteEnabled: boolean; rouletteMaxBet: number;
  hlEnabled: boolean;
};

export default function Games() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: remote } = useGetEconomyConfig({ query: { queryKey: getGetEconomyConfigQueryKey() } });
  const update = useUpdateEconomyConfig();

  const [form, setForm] = useState<Cfg | null>(null);
  const [saved, setSaved] = useState<Cfg | null>(null);

  useEffect(() => {
    if (remote && !form) {
      const v: Cfg = {
        blackjackEnabled: remote.blackjackEnabled,
        blackjackMaxBet: remote.blackjackMaxBet,
        rouletteEnabled: remote.rouletteEnabled,
        rouletteMaxBet: remote.rouletteMaxBet,
        hlEnabled: remote.hlEnabled,
      };
      setForm(v); setSaved(v);
    }
  }, [remote]);

  const p = (u: Partial<Cfg>) => setForm(f => f ? { ...f, ...u } : null);
  const dirty = form && saved ? JSON.stringify(form) !== JSON.stringify(saved) : false;

  function saveModule(fields: Partial<Cfg>) {
    update.mutate(
      { data: fields as Parameters<typeof update.mutate>[0]['data'] },
      {
        onSuccess: (data) => {
          const v: Cfg = {
            blackjackEnabled: data.blackjackEnabled,
            blackjackMaxBet: data.blackjackMaxBet,
            rouletteEnabled: data.rouletteEnabled,
            rouletteMaxBet: data.rouletteMaxBet,
            hlEnabled: data.hlEnabled,
          };
          setForm(v); setSaved(v);
          queryClient.invalidateQueries({ queryKey: getGetEconomyConfigQueryKey() });
          toast({ title: 'Saved' });
        },
        onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
      }
    );
  }

  if (!form) return <div className="p-8 py-12 text-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Games</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure coin-based mini-games</p>
      </div>

      <div className="space-y-4">
        <ModuleCard
          title="/blackjack"
          description="Card game: bet coins and try to beat the dealer without busting. Hit or Stand buttons."
          icon={Spade} iconColor="text-zinc-700"
          enabled={form.blackjackEnabled}
          onToggle={(v) => p({ blackjackEnabled: v })}
          onSave={() => saveModule({ blackjackEnabled: form.blackjackEnabled, blackjackMaxBet: form.blackjackMaxBet })}
          saving={update.isPending} dirty={dirty}>
          <FieldRow label="Maximum bet" hint="Highest amount a player can wager per game.">
            <NumberField value={form.blackjackMaxBet} onChange={(v) => p({ blackjackMaxBet: v })} min={1} suffix="coins" />
          </FieldRow>
        </ModuleCard>

        <ModuleCard
          title="/roulette"
          description="Spin the wheel. Bet on Red (2×), Black (2×), or Green/0 (14×)."
          icon={Dices} iconColor="text-red-500"
          enabled={form.rouletteEnabled}
          onToggle={(v) => p({ rouletteEnabled: v })}
          onSave={() => saveModule({ rouletteEnabled: form.rouletteEnabled, rouletteMaxBet: form.rouletteMaxBet })}
          saving={update.isPending} dirty={dirty}>
          <FieldRow label="Maximum bet" hint="Highest amount a player can wager per spin.">
            <NumberField value={form.rouletteMaxBet} onChange={(v) => p({ rouletteMaxBet: v })} min={1} suffix="coins" />
          </FieldRow>
        </ModuleCard>

        <ModuleCard
          title="/higher-lower"
          description="Guess whether the next random number (1–100) is higher or lower. Build a streak."
          icon={ArrowUpDown} iconColor="text-purple-500"
          enabled={form.hlEnabled}
          onToggle={(v) => p({ hlEnabled: v })}
          onSave={() => saveModule({ hlEnabled: form.hlEnabled })}
          saving={update.isPending} dirty={dirty}>
          <p className="text-xs text-muted-foreground">No additional configuration for this game.</p>
        </ModuleCard>
      </div>
    </div>
  );
}
