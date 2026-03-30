import { test, expect } from '@playwright/test';

// TODO

test('renderer shows the expected text', async ({ page }) => {
	await page.goto('/');
	const renderer = page.locator('[data-md-renderer]');
	await expect(renderer).toHaveText('Hello');
});
