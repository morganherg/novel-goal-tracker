import { expect, test } from '@playwright/test';
import { createTestVault, launchObsidian } from './obsidian-app';

test('Obsidian launches with the plugin enabled', async () => {
	const vault = createTestVault('smoke', { 'Welcome.md': '# Hello\n' });
	const { page, close } = await launchObsidian(vault);
	try {
		const version = await page.evaluate(() => (window as unknown as { app?: { apiVersion?: string } }).app?.apiVersion);
		console.log('Obsidian API version:', version);
		// The setup wizard opens on first run.
		await expect(page.locator('.modal').filter({ hasText: 'Start a new novel' })).toBeVisible({ timeout: 15_000 });
	} finally {
		await close();
	}
});
