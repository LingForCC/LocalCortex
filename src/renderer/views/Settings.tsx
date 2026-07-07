/**
 * Settings view — global tick interval + concurrency cap.
 *
 * Spec: docs/architecture.md §6.4, §6.5. The global default tick interval
 * applies when a rule omits its own; the concurrency cap bounds concurrent
 * agent runs across scheduler + event paths.
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

  // Load persisted settings on mount; without this the inputs show the store's
  // hardcoded defaults instead of what's in the DB.
  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setTick(String(settings.tickIntervalSeconds));
    setConcurrency(String(settings.concurrency));
  }, [settings]);

  async function save() {
    await update({
      tickIntervalSeconds: Number(tick),
      concurrency: Number(concurrency),
    });
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

        <div className="flex justify-end">
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}
