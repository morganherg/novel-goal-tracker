import { expect, test, type Page } from '@playwright/test';

/*
 * The real dashboard code (src/ui/*) rendered in Chromium with sample data
 * (scripts/preview/preview.ts) and Obsidian's default theme colors.
 */

function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	return errors;
}

async function open(page: Page, query = ''): Promise<void> {
	await page.goto(`/scripts/preview/index.html?clean${query ? '&' + query : ''}`);
	await expect(page.locator('.ngt-dashboard')).toBeVisible();
}

const card = (page: Page, title: string) => page.locator('.ngt-card', { has: page.locator('.ngt-card-label', { hasText: title }) });

for (const theme of ['light', 'dark']) {
	for (const scenario of ['mid', 'before', 'won', 'missed']) {
		test(`renders without errors: ${scenario}, ${theme} theme`, async ({ page }) => {
			const errors = watchErrors(page);
			await open(page, `theme=${theme}&scenario=${scenario}`);
			await expect(page.locator('.ngt-error')).toHaveCount(0);
			await expect(page.locator('svg.ngt-chart').first()).toBeVisible();
			expect(errors).toEqual([]);
		});
	}
}

test('every total on the dashboard adds up', async ({ page }) => {
	await open(page);
	const totalCard = card(page, 'Total progress');
	await expect(totalCard.locator('.ngt-card-figure')).toHaveText('34,680 / 50,000');
	await expect(totalCard).toContainText('33,480 in chapters + 1,200 added by hand');
	const foot = card(page, 'Chapters').locator('tfoot');
	await expect(foot.locator('tr', { hasText: 'Added by hand' })).toContainText('+1,200');
	await expect(foot.locator('tr', { hasText: 'Total' }).locator('td').last()).toHaveText('34,680');
});

test('the NaNoWriMo-style cards show the expected numbers', async ({ page }) => {
	await open(page);
	await expect(card(page, 'Words needed today')).toContainText('830');
	await expect(card(page, 'Words needed today')).toContainText('of 1,469');
	await expect(card(page, 'Words needed today')).toContainText('639 more to stay on track');
	await expect(card(page, 'Writing streak')).toContainText('10');
	await expect(card(page, 'Daily average')).toContainText('1,734');
	await expect(card(page, 'Projected finish')).toContainText('Nov 29, 2026');
	await expect(card(page, 'When I write')).toContainText('between 9 pm and 10 pm');
});

test('chart views switch, and keyboard focus stays on the pressed button', async ({ page }) => {
	await open(page);
	const progress = card(page, 'My overall progress');
	const bar = progress.getByRole('button', { name: 'Bar' });
	await bar.focus();
	await bar.press('Enter');
	await expect(progress.getByRole('button', { name: 'Bar' })).toHaveAttribute('aria-pressed', 'true');
	await expect(progress.locator('.ngt-series.ngt-accent rect').first()).toBeVisible();
	const focusedKey = await page.evaluate(() => document.activeElement?.getAttribute('data-ngt-key'));
	expect(focusedKey).toBe('mode-progress-bar');

	await progress.getByRole('button', { name: 'Table' }).click();
	await expect(progress.locator('table.ngt-table tbody tr').first()).toContainText('Nov 20, 2026');
});

test('chapters sort by words, and the sort is announced', async ({ page }) => {
	await open(page);
	const chapters = card(page, 'Chapters');
	await chapters.getByRole('button', { name: /^Words/ }).click();
	await expect(chapters.locator('tbody tr').first()).toContainText('Chapter 6');
	await expect(chapters.locator('th[aria-sort="descending"]')).toHaveCount(1);
});

test('deleting a manual entry takes two presses, and the first press says so', async ({ page }) => {
	await page.clock.install();
	await open(page);
	const log = card(page, 'Progress log');
	await log.getByRole('button', { name: /Show all/ }).click();
	const del = log.getByRole('button', { name: /Delete the 1,200 words added for Nov 9, 2026/ });
	await del.click();
	const confirm = log.getByRole('button', { name: /Press again to delete the 1,200 words/ });
	await expect(confirm).toHaveText('Confirm');
	// Unarmed again after 4 seconds.
	await page.clock.fastForward(4200);
	await expect(log.getByRole('button', { name: /^Delete the 1,200 words/ })).toHaveText('Delete');
	await expect(log).toContainText('Notebook on the train');
});

test('the open summary survives a redraw', async ({ page }) => {
	await open(page);
	await page.locator('details.ngt-summary summary').click();
	await card(page, 'My overall progress').getByRole('button', { name: 'Table' }).click();
	await expect(page.locator('details.ngt-summary')).toHaveAttribute('open', '');
});

test('charts are labelled for screen readers', async ({ page }) => {
	await open(page);
	const charts = page.locator('svg.ngt-chart');
	const count = await charts.count();
	expect(count).toBeGreaterThanOrEqual(5);
	for (let i = 0; i < count; i++) {
		await expect(charts.nth(i)).toHaveAttribute('role', 'img');
		await expect(charts.nth(i)).toHaveAttribute('aria-label', /.+/);
	}
});

test('a narrow side pane stacks everything in one column with readable labels', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 900 });
	await open(page, 'width=300');
	const xs = await page.locator('.ngt-grid > .ngt-card').evaluateAll((els) =>
		els.map((e) => Math.round(e.getBoundingClientRect().left)),
	);
	expect(new Set(xs).size).toBe(1);
	// Axis labels render at 9px or larger.
	const smallest = await page.locator('.ngt-chart-label').evaluateAll((els) =>
		Math.min(...els.map((e) => e.getBoundingClientRect().height)),
	);
	expect(smallest).toBeGreaterThanOrEqual(9);
});

test('states before the start, after a missed goal, and after winning', async ({ page }) => {
	await open(page, 'scenario=before');
	await expect(page.locator('.ngt-banner')).toContainText('Writing starts in 5 days, on Nov 1, 2026.');
	await open(page, 'scenario=missed');
	await expect(page.locator('.ngt-banner')).toContainText('Writing ended on Nov 30, 2026');
	await expect(card(page, 'Projected finish')).toContainText('Ended');
	await open(page, 'scenario=won');
	await expect(page.locator('.ngt-banner')).toContainText('You reached your goal');
	await expect(card(page, 'Projected finish')).toContainText('Done');
});
