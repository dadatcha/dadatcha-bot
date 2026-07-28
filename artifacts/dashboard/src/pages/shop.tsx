import { useState } from 'react';
import {
  useListShopItems, useCreateShopItem, useUpdateShopItem, useDeleteShopItem,
  getListShopItemsQueryKey, useGetEconomyConfig,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow } from '@/components/ui/field-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShoppingBag, Plus, Trash2, Package, Search, Gift, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type Item = {
  id: number; name: string; description: string | null; price: number;
  roleId: string | null; emoji: string; enabled: boolean; position: number; createdAt: string;
};

type DraftItem = {
  name: string; description: string; price: number; roleId: string; emoji: string; enabled: boolean;
};

type InventoryEntry = {
  id: number; userId: string; itemId: number; quantity: number;
  source: string; acquiredAt: string;
  item: { id: number; name: string; description: string | null; price: number; roleId: string | null; emoji: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sourceLabel(s: string) {
  if (s === 'buy') return { label: 'Achat', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (s === 'giveaway') return { label: 'Giveaway', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
  return { label: 'Admin', cls: 'bg-muted text-muted-foreground border-border' };
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Inventory panel ───────────────────────────────────────────────────────────

function InventoryPanel() {
  const [userId, setUserId] = useState('');
  const [searched, setSearched] = useState('');
  const [entries, setEntries] = useState<InventoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  async function search() {
    const uid = userId.trim();
    if (!uid) return;
    setLoading(true); setError(''); setEntries(null); setSearched(uid);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const r = await fetch(`${base}/api/inventory/${uid}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEntries(await r.json());
    } catch (e: any) {
      setError('Impossible de charger l\'inventaire.');
    } finally { setLoading(false); }
  }

  async function remove(id: number) {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      await fetch(`${base}/api/inventory/${id}`, { method: 'DELETE' });
      setEntries(prev => prev ? prev.filter(e => e.id !== id) : prev);
      toast({ title: 'Entrée supprimée' });
    } catch {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-violet-500" />
        <h2 className="font-semibold text-sm">Inventaires joueurs</h2>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="ID Discord du joueur"
          value={userId}
          onChange={e => setUserId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          className="font-mono text-sm flex-1"
        />
        <Button onClick={search} disabled={loading || !userId.trim()} className="gap-2 shrink-0">
          <Search className="w-4 h-4" />
          {loading ? 'Chargement…' : 'Rechercher'}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {entries !== null && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {entries.length === 0
              ? `Aucun item pour ${searched}`
              : `${entries.length} item${entries.length > 1 ? 's' : ''} · <@${searched}>`}
          </p>
          {entries.map(e => {
            const src = sourceLabel(e.source);
            return (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg shrink-0">{e.item?.emoji ?? '📦'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.item?.name ?? `Item #${e.itemId}`}</p>
                    <p className="text-xs text-muted-foreground">{fmt(e.acquiredAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.quantity > 1 && (
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">×{e.quantity}</span>
                  )}
                  <span className={cn('text-[10px] font-medium border rounded-full px-2 py-0.5', src.cls)}>{src.label}</span>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(e.id)}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Item card ──────────────────────────────────────────────────────────────────

function ItemCard({ item, currency, onSaved, onDeleted }: {
  item: Item; currency: string; onSaved: () => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateShopItem();
  const del = useDeleteShopItem();

  const [form, setForm] = useState<DraftItem>({
    name: item.name, description: item.description ?? '', price: item.price,
    roleId: item.roleId ?? '', emoji: item.emoji, enabled: item.enabled,
  });
  const [saved, setSaved] = useState<DraftItem>({ ...form });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const p = (u: Partial<DraftItem>) => setForm(f => ({ ...f, ...u }));

  function save() {
    update.mutate({ id: item.id, data: { name: form.name, description: form.description || undefined, price: form.price, roleId: form.roleId || undefined, emoji: form.emoji || '🛍️', enabled: form.enabled, position: item.position } }, {
      onSuccess: () => { setSaved({ ...form }); toast({ title: 'Sauvegardé' }); onSaved(); },
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  function remove() {
    del.mutate({ id: item.id }, {
      onSuccess: () => { toast({ title: 'Item supprimé' }); onDeleted(); },
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  const deleteBtn = (
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={remove} disabled={del.isPending} title="Supprimer">
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  );

  return (
    <ModuleCard title={`${form.emoji} ${form.name}`} description={form.description || `Prix : ${form.price.toLocaleString()} ${currency}`} icon={ShoppingBag} iconColor="text-violet-500" enabled={form.enabled} onToggle={(v) => p({ enabled: v })} onSave={save} saving={update.isPending} dirty={dirty} extra={deleteBtn}>
      <FieldRow label="Emoji" hint="Affiché à côté du nom sur Discord.">
        <Input value={form.emoji} onChange={e => p({ emoji: e.target.value })} placeholder="🛍️" className="w-24 text-center text-lg" />
      </FieldRow>
      <FieldRow label="Nom">
        <Input value={form.name} onChange={e => p({ name: e.target.value })} placeholder="Nom de l'item" />
      </FieldRow>
      <FieldRow label="Description" hint="Optionnel — affiché dans /shop.">
        <Input value={form.description} onChange={e => p({ description: e.target.value })} placeholder="À quoi sert cet item ?" />
      </FieldRow>
      <FieldRow label="Prix" hint={`Coût en ${currency}.`}>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} value={form.price} onChange={e => p({ price: Math.max(0, parseInt(e.target.value) || 0) })} className="w-32 font-mono text-right" />
          <span className="text-sm text-muted-foreground">{currency}</span>
        </div>
      </FieldRow>
      <FieldRow label="ID Rôle" hint="ID du rôle Discord attribué à l'achat. Vide = aucun rôle.">
        <Input value={form.roleId} onChange={e => p({ roleId: e.target.value })} placeholder="ex: 1234567890123456789" className="font-mono text-sm" />
      </FieldRow>
    </ModuleCard>
  );
}

// ── New item form ──────────────────────────────────────────────────────────────

function NewItemForm({ currency, onCreated, onCancel }: {
  currency: string; onCreated: () => void; onCancel: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateShopItem();
  const [form, setForm] = useState<DraftItem>({ name: '', description: '', price: 100, roleId: '', emoji: '🛍️', enabled: true });
  const p = (u: Partial<DraftItem>) => setForm(f => ({ ...f, ...u }));

  function submit() {
    if (!form.name.trim()) { toast({ title: 'Nom requis', variant: 'destructive' }); return; }
    create.mutate({ data: { name: form.name.trim(), description: form.description || undefined, price: form.price, roleId: form.roleId || undefined, emoji: form.emoji || '🛍️', enabled: form.enabled } }, {
      onSuccess: () => { toast({ title: 'Item créé' }); onCreated(); },
      onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
    });
  }

  return (
    <div className="bg-card border border-indigo-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Nouvel item</h3>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 px-2 text-muted-foreground">Annuler</Button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-center">
        <span className="text-sm font-medium">Emoji</span>
        <Input value={form.emoji} onChange={e => p({ emoji: e.target.value })} placeholder="🛍️" className="w-24 text-center text-lg" />
        <span className="text-sm font-medium">Nom <span className="text-red-500">*</span></span>
        <Input value={form.name} onChange={e => p({ name: e.target.value })} placeholder="Nom de l'item" />
        <span className="text-sm font-medium">Description</span>
        <Input value={form.description} onChange={e => p({ description: e.target.value })} placeholder="Optionnel" />
        <span className="text-sm font-medium">Prix</span>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} value={form.price} onChange={e => p({ price: Math.max(0, parseInt(e.target.value) || 0) })} className="w-32 font-mono text-right" />
          <span className="text-sm text-muted-foreground">{currency}</span>
        </div>
        <span className="text-sm font-medium">ID Rôle</span>
        <Input value={form.roleId} onChange={e => p({ roleId: e.target.value })} placeholder="ID rôle Discord (optionnel)" className="font-mono text-sm" />
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Plus className="w-4 h-4" /> Créer l'item
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Shop() {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useListShopItems({ query: { queryKey: getListShopItemsQueryKey() } });
  const { data: cfg } = useGetEconomyConfig();
  const currency = (cfg as any)?.currencyName ?? 'coins';
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'items' | 'inventory'>('items');

  function refresh() { queryClient.invalidateQueries({ queryKey: getListShopItemsQueryKey() }); }
  const sorted = [...items].sort((a, b) => a.position - b.position || a.id - b.id);

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boutique</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Items achetables avec <span className="font-medium">{currency}</span> via{' '}
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/shop</span> et{' '}
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/buy</span>
          </p>
        </div>
        {tab === 'items' && !adding && (
          <Button onClick={() => setAdding(true)} className="gap-2 flex-shrink-0">
            <Plus className="w-4 h-4" /> Ajouter un item
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('items')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors', tab === 'items' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <ShoppingCart className="w-3.5 h-3.5" /> Items
          <span className="ml-1 text-xs bg-muted-foreground/20 px-1.5 rounded-full">{(items as any[]).length}</span>
        </button>
        <button
          onClick={() => setTab('inventory')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors', tab === 'inventory' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <Package className="w-3.5 h-3.5" /> Inventaires
        </button>
      </div>

      {/* Items tab */}
      {tab === 'items' && (
        <div className="space-y-4">
          {adding && <NewItemForm currency={currency} onCreated={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
          {isLoading && <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>}
          {!isLoading && sorted.length === 0 && !adding && (
            <div className="py-16 text-center">
              <ShoppingBag className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Aucun item. Ajoutez votre premier item.</p>
            </div>
          )}
          {sorted.map(item => (
            <ItemCard key={item.id} item={item as Item} currency={currency} onSaved={refresh} onDeleted={refresh} />
          ))}
        </div>
      )}

      {/* Inventory tab */}
      {tab === 'inventory' && <InventoryPanel />}
    </div>
  );
}
