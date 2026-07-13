/**
 * Catalog picker primitives — reusable card-picker + add-custom forms for
 * agents and task managers. Shared between the Handoff profiles tab (one picker
 * per profile being edited) and anywhere else a catalog entry needs selecting.
 *
 * Extracted from the former onboarding wizard so the multi-profile editor can
 * reuse the same "selectable card list + Add custom…" UX.
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent } from '@renderer/components/ui/card';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Textarea } from '@renderer/components/ui/textarea';
import type { McpServerEntry } from '@shared/types';

/** Generic selectable-card list. Mirrors the old onboarding PickerStep. */
export function PickerStep<T extends { id: string; label?: string }>(props: {
  title?: string;
  subtitle?: string;
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderCard: (item: T) => React.ReactNode;
  /** Render function for the custom-add form. Null disables "Add custom". */
  renderAddCustom: ((onDone: () => void) => React.ReactElement) | null;
}): React.ReactElement {
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-3">
      {props.title && (
        <div>
          <p className="text-sm font-medium">{props.title}</p>
          {props.subtitle && (
            <p className="text-xs text-muted-foreground">{props.subtitle}</p>
          )}
        </div>
      )}
      {adding && props.renderAddCustom ? (
        props.renderAddCustom(() => void setAdding(false))
      ) : (
        <>
          <div className="space-y-2" role="radiogroup" aria-label={props.title ?? 'picker'}>
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
                <CardContent className="p-3">{props.renderCard(item)}</CardContent>
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
    </div>
  );
}

export function AddAgentForm({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}): React.ReactElement {
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

export function AddTaskManagerForm({
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
  const [createTaskInstructions, setCreateTaskInstructions] = React.useState('');
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
        createTaskInstructions: createTaskInstructions || null,
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
      <div className="space-y-1.5">
        <Label htmlFor="tm-create-task-instructions">Task-creation instructions (optional)</Label>
        <Textarea
          id="tm-create-task-instructions"
          value={createTaskInstructions}
          onChange={(e) => setCreateTaskInstructions(e.target.value)}
          placeholder={
            "e.g. Call mcp:omnifocus/add_omnifocus_task with parentTaskId={{parentTaskId}} and name='Review: {{parentTaskName}}'."
          }
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Tells the review-rule prompt which MCP tool to call. You can use{' '}
          {'{{parentTaskId}}'} / {'{{parentTaskName}}'} placeholders. Leave blank for a generic
          prompt.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : 'Save task manager'}
      </Button>
    </div>
  );
}

export function FormField(props: {
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

