import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestVault, launchObsidian, pluginData, runCommand, type TestVault } from './obsidian-app';

/*
 * The whole writer's journey in the real Obsidian app: create a novel with the
 * wizard, write in a chapter (typing, pasting, deleting), read the dashboard,
 * and restart to check everything was saved.
 */

test.describe.configure({ mode: 'serial' });

const TITLE = 'Harbour Lights';
let vault: TestVault;

const modal = (page: Page) => page.locator('.modal-container .modal').last();
// Obsidian keeps a hidden rendering of the note for the other view mode, so
// only look at what's visible.
const card = (page: Page, title: string) =>
	page.locator('.ngt-card:visible', { has: page.locator('.ngt-card-label', { hasText: title }) }).first();

async function today(page: Page): Promise<string> {
	return page.evaluate(() => {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	});
}

/** Words typed today and the net change, from the plugin's saved history. */
async function todayRecord(page: Page): Promise<{ added: number; net: number }> {
	const data = (await pluginData(page)) as {
		novels: { id: string }[];
		history: Record<string, { days: Record<string, Record<string, { added: number; net: number }>> }>;
	};
	const id = data.novels[0]?.id ?? '';
	const day = await today(page);
	let added = 0;
	let net = 0;
	for (const dev of Object.values(data.history)) {
		added += dev.days[id]?.[day]?.added ?? 0;
		net += dev.days[id]?.[day]?.net ?? 0;
	}
	return { added, net };
}

async function editor(page: Page) {
	const content = page.locator('.workspace-leaf.mod-active .cm-content');
	await expect(content).toBeVisible();
	return content;
}

test.beforeAll(() => {
	vault = createTestVault('novel-flow', { 'Welcome.md': '# Welcome\n' });
});

test('create a novel with the wizard, then write, paste, and delete', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		// --- The wizard opens on first run ---
		const m = modal(page);
		await expect(m).toContainText('Start a new novel');
		await expect(m).toContainText('Step 1 of 5');
		await m.locator('input[type="text"]').first().fill(TITLE);
		await m.getByRole('button', { name: 'Next' }).click();

		await expect(m).toContainText('Step 2 of 5');
		await m.locator('textarea').fill('A keeper finds letters from the woman who kept the light before her.');
		await m.getByRole('combobox').selectOption('Literary');
		await m.getByRole('button', { name: 'Next' }).click();

		await expect(m).toContainText('Step 3 of 5');
		await m.locator('input[type="number"]').fill('1000');
		await expect(m).toContainText("That's about 34 words a day over 30 days.");
		await m.getByRole('button', { name: 'Next' }).click();

		await expect(m).toContainText('Step 4 of 5');
		await m.getByRole('combobox').selectOption('from-today');
		await m.locator('input[type="number"]').fill('10');
		await expect(m).toContainText('10 days, 100 words a day.');
		await m.getByRole('button', { name: 'Next' }).click();

		await expect(m).toContainText('Step 5 of 5');
		await expect(m).toContainText(TITLE);
		await expect(m).toContainText('1,000');
		await m.getByRole('button', { name: 'Create novel' }).click();

		// --- The novel folder and dashboard ---
		await expect(page.locator('.ngt-dashboard:visible .ngt-title').first()).toHaveText(TITLE, { timeout: 15_000 });
		expect(existsSync(join(vault.vault, TITLE, 'Dashboard.md'))).toBe(true);
		expect(existsSync(join(vault.vault, TITLE, 'Chapters', 'Chapter 1.md'))).toBe(true);
		await expect(card(page, 'Total progress')).toContainText('0 / 1,000');
		await expect(card(page, 'Words needed today')).toContainText('of 100');

		// --- Typing counts ---
		await page.locator('.ngt-chapter-link:visible', { hasText: 'Chapter 1' }).first().click();
		const ed = await editor(page);
		await ed.click();
		await page.keyboard.type('The harbour lights came on one by one.', { delay: 15 });
		await expect.poll(async () => (await todayRecord(page)).added, { timeout: 10_000 }).toBe(8);

		// --- Pasting counts ---
		await ed.evaluate((el) => {
			const dt = new DataTransfer();
			dt.setData('text/plain', ' Gulls woke the sleeping town.');
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		});
		await expect(ed).toContainText('Gulls woke the sleeping town.');
		await expect.poll(async () => (await todayRecord(page)).added, { timeout: 10_000 }).toBe(13);

		// --- Deleting lowers the total, never today's words ---
		await page.keyboard.press('End');
		for (let i = 0; i < ' sleeping town.'.length; i++) await page.keyboard.press('Backspace');
		await expect.poll(async () => (await todayRecord(page)).net, { timeout: 10_000 }).toBe(11);
		expect((await todayRecord(page)).added).toBe(13);

		// --- The dashboard agrees ---
		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		await expect.poll(() => page.evaluate(() => (window as any).app.workspace.getActiveFile()?.path), { timeout: 10_000 }).toBe(`${TITLE}/Dashboard.md`);
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('11 / 1,000', { timeout: 10_000 });
		await expect(card(page, 'Writing streak')).toContainText('13 words today');
		await expect(card(page, 'Words needed today')).toContainText('13');
		const chapters = card(page, 'Chapters');
		await expect(chapters.locator('tbody tr', { hasText: 'Chapter 1' }).locator('td').last()).toHaveText('11');
		await expect(card(page, 'Progress log')).toContainText('+13');

		// --- The side pane shows the same dashboard ---
		await runCommand(page, 'novel-goal-tracker:open-dashboard-side');
		await expect(page.locator('.ngt-view .ngt-title')).toHaveText(TITLE, { timeout: 10_000 });

		// Give the debounced save time to write data.json.
		await page.waitForTimeout(3000);
	} finally {
		await close();
	}

	const saved = JSON.parse(
		readFileSync(join(vault.vault, '.obsidian', 'plugins', 'novel-goal-tracker', 'data.json'), 'utf8'),
	) as { novels: { title: string; goal: number }[] };
	expect(saved.novels.map((n) => [n.title, n.goal])).toEqual([[TITLE, 1000]]);
});

test('after a restart, the novel and today’s words are still there', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		// No wizard this time.
		await expect(page.locator('.modal').filter({ hasText: 'Start a new novel' })).toHaveCount(0);
		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('11 / 1,000', { timeout: 15_000 });
		await expect(card(page, 'Writing streak')).toContainText('13 words today');
	} finally {
		await close();
	}
});

test('words added by hand show up in the total, the chapter table, and the log', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		await runCommand(page, 'novel-goal-tracker:add-words');
		const m = modal(page);
		await expect(m).toContainText('Add words for a day');
		await m.locator('input[type="number"]').fill('40');
		await m.locator('input[type="text"]').last().fill('Notebook');
		await m.getByRole('button', { name: 'Add words' }).click();
		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('51 / 1,000', { timeout: 10_000 });
		await expect(card(page, 'Total progress')).toContainText('11 in chapters + 40 added by hand');
		await expect(card(page, 'Chapters').locator('tfoot')).toContainText('51');
		await expect(card(page, 'Progress log')).toContainText('Notebook');
	} finally {
		await close();
	}
});

test('settings: stop tracking asks first, and tracking the folder again brings the history back', async () => {
	const { page, windowWith, close } = await launchObsidian(vault);
	try {
		await page.evaluate(() => {
			const app = (window as any).app;
			app.setting.open();
			app.setting.openTabById('novel-goal-tracker');
		});
		// Settings open in their own window in recent Obsidian versions.
		const settingsWin = await windowWith('Writing day starts at');
		const settings = settingsWin.locator('.vertical-tab-content');
		await expect(settings).toContainText('Count code');
		await expect(settings).toContainText('Count comments');

		// Stop tracking: the novel's row in the Novels list, its delete control, then a confirmation.
		const row = settings.locator('.setting-group.mod-list .setting-item', { hasText: TITLE }).first();
		await row.hover();
		const del = row.locator('.clickable-icon, button').last();
		await del.click();
		const confirmWin = await windowWith(`Stop tracking "${TITLE}"?`);
		await confirmWin.getByRole('button', { name: 'Stop tracking' }).click();
		await expect.poll(async () => ((await pluginData(page)) as { novels: unknown[] }).novels.length).toBe(0);
		await page.evaluate(() => (window as any).app.setting.close());

		// Track the folder again: history (13 typed + 40 by hand) comes back.
		await runCommand(page, 'novel-goal-tracker:track-existing-folder');
		const picker = page.locator('.prompt');
		await expect(picker).toContainText(TITLE);
		await picker.locator('.suggestion-item', { hasText: TITLE }).first().click();
		const m = modal(page);
		await expect(m).toContainText(`Tracking the existing folder "${TITLE}"`);
		for (let step = 0; step < 4; step++) await m.getByRole('button', { name: 'Next' }).click();
		await m.getByRole('button', { name: 'Create novel' }).click();
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText(/^51 \//, { timeout: 15_000 });
		await expect(card(page, 'Writing streak')).toContainText('53 words today');
	} finally {
		await close();
	}
});

test('Edit novel rejects bad values, then updates the open dashboard', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		await expect(page.locator('.ngt-dashboard:visible .ngt-title').first()).toHaveText(TITLE, { timeout: 10_000 });
		await runCommand(page, 'novel-goal-tracker:edit-novel');
		const m = modal(page);
		await expect(m).toContainText('Edit novel');
		const error = m.locator('.ngt-wizard-error');
		const save = m.getByRole('button', { name: 'Save' });
		const title = m.locator('input[type="text"]').first();
		const folder = m.locator('input[type="text"]').last();
		const goal = m.locator('input[type="number"]');

		await title.fill('');
		await save.click();
		await expect(error).toHaveText('Enter a title.');
		await title.fill(`${TITLE} II`);
		await folder.fill('Nope');
		await save.click();
		await expect(error).toHaveText('There\'s no folder "Nope" in your vault.');
		await folder.fill(TITLE);
		await goal.fill('1.5');
		await save.click();
		await expect(error).toHaveText('Enter a goal from 1 to 10,000,000 words.');
		await goal.fill('2000');
		await save.click();
		await expect(m).toBeHidden();

		await expect(page.locator('.ngt-dashboard:visible .ngt-title').first()).toHaveText(`${TITLE} II`);
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('51 / 2,000');
	} finally {
		await close();
	}
});

test('renaming the novel folder inside Obsidian keeps it tracked, and typing there still counts', async () => {
	const { page, close } = await launchObsidian(vault);
	try {
		await page.evaluate(async (folder) => {
			const app = (window as any).app;
			await app.vault.createFolder('Drafts');
			await app.fileManager.renameFile(app.vault.getFolderByPath(folder), `Drafts/${folder}`);
		}, TITLE);
		await expect
			.poll(async () => ((await pluginData(page)) as { novels: { folderPath: string }[] }).novels[0]?.folderPath)
			.toBe(`Drafts/${TITLE}`);
		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('51 / 2,000', { timeout: 10_000 });

		const before = (await todayRecord(page)).added;
		await page.evaluate(
			(p) => (window as any).app.plugins.plugins['novel-goal-tracker'].openPath(p),
			`Drafts/${TITLE}/Chapters/Chapter 1.md`,
		);
		const ed = await editor(page);
		await ed.click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.type(' More words here.', { delay: 15 });
		await expect.poll(async () => (await todayRecord(page)).added, { timeout: 10_000 }).toBe(before + 3);
		await page.waitForTimeout(3000); // let the save land
	} finally {
		await close();
	}
});

test('words from another device arrive through sync, and are saved back', async () => {
	const { page, close } = await launchObsidian(vault);
	const file = join(vault.vault, '.obsidian', 'plugins', 'novel-goal-tracker', 'data.json');
	try {
		const before = (await todayRecord(page)).added;
		const day = await today(page);
		const data = JSON.parse(readFileSync(file, 'utf8')) as {
			novels: { id: string }[];
			history: Record<string, unknown>;
		};
		const id = data.novels[0]?.id ?? '';
		data.history['device-other'] = {
			updatedAt: new Date().toISOString(),
			days: { [id]: { [day]: { net: 40, added: 40, hours: { '10': 40 } } } },
			adjustments: [],
			deletedAdjustments: [],
		};
		writeFileSync(file, JSON.stringify(data));
		// What Obsidian calls when sync changes data.json.
		await page.evaluate(() => (window as any).app.plugins.plugins['novel-goal-tracker'].onExternalSettingsChange());

		await runCommand(page, 'novel-goal-tracker:open-dashboard');
		// Words today = this device's typing + the other device's 40 + 40 added by hand.
		await expect(card(page, 'Writing streak')).toContainText(`${before + 40 + 40} words today`, { timeout: 10_000 });
		await expect
			.poll(() => {
				const saved = JSON.parse(readFileSync(file, 'utf8')) as { history: Record<string, unknown> };
				return Object.keys(saved.history).length;
			})
			.toBeGreaterThanOrEqual(2);
	} finally {
		await close();
	}
});
