/**
 * Sources view — manage MCP server configs (the DB-backed mcp_servers table).
 *
 * Spec: docs/features/mcp-sources/README.md.
 *
 * Replaces the old read-only file viewer. Supports Add/Edit via two modes:
 *  - Form mode: name, command, args (one per line), env key/value rows.
 *  - JSON-paste mode: paste the exact { command, args, env } block.
 *
 * Builtin (seeded) servers are editable but not deletable. The `<your-token-here>`
 * placeholder is flagged so users know which servers need tokens.
 */

import * as React from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Textarea } from '@renderer/components/ui/textarea';
import { PLACEHOLDER_TOKEN } from '@shared/constants';
import type { McpServerEntry } from '@shared/types';

type EditMode = 'form' | 'json';

interface EnvRow {
  key: string;
  value: string;
}

export function Sources(): React.ReactElement {
  const [servers, setServers] = React.useState<McpServerEntry[]>([]);
  const [editing, setEditing] = React.useState<McpServerEntry | null>(null);
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setServers(await window.api.mcpServers.list());
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async (name: string): Promise<void> => {
    if (!confirm(`Delete server '${name}'?`)) return;
    await window.api.mcpServers.delete(name);
    void refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>MCP servers</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              + Add server
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            MCP servers are the external systems rules can touch (GitHub, GitLab, Todoist,
            OmniFocus, …). Add one via form or paste a JSON block. Servers holding the{' '}
            <code className="text-xs">{PLACEHOLDER_TOKEN}</code> placeholder need a real token
            before they'll work.
          </p>
          {servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No servers configured.</p>
          ) : (
            <div className="space-y-2">
              {servers.map((s) => {
                const hasPlaceholder = Object.values(s.env).some((v) =>
                  v.includes(PLACEHOLDER_TOKEN),
                );
                return (
                  <div
                    key={s.name}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {s.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                        {hasPlaceholder && <Badge variant="warning">Placeholder</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.command} {s.args.join(' ')}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      {!s.isBuiltin && (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(s.name)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ServerEditor
          server={editing}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void refresh();
          }}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ServerEditor(props: {
  server: McpServerEntry | null;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const isEditing = !!props.server;
  const [mode, setMode] = React.useState<EditMode>('form');
  const [name, setName] = React.useState(props.server?.name ?? '');
  const [command, setCommand] = React.useState(props.server?.command ?? '');
  const [argsText, setArgsText] = React.useState((props.server?.args ?? []).join('\n'));
  const [envRows, setEnvRows] = React.useState<EnvRow[]>(
    Object.entries(props.server?.env ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [jsonText, setJsonText] = React.useState(
    JSON.stringify(
      {
        command: props.server?.command ?? '',
        args: props.server?.args ?? [],
        env: props.server?.env ?? {},
      },
      null,
      2,
    ),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const addEnvRow = (): void => setEnvRows((r) => [...r, { key: '', value: '' }]);
  const updateEnvRow = (i: number, patch: Partial<EnvRow>): void =>
    setEnvRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeEnvRow = (i: number): void => setEnvRows((r) => r.filter((_, idx) => idx !== i));

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      let input: Omit<McpServerEntry, 'createdAt' | 'updatedAt'>;
      if (mode === 'json') {
        const parsed = JSON.parse(jsonText) as {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        };
        if (!parsed.command) throw new Error('JSON must include a "command" field.');
        input = {
          name: name || props.server!.name,
          transport: 'stdio',
          command: parsed.command,
          args: Array.isArray(parsed.args) ? parsed.args : [],
          env: parsed.env ?? {},
          isBuiltin: props.server?.isBuiltin ?? false,
        };
      } else {
        if (!name.trim()) throw new Error('Name is required.');
        if (!command.trim()) throw new Error('Command is required.');
        const env: Record<string, string> = {};
        for (const row of envRows) {
          const k = row.key.trim();
          if (k) env[k] = row.value;
        }
        input = {
          name: name.trim(),
          transport: 'stdio',
          command: command.trim(),
          args: argsText
            .split('\n')
            .map((a) => a.trim())
            .filter(Boolean),
          env,
          isBuiltin: props.server?.isBuiltin ?? false,
        };
      }
      await window.api.mcpServers.upsert(input);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{isEditing ? `Edit ${props.server!.name}` : 'Add server'}</CardTitle>
          <div className="flex gap-1">
            <Button
              variant={mode === 'form' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('form')}
            >
              Form
            </Button>
            <Button
              variant={mode === 'json' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('json')}
            >
              JSON
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'form' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEditing && props.server!.isBuiltin}
                placeholder="my-server"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="server-command">Command</Label>
              <Input
                id="server-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="server-args">Args (one per line)</Label>
              <Textarea
                id="server-args"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={3}
                placeholder={'-y\n@modelcontextprotocol/server-github'}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Environment variables</Label>
              <div className="space-y-2">
                {envRows.map((row, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="KEY"
                      value={row.key}
                      onChange={(e) => updateEnvRow(idx, { key: e.target.value })}
                    />
                    <Input
                      className="flex-1"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => updateEnvRow(idx, { value: e.target.value })}
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeEnvRow(idx)}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addEnvRow}>
                + Add env var
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            {!isEditing && (
              <div className="space-y-1.5">
                <Label htmlFor="server-name-json">Name</Label>
                <Input
                  id="server-name-json"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-server"
                />
              </div>
            )}
            <Label htmlFor="server-json">Paste server JSON</Label>
            <Textarea
              id="server-json"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Paste the <code>{'{ "command", "args", "env" }'}</code> block from an MCP server's
              README.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
