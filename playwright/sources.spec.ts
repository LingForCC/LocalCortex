/**
 * E2E for MCP Sources (docs/features/mcp-sources/test-plan.md M-E1/E2/E4).
 *
 * The fixture's isolated HOME starts empty, so `ensureConfigFile` provisions a
 * fresh default ~/.localcortex/mcp-servers.json on launch with the three v1
 * servers (github, gitlab, todoist), each still carrying the
 * `<your-token-here>` placeholder.
 */

import { test, expect } from './fixtures/app';
import { join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';

/** Click a sidebar nav button by its label. */
async function gotoTab(window: import('@playwright/test').Page, label: string): Promise<void> {
  await window.getByRole('button', { name: label }).click();
}

/** Path to the isolated mcp-servers.json for a given HOME. */
function configPath(home: string): string {
  return join(home, '.localcortex', 'mcp-servers.json');
}

test.describe('MCP sources', () => {
  test('M-E1: default servers are provisioned and placeholders flagged', async ({ app }) => {
    const { window } = app;
    await gotoTab(window, 'Sources');

    // The three token-bearing servers render with a "· placeholder" suffix.
    for (const name of ['github', 'gitlab', 'todoist']) {
      await expect(window.getByText(`${name} · placeholder`)).toBeVisible();
    }
  });

  test('M-E2: Refresh picks up edits made to the file out of band', async ({ app }) => {
    const { window, home } = app;
    await gotoTab(window, 'Sources');
    // Wait for the initial load to settle.
    await expect(window.getByText('github · placeholder')).toBeVisible();

    // Append a brand-new server entry by rewriting the config file.
    const path = configPath(home);
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    cfg.servers['jira-acme'] = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/jira-mcp'],
      env: { JIRA_TOKEN: 'real-token' },
    };
    writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });

    await window.getByRole('button', { name: 'Refresh' }).click();

    // The new server appears as a bare chip (real token → no placeholder).
    await expect(window.getByText('jira-acme', { exact: true })).toBeVisible();
    await expect(window.getByText('jira-acme · placeholder')).toHaveCount(0);

    // And it shows up in the raw config panel.
    await expect(window.locator('pre', { hasText: 'jira-acme' })).toBeVisible();
  });

  test('M-E4: deleting the config then relaunching recreates it with 0600 perms', async ({
    app,
  }) => {
    const { home } = app;
    const path = configPath(home);
    expect(existsSync(path)).toBe(true);

    unlinkSync(path);
    expect(existsSync(path)).toBe(false);

    // Relaunch under the same HOME → ensureConfigFile re-provisions the default.
    await app.relaunch();

    await expect.poll(async () => existsSync(path), { timeout: 10_000 }).toBe(true);

    const perms = statSync(path).mode & 0o777;
    expect(perms).toBe(0o600);

    // The recreated file still parses and lists the three defaults.
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(cfg.servers).sort()).toEqual(['github', 'gitlab', 'todoist']);
  });
});
