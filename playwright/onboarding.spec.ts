/**
 * E2E for the Handoff setup onboarding wizard
 * (docs/features/handoff-setup/test-plan.md HS-E1..HS-E7, HS-E12..HS-E14).
 *
 * A fresh DB shows the wizard (not the shell). These tests cover: the wizard
 * gate, completing the 4 steps, step navigation, custom agent/task-manager
 * forms, the review step's instructions, the Home dashboard, the "Change setup"
 * re-entry, and the Settings reset.
 *
 * Uses the shared fixture (isolated HOME). Each test starts with a fresh empty
 * DB where setup is incomplete.
 */

import { test, expect } from './fixtures/app';
import type { Page } from '@playwright/test';

/** Click a sidebar nav button by its label (only valid after onboarding). */
async function gotoTab(window: Page, label: string): Promise<void> {
  await window.getByRole('button', { name: label }).click();
}

test.describe('Onboarding wizard gate', () => {
  test('HS-E1: first launch shows the wizard, not the shell', async ({ app }) => {
    const { window } = app;

    // The welcome heading should be visible — this is the wizard, not the shell.
    await expect(window.getByRole('heading', { name: 'Welcome to LocalCortex' })).toBeVisible();

    // The sidebar shell (Home nav button) should NOT be present.
    await expect(window.getByRole('button', { name: 'Home' })).toHaveCount(0);
  });
});

test.describe('Onboarding completion', () => {
  test('HS-E2: complete onboarding creates the rule + transitions to shell', async ({ app }) => {
    const { window } = app;

    // Step 1: select ZCode agent.
    await window.getByRole('radio', { name: 'ZCode' }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Step 2: select OmniFocus task manager.
    await window.getByRole('radio', { name: 'OmniFocus' }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Step 3: select Claude backend.
    await window.getByRole('radio', { name: /^Claude/ }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Step 4: review + Finish.
    await window.getByRole('button', { name: 'Finish' }).click();

    // The shell should appear (Home is the default tab).
    await expect(window.getByRole('button', { name: 'Home' })).toBeVisible({ timeout: 10_000 });

    // The auto-created rule should exist — verify via IPC.
    const rules = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { rules: { list: () => Promise<Array<{ id: string; name: string }>> } };
        }
      ).api;
      return api.rules.list();
    });
    const handoffRule = rules.find((r) => r.id === 'handoff-auto');
    expect(handoffRule).toBeDefined();
    expect(handoffRule!.name).toBe('Handoff (auto-created)');
  });

  test('HS-E3: step navigation Back/Next preserves selections', async ({ app }) => {
    const { window } = app;

    // Step 1: select ZCode, go Next.
    await window.getByRole('radio', { name: 'ZCode' }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Step 2: select OmniFocus, go Next.
    await window.getByRole('radio', { name: 'OmniFocus' }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Step 3: go Back — should land on step 2 with OmniFocus still selected.
    await window.getByRole('button', { name: 'Back' }).click();
    await expect(window.getByRole('radio', { name: 'OmniFocus' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Go Back again — should land on step 1 with ZCode still selected.
    await window.getByRole('button', { name: 'Back' }).click();
    await expect(window.getByRole('radio', { name: 'ZCode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('Onboarding custom forms', () => {
  test('HS-E4: add custom agent form creates a selectable row', async ({ app }) => {
    const { window } = app;

    // Step 1: click "Add custom…".
    await window.getByRole('button', { name: '+ Add custom…' }).click();

    // Fill the custom agent form.
    await window.getByLabel('Id (unique)').fill('myagent');
    await window.getByLabel('Label').fill('My Agent');
    await window.getByLabel('Description').fill('A custom agent');
    await window.getByLabel('Session-complete event type').fill('myagent.session-complete');
    await window.getByLabel('Prompt-submit event type').fill('myagent.prompt-submit');
    await window.getByLabel('Source').fill('myagent');
    await window.getByLabel('Install instructions').fill('Install my custom hook.');

    await window.getByRole('button', { name: 'Save agent' }).click();

    // After saving, the custom agent appears in the picker. Wait for it.
    const agentRadio = window.getByRole('radio', { name: 'My Agent' });
    await expect(agentRadio).toBeVisible({ timeout: 10_000 });
    await agentRadio.click();
    await expect(agentRadio).toHaveAttribute('aria-checked', 'true');
  });

  test('HS-E5: add custom task manager form creates a selectable row', async ({ app }) => {
    const { window } = app;

    // Navigate to step 2 (select agent first, then Next).
    await window.getByRole('radio', { name: 'ZCode' }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // Click "Add custom…".
    await window.getByRole('button', { name: '+ Add custom…' }).click();

    // Fill the custom task manager form.
    await window.getByLabel('Id (unique)').fill('mytm');
    await window.getByLabel('Label').fill('My TM');
    await window.getByLabel('Description').fill('A custom task manager');
    // MCP server dropdown — select 'github' (it exists from seeds).
    await window.locator('select').selectOption('github');
    await window.getByLabel('Setup instructions').fill('Set up my task manager.');

    await window.getByRole('button', { name: 'Save task manager' }).click();

    // After saving, the custom task manager appears in the picker. Wait for it.
    const tmRadio = window.getByRole('radio', { name: 'My TM' });
    await expect(tmRadio).toBeVisible({ timeout: 10_000 });
    await tmRadio.click();
    await expect(tmRadio).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Onboarding review step', () => {
  test('HS-E6: agent install instructions shown on review step', async ({ app }) => {
    const { window } = app;

    // Walk through the wizard to step 4.
    await window.getByRole('radio', { name: 'ZCode' }).click();
    await window.getByRole('button', { name: 'Next' }).click();
    await window.getByRole('radio', { name: 'OmniFocus' }).click();
    await window.getByRole('button', { name: 'Next' }).click();
    await window.getByRole('radio', { name: /^Claude/ }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    // The review step should show the agent's install instructions.
    await expect(window.getByText('Agent setup instructions')).toBeVisible();
    await expect(window.locator('pre', { hasText: 'Install the localcortex-hook ZCode plugin' })).toBeVisible();
  });

  test('HS-E7: task manager setup instructions shown on review step', async ({ app }) => {
    const { window } = app;

    await window.getByRole('radio', { name: 'ZCode' }).click();
    await window.getByRole('button', { name: 'Next' }).click();
    await window.getByRole('radio', { name: 'OmniFocus' }).click();
    await window.getByRole('button', { name: 'Next' }).click();
    await window.getByRole('radio', { name: /^Claude/ }).click();
    await window.getByRole('button', { name: 'Next' }).click();

    await expect(window.getByText('Task manager setup')).toBeVisible();
    await expect(window.locator('pre', { hasText: 'leedoughty/omnifocus-mcp' })).toBeVisible();
  });
});

test.describe('Home dashboard + re-entry', () => {
  test('HS-E12: Home tab shows current setup after onboarding', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;

    // Home is the default tab. Confirm the setup card shows the choices.
    // Use exact text matching for the row labels (they're <span> in Row components).
    await expect(window.getByText('Coding agent', { exact: true })).toBeVisible();
    await expect(window.getByText('ZCode', { exact: true })).toBeVisible();
    await expect(window.getByText('Task manager', { exact: true })).toBeVisible();
    await expect(window.getByText('OmniFocus', { exact: true })).toBeVisible();
    await expect(window.getByText('Review backend', { exact: true })).toBeVisible();
    await expect(window.getByText('Claude', { exact: true })).toBeVisible();
  });

  test('HS-E13: Home "Change setup" re-opens onboarding', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;

    await window.getByRole('button', { name: 'Change setup' }).click();

    // The wizard should appear again.
    await expect(window.getByRole('heading', { name: 'Welcome to LocalCortex' })).toBeVisible();
  });

  test('HS-E14: Settings reset clears setup and returns to onboarding', async ({ app }) => {
    await app.completeOnboarding();
    const { window } = app;

    await gotoTab(window, 'Settings');

    // Auto-accept the confirm dialog.
    window.once('dialog', (d) => void d.accept());
    await window.getByRole('button', { name: 'Reset setup' }).click();

    // The wizard should reappear after reset.
    await expect(window.getByRole('heading', { name: 'Welcome to LocalCortex' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
