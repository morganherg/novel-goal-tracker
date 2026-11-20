import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTestVault, launchObsidian, pluginData } from './obsidian-app';

/*
 * Finding your way when folders change: the ribbon's Novels menu, a novel
 * whose folder is missing, a deleted Dashboard.md, and deleting a novel's folder.
 */

const novel = (id: string, title: string) => ({
	id,
	title,
	summary: '',
	genre: '',
	goal: 1000,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	folderPath: title,
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z',
});

async function openNovelsMenu(page: Page) {
	await page.locator('.side-dock-ribbon-action[aria-label="Novels"]').click();
	const menu = page.locator('.menu');
	await expect(menu).toBeVisible();
	return menu;
}

test('the Novels menu, missing folders, a deleted dashboard, and a deleted novel folder', async () => {
	const vault = createTestVault('folders', {
		// Draw menus inside the window (not as native macOS menus) so the test can see them.
		'.obsidian/app.json': JSON.stringify({ nativeMenus: false }),
		'Kept/Dashboard.md': '```novel-dashboard\nnovel: k\n```\n',
		'Kept/Chapters/Chapter 1.md': 'Still here.',
		'.obsidian/plugins/novel-goal-tracker/data.json': JSON.stringify({
			hasOnboarded: true,
			// "Gone" was tracked, but its folder no longer exists.
			novels: [novel('k', 'Kept'), novel('g', 'Gone')],
		}),
	});
	const { page, windowWith, close } = await launchObsidian(vault);
	try {
		// --- The ribbon menu lists novels, flags the missing one, and offers to create ---
		let menu = await openNovelsMenu(page);
		await expect(menu).toContainText('Kept');
		await expect(menu).toContainText('Gone (folder missing)');
		await expect(menu).toContainText('Create new novel');
		await expect(menu).toContainText('Track existing novel folder');
		await menu.getByText('Create new novel').click();
		// Recent Obsidian versions show dialogs in their own pop-out window.
		const wizard = await windowWith('Start a new novel');
		await wizard.keyboard.press('Escape');

		// --- A missing folder explains itself instead of failing silently ---
		menu = await openNovelsMenu(page);
		await menu.getByText('Gone (folder missing)').click();
		await windowWith('is missing'); // a notice, in whichever window is active

		// --- A deleted Dashboard.md comes back when you open the dashboard ---
		await page.evaluate(async () => {
			const app = (window as any).app;
			await app.vault.delete(app.vault.getFileByPath('Kept/Dashboard.md'));
		});
		expect(existsSync(join(vault.vault, 'Kept', 'Dashboard.md'))).toBe(false);
		menu = await openNovelsMenu(page);
		await menu.getByText('Kept', { exact: true }).click();
		await expect(page.locator('.ngt-dashboard:visible .ngt-title').first()).toHaveText('Kept', { timeout: 10_000 });
		expect(existsSync(join(vault.vault, 'Kept', 'Dashboard.md'))).toBe(true);

		// --- Deleting a novel's folder stops tracking it, with a way back ---
		await page.evaluate(async () => {
			const app = (window as any).app;
			await app.vault.delete(app.vault.getFolderByPath('Kept'), true);
		});
		await windowWith('Stopped tracking "Kept"');
		await expect
			.poll(async () => ((await pluginData(page)) as { novels: { title: string }[] }).novels.map((n) => n.title))
			.toEqual(['Gone']);
	} finally {
		await close();
	}
});
