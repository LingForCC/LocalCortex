/**
 * E2E for MCP Sources (docs/features/mcp-sources/test-plan.md — DB-backed UI).
 *
 * The Sources tab is now a CRUD table over the `mcp_servers` DB table (replacing
 * the old file viewer). These tests cover: seeded servers + placeholder flags
 * (HS-E8), adding via form mode (HS-E9), adding via JSON-paste mode (HS-E10),
 * and editing a builtin server (HS-E11).
 *
 * The fixture's isolated HOME starts empty, so migration 004 seeds the defaults
 * (github, gitlab, todoist, omnifocus) on first launch.
 */

import { test, expect } from './fixtures/app';
import type { Page } from '@playwright/test';

/** Click a sidebar nav button by its label. */
async function gotoTab(window: Page, label: string): Promise<void> {
  await window.getByRole('button', { name: 'Home' }).waitFor({ state: 'visible' });
  await window.getByRole('button', { name: label }).click();
}

test.describe('MCP sources (DB-backed CRUD)', () => {
  test('HS-E8: seeded servers listed + placeholder tokens flagged', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await gotoTab(window, 'Sources');

    // Each seeded server name should be visible.
    for (const name of ['github', 'gitlab', 'todoist', 'omnifocus']) {
      await expect(window.getByText(name, { exact: true })).toBeVisible();
    }

    // The three token-bearing servers show a Placeholder badge.
    await expect(window.getByText('Placeholder').first()).toBeVisible();
  });

  test('HS-E9: add a server via form mode', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await gotoTab(window, 'Sources');

    await window.getByRole('button', { name: 'Add server' }).click();
    await window.getByRole('button', { name: 'Form', exact: true }).click();

    await window.getByLabel('Name').fill('custom-form');
    await window.getByLabel('Command').fill('npx');
    await window.getByLabel('Args (one per line)').fill('-y\n@modelcontextprotocol/server-github');
    await window.getByRole('button', { name: 'Add env var' }).click();
    await window.locator('input[placeholder="KEY"]').first().fill('MY_TOKEN');
    await window.locator('input[placeholder="value"]').first().fill('tok_real');

    await window.getByRole('button', { name: 'Save' }).click();

    await expect(window.getByText('custom-form', { exact: true })).toBeVisible();
  });

  test('HS-E10: add a server via JSON-paste mode', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await gotoTab(window, 'Sources');

    await window.getByRole('button', { name: 'Add server' }).click();
    await window.getByRole('button', { name: 'JSON', exact: true }).click();

    await window.getByLabel('Name').fill('custom-json');
    await window.getByLabel('Paste server JSON').fill(
      JSON.stringify(
        {
          command: 'node',
          args: ['server.js'],
          env: { MY_API_KEY: 'key_real' },
        },
        null,
        2,
      ),
    );

    await window.getByRole('button', { name: 'Save' }).click();

    await expect(window.getByText('custom-json', { exact: true })).toBeVisible();
  });

  test('HS-E11: edit a builtin server (update token)', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await gotoTab(window, 'Sources');

    // Click the first Edit button (github is alphabetically first among the
    // builtin servers). Use the first to avoid ambiguity.
    await window.getByRole('button', { name: 'Edit' }).first().click();

    // In form mode, the env var value input holds the placeholder token.
    // Replace it with a real token.
    await window.locator('input[placeholder="value"]').first().fill('ghp_real_token');

    await window.getByRole('button', { name: 'Save' }).click();

    // After saving, the editor closes. Verify the token was updated via IPC
    // (more reliable than counting Placeholder badges in the DOM).
    await expect(window.getByRole('button', { name: 'Save' })).toHaveCount(0);

    const github = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { mcpServers: { get: (name: string) => Promise<{ env: Record<string, string> } | null> } };
        }
      ).api;
      return api.mcpServers.get('github');
    });
    expect(github?.env['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_real_token');
  });
});
