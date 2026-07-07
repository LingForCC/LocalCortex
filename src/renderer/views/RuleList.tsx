/**
 * Rules list view — table of rules with enable/disable + edit + delete + run-now.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
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
import { useRulesStore } from '@renderer/store/rules';
import { useRunsStore } from '@renderer/store/runs';
import { RuleEditor } from './RuleEditor';
import type { Rule } from '@shared/types';

export function RuleList() {
  const rules = useRulesStore((s) => s.rules);
  const load = useRulesStore((s) => s.load);
  const setEnabled = useRulesStore((s) => s.setEnabled);
  const remove = useRulesStore((s) => s.remove);
  const trigger = useRunsStore((s) => s.trigger);

  const [editing, setEditing] = React.useState<Rule | null>(null);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (editing) {
    return <RuleEditor rule={editing} onDone={() => setEditing(null)} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Rules</CardTitle>
          <Button size="sm" onClick={() => setEditing({} as Rule)}>
            New rule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Enabled</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Backend</TableHead>
              <TableHead>Servers</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No rules yet. Click “New rule”.
                </TableCell>
              </TableRow>
            )}
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => void setEnabled(r.id, v)}
                    aria-label={`Toggle ${r.name}`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {r.name}
                  {r.disableReason && (
                    <div className="text-xs text-destructive">{r.disableReason}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{r.trigger.type}</Badge>
                </TableCell>
                <TableCell>{r.backend}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.mcpServers.join(', ')}
                </TableCell>
                <TableCell className="text-xs">{r.runCount}</TableCell>
                <TableCell className="space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void trigger(r.id).then(() => load())}
                  >
                    Run
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Delete rule "${r.name}"?`)) void remove(r.id);
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
