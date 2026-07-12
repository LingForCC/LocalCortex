/**
 * E2E for the Handoff profiles tab
 * (docs/features/handoff-profiles/test-plan.md HS-E1..HS-E10).
 *
 * The app no longer has a first-run onboarding wizard — the shell always
 * renders, and handoff profiles are managed in the Handoff profiles tab. These
 * tests cover: the shell appearing on first launch, creating a profile,
 * creating a second profile with a different agent, editing a profile,
 * toggling/deleting, the custom agent/task-manager forms, and the Home summary.
 *
 * Uses the shared fixture (isolated HOME). Each test starts with a fresh empty
 * DB.
 */

import { test, expect } from './fixtures/app';

test.describe('Handoff profiles tab', () => {
  test('HS-E1: first launch shows the shell (no wizard), Handoff profiles tab empty', async ({ app }) => {
    const { window } = app;

    // The shell renders directly — the sidebar nav is present.
    await expect(window.getByRole('button', { name: 'Handoff profiles', exact: true })).toBeVisible();

    // Navigate to Handoff profiles — the empty state is shown.
    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    await expect(window.getByText('No handoff profiles yet')).toBeVisible();
  });

  test('HS-E2: create a handoff profile', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'ZCode → OmniFocus' });

    // Navigate to Handoff profiles — the new row is present.
    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
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

  test('HS-E3: create a second profile with a different agent', async ({ app }) => {
    const { window } = app;
    // First profile: ZCode.
    await app.completeOnboarding({ label: 'ZCode profile' });
    // Second profile: Codex → OmniFocus → Codex.
    await app.completeOnboarding({
      agent: 'codex',
      taskManager: 'omnifocus',
      backend: 'Codex',
      label: 'Codex profile',
    });

    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    await expect(window.getByText('ZCode profile')).toBeVisible();
    await expect(window.getByText('Codex profile')).toBeVisible();

    // Two distinct rules with distinct backends.
    const rules = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { rules: { list: () => Promise<Array<{ name: string; backend: string }>> } };
        }
      ).api;
      return api.rules.list();
    });
    expect(rules.filter((r) => r.name === 'ZCode profile' || r.name === 'Codex profile')).toHaveLength(
      2,
    );
  });

  test('HS-E4: edit a profile (switch agent)', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'Editable profile' });

    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    await window.getByRole('button', { name: 'Edit' }).first().click();

    // Switch the agent selection to Codex. exact: true because the backend
    // picker also has a "Codex (OpenAI Codex SDK)" radio that would match.
    await window.getByRole('radio', { name: 'Codex', exact: true }).click();
    await window.getByRole('button', { name: 'Save changes' }).click();

    // The row still exists.
    await expect(window.getByText('Editable profile')).toBeVisible();
  });

  test('HS-E5: toggle a profile off', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding();

    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    const toggle = window.getByRole('switch').first();
    await toggle.click();
    // The switch reflects the disabled state.
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('HS-E6: delete a profile', async ({ app }) => {
    const { window } = app;
    await app.completeOnboarding({ label: 'Doomed profile' });

    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    window.once('dialog', (d) => void d.accept());
    await window.getByRole('button', { name: 'Delete' }).first().click();

    await expect(window.getByText('Doomed profile')).toHaveCount(0);
  });

  test('HS-E7: add custom agent inside the profile editor', async ({ app }) => {
    const { window } = app;
    await window.getByRole('button', { name: 'Handoff profiles', exact: true }).click();
    await window.getByRole('button', { name: 'New handoff profile' }).click();

    // Profile label — target by its unique placeholder to avoid colliding with
    // the agent form's "Label" field that appears once "+ Add custom" opens.
    await window.getByPlaceholder('e.g. ZCode → OmniFocus').fill('Custom agent profile');
    await window.getByRole('button', { name: '+ Add custom…' }).first().click();

    // The custom-agent form renders inside the agent picker. Its fields are the
    // second occurrence of each label (the profile editor's own fields are
    // first), so use .last() to disambiguate.
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

  test('HS-E9: Home shows profile summary after creating one', async ({ app }) => {
    await app.completeOnboarding({ label: 'Home profile' });
    const { window } = app;

    // Home renders the label + an "agent → task manager" summary span.
    await expect(window.getByText('Home profile')).toBeVisible();
    await expect(window.getByText('ZCode → OmniFocus')).toBeVisible();
  });

  test('HS-E10: Home "Manage handoff profiles" navigates to the Handoff profiles tab', async ({ app }) => {
    const { window } = app;
    await window.getByRole('button', { name: 'Manage handoff profiles' }).click();
    // The Handoff profiles tab's CardTitle is a <div>, not a heading, so assert
    // on the "New handoff profile" button which is unique to the view.
    await expect(window.getByRole('button', { name: 'New handoff profile' })).toBeVisible();
  });
});
