import { expect, test } from '@playwright/test';

test('shows the Lineage Workbench shell', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Chat: connectors and onboarding' }),
  ).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Domain path' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Evidence' })).toBeVisible();
});

test('answers one interview question before form authoring', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue structured interview' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue structured interview' }).click();
  await expect(page.getByText(/Where should I look for this domain/i)).toBeVisible();
  await page.getByRole('button', { name: 'I will type it manually' }).click();
  await page
    .getByLabel('Type the details')
    .fill('Customer health\nWeekly account risk and intervention planning.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Captured manual notes|Recorded/i)).toBeVisible();
});
