import { test, expect } from '@playwright/test';

// TODO

test('typing inserts characters', async ({ page }) => {
	await page.goto('/');
	const editor = page.locator('[data-md-editor]');
	await editor.click();
	await page.keyboard.type('Hello');
	await expect(editor).toHaveText('Hello');
});

test('bold syntax renders correct element', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-md-editor]').click();
	await page.keyboard.type('**bold**');
	await expect(page.locator('strong[data-md-type="bold"]')).toHaveText('bold');
});

test('Enter creates new line', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-md-editor]').click();
	await page.keyboard.type('line1');
	await page.keyboard.press('Enter');
	await page.keyboard.type('line2');
	await expect(page.locator('[data-md-line="0"]')).toHaveText('line1');
	await expect(page.locator('[data-md-line="1"]')).toHaveText('line2');
});
