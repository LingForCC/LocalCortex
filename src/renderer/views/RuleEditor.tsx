/**
 * Rule editor view — create/edit rules.
 *
 * Spec: docs/features/rules/README.md. A form over the Rule schema: NL rule text,
 * trigger (tick|event), mcpServers, backend, workdir, sandbox, and the
 * maxRuns/expiresAt backstops. The `rule` field is free text (the rule IS the
 * spec); everything else is the minimal structure to run it.
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useRulesStore } from '@renderer/store/rules';
import { useSettingsStore } from '@renderer/store/settings';
import { CODEX_REASONING_EFFORTS } from '@shared/constants';
import type { Rule, Trigger } from '@shared/types';

function newRule(): Rule {
  return {
    id: `r_${Date.now()}`,
    name: '',
    enabled: true,
    rule: '',
    trigger: { type: 'tick' },
    mcpServers: [],
    backend: 'claude',
    sandbox: 'read-only',
  };
}

export function RuleEditor({ rule, onDone }: { rule?: Rule; onDone?: () => void }) {
  const create = useRulesStore((s) => s.create);
  const update = useRulesStore((s) => s.update);
  const serverNames = useSettingsStore((s) => s.serverNames);

  // The list passes a partial/empty object when creating a new rule (`{} as Rule`),
  // so treat it as "new" whenever the incoming rule lacks the trigger
  // discriminator that every persisted rule has. `isEditing` drives draft init,
  // the title, and the create-vs-update branch in save().
  const isEditing = Boolean(rule && rule.trigger);
  const initialDraft = isEditing ? rule! : newRule();
  const [draft, setDraft] = React.useState<Rule>(initialDraft);
  const [mcpServersText, setMcpServersText] = React.useState((rule?.mcpServers ?? []).join(', '));
  const [error, setError] = React.useState<string | null>(null);

  function set<K extends keyof Rule>(key: K, value: Rule[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setTriggerType(type: 'tick' | 'event') {
    const trigger: Trigger = type === 'tick' ? { type: 'tick' } : { type: 'event', eventType: '' };
    set('trigger', trigger);
  }

  async function save() {
    setError(null);
    const mcpServers = mcpServersText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const toSave: Rule = { ...draft, mcpServers };

    // Basic client-side guard; the main process re-validates with Zod.
    if (!toSave.name.trim() || !toSave.rule.trim() || mcpServers.length === 0) {
      setError('Name, rule text, and at least one MCP server are required.');
      return;
    }
    if (toSave.trigger.type === 'event' && !toSave.trigger.eventType.trim()) {
      setError('Event-triggered rules require an eventType.');
      return;
    }

    try {
      if (isEditing) await update(toSave);
      else await create(toSave);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEditing ? `Edit ${rule!.name}` : 'New rule'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule">
            Rule (natural language) — the rule <em>is</em> the spec
          </Label>
          <Textarea
            id="rule"
            rows={5}
            placeholder="e.g. Fetch the status of MR !23494 from GitLab. If merged, create a Todoist task under 'Engineering' titled 'Merge MR !23494'."
            value={draft.rule}
            onChange={(e) => set('rule', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            For event-triggered rules, use <code>{'{{workdir}}'}</code>,{' '}
            <code>{'{{summary}}'}</code>, etc. — rendered from the event payload at run time.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="trigger">Trigger</Label>
            <Select
              id="trigger"
              value={draft.trigger.type}
              onChange={(e) => setTriggerType(e.target.value as 'tick' | 'event')}
            >
              <option value="tick">Tick (schedule)</option>
              <option value="event">Event (HTTP ingress)</option>
            </Select>
          </div>

          {draft.trigger.type === 'tick' ? (
            <div className="space-y-1.5">
              <Label htmlFor="interval">Interval (seconds, ≥ 300, optional)</Label>
              <Input
                id="interval"
                type="number"
                min={300}
                placeholder="default: global"
                value={draft.trigger.intervalSeconds ?? ''}
                onChange={(e) =>
                  set('trigger', {
                    type: 'tick',
                    ...(e.target.value ? { intervalSeconds: Number(e.target.value) } : {}),
                  })
                }
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="eventType">Event type</Label>
              <Input
                id="eventType"
                placeholder="e.g. codex.session-complete"
                value={draft.trigger.eventType}
                onChange={(e) => set('trigger', { type: 'event', eventType: e.target.value })}
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcpServers">MCP servers (comma-separated)</Label>
          <Input
            id="mcpServers"
            placeholder={serverNames.length ? serverNames.join(', ') : 'gitlab, todoist'}
            value={mcpServersText}
            onChange={(e) => setMcpServersText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Must match names defined in <code>~/.localcortex/mcp-servers.json</code>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="backend">Backend</Label>
            <Select
              id="backend"
              value={draft.backend}
              onChange={(e) => set('backend', e.target.value as Rule['backend'])}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sandbox">Sandbox</Label>
            <Select
              id="sandbox"
              value={draft.sandbox}
              onChange={(e) => set('sandbox', e.target.value as Rule['sandbox'])}
            >
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
            </Select>
          </div>
        </div>

        {draft.backend === 'codex' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="model">Codex model (optional)</Label>
              <Input
                id="model"
                placeholder="app default"
                value={draft.model ?? ''}
                onChange={(e) => set('model', e.target.value.trim() || undefined)}
              />
              <p className="text-xs text-muted-foreground">
                Override the app default. Blank = inherit from Settings.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="modelReasoningEffort">Codex reasoning effort (optional)</Label>
              <Select
                id="modelReasoningEffort"
                value={draft.modelReasoningEffort ?? ''}
                onChange={(e) =>
                  set(
                    'modelReasoningEffort',
                    (e.target.value || undefined) as Rule['modelReasoningEffort'],
                  )
                }
              >
                <option value="">app default</option>
                {CODEX_REASONING_EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Override the app default. Blank = inherit from Settings.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="workdir">Workdir (optional)</Label>
            <Input
              id="workdir"
              placeholder="per-rule scratch"
              value={draft.workdir ?? ''}
              onChange={(e) => set('workdir', e.target.value || undefined)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxRuns">maxRuns (optional)</Label>
            <Input
              id="maxRuns"
              type="number"
              min={1}
              placeholder="default: global"
              value={draft.maxRuns ?? ''}
              onChange={(e) => set('maxRuns', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiresAt">expiresAt (optional)</Label>
            <Input
              id="expiresAt"
              placeholder="ISO timestamp"
              value={draft.expiresAt ?? ''}
              onChange={(e) => set('expiresAt', e.target.value || undefined)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          {onDone && (
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button onClick={() => void save()}>{isEditing ? 'Save' : 'Create'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
