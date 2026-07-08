/**
 * Handoffs view — register and watch agent-session handoffs (pending reviews).
 *
 * A handoff correlates an agent session id with free-form context that gets
 * merged into a session-complete event when that session ends, so an
 * event-triggered rule can act (e.g. create a review subtask).
 *
 * The context is a free-form key-value map (Level-2 abstraction): the user
 * registers whatever keys their fulfilling rule's prompt renders, e.g.
 * `{ parentTaskId: 'o2LOz5FWVIj', taskManager: 'omnifocus' }`. LocalCortex has
 * no domain knowledge of any task manager.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { useHandoffsStore } from '@renderer/store/handoffs';
import type { HandoffStatus } from '@shared/types';

/** A mutable context row in the registration form. */
interface ContextRow {
  key: string;
  value: string;
}

/** Badge variant for a handoff status. */
function statusVariant(status: HandoffStatus): 'warning' | 'success' | 'secondary' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'fulfilled':
      return 'success';
    case 'cancelled':
      return 'secondary';
  }
}

export function Handoffs() {
  const handoffs = useHandoffsStore((s) => s.handoffs);
  const load = useHandoffsStore((s) => s.load);
  const create = useHandoffsStore((s) => s.create);
  const remove = useHandoffsStore((s) => s.remove);

  // Registration form state.
  const [sessionId, setSessionId] = React.useState('');
  const [reminderTitle, setReminderTitle] = React.useState('');
  const [contextRows, setContextRows] = React.useState<ContextRow[]>([
    { key: 'parentTaskId', value: '' },
  ]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Update a single context row's key or value. */
  const updateRow = (idx: number, patch: Partial<ContextRow>): void => {
    setContextRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = (): void => setContextRows((rows) => [...rows, { key: '', value: '' }]);

  const removeRow = (idx: number): void =>
    setContextRows((rows) => rows.filter((_, i) => i !== idx));

  const submit = async (): Promise<void> => {
    setError(null);
    if (!sessionId.trim()) {
      setError('Session id is required.');
      return;
    }
    // Build the context map, dropping rows with empty keys.
    const context: Record<string, string> = {};
    for (const row of contextRows) {
      const k = row.key.trim();
      if (k) context[k] = row.value;
    }
    if (Object.keys(context).length === 0) {
      setError('At least one context entry (e.g. parentTaskId) is required.');
      return;
    }
    try {
      await create({
        sessionId: sessionId.trim(),
        context,
        reminderTitle: reminderTitle.trim() || undefined,
      });
      // Reset the form.
      setSessionId('');
      setReminderTitle('');
      setContextRows([{ key: 'parentTaskId', value: '' }]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New handoff</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-id">Agent session id</Label>
            <Input
              id="session-id"
              placeholder="sess_c286a04e-97d9-4856-b8f1-e1275558a464"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The ZCode / Codex / Claude session to watch. Auto-captured by the completion hook;
              paste it here once.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Context</Label>
            <p className="text-xs text-muted-foreground">
              Key-values merged into the completion event so a rule can render{' '}
              <code className="rounded bg-muted px-1">{'{{key}}'}</code> in its prompt (e.g.{' '}
              <code className="rounded bg-muted px-1">parentTaskId</code>,{' '}
              <code className="rounded bg-muted px-1">taskManager</code>).
            </p>
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

          <div className="flex justify-end">
            <Button onClick={() => void submit()}>Register handoff</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Handoffs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Reminder</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {handoffs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No handoffs registered.
                  </TableCell>
                </TableRow>
              )}
              {handoffs.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <Badge variant={statusVariant(h.status)}>{h.status}</Badge>
                  </TableCell>
                  <TableCell
                    className="max-w-[16rem] truncate font-mono text-xs"
                    title={h.sessionId}
                  >
                    {h.sessionId}
                  </TableCell>
                  <TableCell className="max-w-[20rem] truncate text-xs text-muted-foreground">
                    {Object.entries(h.context)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', ')}
                  </TableCell>
                  <TableCell className="text-xs">{h.reminderTitle ?? '—'}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void remove(h.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
