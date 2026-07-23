import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Created a new local canonical project.')).toBeVisible();
}

test('authors all ten sections with save/load, export/import, connectors, and blocked deletes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await createProject(page, 'Customer health');
  if (await page.getByRole('button', { name: 'Collapse evidence' }).isVisible()) {
    await page.getByRole('button', { name: 'Collapse evidence' }).click();
  }

  // Skip interview into Domain form authoring
  await page.getByRole('button', { name: /Continue to Domain/ }).click();

  // Domain
  await page
    .getByLabel('Description')
    .fill('How customer teams assess account risk and prioritize weekly interventions.');
  await page.getByRole('button', { name: 'Add named owner' }).click();
  await page.getByLabel('Owner 1 name').fill('Maya Chen');
  await page.getByLabel('Owner 1 team').fill('Revenue Operations');
  await page.getByRole('button', { name: /Continue to Sources/ }).click();

  // Sources — static collect
  await page.getByLabel('Source name').fill('Customer health playbook');
  await page.getByLabel('Scope').fill('health definitions, intervention rules');
  await page
    .getByLabel('Evidence content')
    .fill(
      'An account is at risk when two critical support tickets remain unresolved for seven days.',
    );
  await page.getByRole('button', { name: 'Add source & collect' }).click();
  await expect(page.getByText(/Collected 1 evidence record/)).toBeVisible();

  // Sources — connector variants (configured only)
  for (const [type, name, endpoint, adapter] of [
    ['MCP server', 'Ops MCP', 'https://mcp.example.com', ''],
    ['REST API', 'Health API', 'https://api.example.com/health', ''],
    ['dbt adapter', 'Analytics dbt', 'https://dbt.example.com', ''],
    ['Custom adapter', 'Catalog proxy', 'https://catalog.example.com', 'catalog-proxy'],
  ] as const) {
    await page.getByLabel('Source type').selectOption({ label: type });
    await page.getByLabel('Source name').fill(name);
    await page.getByLabel('Scope').fill('configured connector');
    await page.getByLabel('Endpoint').fill(endpoint);
    if (adapter) await page.getByLabel('Adapter ID').fill(adapter);
    await page.getByRole('button', { name: 'Save source configuration' }).click();
    await expect(page.getByText(`${name} is configured. No collection was run.`)).toBeVisible();
  }
  await expect(page.getByText('custom:dbt')).toBeVisible();
  await expect(page.getByText('custom:catalog-proxy')).toBeVisible();

  // Business
  await page.getByRole('button', { name: /Continue to Business/ }).click();
  await page.getByLabel('Term').fill('Healthy account');
  await page
    .getByLabel('Definition')
    .fill('An account with no critical risk signal for two consecutive weeks.');
  await page.getByRole('button', { name: 'Add term' }).click();
  await page
    .getByLabel('Claim')
    .fill('Two unresolved critical tickets indicate an account is at risk.');
  await page
    .getByRole('group', { name: 'Supporting evidence' })
    .getByRole('checkbox', { name: /inline:/ })
    .check();
  await page.getByRole('button', { name: 'Add claim' }).click();

  // Data map
  await page.getByRole('button', { name: /Continue to Data map/ }).click();
  await page.getByLabel('Asset name').fill('account_health_snapshot');
  await page.getByLabel('Owner').selectOption({ label: 'Maya Chen' });
  await page.getByLabel('Grain').fill('One row per account per ISO week');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('New account_health_snapshot column name').fill('account_id');
  await page.getByLabel('New account_health_snapshot column type').fill('string');
  await page
    .getByLabel('New account_health_snapshot column description')
    .fill('Stable account key');
  await page.getByRole('button', { name: 'Add account_health_snapshot column' }).click();

  // Metrics
  await page.getByRole('button', { name: /Continue to Metrics/ }).click();
  await page.getByLabel('Metric name').fill('Healthy account rate');
  await page.getByLabel('Grain').fill('ISO week');
  await page
    .getByLabel('Description')
    .fill('Share of active accounts that meet the healthy-account definition.');
  await page.getByLabel('Expression').fill('healthy_accounts / active_accounts');
  await page.getByLabel('Worked example').fill('80 healthy / 100 active = 80%');
  await page.getByLabel('Primary asset').selectOption({ label: 'account_health_snapshot' });
  await page.getByLabel('Owner').selectOption({ label: 'Maya Chen' });
  await page.getByRole('button', { name: 'Add metric' }).click();

  // Caveats
  await page.getByRole('button', { name: /Continue to Caveats/ }).click();
  await page.getByLabel('Caveat name').fill('Support ticket lag');
  await page.getByLabel('Applies to').selectOption({ label: 'Metric · Healthy account rate' });
  await page
    .getByLabel('What can go wrong')
    .fill('Ticket status arrives up to four hours after the support system changes.');
  await page
    .getByLabel('Reader action')
    .fill('Check the support system directly before escalating a borderline account.');
  await page.getByRole('button', { name: 'Add caveat' }).click();

  // Governance
  await page
    .getByRole('navigation', { name: 'Authoring progress' })
    .getByRole('button', { name: /Governance/ })
    .click();
  await page.getByLabel('Classification name').fill('Customer operational data');
  await page.getByLabel('Asset').first().selectOption({ label: 'account_health_snapshot' });
  await page.getByRole('button', { name: 'Add classification' }).click();
  await page.getByLabel('Policy name').fill('Customer health access');
  await page.getByLabel('Owner').selectOption({ label: 'Maya Chen' });
  await page.getByLabel('Asset').nth(1).selectOption({ label: 'account_health_snapshot' });
  await page
    .getByLabel('Policy rule')
    .fill('Only Customer Success and Revenue Operations may access account-level health signals.');
  await page.getByRole('button', { name: 'Add policy' }).click();

  // Clarify
  await page.getByRole('button', { name: /08 Clarify/ }).click();
  await expect(page.locator('.question-sheet h2')).toBeVisible();
  await page
    .getByLabel('Analyst answer')
    .fill('Keep the seven-day threshold and update the claim status after linking evidence.');
  await page.getByLabel('I confirm this answer represents the intended domain decision.').check();
  await page.getByRole('button', { name: 'Confirm answer' }).click();

  // Review
  await page.getByRole('button', { name: /09 Review/ }).click();
  await expect(page.getByRole('heading', { name: 'Review before handoff' })).toBeVisible();
  await expect(page.getByText('Generated-file preview')).toBeVisible();
  await expect(page.getByText('Validating references and chronology…')).toBeHidden();
  await page.screenshot({
    path: 'apps/web/e2e/screenshots/lineage-workbench-review.png',
    fullPage: true,
  });

  // Save / load revision behavior
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved to the fixed local workspace.')).toBeVisible();
  await page.getByRole('button', { name: 'Load local' }).click();
  await expect(page.getByText('Loaded the local workspace project.')).toBeVisible();

  // JSON export / import
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = path.join('apps/web/e2e/screenshots', await download.suggestedFilename());
  await download.saveAs(downloadPath);
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(downloadPath);
  await expect(page.getByText(/Imported canonical JSON/)).toBeVisible();

  // Blocked deletes
  await page.getByRole('button', { name: /02 Sources/ }).click();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByText(/cannot be removed because it is referenced/)).toBeVisible();
});

test('keyboard navigation, mobile evidence dialog, and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to current section' })).toBeFocused();

  if (await page.getByRole('dialog', { name: 'Evidence' }).count()) {
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Open evidence' }).click();
  await expect(page.getByRole('dialog', { name: 'Evidence' })).toBeVisible();
  await page.screenshot({
    path: 'apps/web/e2e/screenshots/lineage-workbench-mobile-evidence.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Evidence' })).toHaveCount(0);
});
