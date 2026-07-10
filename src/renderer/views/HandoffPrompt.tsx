/**
 * Handoff-attach popup — rendered in the separate prompt-submit popup window
 * (loaded via `?view=handoff-prompt`; see src/main/index.ts openHandoffPrompt).
 *
 * Spec: docs/features/handoffs/README.md → "Prompt-submit prompt".
 *
 * The main process pushes a `HandoffPromptPayload` on load:
 *   - mode 'new'      → no handoff exists for this session; render the attach
 *                       form (prefilled sessionId, dynamic context rows,
 *                       optional reminder title).
 *   - mode 'existing' → a handoff already exists; render its state with an
 *                       enable/disable toggle.
 *
 * Mirrors the Handoffs.tsx form, but standalone (no sidebar) and self-closing.
 * Reuses the existing shadcn-style primitives; no new dependencies.
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import type { HandoffPromptPayload } from '@shared/schemas/ipc-schema';

/** A mutable context row in the attach form. */
interface ContextRow {
  key: string;
  value: string;
}

export function HandoffPrompt() {
  const [payload, setPayload] = React.useState<HandoffPromptPayload | null>(null);

  // Subscribe to the prompt push from the main process. The window is loaded
  // with no state; the payload arrives once the renderer finishes loading (and
  // again on any re-focus for an already-open popup).
  React.useEffect(() => {
    const off = window.api.handoffs.onPrompt((p) => setPayload(p));
    return off;
  }, []);

  if (!payload) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-screen overflow-auto p-4">
      {payload.mode === 'new' ? (
        <NewSessionForm payload={payload} />
      ) : (
        <ExistingSessionToggle payload={payload} />
      )}
    </div>
  );
}

/** "New session" → attach-handoff form. */
function NewSessionForm({ payload }: { payload: HandoffPromptPayload }) {
  const [reminderTitle, setReminderTitle] = React.useState('');
  const [contextRows, setContextRows] = React.useState<ContextRow[]>([
    { key: 'parentTaskId', value: '' },
  ]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const updateRow = (idx: number, patch: Partial<ContextRow>): void => {
    setContextRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = (): void => setContextRows((rows) => [...rows, { key: '', value: '' }]);
  const removeRow = (idx: number): void =>
    setContextRows((rows) => rows.filter((_, i) => i !== idx));

  const submit = async (): Promise<void> => {
    setError(null);
    const context: Record<string, string> = {};
    for (const row of contextRows) {
      const k = row.key.trim();
      if (k) context[k] = row.value;
    }
    if (Object.keys(context).length === 0) {
      setError('At least one context entry (e.g. parentTaskId) is required.');
      return;
    }
    setBusy(true);
    try {
      await window.api.handoffs.create({
        sessionId: payload.sessionId,
        context,
        reminderTitle: reminderTitle.trim() || undefined,
      });
      window.close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{payload.source} session handoff</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Attach handoff context so that when this session completes, your rule can render{' '}
          <code className="rounded bg-muted px-1">{'{{key}}'}</code> variables into its prompt (e.g.
          create a review subtask).
        </p>

        <div className="space-y-1.5">
          <Label>Agent session id</Label>
          <Input value={payload.sessionId} readOnly className="font-mono text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label>Context</Label>
          <div className="space-y-2">
            {contextRows.map((row, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="key"
                  value={row.key}
                  onChange={(e) => updateRow(idx, { key: e.target.value })}
                />
                <Input
                  className="flex-1"
                  placeholder="value"
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(idx)}
                  aria-label="Remove context entry"
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addRow}>
            + Add context
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reminder-title">Reminder title (optional)</Label>
          <Input
            id="reminder-title"
            placeholder="Review agent work"
            value={reminderTitle}
            onChange={(e) => setReminderTitle(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => window.close()}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Attaching…' : 'Attach handoff'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** "Existing session" → enable/disable toggle. */
function ExistingSessionToggle({ payload }: { payload: HandoffPromptPayload }) {
  const handoff = payload.handoff;
  const [enabled, setEnabled] = React.useState(handoff?.enabled ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // If the main process re-pushes an updated payload (e.g. after a toggle on a
  // re-focus), keep the switch in sync with the canonical row state.
  React.useEffect(() => {
    if (handoff) setEnabled(handoff.enabled);
  }, [handoff]);

  const toggle = async (next: boolean): Promise<void> => {
    if (!handoff) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.handoffs.setEnabled(handoff.id, next);
      setEnabled(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session resumed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Agent session id</Label>
          <Input value={payload.sessionId} readOnly className="font-mono text-xs" />
        </div>

        {handoff?.reminderTitle && (
          <div className="space-y-1.5">
            <Label>Reminder</Label>
            <p className="text-sm">{handoff.reminderTitle}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={busy}
            aria-label="Toggle handoff"
          />
          <span className="text-sm">
            {enabled ? 'Handoff enabled — fires on every session-complete.' : 'Handoff disabled.'}
          </span>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={() => window.close()}>Done</Button>
        </div>
      </CardContent>
    </Card>
  );
}
