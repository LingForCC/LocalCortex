/**
 * Handoff profiles tab — manage the list of agent + task-manager + backend
 * handoff profiles.
 *
 * Spec: docs/features/handoff-profiles/README.md.
 *
 * Each profile owns one auto-created rule that listens to the agent's
 * session-complete event type, so multiple profiles run in parallel — one per
 * agent source. This view provides the CRUD UX: a table of existing profiles
 * (enable/disable, edit, delete) and an inline editor (reusing the catalog
 * picker primitives) for creating/editing a profile.
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
import { useHandoffProfilesStore } from '@renderer/store/handoff-profiles';
import {
  PickerStep,
  AddAgentForm,
  AddTaskManagerForm,
} from '@renderer/components/catalog-picker';
import type { AgentEntry, TaskManagerEntry, McpServerEntry, HandoffProfile } from '@shared/types';

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

/** Either "new" (no id) or editing an existing handoff profile. */
interface Draft {
  id?: string;
  label: string;
  agentId: string | null;
  taskManagerId: string | null;
  backend: 'claude' | 'codex' | null;
}

export function HandoffProfiles(): React.ReactElement {
  const handoffProfiles = useHandoffProfilesStore((s) => s.handoffProfiles);
  const load = useHandoffProfilesStore((s) => s.load);
  const setEnabled = useHandoffProfilesStore((s) => s.setEnabled);
  const remove = useHandoffProfilesStore((s) => s.remove);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (draft) {
    return (
      <HandoffProfileEditor
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
          <CardTitle>Handoff profiles</CardTitle>
          <Button
            size="sm"
            onClick={() =>
              setDraft({ label: '', agentId: null, taskManagerId: null, backend: null })
            }
          >
            New handoff profile
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Each handoff profile binds a coding agent (event source) to a task manager (sink) and a
          runner backend. Profiles run in parallel — one per agent source.
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
            {handoffProfiles.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No handoff profiles yet. Click “New handoff profile”.
                </TableCell>
              </TableRow>
            )}
            {handoffProfiles.map((p) => (
              <HandoffProfileRow
                key={p.id}
                handoffProfile={p}
                onToggle={(v) => void setEnabled(p.id, v)}
                onEdit={() =>
                  setDraft({
                    id: p.id,
                    label: p.label,
                    agentId: p.agentId,
                    taskManagerId: p.taskManagerId,
                    backend: p.backend,
                  })
                }
                onDelete={() => {
                  if (confirm(`Delete handoff profile "${p.label}"? This also deletes its rule.`))
                    void remove(p.id);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function HandoffProfileRow(props: {
  handoffProfile: HandoffProfile;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { handoffProfile } = props;
  const [agent, setAgent] = React.useState<AgentEntry | null>(null);
  const [taskManager, setTaskManager] = React.useState<TaskManagerEntry | null>(null);

  React.useEffect(() => {
    void (async () => {
      setAgent(await window.api.agents.get(handoffProfile.agentId));
      setTaskManager(await window.api.taskManagers.get(handoffProfile.taskManagerId));
    })();
  }, [handoffProfile.agentId, handoffProfile.taskManagerId]);

  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={handoffProfile.enabled}
          onCheckedChange={props.onToggle}
          aria-label={`Toggle ${handoffProfile.label}`}
        />
      </TableCell>
      <TableCell className="font-medium">{handoffProfile.label}</TableCell>
      <TableCell>{agent?.label ?? handoffProfile.agentId}</TableCell>
      <TableCell>{taskManager?.label ?? handoffProfile.taskManagerId}</TableCell>
      <TableCell>
        <Badge variant="outline">{handoffProfile.backend}</Badge>
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
 * Inline handoff-profile editor — label field + the three pickers (agent, task
 * manager, backend) reusing PickerStep / AddAgentForm / AddTaskManagerForm.
 * Save calls the handoff-profiles store create/update.
 */
function HandoffProfileEditor(props: {
  initial: Draft;
  onCancel: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const create = useHandoffProfilesStore((s) => s.create);
  const update = useHandoffProfilesStore((s) => s.update);
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
        <CardTitle>{props.initial.id ? 'Edit handoff profile' : 'New handoff profile'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="handoff-profile-label">Label</Label>
          <Input
            id="handoff-profile-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. ZCode → OmniFocus"
          />
        </div>

        <PickerStep<AgentEntry>
          title="Coding agent"
          subtitle="The agent whose sessions this handoff profile listens to."
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
            {busy ? 'Saving…' : props.initial.id ? 'Save changes' : 'Create handoff profile'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
