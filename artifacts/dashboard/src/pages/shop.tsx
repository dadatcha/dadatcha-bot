import { useState } from 'react';
import {
  useListShopItems, useCreateShopItem, useUpdateShopItem, useDeleteShopItem,
  getListShopItemsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow } from '@/components/ui/field-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShoppingBag, Plus, Trash2, GripVertical } from 'lucide-react';
import { useGetEconomyConfig } from '@workspace/api-client-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Item = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  roleId: string | null;
  emoji: string;
  enabled: boolean;
  position: number;
  createdAt: string;
};

type DraftItem = {
  name: string;
  description: string;
  price: number;
  roleId: string;
  emoji: string;
  enabled: boolean;
};

// ── Item card ──────────────────────────────────────────────────────────────────

function ItemCard({ item, currency, onSaved, onDeleted }: {
  item: Item;
  currency: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateShopItem();
  const del = useDeleteShopItem();

  const [form, setForm] = useState<DraftItem>({
    name: item.name,
    description: item.description ?? '',
    price: item.price,
    roleId: item.roleId ?? '',
    emoji: item.emoji,
    enabled: item.enabled,
  });
  const [saved, setSaved] = useState<DraftItem>({ ...form });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const p = (u: Partial<DraftItem>) => setForm(f => ({ ...f, ...u }));

  function save() {
    update.mutate(
      {
        id: item.id,
        data: {
          name: form.name,
          description: form.description || undefined,
          price: form.price,
          roleId: form.roleId || undefined,
          emoji: form.emoji || '🛍️',
          enabled: form.enabled,
          position: item.position,
        },
      },
      {
        onSuccess: () => { setSaved({ ...form }); toast({ title: 'Saved' }); onSaved(); },
        onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
      }
    );
  }

  function remove() {
    del.mutate(
      { id: item.id },
      {
        onSuccess: () => { toast({ title: 'Item deleted' }); onDeleted(); },
        onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
      }
    );
  }

  const deleteBtn = (
    <Button
      size="sm" variant="ghost"
      className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
      onClick={remove}
      disabled={del.isPending}
      title="Delete item"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  );

  return (
    <ModuleCard
      title={`${form.emoji} ${form.name}`}
      description={form.description || `Price: ${form.price.toLocaleString()} ${currency}`}
      icon={ShoppingBag}
      iconColor="text-violet-500"
      enabled={form.enabled}
      onToggle={(v) => p({ enabled: v })}
      onSave={save}
      saving={update.isPending}
      dirty={dirty}
      extra={deleteBtn}
    >
      <FieldRow label="Emoji" hint="Shown next to the item name in Discord.">
        <Input
          value={form.emoji}
          onChange={e => p({ emoji: e.target.value })}
          placeholder="🛍️"
          className="w-24 text-center text-lg"
        />
      </FieldRow>
      <FieldRow label="Name">
        <Input value={form.name} onChange={e => p({ name: e.target.value })} placeholder="Item name" />
      </FieldRow>
      <FieldRow label="Description" hint="Optional — shown in /shop.">
        <Input value={form.description} onChange={e => p({ description: e.target.value })} placeholder="What does this item do?" />
      </FieldRow>
      <FieldRow label="Price" hint={`Cost in ${currency}.`}>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={form.price}
            onChange={e => p({ price: Math.max(0, parseInt(e.target.value) || 0) })}
            className="w-32 font-mono text-right"
          />
          <span className="text-sm text-muted-foreground">{currency}</span>
        </div>
      </FieldRow>
      <FieldRow label="Role ID" hint="Discord role ID to grant on purchase. Leave empty for no role.">
        <Input
          value={form.roleId}
          onChange={e => p({ roleId: e.target.value })}
          placeholder="e.g. 1234567890123456789"
          className="font-mono text-sm"
        />
      </FieldRow>
    </ModuleCard>
  );
}

// ── New item form ──────────────────────────────────────────────────────────────

function NewItemForm({ currency, onCreated, onCancel }: {
  currency: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateShopItem();
  const [form, setForm] = useState<DraftItem>({
    name: '',
    description: '',
    price: 100,
    roleId: '',
    emoji: '🛍️',
    enabled: true,
  });
  const p = (u: Partial<DraftItem>) => setForm(f => ({ ...f, ...u }));

  function submit() {
    if (!form.name.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    create.mutate(
      {
        data: {
          name: form.name.trim(),
          description: form.description || undefined,
          price: form.price,
          roleId: form.roleId || undefined,
          emoji: form.emoji || '🛍️',
          enabled: form.enabled,
        },
      },
      {
        onSuccess: () => { toast({ title: 'Item created' }); onCreated(); },
        onError: () => toast({ title: 'Create failed', variant: 'destructive' }),
      }
    );
  }

  return (
    <div className="bg-card border border-indigo-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">New item</h3>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 px-2 text-muted-foreground">Cancel</Button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-center">
        <span className="text-sm font-medium">Emoji</span>
        <Input value={form.emoji} onChange={e => p({ emoji: e.target.value })} placeholder="🛍️" className="w-24 text-center text-lg" />
        <span className="text-sm font-medium">Name <span className="text-red-500">*</span></span>
        <Input value={form.name} onChange={e => p({ name: e.target.value })} placeholder="Item name" />
        <span className="text-sm font-medium">Description</span>
        <Input value={form.description} onChange={e => p({ description: e.target.value })} placeholder="Optional" />
        <span className="text-sm font-medium">Price</span>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} value={form.price} onChange={e => p({ price: Math.max(0, parseInt(e.target.value) || 0) })} className="w-32 font-mono text-right" />
          <span className="text-sm text-muted-foreground">{currency}</span>
        </div>
        <span className="text-sm font-medium">Role ID</span>
        <Input value={form.roleId} onChange={e => p({ roleId: e.target.value })} placeholder="Discord role ID (optional)" className="font-mono text-sm" />
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Plus className="w-4 h-4" /> Create item
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Shop() {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useListShopItems({
    query: { queryKey: getListShopItemsQueryKey() },
  });
  const { data: cfg } = useGetEconomyConfig();
  const currency = (cfg as any)?.currencyName ?? 'coins';
  const [adding, setAdding] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListShopItemsQueryKey() });
  }

  const sorted = [...items].sort((a, b) => a.position - b.position || a.id - b.id);

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shop</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Items players can buy with <span className="font-medium">{currency}</span> using <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/shop</span> and <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/buy</span>
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} className="gap-2 flex-shrink-0">
            <Plus className="w-4 h-4" /> Add item
          </Button>
        )}
      </div>

      {adding && (
        <NewItemForm
          currency={currency}
          onCreated={() => { setAdding(false); refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {!isLoading && sorted.length === 0 && !adding && (
        <div className="py-16 text-center">
          <ShoppingBag className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No items yet. Add your first shop item.</p>
        </div>
      )}

      <div className="space-y-4">
        {sorted.map(item => (
          <ItemCard
            key={item.id}
            item={item as Item}
            currency={currency}
            onSaved={refresh}
            onDeleted={refresh}
          />
        ))}
      </div>
    </div>
  );
}
