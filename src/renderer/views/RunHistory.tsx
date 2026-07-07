/**
 * Run history view — per-rule run list + tool-call inspection.
 *
 * Spec: docs/architecture.md §4 (renderer/run-history). Each run shows status,
 * trigger, duration, token usage, and the parsed status block; the agent's
 * final text and tool calls are inspectable. The observability surface under
 * auto-execute.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { useRunsStore } from '@renderer/store/runs';
import type { Run } from '@shared/types';

function statusBadge(status: Run['status']): React.ReactNode {
  return <Badge variant={status === 'success' ? 'success' : 'destructive'}>{status}</Badge>;
}

function parsedStatusBadge(parsed?: Run['parsedStatus']): React.ReactNode {
  if (!parsed) return <span className="text-muted-foreground">—</span>;
  const variant =
    parsed.status === 'done' ? 'success' : parsed.status === 'error' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{parsed.status}</Badge>;
}

export function RunHistory() {
  const runs = useRunsStore((s) => s.runs);
  const load = useRunsStore((s) => s.load);
  const loading = useRunsStore((s) => s.loading);
  const [selected, setSelected] = React.useState<Run | null>(null);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Parsed</TableHead>
                <TableHead>Tokens (in/out)</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              )}
              {runs.map((r) => (
                <TableRow key={r.id} onClick={() => setSelected(r)} className="cursor-pointer">
                  <TableCell>{r.id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.ruleId}</TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell>{parsedStatusBadge(r.parsedStatus)}</TableCell>
                  <TableCell className="text-xs">
                    {r.inputTokens ?? '?'}/{r.outputTokens ?? '?'}
                  </TableCell>
                  <TableCell className="text-xs">{r.durationMs ?? '?'}ms</TableCell>
                  <TableCell className="text-xs">{r.startedAt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Run #{selected.id}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="mb-1 text-sm font-medium">Prompt</h4>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                {selected.prompt}
              </pre>
            </div>
            <div>
              <h4 className="mb-1 text-sm font-medium">Result</h4>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                {selected.result ?? selected.error ?? '(no output)'}
              </pre>
            </div>
            <div>
              <h4 className="mb-1 text-sm font-medium">Tool calls ({selected.toolCalls.length})</h4>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(selected.toolCalls, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
