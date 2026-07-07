/**
 * E2E for Observability (docs/features/observability/test-plan.md O-E1/E4/E5).
 *
 * Without credentials, runs record status `error` — that's exactly what these
 * cases assert: a run row appears after Run-now, the error message is visible in
 * the run detail, and the run is durably re-fetchable via IPC. Real agent
 * success / parsed `done` badges (O-E2 toolCalls, O-E3) need live credentials
 * and stay manual. The file-log path (O-E5's original intent) can't be
 * isolated on macOS, so the DB-backed run record stands in for it.
 */

import { test, expect } from './fixtures/app';

/** Click a sidebar nav button by its label. */
async function gotoTab(window: import('@playwright/test').Page, label: string): Promise<void> {
  await window.getByRole('button', { name: label }).click();
}

test.describe('Run history observability', () => {
  test('O-E1: a run appears after Run-now; O-E4: error run shows its message', async ({ app }) => {
    const { window } = app;

    // Create + run a rule (no credentials → the run records status `error`).
    await gotoTab(window, 'Rules');
    await window.getByRole('button', { name: 'New rule' }).click();
    await window.getByLabel('Name').fill('Observed rule');
    await window.getByLabel('Rule (natural language)').fill('Do something observable.');
    await window.getByLabel('MCP servers (comma-separated)').fill('gitlab');
    await window.getByRole('button', { name: 'Create' }).click();

    // Resolve the ruleId so we can match the run-history row (keyed on ruleId).
    const ruleId = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { rules: { list: () => Promise<Array<{ name: string; id: string }>> } };
        }
      ).api;
      const rules = await api.rules.list();
      return rules.find((r) => r.name === 'Observed rule')!.id;
    });

    // Click Run within the rule's row.
    await window
      .getByRole('row', { name: /Observed rule/ })
      .getByRole('button', { name: 'Run' })
      .click();

    // O-E1: a run row appears in Run history (keyed on ruleId).
    await gotoTab(window, 'Run history');
    const runRow = window.getByRole('row', { name: new RegExp(ruleId) });
    await expect(runRow).toBeVisible({ timeout: 20_000 });

    // The status cell shows the `error` badge.
    await expect(runRow.getByText('error')).toBeVisible();

    // O-E4: open the detail and the Result section surfaces the error text.
    await runRow.click();
    const resultPanel = window
      .locator('pre', { hasText: /run failed|API_KEY|placeholder|error/i })
      .first();
    await expect(resultPanel).toBeVisible();

    // O-E5: the run is durably recorded (re-fetchable via IPC after the fact),
    // confirming the observability write — the safety net under auto-execute.
    // (The electron-log FILE path — ~/Library/Logs/LocalCortex/main.log — is
    // resolved via app.getPath('logs') through macOS Cocoa and can't be
    // isolated by HOME / --user-data-dir alone, so it isn't asserted here; the
    // DB-backed run record is the isolatable, authoritative surface.)
    const persisted = await window.evaluate(async (id) => {
      const api = (
        window as unknown as {
          api: {
            runs: { list: (ruleId: unknown) => Promise<Array<{ ruleId: string; status: string }>> };
          };
        }
      ).api;
      return api.runs.list(id);
    }, ruleId);
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    expect(persisted[0]!.status).toBe('error');
  });
});
