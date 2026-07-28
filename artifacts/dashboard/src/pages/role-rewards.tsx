import { useState } from 'react';
import {
  useListRoleRewards, useCreateRoleReward, useUpdateRoleReward, useDeleteRoleReward,
  getListRoleRewardsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ModuleCard } from '@/components/ui/module-card';
import { FieldRow } from '@/components/ui/field-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shield, Plus, Trash2, ArrowRight, ArrowDown, MinusCircle } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Rule = {
  id: number;
  triggerRoleId: string;
  rewardRoleId: string;
  removeRoleId: string | null;
  enabled: boolean;
  createdAt: string;
};

type DraftRule = {
  triggerRoleId: string;
  rewardRoleId: string;
  removeRoleId: string;
  enabled: boolean;
};

// ── Rule card ──────────────────────────────────────────────────────────────────

function RuleCard({ rule, onSaved, onDeleted }: {
  rule: Rule;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateRoleReward();
  const del = useDeleteRoleReward();

  const [form, setForm] = useState<DraftRule>({
    triggerRoleId: rule.triggerRoleId,
    rewardRoleId:  rule.rewardRoleId,
    removeRoleId:  rule.removeRoleId ?? '',
    enabled:       rule.enabled,
  });
  const [saved, setSaved] = useState<DraftRule>({ ...form });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const p = (u: Partial<DraftRule>) => setForm(f => ({ ...f, ...u }));

  function save() {
    update.mutate(
      {
        id: rule.id,
        data: {
          triggerRoleId: form.triggerRoleId,
          rewardRoleId:  form.rewardRoleId,
          removeRoleId:  form.removeRoleId || undefined,
          enabled:       form.enabled,
        },
      },
      {
        onSuccess: () => { setSaved({ ...form }); toast({ title: 'Sauvegardé' }); onSaved(); },
        onError:   () => toast({ title: 'Erreur de sauvegarde', variant: 'destructive' }),
      }
    );
  }

  function remove() {
    del.mutate(
      { id: rule.id },
      {
        onSuccess: () => { toast({ title: 'Règle supprimée' }); onDeleted(); },
        onError:   () => toast({ title: 'Erreur de suppression', variant: 'destructive' }),
      }
    );
  }

  const shortId = (id: string) => id ? `…${id.slice(-6)}` : '—';

  const deleteBtn = (
    <Button
      size="sm" variant="ghost"
      className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
      onClick={remove}
      disabled={del.isPending}
      title="Supprimer la règle"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  );

  // Build a compact title showing the flow
  const titleEl = (
    <span className="flex items-center gap-1.5 font-mono text-sm flex-wrap">
      <span className="text-indigo-400">{shortId(form.triggerRoleId)}</span>
      <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-emerald-500">+{shortId(form.rewardRoleId)}</span>
      {form.removeRoleId && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="text-red-400">−{shortId(form.removeRoleId)}</span>
        </>
      )}
    </span>
  );

  return (
    <ModuleCard
      title={titleEl}
      description="Quand le rôle déclencheur est attribué, le rôle récompense est ajouté et (si configuré) le rôle à enlever est retiré."
      icon={Shield}
      iconColor="text-indigo-500"
      enabled={form.enabled}
      onToggle={(v) => p({ enabled: v })}
      onSave={save}
      saving={update.isPending}
      dirty={dirty}
      extra={deleteBtn}
    >
      <FieldRow
        label="Rôle déclencheur"
        hint="ID du rôle dont l'obtention déclenche la règle."
      >
        <Input
          value={form.triggerRoleId}
          onChange={e => p({ triggerRoleId: e.target.value })}
          placeholder="ex. 1234567890123456789"
          className="font-mono text-sm"
        />
      </FieldRow>

      {/* Separator */}
      <div className="flex items-center gap-2 py-1">
        <ArrowDown className="w-3.5 h-3.5 text-muted-foreground ml-1 flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Actions déclenchées</span>
        <div className="flex-1 border-t" />
      </div>

      <FieldRow
        label={<span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Rôle à ajouter</span>}
        hint="ID du rôle Discord accordé automatiquement."
      >
        <Input
          value={form.rewardRoleId}
          onChange={e => p({ rewardRoleId: e.target.value })}
          placeholder="ex. 9876543210987654321"
          className="font-mono text-sm"
        />
      </FieldRow>

      <FieldRow
        label={<span className="flex items-center gap-1.5"><MinusCircle className="w-3.5 h-3.5 text-red-400" /> Rôle à enlever</span>}
        hint="ID du rôle Discord retiré automatiquement. Laisse vide pour ne rien retirer."
      >
        <Input
          value={form.removeRoleId}
          onChange={e => p({ removeRoleId: e.target.value })}
          placeholder="Optionnel — ex. 1122334455667788990"
          className="font-mono text-sm"
        />
      </FieldRow>
    </ModuleCard>
  );
}

// ── New rule form ──────────────────────────────────────────────────────────────

function NewRuleForm({ onCreated, onCancel }: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateRoleReward();
  const [form, setForm] = useState<DraftRule>({
    triggerRoleId: '',
    rewardRoleId:  '',
    removeRoleId:  '',
    enabled:       true,
  });
  const p = (u: Partial<DraftRule>) => setForm(f => ({ ...f, ...u }));

  function submit() {
    if (!form.triggerRoleId.trim()) { toast({ title: 'Rôle déclencheur requis', variant: 'destructive' }); return; }
    if (!form.rewardRoleId.trim())  { toast({ title: 'Rôle à ajouter requis',   variant: 'destructive' }); return; }
    create.mutate(
      {
        data: {
          triggerRoleId: form.triggerRoleId.trim(),
          rewardRoleId:  form.rewardRoleId.trim(),
          removeRoleId:  form.removeRoleId.trim() || undefined,
          enabled:       form.enabled,
        },
      },
      {
        onSuccess: () => { toast({ title: 'Règle créée' }); onCreated(); },
        onError:   () => toast({ title: 'Erreur de création', variant: 'destructive' }),
      }
    );
  }

  return (
    <div className="bg-card border border-indigo-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Nouvelle règle</h3>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 px-2 text-muted-foreground">Annuler</Button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-center">
        <span className="text-sm font-medium">
          Rôle déclencheur <span className="text-red-500">*</span>
        </span>
        <Input
          value={form.triggerRoleId}
          onChange={e => p({ triggerRoleId: e.target.value })}
          placeholder="ID du rôle qui déclenche la règle"
          className="font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <ArrowDown className="w-3.5 h-3.5 text-muted-foreground ml-1 flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Actions déclenchées</span>
        <div className="flex-1 border-t" />
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-center">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          Rôle à ajouter <span className="text-red-500">*</span>
        </span>
        <Input
          value={form.rewardRoleId}
          onChange={e => p({ rewardRoleId: e.target.value })}
          placeholder="ID du rôle accordé automatiquement"
          className="font-mono text-sm"
        />
        <span className="text-sm font-medium flex items-center gap-1.5">
          <MinusCircle className="w-3.5 h-3.5 text-red-400" />
          Rôle à enlever
        </span>
        <Input
          value={form.removeRoleId}
          onChange={e => p({ removeRoleId: e.target.value })}
          placeholder="Optionnel — ID du rôle retiré automatiquement"
          className="font-mono text-sm"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Clic droit sur un rôle dans Discord → <strong>Copier l'identifiant</strong> (mode développeur requis).
      </p>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Plus className="w-4 h-4" /> Créer la règle
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RoleRewards() {
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading } = useListRoleRewards({
    query: { queryKey: getListRoleRewardsQueryKey() },
  });
  const [adding, setAdding] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListRoleRewardsQueryKey() });
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rôles automatiques</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quand un membre obtient un <span className="font-medium">rôle déclencheur</span>,
            le bot lui ajoute le <span className="font-medium">rôle récompense</span> et
            peut simultanément lui <span className="font-medium">retirer un autre rôle</span>.
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} className="gap-2 flex-shrink-0">
            <Plus className="w-4 h-4" /> Ajouter une règle
          </Button>
        )}
      </div>

      {adding && (
        <NewRuleForm
          onCreated={() => { setAdding(false); refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>
      )}

      {!isLoading && rules.length === 0 && !adding && (
        <div className="py-16 text-center">
          <Shield className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Aucune règle configurée. Ajoutez votre première règle ci-dessus.</p>
        </div>
      )}

      <div className="space-y-4">
        {rules.map(rule => (
          <RuleCard
            key={rule.id}
            rule={rule as Rule}
            onSaved={refresh}
            onDeleted={refresh}
          />
        ))}
      </div>
    </div>
  );
}
