import { expect, test, type Page } from '@playwright/test';
import { createTestVault, launchObsidian, pluginData } from './obsidian-app';

/*
 * The setup wizard in the real Obsidian app: every check that blocks bad
 * input, and the timeframe options.
 */

const modal = (page: Page) => page.locator('.modal-container .modal').last();

function isoDay(offsetDays = 0): string {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test('the wizard rejects bad input on every step, then creates a novel with custom dates', async () => {
	// A folder with the title we'll try first already exists.
	const vault = createTestVault('wizard', { 'Harbour Lights/notes.md': 'old notes' });
	const { page, close } = await launchObsidian(vault);
	try {
		const m = modal(page);
		const error = m.locator('.ngt-wizard-error');
		const next = m.getByRole('button', { name: 'Next' });
		const title = m.locator('input[type="text"]').first();
		await expect(m).toContainText('Step 1 of 5');

		// --- Step 1: title ---
		await next.click();
		await expect(error).toHaveText('Enter a title.');
		await title.fill('###');
		await next.click();
		await expect(error).toHaveText('Use at least one letter or number in the title.');
		await title.fill('Harbour Lights');
		await next.click();
		await expect(error).toContainText('already exists in your vault');
		await expect(error).toContainText('Track existing novel folder');
		await title.press('End');
		await title.pressSequentially(' II');
		await expect(error).toHaveText(''); // cleared as soon as you edit
		await expect(m).toContainText('Step 1 of 5');
		await next.click();

		// --- Step 2: summary (optional) ---
		await expect(m).toContainText('Step 2 of 5');
		await next.click();

		// --- Step 3: goal ---
		await expect(m).toContainText('Step 3 of 5');
		const goal = m.locator('input[type="number"]');
		await goal.fill('0');
		await next.click();
		await expect(error).toHaveText('Enter a goal of at least 1 word.');
		await goal.fill('20000000');
		await next.click();
		await expect(error).toHaveText('Enter a goal of 10,000,000 words or fewer.');
		await goal.fill('50000');
		await next.click();

		// --- Step 4: timeframe ---
		await expect(m).toContainText('Step 4 of 5');
		const choice = m.getByRole('combobox');
		const hint = m.locator('.ngt-wizard-hint');

		// This November: always 30 days and 1,667 a day; mid-month it says how many days are left.
		await expect(hint).toContainText('30 days, 1,667 words a day.');
		if (new Date().getMonth() === 10 && new Date().getDate() > 1) {
			await expect(hint).toContainText('It has already started');
		}

		await choice.selectOption('from-today');
		await m.locator('input[type="number"]').fill('0');
		await next.click();
		await expect(error).toHaveText('Enter a number of days from 1 to 3,650.');
		await m.locator('input[type="number"]').fill('3651');
		await next.click();
		await expect(error).toHaveText('Enter a number of days from 1 to 3,650.');

		await choice.selectOption('custom');
		const [start, end] = [m.locator('input[type="date"]').first(), m.locator('input[type="date"]').last()];
		await start.fill(isoDay(5));
		await end.fill(isoDay(1));
		await next.click();
		await expect(error).toHaveText("The last day can't be before the start date.");
		await start.fill(isoDay(-400));
		await end.fill(isoDay(-370));
		await next.click();
		await expect(error).toContainText('That timeframe has already ended.');
		await expect(m).toContainText('Step 4 of 5');

		await start.fill(isoDay(0));
		await end.fill(isoDay(6));
		await expect(hint).toContainText('7 days, 7,143 words a day.');
		await next.click();

		// --- Step 5: confirm, then create ---
		await expect(m).toContainText('Step 5 of 5');
		await expect(m).toContainText('Harbour Lights II');
		await expect(m).toContainText('(7 days)');
		await expect(m).toContainText('7,143 words');
		await m.getByRole('button', { name: 'Create novel' }).click();

		await expect
			.poll(async () => {
				const d = (await pluginData(page)) as { novels: { title: string; startDate: string; endDate: string }[] };
				return d.novels.map((n) => [n.title, n.startDate, n.endDate]);
			})
			.toEqual([['Harbour Lights II', isoDay(0), isoDay(6)]]);
	} finally {
		await close();
	}
});
