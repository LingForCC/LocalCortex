/**
 * Onboarding wizard — shown when handoff setup is incomplete (any of
 * handoffAgentId / handoffTaskManagerId / handoffBackend unset).
 *
 * Spec: docs/features/handoff-setup/README.md.
 *
 * Four steps:
 *  1. Pick coding agent (event source) — cards from window.api.agents.list()
 *  2. Pick task manager (sink) — cards from window.api.taskManagers.list()
 *  3. Pick review-rule backend — Claude / Codex cards
 *  4. Review & confirm — summary + instructions → handoffSetup.complete
 *
 * Each picker step has an "Add custom…" button for zero-code extensibility.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Textarea } from '@renderer/components/ui/textarea';
import type { AgentEntry, TaskManagerEntry, McpServerEntry } from '@shared/types';

interface OnboardingProps {
  /** Called after setup completes so App.tsx re-evaluates the gate. */
  onDone: () => void;
}

type Step = 1 | 2 | 3 | 4;

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

export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = React.useState<Step>(1);
  const [agents, setAgents] = React.useState<AgentEntry[]>([]);
  const [taskManagers, setTaskManagers] = React.useState<TaskManagerEntry[]>([]);
  const [mcpServers, setMcpServers] = React.useState<McpServerEntry[]>([]);
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [taskManagerId, setTaskManagerId] = React.useState<string | null>(null);
  const [backend, setBackend] = React.useState<'claude' | 'codex' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshAgents = React.useCallback(async () => {
    setAgents(await window.api.agents.list());
  }, []);
  const refreshTaskManagers = React.useCallback(async () => {
    setTaskManagers(await window.api.taskManagers.list());
  }, []);

  React.useEffect(() => {
    void Promise.all([refreshAgents(), refreshTaskManagers(), refreshServers(setMcpServers)]);
  }, [refreshAgents, refreshTaskManagers]);

  const selectedAgent = agents.find((a) => a.id === agentId) ?? null;
  const selectedTM = taskManagers.find((t) => t.id === taskManagerId) ?? null;

  const canNext =
    step === 1 ? !!agentId : step === 2 ? !!taskManagerId : step === 3 ? !!backend : true;

  const finish = async (): Promise<void> => {
    if (!agentId || !taskManagerId || !backend) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.handoffSetup.complete({ agentId, taskManagerId, backend });
      if (!result.ok) {
        setError(result.error ?? 'Setup failed.');
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">Welcome to LocalCortex</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the handoff pipeline in three quick steps.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-2 w-12 rounded-full transition-colors ${
                s <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <PickerStep<AgentEntry>
            title="Which coding agent do you use?"
            subtitle="This is the agent whose sessions LocalCortex will listen to."
            items={agents}
            selectedId={agentId}
            onSelect={setAgentId}
            renderCard={(a) => (
              <>
                <div className="flex items-center justify-between">
                  <CardTitle>{a.label}</CardTitle>
                  {a.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
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
        )}

        {step === 2 && (
          <PickerStep<TaskManagerEntry>
            title="Which task manager do you use?"
            subtitle="This is where review subtasks will be created."
            items={taskManagers}
            selectedId={taskManagerId}
            onSelect={setTaskManagerId}
            renderCard={(t) => (
              <>
                <div className="flex items-center justify-between">
                  <CardTitle>{t.label}</CardTitle>
                  {t.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                {mcpServers.find((s) => s.name === t.mcpServerName) === undefined && (
                  <p className="mt-1 text-xs text-destructive">
                    Warning: server '{t.mcpServerName}' is not configured.
                  </p>
                )}
              </>
            )}
            renderAddCustom={(onDone) => (
              <AddTaskManagerForm
                mcpServers={mcpServers}
                onSaved={async () => {
                  await refreshTaskManagers();
                  await refreshServers(setMcpServers);
                  onDone();
                }}
              />
            )}
          />
        )}

        {step === 3 && (
          <PickerStep<{ id: 'claude' | 'codex'; label: string; description: string }>
            title="Which backend should run the review rule?"
            subtitle="This is the agent SDK that fulfills the review-subtask rule — independent of your coding agent."
            items={BACKENDS}
            selectedId={backend}
            onSelect={(id) => setBackend(id as 'claude' | 'codex')}
            renderCard={(b) => (
              <>
                <CardTitle>{b.label}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>
              </>
            )}
            renderAddCustom={null}
          />
        )}

        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>Review your setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ReviewRow label="Coding agent" value={selectedAgent?.label} />
              <ReviewRow label="Task manager" value={selectedTM?.label} />
              <ReviewRow
                label="Review backend"
                value={backend === 'claude' ? 'Claude' : backend === 'codex' ? 'Codex' : undefined}
              />

              {selectedAgent && (
                <div className="space-y-1">
                  <Label>Agent setup instructions</Label>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {selectedAgent.installInstructions}
                  </pre>
                </div>
              )}
              {selectedTM && (
                <div className="space-y-1">
                  <Label>Task manager setup</Label>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {selectedTM.setupInstructions}
                  </pre>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(3)} disabled={busy}>
                  Back
                </Button>
                <Button disabled={busy} onClick={() => void finish()}>
                  {busy ? 'Setting up…' : 'Finish'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step < 4 && (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              disabled={step === 1}
            >
              Back
            </Button>
            <Button disabled={!canNext} onClick={() => setStep((s) => (s + 1) as Step)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helper components ------------------------------------------------------

async function refreshServers(set: (s: McpServerEntry[]) => void): Promise<void> {
  set(await window.api.mcpServers.list());
}

function ReviewRow({ label, value }: { label: string; value?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}

/** Generic picker step: renders selectable cards for a list of options. */
function PickerStep<T extends { id: string; label?: string }>(props: {
  title: string;
  subtitle: string;
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderCard: (item: T) => React.ReactNode;
  /**
   * Render function for the custom-add form. Receives `onDone` which the form
   * should call after a successful save — it refreshes the list and closes the
   * form. Null disables the "Add custom" button.
   */
  renderAddCustom: ((onDone: () => void) => React.ReactElement) | null;
}): React.ReactElement {
  const [adding, setAdding] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{props.subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && props.renderAddCustom ? (
          props.renderAddCustom(() => void setAdding(false))
        ) : (
          <>
            <div className="space-y-2" role="radiogroup" aria-label={props.title}>
              {props.items.map((item) => (
                <Card
                  key={item.id}
                  role="radio"
                  aria-checked={props.selectedId === item.id}
                  aria-label={item.label ?? item.id}
                  tabIndex={0}
                  className={`cursor-pointer transition-colors hover:bg-accent ${
                    props.selectedId === item.id ? 'border-primary ring-1 ring-primary' : ''
                  }`}
                  onClick={() => props.onSelect(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      props.onSelect(item.id);
                    }
                  }}
                >
                  <CardContent className="p-4">{props.renderCard(item)}</CardContent>
                </Card>
              ))}
              {props.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No options yet — add a custom one.</p>
              )}
            </div>
            {props.renderAddCustom && (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                + Add custom…
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AddAgentForm({ onSaved }: { onSaved: () => Promise<void> }): React.ReactElement {
  const [id, setId] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [sessionCompleteEventType, setSessionCompleteEventType] = React.useState('');
  const [promptSubmitEventType, setPromptSubmitEventType] = React.useState('');
  const [source, setSource] = React.useState('');
  const [installInstructions, setInstallInstructions] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (): Promise<void> => {
    if (
      !id ||
      !label ||
      !description ||
      !sessionCompleteEventType ||
      !promptSubmitEventType ||
      !source ||
      !installInstructions
    ) {
      setError('All fields are required.');
      return;
    }
    setBusy(true);
    try {
      await window.api.agents.create({
        id,
        label,
        description,
        sessionCompleteEventType,
        promptSubmitEventType,
        source,
        installInstructions,
        isBuiltin: false,
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Id (unique)" value={id} onChange={setId} />
        <FormField label="Label" value={label} onChange={setLabel} />
      </div>
      <FormField label="Description" value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Session-complete event type"
          value={sessionCompleteEventType}
          onChange={setSessionCompleteEventType}
          placeholder="myagent.session-complete"
        />
        <FormField
          label="Prompt-submit event type"
          value={promptSubmitEventType}
          onChange={setPromptSubmitEventType}
          placeholder="myagent.prompt-submit"
        />
      </div>
      <FormField label="Source" value={source} onChange={setSource} placeholder="myagent" />
      <div className="space-y-1.5">
        <Label htmlFor="agent-install-instructions">Install instructions</Label>
        <Textarea
          id="agent-install-instructions"
          value={installInstructions}
          onChange={(e) => setInstallInstructions(e.target.value)}
          placeholder="How to configure the hook/plugin on the agent side…"
          rows={3}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : 'Save agent'}
      </Button>
    </div>
  );
}

function AddTaskManagerForm({
  mcpServers,
  onSaved,
}: {
  mcpServers: McpServerEntry[];
  onSaved: () => Promise<void>;
}): React.ReactElement {
  const [id, setId] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mcpServerName, setMcpServerName] = React.useState(mcpServers[0]?.name ?? '');
  const [requiresToken, setRequiresToken] = React.useState(false);
  const [tokenEnvVar, setTokenEnvVar] = React.useState('');
  const [setupInstructions, setSetupInstructions] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (): Promise<void> => {
    if (!id || !label || !description || !mcpServerName || !setupInstructions) {
      setError('All fields are required (token env var optional if no token).');
      return;
    }
    setBusy(true);
    try {
      await window.api.taskManagers.create({
        id,
        label,
        description,
        mcpServerName,
        requiresToken,
        tokenEnvVar: tokenEnvVar || null,
        setupInstructions,
        isBuiltin: false,
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Id (unique)" value={id} onChange={setId} />
        <FormField label="Label" value={label} onChange={setLabel} />
      </div>
      <FormField label="Description" value={description} onChange={setDescription} />
      <div className="space-y-1.5">
        <Label>MCP server</Label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={mcpServerName}
          onChange={(e) => setMcpServerName(e.target.value)}
        >
          {mcpServers.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          The server that writes tasks. Add one in the Sources tab if needed.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="requires-token"
          checked={requiresToken}
          onChange={(e) => setRequiresToken(e.target.checked)}
        />
        <Label htmlFor="requires-token">Requires an API token</Label>
      </div>
      {requiresToken && (
        <FormField
          label="Token env var"
          value={tokenEnvVar}
          onChange={setTokenEnvVar}
          placeholder="MY_API_TOKEN"
        />
      )}
      <div className="space-y-1.5">
        <Label htmlFor="tm-setup-instructions">Setup instructions</Label>
        <Textarea
          id="tm-setup-instructions"
          value={setupInstructions}
          onChange={(e) => setSetupInstructions(e.target.value)}
          placeholder="How to set up the task manager connection…"
          rows={3}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : 'Save task manager'}
      </Button>
    </div>
  );
}

function FormField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const fieldId = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{props.label}</Label>
      <Input
        id={fieldId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </div>
  );
}
