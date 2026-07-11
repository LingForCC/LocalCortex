/**
 * Home dashboard — the default tab after onboarding.
 *
 * Spec: docs/features/handoff-setup/README.md.
 *
 * Shows the current handoff setup (agent, task manager, backend, rule status)
 * and recent handoffs. A "Change setup" button re-opens the onboarding wizard.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useHandoffsStore } from '@renderer/store/handoffs';
import { useRulesStore } from '@renderer/store/rules';
import { useSettingsStore } from '@renderer/store/settings';
import type { AgentEntry, TaskManagerEntry } from '@shared/types';

export function Home({ onChangeSetup }: { onChangeSetup: () => void }): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const handoffs = useHandoffsStore((s) => s.handoffs);
  const loadHandoffs = useHandoffsStore((s) => s.load);
  const rules = useRulesStore((s) => s.rules);
  const loadRules = useRulesStore((s) => s.load);
  const [agent, setAgent] = React.useState<AgentEntry | null>(null);
  const [taskManager, setTaskManager] = React.useState<TaskManagerEntry | null>(null);

  React.useEffect(() => {
    void Promise.all([loadSettings(), loadHandoffs(), loadRules()]);
  }, [loadSettings, loadHandoffs, loadRules]);

  React.useEffect(() => {
    void (async () => {
      if (settings.handoffAgentId) {
        setAgent(await window.api.agents.get(settings.handoffAgentId));
      }
      if (settings.handoffTaskManagerId) {
        setTaskManager(await window.api.taskManagers.get(settings.handoffTaskManagerId));
      }
    })();
  }, [settings.handoffAgentId, settings.handoffTaskManagerId]);

  const handoffRule = rules.find((r) => r.id === settings.handoffRuleId) ?? null;
  const recentHandoffs = handoffs.slice(0, 5);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Handoff setup</CardTitle>
            <Button variant="outline" size="sm" onClick={onChangeSetup}>
              Change setup
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Row label="Coding agent" value={agent?.label ?? '—'} />
          <Row label="Task manager" value={taskManager?.label ?? '—'} />
          <Row
            label="Review backend"
            value={
              settings.handoffBackend === 'claude'
                ? 'Claude'
                : settings.handoffBackend === 'codex'
                  ? 'Codex'
                  : '—'
            }
          />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Handoff rule</span>
            {handoffRule ? (
              <Badge variant={handoffRule.enabled ? 'secondary' : 'outline'}>
                {handoffRule.enabled ? 'Active' : 'Disabled'}
              </Badge>
            ) : (
              <span className="text-sm">—</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. When you start prompting your coding agent, a handoff popup appears. Attach it to a
            parent task (e.g. <code className="text-xs">parentTaskId</code>).
          </p>
          <p>
            2. When the session completes, the handoff rule fires automatically and creates a review
            subtask in {taskManager?.label ?? 'your task manager'}.
          </p>
          <p>3. Review the agent's work at your leisure — the subtask reminds you.</p>
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

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
