import { expect, test } from '@playwright/test';

test.describe('App Shell', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CashTrace/);
  });
});
