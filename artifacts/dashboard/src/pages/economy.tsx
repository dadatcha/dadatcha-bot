import { useState, useMemo } from 'react';
import {
  useListPlayers,
  useUpdatePlayerBalance,
  getListPlayersQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Check, X, Search, Coins } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

type Player = {
  userId: string;
  username: string;
  wallet: number;
  bank: number;
  total: number;
  lastDaily: string | null;
  lastWork: string | null;
  lastCrime: string | null;
  updatedAt: string;
};

type EditState = {
  userId: string;
  wallet: string;
  bank: string;
};

export default function Economy() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: players = [], isLoading } = useListPlayers({
    query: {
      refetchInterval: 10000,
      queryKey: getListPlayersQueryKey(),
    },
  });
  const updateBalance = useUpdatePlayerBalance();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);

  const sorted = useMemo(
    () => [...players].sort((a, b) => b.total - a.total),
    [players]
  );

  const filtered = useMemo(
    () =>
      search.trim()
        ? sorted.filter((p) =>
            p.username.toLowerCase().includes(search.toLowerCase())
          )
        : sorted,
    [sorted, search]
  );

  const totalCirculation = useMemo(
    () => players.reduce((sum, p) => sum + p.total, 0),
    [players]
  );

  const startEdit = (player: Player) => {
    setEditing({
      userId: player.userId,
      wallet: String(player.wallet),
      bank: String(player.bank),
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = () => {
    if (!editing) return;
    const wallet = parseInt(editing.wallet, 10);
    const bank = parseInt(editing.bank, 10);
    if (isNaN(wallet) || isNaN(bank) || wallet < 0 || bank < 0) {
      toast({ title: 'Invalid amount', variant: 'destructive' });
      return;
    }
    updateBalance.mutate(
      { userId: editing.userId, data: { wallet, bank } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          toast({ title: 'Balance updated' });
          setEditing(null);
        },
        onError: () => {
          toast({ title: 'Failed to update balance', variant: 'destructive' });
        },
      }
    );
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Economy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Player coin balances and admin controls
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Players"
          value={players.length}
          loading={isLoading}
          mono
        />
        <StatCard
          label="Coins in Circulation"
          value={isLoading ? '...' : totalCirculation.toLocaleString()}
          loading={isLoading}
          valueClassName="text-primary"
          mono
        />
        <StatCard
          label="Richest Player"
          value={
            isLoading || sorted.length === 0
              ? '—'
              : `${sorted[0].username} (${sorted[0].total.toLocaleString()})`
          }
          loading={isLoading}
        />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Filter by username..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 font-mono"
          data-testid="input-search"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-muted/40">
              <th className="px-4 py-3 text-left font-mono text-xs uppercase tracking-wider text-muted-foreground w-12">
                Rank
              </th>
              <th className="px-4 py-3 text-left font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Username
              </th>
              <th className="px-4 py-3 text-right font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Wallet
              </th>
              <th className="px-4 py-3 text-right font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Bank
              </th>
              <th className="px-4 py-3 text-right font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Total
              </th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  Loading players...
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {search ? 'No players match your search.' : 'No players yet.'}
                </td>
              </tr>
            )}
            {filtered.map((player, idx) => {
              const rank = sorted.indexOf(player) + 1;
              const isEditing = editing?.userId === player.userId;

              return (
                <tr
                  key={player.userId}
                  className="border-b border-card-border last:border-0 hover:bg-muted/20 transition-colors"
                  data-testid={`player-row-${player.userId}`}
                >
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {rank <= 3 ? (
                      <span className="text-primary font-bold">#{rank}</span>
                    ) : (
                      <span>#{rank}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{player.username}</td>

                  {isEditing ? (
                    <>
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Label className="text-xs text-muted-foreground font-mono sr-only">
                            Wallet
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            value={editing.wallet}
                            onChange={(e) =>
                              setEditing({ ...editing, wallet: e.target.value })
                            }
                            className="w-28 text-right font-mono text-sm h-8"
                            data-testid="input-wallet"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number"
                            min="0"
                            value={editing.bank}
                            onChange={(e) =>
                              setEditing({ ...editing, bank: e.target.value })
                            }
                            className="w-28 text-right font-mono text-sm h-8"
                            data-testid="input-bank"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {(
                          (parseInt(editing.wallet, 10) || 0) +
                          (parseInt(editing.bank, 10) || 0)
                        ).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={saveEdit}
                            disabled={updateBalance.isPending}
                            className="h-7 w-7 p-0 text-primary hover:text-primary"
                            data-testid="button-save-edit"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                            className="h-7 w-7 p-0 text-muted-foreground"
                            data-testid="button-cancel-edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {player.wallet.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {player.bank.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-primary">
                        {player.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(player)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          data-testid={`button-edit-${player.userId}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {players.length > 0 && (
        <p className="text-xs text-muted-foreground font-mono">
          {players.length} player{players.length !== 1 ? 's' : ''} registered
          {search && filtered.length !== players.length
            ? ` — ${filtered.length} shown`
            : ''}
        </p>
      )}
    </div>
  );
}
