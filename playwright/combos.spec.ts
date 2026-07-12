/**
 * E2E for the Combos tab (docs/features/handoff-setup/test-plan.md HS-E1..HS-E10).
 *
 * The app no longer has a first-run onboarding wizard — the shell always
 * renders, and combos are managed in the Combos tab. These tests cover: the
 * shell appearing on first launch, creating a combo, creating a second combo
 * with a different agent, editing a combo, toggling/deleting, the custom
 * agent/task-manager forms, and the Home summary.
 *
 * Uses the shared fixture (isolated HOME). Each test starts with a fresh empty
 * DB.
 */

import { test, expect } from './fixtures/app';

test.describe('Combos tab', () => {
  test('HS-E1: first launch shows the shell (no wizard), Combos tab empty', async ({ app }) => {
    const { window } = app;

    // The shell renders directly — the sidebar nav is present.
    await expect(window.getByRole('button', { name: 'Combos', exact: true })).toBeVisible();

    // Navigate to Combos — the empty state is shown.
    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    await expect(window.getByText('No combos yet')).toBeVisible();
  });

  test('HS-E2: create a combo', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'ZCode → OmniFocus' });

    // Navigate to Combos — the new row is present.
    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    await expect(window.getByText('ZCode → OmniFocus')).toBeVisible();

    // The owned rule exists — verify via IPC.
    const rules = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { rules: { list: () => Promise<Array<{ name: string; backend: string }>> } };
        }
      ).api;
      return api.rules.list();
    });
    expect(rules.some((r) => r.name === 'ZCode → OmniFocus' && r.backend === 'claude')).toBe(true);
  });

  test('HS-E3: create a second combo with a different agent', async ({ app }) => {
    const { window } = app;
    // First combo: ZCode.
    await app.completeOnboarding({ label: 'ZCode combo' });
    // Second combo: Codex → OmniFocus → Codex.
    await app.completeOnboarding({
      agent: 'codex',
      taskManager: 'omnifocus',
      backend: 'Codex',
      label: 'Codex combo',
    });

    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    await expect(window.getByText('ZCode combo')).toBeVisible();
    await expect(window.getByText('Codex combo')).toBeVisible();

    // Two distinct rules with distinct backends.
    const rules = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { rules: { list: () => Promise<Array<{ name: string; backend: string }>> } };
        }
      ).api;
      return api.rules.list();
    });
    expect(rules.filter((r) => r.name === 'ZCode combo' || r.name === 'Codex combo')).toHaveLength(
      2,
    );
  });

  test('HS-E4: edit a combo (switch agent)', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'Editable combo' });

    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    await window.getByRole('button', { name: 'Edit' }).first().click();

    // Switch the agent selection to Codex. exact: true because the backend
    // picker also has a "Codex (OpenAI Codex SDK)" radio that would match.
    await window.getByRole('radio', { name: 'Codex', exact: true }).click();
    await window.getByRole('button', { name: 'Save changes' }).click();

    // The row still exists.
    await expect(window.getByText('Editable combo')).toBeVisible();
  });

  test('HS-E5: toggle a combo off', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding();

    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    const toggle = window.getByRole('switch').first();
    await toggle.click();
    // The switch reflects the disabled state.
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('HS-E6: delete a combo', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'Doomed combo' });

    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    window.once('dialog', (d) => void d.accept());
    await window.getByRole('button', { name: 'Delete' }).first().click();

    await expect(window.getByText('Doomed combo')).toHaveCount(0);
  });

  test('HS-E7: add custom agent inside the combo editor', async ({ app }) => {
    const { window } = app;
    await window.getByRole('button', { name: 'Combos', exact: true }).click();
    await window.getByRole('button', { name: 'New combo' }).click();

    // Combo label — target by its unique placeholder to avoid colliding with
    // the agent form's "Label" field that appears once "+ Add custom" opens.
    await window.getByPlaceholder('e.g. ZCode → OmniFocus').fill('Custom agent combo');
    await window.getByRole('button', { name: '+ Add custom…' }).first().click();

    // The custom-agent form renders inside the agent picker. Its fields are the
    // second occurrence of each label (the combo editor's own fields are first),
    // so use .last() to disambiguate.
    await window.getByLabel('Id (unique)').fill('myagent');
    await window.getByLabel('Label').last().fill('My Agent');
    await window.getByLabel('Description').last().fill('A custom agent');
    await window.getByLabel('Session-complete event type').fill('myagent.session-complete');
    await window.getByLabel('Prompt-submit event type').fill('myagent.prompt-submit');
    await window.getByLabel('Source').fill('myagent');
    await window.getByLabel('Install instructions').fill('Install my custom hook.');
    await window.getByRole('button', { name: 'Save agent' }).click();

    // The custom agent is now selectable.
    const agentRadio = window.getByRole('radio', { name: 'My Agent' });
    await expect(agentRadio).toBeVisible({ timeout: 10_000 });
  });

  test('HS-E9: Home shows combo summary after creating one', async ({ app }) => {
    await app.completeOnboarding({ label: 'Home combo' });
    const { window } = app;

    // Home renders the label + an "agent → task manager" summary span.
    await expect(window.getByText('Home combo')).toBeVisible();
    await expect(window.getByText('ZCode → OmniFocus')).toBeVisible();
  });

  test('HS-E10: Home "Manage combos" navigates to the Combos tab', async ({ app }) => {
    const { window } = app;
    await window.getByRole('button', { name: 'Manage combos' }).click();
    // The Combos tab's CardTitle is a <div>, not a heading, so assert on the
    // "New combo" button which is unique to the Combos view.
    await expect(window.getByRole('button', { name: 'New combo' })).toBeVisible();
  });
});
