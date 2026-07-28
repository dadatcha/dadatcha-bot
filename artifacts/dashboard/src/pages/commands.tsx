import { useState } from 'react';
import { useListCommands, useCreateCommand, useUpdateCommand, useDeleteCommand, getListCommandsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { BotCommand } from '@workspace/api-client-react';

export default function Commands() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: commands, isLoading } = useListCommands({
    query: { queryKey: getListCommandsQueryKey() },
  });
  const createCommand = useCreateCommand();
  const updateCommand = useUpdateCommand();
  const deleteCommand = useDeleteCommand();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ description: '', response: '' });
  const [newCommandForm, setNewCommandForm] = useState({
    name: '',
    description: '',
    response: '',
  });

  const handleCreate = async () => {
    if (!newCommandForm.name || !newCommandForm.description || !newCommandForm.response) {
      toast({ title: 'Validation Error', description: 'All fields are required', variant: 'destructive' });
      return;
    }

    createCommand.mutate(
      { data: { ...newCommandForm, enabled: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey() });
          setNewCommandForm({ name: '', description: '', response: '' });
          toast({ title: 'Command created' });
        },
        onError: () => {
          toast({ title: 'Failed to create command', variant: 'destructive' });
        },
      }
    );
  };

  const handleToggle = (cmd: BotCommand) => {
    updateCommand.mutate(
      { name: cmd.name, data: { enabled: !cmd.enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey() });
        },
      }
    );
  };

  const handleStartEdit = (cmd: BotCommand) => {
    setEditingId(cmd.id);
    setEditForm({ description: cmd.description, response: cmd.response });
  };

  const handleSaveEdit = (cmd: BotCommand) => {
    updateCommand.mutate(
      { name: cmd.name, data: editForm },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey() });
          setEditingId(null);
          toast({ title: 'Command updated' });
        },
        onError: () => {
          toast({ title: 'Failed to update command', variant: 'destructive' });
        },
      }
    );
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleDelete = (cmd: BotCommand) => {
    if (!confirm(`Delete command "${cmd.name}"?`)) return;

    deleteCommand.mutate(
      { name: cmd.name },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey() });
          toast({ title: 'Command deleted' });
        },
        onError: () => {
          toast({ title: 'Failed to delete command', variant: 'destructive' });
        },
      }
    );
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Commands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage custom text commands for the bot
        </p>
      </div>

      <div className="bg-card border border-card-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Create New Command</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            placeholder="Command name (e.g. ping)"
            value={newCommandForm.name}
            onChange={(e) => setNewCommandForm({ ...newCommandForm, name: e.target.value })}
            data-testid="input-command-name"
          />
          <Input
            placeholder="Description"
            value={newCommandForm.description}
            onChange={(e) => setNewCommandForm({ ...newCommandForm, description: e.target.value })}
            data-testid="input-command-description"
          />
          <Input
            placeholder="Response text"
            value={newCommandForm.response}
            onChange={(e) => setNewCommandForm({ ...newCommandForm, response: e.target.value })}
            data-testid="input-command-response"
          />
        </div>
        <Button
          onClick={handleCreate}
          disabled={createCommand.isPending}
          data-testid="button-create-command"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Command
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : commands && commands.length > 0 ? (
          commands.map((cmd) => {
            const isEditing = editingId === cmd.id;
            
            return (
              <div
                key={cmd.id}
                className="bg-card border border-card-border rounded-lg p-4"
                data-testid={`command-${cmd.name}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <code className="px-2 py-1 bg-muted rounded text-sm font-mono">
                        /{cmd.name}
                      </code>
                      <Switch
                        checked={cmd.enabled}
                        onCheckedChange={() => handleToggle(cmd)}
                        data-testid={`toggle-${cmd.name}`}
                      />
                      <span className="text-xs text-muted-foreground font-mono">
                        {cmd.enabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <Input
                          value={editForm.description}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          placeholder="Description"
                          data-testid={`edit-description-${cmd.name}`}
                        />
                        <Textarea
                          value={editForm.response}
                          onChange={(e) => setEditForm({ ...editForm, response: e.target.value })}
                          placeholder="Response"
                          rows={3}
                          data-testid={`edit-response-${cmd.name}`}
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">{cmd.description}</p>
                        <p className="text-sm bg-muted/50 rounded p-2 font-mono">{cmd.response}</p>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSaveEdit(cmd)}
                          data-testid={`save-${cmd.name}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                          data-testid={`cancel-${cmd.name}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStartEdit(cmd)}
                        data-testid={`edit-${cmd.name}`}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(cmd)}
                      data-testid={`delete-${cmd.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            No commands yet. Create one above.
          </div>
        )}
      </div>
    </div>
  );
}
