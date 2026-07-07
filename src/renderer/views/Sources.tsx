/**
 * Sources view — manage MCP server connections (the user-editable
 * ~/.localcortex/mcp-servers.json) and flag placeholder tokens.
 *
 * Spec: docs/mcp-servers.md, docs/architecture.md §4 (renderer/sources).
 * The file is edited by the user out of band; this view surfaces its current
 * contents, lists configured servers, and flags any still holding the
 * `<your-token-here>` placeholder.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { useSettingsStore } from '@renderer/store/settings';

export function Sources() {
  const serverNames = useSettingsStore((s) => s.serverNames);
  const placeholders = useSettingsStore((s) => s.placeholders);
  const load = useSettingsStore((s) => s.load);
  const [raw, setRaw] = React.useState<string>('');

  async function refresh() {
    await load();
    try {
      const config = await window.api.servers.read();
      setRaw(JSON.stringify(config, null, 2));
    } catch {
      setRaw('(unable to read mcp-servers.json)');
    }
  }

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>MCP servers</CardTitle>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Configured in <code className="text-xs">~/.localcortex/mcp-servers.json</code>. Edit the
            file to add servers or fill in tokens.
          </p>
          <div className="flex flex-wrap gap-2">
            {serverNames.map((name) => (
              <Badge key={name} variant={placeholders.includes(name) ? 'warning' : 'secondary'}>
                {name}
                {placeholders.includes(name) && ' · placeholder'}
              </Badge>
            ))}
            {serverNames.length === 0 && (
              <span className="text-sm text-muted-foreground">No servers configured.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw config</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{raw}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
