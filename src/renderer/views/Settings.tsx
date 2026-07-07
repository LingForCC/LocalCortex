/**
 * Settings view — global tick interval, concurrency cap, ingress secret, and
 * explicit CLI paths for the Codex / Claude Code backends.
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
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useSettingsStore } from '@renderer/store/settings';

export function Settings() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);

  const [tick, setTick] = React.useState(String(settings.tickIntervalSeconds));
  const [concurrency, setConcurrency] = React.useState(String(settings.concurrency));
  const [codexCliPath, setCodexCliPath] = React.useState(settings.codexCliPath ?? '');
  const [claudeCliPath, setClaudeCliPath] = React.useState(settings.claudeCliPath ?? '');
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
    setCodexCliPath(settings.codexCliPath ?? '');
    setClaudeCliPath(settings.claudeCliPath ?? '');
  }, [settings]);

  async function save() {
    setError(undefined);
    setSaved(false);
    const err = await update({
      tickIntervalSeconds: Number(tick),
      concurrency: Number(concurrency),
      codexCliPath,
      claudeCliPath,
    });
    if (err) setError(err);
    else setSaved(true);
  }

  return (
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && !error && <p className="text-sm text-muted-foreground">Saved.</p>}

        <div className="flex justify-end">
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}
