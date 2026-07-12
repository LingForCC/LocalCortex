/**
 * Home dashboard — the default tab.
 *
 * Spec: docs/features/handoff-profiles/README.md.
 *
 * Summarizes the configured handoff profiles (each agent → task manager →
 * backend) and recent handoffs. Profiles themselves are created/edited in the
 * Handoff profiles tab; when none exist, this view points the user there.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useHandoffsStore } from '@renderer/store/handoffs';
import { useHandoffProfilesStore } from '@renderer/store/handoff-profiles';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

export function Home({ onGoToHandoffProfiles }: { onGoToHandoffProfiles: () => void }): React.ReactElement {
  const handoffProfiles = useHandoffProfilesStore((s) => s.handoffProfiles);
  const loadHandoffProfiles = useHandoffProfilesStore((s) => s.load);
  const handoffs = useHandoffsStore((s) => s.handoffs);
  const loadHandoffs = useHandoffsStore((s) => s.load);

  React.useEffect(() => {
    void Promise.all([loadHandoffProfiles(), loadHandoffs()]);
  }, [loadHandoffProfiles, loadHandoffs]);

  const recentHandoffs = handoffs.slice(0, 5);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Handoff profiles</CardTitle>
            <Button variant="outline" size="sm" onClick={onGoToHandoffProfiles}>
              Manage handoff profiles
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {handoffProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No handoff profiles configured. Visit the Handoff profiles tab to set one up.
            </p>
          ) : (
            handoffProfiles.map((p) => (
              <HandoffProfileSummaryRow
                key={p.id}
                label={p.label}
                agentId={p.agentId}
                taskManagerId={p.taskManagerId}
                backend={p.backend}
                enabled={p.enabled}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. When you start prompting a coding agent, a handoff popup appears. Attach it to a
            parent task (e.g. <code className="text-xs">parentTaskId</code>).
          </p>
          <p>
            2. When the session completes, each matching handoff profile’s rule fires automatically
            and creates a review subtask in its task manager.
          </p>
          <p>3. Review the agent’s work at your leisure — the subtask reminds you.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent handoffs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentHandoffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No handoffs yet. Start a coding session and the popup will appear.
            </p>
          ) : (
            recentHandoffs.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-muted-foreground">{h.sessionId}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs">{h.reminderTitle ?? '—'}</span>
                  <Badge variant={h.enabled ? 'secondary' : 'outline'}>
                    {h.enabled ? 'On' : 'Off'}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HandoffProfileSummaryRow(props: {
  label: string;
  agentId: string;
  taskManagerId: string;
  backend: 'claude' | 'codex';
  enabled: boolean;
}): React.ReactElement {
  const [agent, setAgent] = React.useState<AgentEntry | null>(null);
  const [taskManager, setTaskManager] = React.useState<TaskManagerEntry | null>(null);

  React.useEffect(() => {
    void (async () => {
      setAgent(await window.api.agents.get(props.agentId));
      setTaskManager(await window.api.taskManagers.get(props.taskManagerId));
    })();
  }, [props.agentId, props.taskManagerId]);

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{props.label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {agent?.label ?? props.agentId} → {taskManager?.label ?? props.taskManagerId}
        </span>
        <Badge variant="outline">{props.backend}</Badge>
        <Badge variant={props.enabled ? 'secondary' : 'outline'}>
          {props.enabled ? 'Active' : 'Disabled'}
        </Badge>
      </div>
    </div>
  );
}
