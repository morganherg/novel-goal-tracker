import { expect, test, type Page } from '@playwright/test';

/*
 * The whole plugin (src/main.ts: loading data, counting chapters, history,
 * the dashboard code block) running in Chromium against a stand-in for
 * Obsidian (scripts/preview/obsidian-browser-stub.ts) and fixture data.
 */

interface Fixture {
	data: unknown;
	files: Record<string, string>;
	novelId: string;
	dashPath: string;
}

const novel = {
	id: 'n1',
	title: 'Harbour Lights',
	summary: 'A test novel.',
	genre: 'Literary',
	goal: 50000,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	folderPath: 'Harbour Lights',
	createdAt: '2026-11-01T09:00:00.000Z',
	updatedAt: '2026-11-01T09:00:00.000Z',
};

const today = (() => {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

function fixture(overrides: Partial<Fixture> = {}): Fixture {
	return {
		data: {
			schemaVersion: 1,
			hasOnboarded: true,
			dayStartHour: 0,
			novelsFolder: '',
			countOptions: { code: false, comments: false },
			settingsUpdatedAt: '',
			novels: [novel],
			removedNovels: {},
			history: {
				'device-a': {
					updatedAt: '',
					// Typed 300, deleted 200 today: net +100.
					days: { n1: { [today]: { net: 100, added: 300, hours: { '9': 300 } } } },
					adjustments: [{ id: 'adj1', novelId: 'n1', date: today, words: 50, note: 'On paper', createdAt: '' }],
					deletedAdjustments: [],
				},
			},
		},
		files: {
			'Harbour Lights/Dashboard.md': '```novel-dashboard\nnovel: n1\n```\n',
			// 5 words (the heading counts), with Markdown and a comment that must not count.
			'Harbour Lights/Chapters/Chapter 1.md': '# One\n\nThe *boats* knocked together. %%not counted%%\n',
			// 4 words, with frontmatter that must not count.
			'Harbour Lights/Chapters/Chapter 2.md': '---\ntags: [draft]\n---\nGulls woke the harbour.\n',
			'Notes/Elsewhere.md': 'These words are not in the novel at all.',
		},
		novelId: 'n1',
		dashPath: 'Harbour Lights/Dashboard.md',
		...overrides,
	};
}

async function runPlugin(page: Page, f: Fixture): Promise<string[]> {
	await page.addInitScript((fx: Fixture) => {
		const w = window as unknown as Record<string, unknown>;
		w.__data = fx.data;
		w.__files = fx.files;
		w.__novelId = fx.novelId;
		w.__dashPath = fx.dashPath;
	}, f);
	await page.goto('/scripts/preview/harness-blank.html');
	await expect(page).toHaveTitle(/OK|ERRORS/);
	return page.evaluate(() => (window as unknown as { __errors: string[] }).__errors);
}

const card = (page: Page, title: string) =>
	page.locator('.ngt-card', { has: page.locator('.ngt-card-label', { hasText: title }) }).first();

test('the plugin loads, counts chapters, and draws the dashboard without errors', async ({ page }) => {
	const errors = await runPlugin(page, fixture());
	expect(errors).toEqual([]);
	await expect(page.locator('.ngt-error')).toHaveCount(0);
	await expect(page.locator('.ngt-title').first()).toHaveText('Harbour Lights');
});

test('chapter counts follow the word rules; the total includes words added by hand', async ({ page }) => {
	await runPlugin(page, fixture());
	const chapters = card(page, 'Chapters');
	await expect(chapters.locator('tbody tr', { hasText: 'Chapter 1' }).locator('td').last()).toHaveText('5');
	await expect(chapters.locator('tbody tr', { hasText: 'Chapter 2' }).locator('td').last()).toHaveText('4');
	await expect(chapters.locator('tfoot tr', { hasText: 'Total' }).locator('td').last()).toHaveText('59');
	await expect(card(page, 'Total progress').locator('.ngt-card-figure')).toHaveText('59 / 50,000');
	await expect(card(page, 'Total progress')).toContainText('9 in chapters + 50 added by hand');
});

test("words today counts what was typed (plus words added by hand), not the net change", async ({ page }) => {
	await runPlugin(page, fixture());
	// 300 typed + 50 added by hand; the 200 deleted don't lower it.
	await expect(card(page, 'Writing streak')).toContainText('350 words today');
	const log = card(page, 'Progress log');
	await expect(log.locator('tr', { hasText: 'Typed' })).toContainText('+300');
	await expect(log.locator('tr', { hasText: 'Added' })).toContainText('+50');
	await expect(log).toContainText('On paper');
});

test('a dashboard that points at no tracked novel says so', async ({ page }) => {
	await runPlugin(page, fixture({ novelId: 'missing', dashPath: 'Elsewhere/Dashboard.md' }));
	await expect(page.locator('.ngt-error').first()).toContainText("isn't linked to a tracked novel");
});

test('older saved data (before words typed were recorded) still loads', async ({ page }) => {
	const f = fixture();
	const data = f.data as { history: Record<string, { days: Record<string, Record<string, unknown>> }> };
	data.history['device-a'] = {
		days: { n1: { [today]: { net: 120, hours: { '14': 120 } } } },
	} as never;
	(f.data as Record<string, unknown>).removedNovelIds = ['old-id'];
	delete (f.data as Record<string, unknown>).removedNovels;
	const errors = await runPlugin(page, f);
	expect(errors).toEqual([]);
	await expect(card(page, 'Writing streak')).toContainText('120 words today');
});

function dayFixture(dayStartHour: number): Fixture {
	const f = fixture();
	const data = f.data as Record<string, unknown>;
	data.dayStartHour = dayStartHour;
	data.history = {
		'device-a': {
			updatedAt: '',
			days: { n1: { '2026-11-20': { net: 300, added: 300, hours: { '23': 300 } } } },
			adjustments: [],
			deletedAdjustments: [],
		},
	};
	return f;
}

test('at midnight, with Obsidian left open, today starts over and yesterday moves to the log', async ({ page }) => {
	await page.clock.install({ time: new Date(2026, 10, 20, 23, 58, 0) });
	await runPlugin(page, dayFixture(0));
	await expect(card(page, 'Writing streak')).toContainText('300 words today');
	await page.clock.fastForward('03:00'); // 00:01 on Nov 21; the plugin checks once a minute
	await expect(card(page, 'Writing streak')).toContainText('0 words today');
	await expect(card(page, 'Writing streak')).toContainText(/1\s*day in a row/);
	await expect(card(page, 'Progress log').locator('tbody tr').first()).toContainText('Nov 20, 2026');
});

test('with the writing day starting at 4 am, 2:30 am still counts as the day before', async ({ page }) => {
	await page.clock.install({ time: new Date(2026, 10, 21, 2, 30, 0) });
	await runPlugin(page, dayFixture(4));
	await expect(card(page, 'Writing streak')).toContainText('300 words today');
});
