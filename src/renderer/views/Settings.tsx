/**
 * Settings view — global tick interval, concurrency cap, appearance, ingress
 * secret, and explicit CLI paths for the Codex / Claude Code backends.
 *
 * Spec: docs/architecture.md §6.4, §6.5, §6.5.1. The global default tick
 * interval applies when a rule omits its own; the concurrency cap bounds
 * concurrent agent runs across scheduler + event paths. The CLI path fields
 * override the SDK's bundled vendored binary: leave blank to auto-detect on
 * PATH (and otherwise fall back to the bundled binary).
 */

import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useSettingsStore } from '@renderer/store/settings';
import { APPEARANCES, CODEX_REASONING_EFFORTS } from '@shared/constants';
import type { AppSettings, AgentEntry, TaskManagerEntry } from '@shared/types';

export function Settings() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);
  const [agent, setAgent] = React.useState<AgentEntry | null>(null);
  const [taskManager, setTaskManager] = React.useState<TaskManagerEntry | null>(null);
  const [resetBusy, setResetBusy] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      if (settings.handoffAgentId) {
        setAgent(await window.api.agents.get(settings.handoffAgentId));
      } else {
        setAgent(null);
      }
      if (settings.handoffTaskManagerId) {
        setTaskManager(await window.api.taskManagers.get(settings.handoffTaskManagerId));
      } else {
        setTaskManager(null);
      }
    })();
  }, [settings.handoffAgentId, settings.handoffTaskManagerId]);

  const handleReset = async (): Promise<void> => {
    if (!confirm('Reset handoff setup? You can re-run onboarding from the Home tab.')) return;
    setResetBusy(true);
    setResetError(null);
    try {
      await window.api.handoffSetup.reset();
      await load();
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };

  const [tick, setTick] = React.useState(String(settings.tickIntervalSeconds));
  const [concurrency, setConcurrency] = React.useState(String(settings.concurrency));
  const [appearance, setAppearance] = React.useState<AppSettings['appearance']>(
    settings.appearance,
  );
  const [codexCliPath, setCodexCliPath] = React.useState(settings.codexCliPath ?? '');
  const [claudeCliPath, setClaudeCliPath] = React.useState(settings.claudeCliPath ?? '');
  const [codexModel, setCodexModel] = React.useState(settings.codexModel ?? '');
  const [codexReasoningEffort, setCodexReasoningEffort] = React.useState<
    AppSettings['codexReasoningEffort']
  >(settings.codexReasoningEffort);
  const [error, setError] = React.useState<string | undefined>();
  const [saved, setSaved] = React.useState(false);

  // Load persisted settings on mount; without this the inputs show the store's
  // hardcoded defaults instead of what's in the DB.
  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setTick(String(settings.tickIntervalSeconds));
    setConcurrency(String(settings.concurrency));
    setAppearance(settings.appearance);
    setCodexCliPath(settings.codexCliPath ?? '');
    setClaudeCliPath(settings.claudeCliPath ?? '');
    setCodexModel(settings.codexModel ?? '');
    setCodexReasoningEffort(settings.codexReasoningEffort);
  }, [settings]);

  async function save() {
    setError(undefined);
    setSaved(false);
    const err = await update({
      tickIntervalSeconds: Number(tick),
      concurrency: Number(concurrency),
      appearance,
      codexCliPath,
      claudeCliPath,
      codexModel,
      codexReasoningEffort,
    });
    if (err) setError(err);
    else setSaved(true);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Handoff setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Coding agent</span>
            <span className="text-sm font-medium">{agent?.label ?? 'Not set'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Task manager</span>
            <span className="text-sm font-medium">{taskManager?.label ?? 'Not set'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Review backend</span>
            <span className="text-sm font-medium">
              {settings.handoffBackend
                ? settings.handoffBackend === 'claude'
                  ? 'Claude'
                  : 'Codex'
                : 'Not set'}
            </span>
          </div>
          {resetError && <p className="text-sm text-destructive">{resetError}</p>}
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={resetBusy}
              onClick={() => void handleReset()}
            >
              {resetBusy ? 'Resetting…' : 'Reset setup'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Global settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tick">Default tick interval (seconds, ≥ 300)</Label>
            <Input
              id="tick"
              type="number"
              min={300}
              value={tick}
              onChange={(e) => setTick(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Applied to tick-triggered rules that don't set their own interval. Lowering it raises
              token cost linearly.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="concurrency">Concurrency cap</Label>
            <Input
              id="concurrency"
              type="number"
              min={1}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Max concurrent agent runs across the scheduler and event ingress.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appearance">Appearance</Label>
            <Select
              id="appearance"
              value={appearance}
              onChange={(e) => setAppearance(e.target.value as AppSettings['appearance'])}
            >
              {APPEARANCES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              <code>System</code> follows your OS color scheme. Applies immediately on save.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="codexCliPath">Codex CLI path</Label>
            <Input
              id="codexCliPath"
              type="text"
              placeholder="Auto-detect on PATH"
              value={codexCliPath}
              onChange={(e) => setCodexCliPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Absolute path to a locally installed <code>codex</code> binary. Leave blank to
              auto-detect on <code>PATH</code> (falls back to the bundled binary).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="claudeCliPath">Claude Code CLI path</Label>
            <Input
              id="claudeCliPath"
              type="text"
              placeholder="Auto-detect on PATH"
              value={claudeCliPath}
              onChange={(e) => setClaudeCliPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Absolute path to a locally installed <code>claude</code> binary. Leave blank to
              auto-detect on <code>PATH</code> (falls back to the bundled binary).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="codexModel">Codex model (default)</Label>
              <Input
                id="codexModel"
                type="text"
                placeholder="gpt-5.5"
                value={codexModel}
                onChange={(e) => setCodexModel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Model id used when a rule doesn't set its own. Free-text (e.g.{' '}
                <code>gpt-5.5</code>).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="codexReasoningEffort">Codex reasoning effort (default)</Label>
              <Select
                id="codexReasoningEffort"
                value={codexReasoningEffort}
                onChange={(e) =>
                  setCodexReasoningEffort(e.target.value as AppSettings['codexReasoningEffort'])
                }
              >
                {CODEX_REASONING_EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Applied to Codex rules that don't set their own effort.
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-muted-foreground">Saved.</p>}

          <div className="flex justify-end">
            <Button onClick={() => void save()}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
