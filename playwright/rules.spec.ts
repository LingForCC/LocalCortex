/**
 * E2E for the Rules feature (docs/features/rules/test-plan.md R-E1..R-E6).
 *
 * Drives the real renderer: RuleList table + RuleEditor form, covering authoring,
 * persistence, toggle, delete, client-side validation, and run-now enqueue.
 * These run against an isolated HOME (see fixtures/app.ts) so they never touch
 * the operator's real DB.
 *
 * Real agent reasoning is not automated (tech-stack.md §5): R-E6 asserts the
 * enqueue/recording, not a successful run — a run row with status `error` is the
 * expected outcome without credentials, and is what the run-loop now records.
 */

import { test, expect } from './fixtures/app';
import type { Page } from '@playwright/test';

/** Click a sidebar nav button by its label. */
async function gotoTab(window: Page, label: string): Promise<void> {
  // Ensure the shell is fully rendered before clicking (the onboarding→shell
  // transition is async; clicking too early can miss the handler).
  await window.getByRole('button', { name: 'Home' }).waitFor({ state: 'visible' });
  await window.getByRole('button', { name: label }).click();
  // Wait for the tab content to render so subsequent locators are stable.
  if (label === 'Rules') {
    await expect(window.getByRole('button', { name: 'New rule' })).toBeVisible();
  }
}

/**
 * Open the New Rule editor, fill the required fields, and submit.
 * Returns the values used plus the created rule's id (so callers can match the
 * run-history row, which is keyed on ruleId, not rule name).
 */
async function createRuleViaUi(
  window: Page,
  opts: { name?: string; rule?: string; mcpServers?: string } = {},
): Promise<{ name: string; rule: string; mcpServers: string; ruleId: string }> {
  const name = opts.name ?? 'Test rule';
  const rule = opts.rule ?? 'Fetch the status of MR !123 from GitLab.';
  const mcpServers = opts.mcpServers ?? 'gitlab';

  await gotoTab(window, 'Rules');
  await window.getByRole('button', { name: 'New rule' }).click();
  await window.getByLabel('Name').fill(name);
  await window.getByLabel('Rule (natural language)').fill(rule);
  await window.getByLabel('MCP servers (comma-separated)').fill(mcpServers);
  await window.getByRole('button', { name: 'Create' }).click();

  // Row appears in the table (and wait for it so subsequent lookups are stable).
  const row = window.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();

  // Resolve the persisted ruleId via IPC (the editor generates r_<timestamp>).
  const rules = await window.evaluate(async () => {
    const api = (
      window as unknown as {
        api: { rules: { list: () => Promise<Array<{ name: string; id: string }>> } };
      }
    ).api;
    return api.rules.list();
  });
  const created = rules.find((r) => r.name === name);
  if (!created) throw new Error(`created rule '${name}' not found via rules:list`);

  return { name, rule, mcpServers, ruleId: created.id };
}

test.describe('Rules CRUD (R-E1..R-E5)', () => {
  test('R-E1: create a rule via the UI and it persists across reload', async ({ app }) => {
    await app.completeOnboarding();
    const created = await createRuleViaUi(app.window, { name: 'Persisted rule' });

    // Row appears in the table immediately.
    await expect(app.window.getByRole('row', { name: /Persisted rule/ })).toBeVisible();

    // Relaunch the app and confirm the row survived (DB-backed).
    await app.relaunch();
    await gotoTab(app.window, 'Rules');
    await expect(app.window.getByRole('row', { name: /Persisted rule/ })).toBeVisible();
    expect(created.name).toBe('Persisted rule');
  });

  test('R-E2: edit a rule and the row updates', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await createRuleViaUi(window, { name: 'Before edit' });

    await window
      .getByRole('row', { name: /Before edit/ })
      .getByRole('button', { name: 'Edit' })
      .click();
    await window.getByLabel('Name').fill('After edit');
    await window.getByRole('button', { name: 'Save' }).click();

    await expect(window.getByRole('row', { name: /After edit/ })).toBeVisible();
    await expect(window.getByRole('row', { name: /Before edit/ })).toHaveCount(0);
  });

  test('R-E3: toggling enabled flips and persists across reload', async ({ app }) => {
    await app.completeOnboarding();
    await createRuleViaUi(app.window, { name: 'Toggle me' });

    // Resolve the switch lazily off app.window so it stays valid after relaunch.
    const toggle = () => app.window.getByRole('switch', { name: 'Toggle Toggle me' });
    await expect(toggle()).toHaveAttribute('aria-checked', 'true');

    await toggle().click();
    await expect(toggle()).toHaveAttribute('aria-checked', 'false');

    // Persist across relaunch (app.window is rebound after relaunch).
    await app.relaunch();
    await gotoTab(app.window, 'Rules');
    await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  test('R-E4: delete a rule removes the row', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    // Auto-accept the window.confirm() the Delete button triggers.
    window.once('dialog', (d) => void d.accept());
    await createRuleViaUi(window, { name: 'Delete me' });

    // Scope Delete to the specific row (the combo's auto-created rule also has a Delete).
    await window
      .getByRole('row', { name: /Delete me/ })
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(window.getByRole('row', { name: /Delete me/ })).toHaveCount(0);
  });

  test('R-E5: empty rule text shows inline validation and saves nothing', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    await gotoTab(window, 'Rules');
    await window.getByRole('button', { name: 'New rule' }).click();

    // Submit with everything empty.
    await window.getByRole('button', { name: 'Create' }).click();

    // The client-side guard renders a destructive error paragraph.
    await expect(window.getByText(/required/i)).toBeVisible();

    // Cancel back to the list. The combo's auto-created rule is still there,
    // so we assert the editor is gone (no Create/Cancel button) rather than
    // the old "No rules yet" empty state.
    await window.getByRole('button', { name: 'Cancel' }).click();
    await expect(window.getByRole('button', { name: 'New rule' })).toBeVisible();
    await expect(window.getByText(/required/i)).toHaveCount(0);
  });
});

test.describe('Run-now (R-E6)', () => {
  test('Run-now enqueues and a run row appears', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;
    const { ruleId } = await createRuleViaUi(window, { name: 'Run me' });

    // Click Run within the rule's row (fire-and-forget enqueue). Without
    // credentials the run records status `error` — that's expected; the enqueue
    // is what we assert.
    const row = window.getByRole('row', { name: /Run me/ });
    await row.getByRole('button', { name: 'Run' }).click();

    // Switch to Run history and wait for a row to land. The history row is keyed
    // on ruleId (not the rule name), so match on the ruleId.
    await gotoTab(window, 'Run history');
    await expect(window.getByRole('row', { name: new RegExp(ruleId) })).toBeVisible({
      timeout: 20_000,
    });
  });
});
