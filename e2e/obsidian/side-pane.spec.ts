import { expect, test, type Page } from '@playwright/test';
import { createTestVault, launchObsidian, runCommand, type TestVault } from './obsidian-app';

/*
 * The side-pane dashboard with two novels: the picker, remembering the
 * choice across restarts, and following the novel you're writing.
 */

test.describe.configure({ mode: 'serial' });

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

let vault: TestVault;

const paneTitle = (page: Page) => page.locator('.ngt-view .ngt-title');

async function openChapter(page: Page, path: string): Promise<void> {
	await page.evaluate((p) => (window as any).app.plugins.plugins['novel-goal-tracker'].openPath(p), path);
	await expect.poll(() => page.evaluate(() => (window as any).app.workspace.getActiveFile()?.path)).toBe(path);
}

test.beforeAll(() => {
	vault = createTestVault('side-pane', {
		'Alpha/Dashboard.md': '```novel-dashboard\nnovel: a\n```\n',
		'Alpha/Chapters/Chapter 1.md': 'One two.',
		'Beta/Dashboard.md': '```novel-dashboard\nnovel: b\n```\n',
		'Beta/Chapters/Chapter 1.md': 'Three four five.',
		'.obsidian/plugins/novel-goal-tracker/data.json': JSON.stringify({
			hasOnboarded: true,
			novels: [novel('a', 'Alpha'), novel('b', 'Beta')],
		}),
	});
});

test('the picker switches novels, and the choice survives a restart', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		await openChapter(page, 'Alpha/Chapters/Chapter 1.md');
		await runCommand(page, 'novel-goal-tracker:open-dashboard-side');
		await expect(paneTitle(page)).toHaveText('Alpha', { timeout: 10_000 });
		const picker = page.locator('select.ngt-view-picker');
		await expect(picker.locator('option')).toHaveCount(2);
		await picker.selectOption('b');
		await expect(paneTitle(page)).toHaveText('Beta');
		// Let Obsidian save the layout.
		await page.waitForTimeout(2500);
	} finally {
		await close();
	}

	const again = await launchObsidian(vault);
	try {
		await expect(paneTitle(again.page)).toHaveText('Beta', { timeout: 15_000 });
	} finally {
		await again.close();
	}
});

test('opening the side pane while writing a chapter switches it to that novel', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		await expect(paneTitle(page)).toHaveText('Beta', { timeout: 15_000 });
		await openChapter(page, 'Alpha/Chapters/Chapter 1.md');
		await runCommand(page, 'novel-goal-tracker:open-dashboard-side');
		await expect(paneTitle(page)).toHaveText('Alpha', { timeout: 10_000 });
	} finally {
		await close();
	}
});
