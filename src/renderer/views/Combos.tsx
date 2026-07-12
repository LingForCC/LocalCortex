/**
 * Combos tab — manage the list of agent + task-manager + backend combos.
 *
 * Spec: docs/features/handoff-setup/README.md.
 *
 * Each combo owns one auto-created rule that listens to the agent's
 * session-complete event type, so multiple combos run in parallel — one per
 * agent source. This view provides the CRUD UX: a table of existing combos
 * (enable/disable, edit, delete) and an inline editor (reusing the catalog
 * picker primitives) for creating/editing a combo.
 *
 * Mirrors the list-CRUD layout of RuleList.tsx + Sources.tsx.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { useCombosStore } from '@renderer/store/combos';
import {
  PickerStep,
  AddAgentForm,
  AddTaskManagerForm,
} from '@renderer/components/catalog-picker';
import type { AgentEntry, TaskManagerEntry, McpServerEntry, Combo } from '@shared/types';

const BACKENDS = [
  {
    id: 'claude' as const,
    label: 'Claude (Claude Code SDK)',
    description: 'The Claude Code SDK runs the review-rule agent. Best for Claude-based setups.',
  },
  {
    id: 'codex' as const,
    label: 'Codex (OpenAI Codex SDK)',
    description: 'The Codex SDK runs the review-rule agent. Best for OpenAI-based setups.',
  },
];

/** Either "new" (no id) or editing an existing combo. */
interface Draft {
  id?: string;
  label: string;
  agentId: string | null;
  taskManagerId: string | null;
  backend: 'claude' | 'codex' | null;
}

export function Combos(): React.ReactElement {
  const combos = useCombosStore((s) => s.combos);
  const load = useCombosStore((s) => s.load);
  const setEnabled = useCombosStore((s) => s.setEnabled);
  const remove = useCombosStore((s) => s.remove);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (draft) {
    return (
      <ComboEditor
        initial={draft}
        onCancel={() => setDraft(null)}
        onSaved={() => setDraft(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Combos</CardTitle>
          <Button
            size="sm"
            onClick={() =>
              setDraft({ label: '', agentId: null, taskManagerId: null, backend: null })
            }
          >
            New combo
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Each combo binds a coding agent (event source) to a task manager (sink) and a runner
          backend. Combos run in parallel — one per agent source.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Enabled</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Task manager</TableHead>
              <TableHead>Backend</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {combos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No combos yet. Click “New combo”.
                </TableCell>
              </TableRow>
            )}
            {combos.map((c) => (
              <ComboRow
                key={c.id}
                combo={c}
                onToggle={(v) => void setEnabled(c.id, v)}
                onEdit={() =>
                  setDraft({
                    id: c.id,
                    label: c.label,
                    agentId: c.agentId,
                    taskManagerId: c.taskManagerId,
                    backend: c.backend,
                  })
                }
                onDelete={() => {
                  if (confirm(`Delete combo "${c.label}"? This also deletes its rule.`))
                    void remove(c.id);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ComboRow(props: {
  combo: Combo;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { combo } = props;
  const [agent, setAgent] = React.useState<AgentEntry | null>(null);
  const [taskManager, setTaskManager] = React.useState<TaskManagerEntry | null>(null);

  React.useEffect(() => {
    void (async () => {
      setAgent(await window.api.agents.get(combo.agentId));
      setTaskManager(await window.api.taskManagers.get(combo.taskManagerId));
    })();
  }, [combo.agentId, combo.taskManagerId]);

  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={combo.enabled}
          onCheckedChange={props.onToggle}
          aria-label={`Toggle ${combo.label}`}
        />
      </TableCell>
      <TableCell className="font-medium">{combo.label}</TableCell>
      <TableCell>{agent?.label ?? combo.agentId}</TableCell>
      <TableCell>{taskManager?.label ?? combo.taskManagerId}</TableCell>
      <TableCell>
        <Badge variant="outline">{combo.backend}</Badge>
      </TableCell>
      <TableCell className="space-x-1">
        <Button variant="ghost" size="sm" onClick={props.onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDelete}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Inline combo editor — label field + the three pickers (agent, task manager,
 * backend) reusing PickerStep / AddAgentForm / AddTaskManagerForm. Save calls
 * the combos store create/update.
 */
function ComboEditor(props: {
  initial: Draft;
  onCancel: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const create = useCombosStore((s) => s.create);
  const update = useCombosStore((s) => s.update);
  const [label, setLabel] = React.useState(props.initial.label);
  const [agentId, setAgentId] = React.useState<string | null>(props.initial.agentId);
  const [taskManagerId, setTaskManagerId] = React.useState<string | null>(
    props.initial.taskManagerId,
  );
  const [backend, setBackend] = React.useState<'claude' | 'codex' | null>(props.initial.backend);
  const [agents, setAgents] = React.useState<AgentEntry[]>([]);
  const [taskManagers, setTaskManagers] = React.useState<TaskManagerEntry[]>([]);
  const [mcpServers, setMcpServers] = React.useState<McpServerEntry[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshAgents = React.useCallback(async () => {
    setAgents(await window.api.agents.list());
  }, []);
  const refreshTaskManagers = React.useCallback(async () => {
    setTaskManagers(await window.api.taskManagers.list());
  }, []);
  const refreshServers = React.useCallback(async () => {
    setMcpServers(await window.api.mcpServers.list());
  }, []);

  React.useEffect(() => {
    void Promise.all([refreshAgents(), refreshTaskManagers(), refreshServers()]);
  }, [refreshAgents, refreshTaskManagers, refreshServers]);

  const canSave = !!label.trim() && !!agentId && !!taskManagerId && !!backend;

  const save = async (): Promise<void> => {
    if (!canSave || !backend) return;
    setBusy(true);
    setError(null);
    try {
      if (props.initial.id) {
        const ok = await update(props.initial.id, {
          label: label.trim(),
          agentId,
          taskManagerId,
          backend,
        });
        if (!ok) {
          setBusy(false);
          return;
        }
      } else {
        const id = await create({
          label: label.trim(),
          agentId,
          taskManagerId,
          backend,
        });
        if (!id) {
          setBusy(false);
          return;
        }
      }
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const selectedTM = taskManagers.find((t) => t.id === taskManagerId) ?? null;
  const tmServerMissing =
    !!selectedTM && mcpServers.find((s) => s.name === selectedTM.mcpServerName) === undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.initial.id ? 'Edit combo' : 'New combo'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="combo-label">Label</Label>
          <Input
            id="combo-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. ZCode → OmniFocus"
          />
        </div>

        <PickerStep<AgentEntry>
          title="Coding agent"
          subtitle="The agent whose sessions this combo listens to."
          items={agents}
          selectedId={agentId}
          onSelect={setAgentId}
          renderCard={(a) => (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.label}</span>
                {a.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
            </>
          )}
          renderAddCustom={(onDone) => (
            <AddAgentForm
              onSaved={async () => {
                await refreshAgents();
                onDone();
              }}
            />
          )}
        />

        <PickerStep<TaskManagerEntry>
          title="Task manager"
          subtitle="Where review subtasks will be created."
          items={taskManagers}
          selectedId={taskManagerId}
          onSelect={setTaskManagerId}
          renderCard={(t) => (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t.label}</span>
                {t.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
              {mcpServers.find((s) => s.name === t.mcpServerName) === undefined && (
                <p className="mt-1 text-xs text-destructive">
                  Warning: server ‘{t.mcpServerName}’ is not configured.
                </p>
              )}
            </>
          )}
          renderAddCustom={(onDone) => (
            <AddTaskManagerForm
              mcpServers={mcpServers}
              onSaved={async () => {
                await refreshTaskManagers();
                await refreshServers();
                onDone();
              }}
            />
          )}
        />

        {tmServerMissing && (
          <p className="text-sm text-destructive">
            The selected task manager references a missing MCP server. Add it in the Sources tab
            before saving.
          </p>
        )}

        <PickerStep<{ id: 'claude' | 'codex'; label: string; description: string }>
          title="Review backend"
          subtitle="The agent SDK that fulfills the review rule — independent of the coding agent."
          items={BACKENDS}
          selectedId={backend}
          onSelect={(id) => setBackend(id as 'claude' | 'codex')}
          renderCard={(b) => (
            <>
              <span className="text-sm font-medium">{b.label}</span>
              <p className="mt-1 text-xs text-muted-foreground">{b.description}</p>
            </>
          )}
          renderAddCustom={null}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!canSave || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : props.initial.id ? 'Save changes' : 'Create combo'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
