import { daysBetween, formatKey } from '../dates';
import type { NovelStats } from '../history';
import { whenIWriteSummary, type LogRow, type ProgressSeries } from '../series';
import type { DateKey, Novel } from '../types';
import { dataTable, modeSwitch, ringGauge, xyChart, type ChartMode } from './charts';

export interface ChapterLink {
	name: string;
	path: string;
	/** Live word count, or undefined while counting. */
	words: number | undefined;
}

export interface DashboardData {
	novel: Novel;
	today: DateKey;
	/** Null while chapters are still being counted. */
	stats: NovelStats | null;
	series: ProgressSeries | null;
	/** Net words by hour of day (0-23). */
	hours: number[];
	log: LogRow[];
	chapters: ChapterLink[];
	/** Words added by hand ("Add words for a day"); part of the total, not of any chapter. */
	added: number;
}

export interface DashboardActions {
	openChapter(path: string): void;
	newChapter(): void;
	addWords(): void;
	editNovel(): void;
	deleteAdjustment(id: string): void;
	/** Re-draw this dashboard (after a view switch, sort, etc.). */
	redraw(): void;
}

/** Per-novel display choices, kept while Obsidian is open. */
interface ViewState {
	progress: ChartMode;
	daily: ChartMode;
	chapterSort: 'name' | 'words';
	showFullLog: boolean;
	summaryOpen: boolean;
	/** A manual entry whose Delete was pressed once, waiting for Confirm. */
	armed: { id: string; until: number } | null;
}
const viewStates = new Map<string, ViewState>();
function viewState(novelId: string): ViewState {
	let s = viewStates.get(novelId);
	if (!s) {
		s = { progress: 'line', daily: 'bar', chapterSort: 'name', showFullLog: false, summaryOpen: false, armed: null };
		viewStates.set(novelId, s);
	}
	return s;
}

const LOG_ROWS = 7;
/** Below this width (px), charts are drawn smaller so their labels stay readable. */
const NARROW_PX = 560;

/** Whether a dashboard drawn in this element should use the narrow layout. */
export function isNarrow(el: HTMLElement): boolean {
	return el.clientWidth > 0 && el.clientWidth < NARROW_PX;
}

/** Layout for the dashboard being drawn (set at the start of each render). */
let narrow = false;
let wideChartWidth = 640;
let smallChartWidth = 300;

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

/** Mark a control so focus can return to it after a redraw. */
function key<T extends HTMLElement>(el: T, k: string): T {
	el.setAttr('data-ngt-key', k);
	return el;
}

const ARM_MS = 4000;

function n(x: number): string {
	return Math.round(x).toLocaleString();
}

function plural(x: number, one: string, many: string): string {
	return `${n(x)} ${x === 1 ? one : many}`;
}

/** The full novel dashboard, modeled on the classic NaNoWriMo novel stats page. */
export function renderDashboard(el: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	// Measure while the old dashboard is still in place, so nothing jumps.
	const width = el.clientWidth;
	narrow = width > 0 && width < NARROW_PX;
	const columns = narrow ? 1 : width > 0 && width < 760 ? 2 : 3;
	// Draw charts at about their on-screen size so labels stay readable.
	wideChartWidth = width > 0 ? clamp(Math.round(width - 40), 240, 900) : 640;
	smallChartWidth = width > 0 ? clamp(Math.round(width / columns - 40), 200, 420) : 300;
	const doc = el.doc;
	const focused = doc.activeElement;
	// instanceOf (not instanceof) also works for elements in popout windows.
	const focusKey =
		focused && focused.instanceOf(HTMLElement) && el.contains(focused)
			? (focused.closest('[data-ngt-key]')?.getAttribute('data-ngt-key') ?? null)
			: null;

	// Build the new dashboard next to the old one, then swap in one step.
	const root = el.createDiv({ cls: 'ngt-dashboard' });
	buildDashboard(root, d, actions);
	el.replaceChildren(root);

	if (focusKey) {
		for (const c of Array.from(root.querySelectorAll<HTMLElement>('[data-ngt-key]'))) {
			if (c.getAttribute('data-ngt-key') === focusKey) {
				c.focus();
				break;
			}
		}
	}
}

function buildDashboard(root: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	renderHeader(root, d, actions);

	if (!d.stats || !d.series) {
		root.createDiv({ cls: 'ngt-note', text: 'Counting your chapters…' });
		renderChapters(root, d, actions);
		return;
	}
	const s = d.stats;
	renderBanner(root, d.novel, d.today, s);

	const grid = root.createDiv({ cls: 'ngt-grid' });
	renderTotalCard(grid, s, d.added);
	renderTodayCard(grid, d.novel, d.today, s);
	renderStreakCard(grid, s);
	renderProgressChart(grid, d, actions);
	renderAverageCard(grid, s);
	renderFinishCard(grid, d.novel, s);
	renderWhenCard(grid, d.hours);
	renderDailyChart(grid, d, actions);
	const pair = grid.createDiv({ cls: 'ngt-pair' });
	renderLog(pair, d, actions);
	renderChapters(pair, d, actions);
}

// ---- Header and banner -------------------------------------------------------

function renderHeader(root: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	const { novel } = d;
	const header = root.createDiv({ cls: 'ngt-header' });
	const titleRow = header.createDiv({ cls: 'ngt-title-row' });
	titleRow.createDiv({ cls: 'ngt-title', text: novel.title });
	const buttons = titleRow.createDiv({ cls: 'ngt-buttons' });
	key(buttons.createEl('button', { text: 'Edit novel' }), 'edit').addEventListener('click', () => actions.editNovel());
	key(buttons.createEl('button', { text: 'Add words for a day' }), 'add').addEventListener('click', () =>
		actions.addWords(),
	);
	const meta = [
		novel.genre,
		`${n(novel.goal)} words`,
		`${formatKey(novel.startDate)} to ${formatKey(novel.endDate)}`,
	]
		.filter(Boolean)
		.join(' · ');
	header.createDiv({ cls: 'ngt-meta', text: meta });
	if (novel.summary) {
		const state = viewState(novel.id);
		const details = header.createEl('details', { cls: 'ngt-summary' });
		details.open = state.summaryOpen;
		details.addEventListener('toggle', () => (state.summaryOpen = details.open));
		key(details.createEl('summary', { text: 'Summary' }), 'summary');
		details.createEl('p', { text: novel.summary });
	}
}

function renderBanner(root: HTMLElement, novel: Novel, today: DateKey, s: NovelStats): void {
	if (s.phase === 'before') {
		const until = daysBetween(today, novel.startDate);
		root.createDiv({
			cls: 'ngt-banner',
			text: `Writing starts in ${plural(until, 'day', 'days')}, on ${formatKey(novel.startDate)}.`,
		});
	} else if (s.goalMet) {
		root.createDiv({
			cls: 'ngt-banner ngt-banner-win',
			text: `You reached your goal: ${n(s.current)} of ${n(s.goal)} words.`,
		});
	} else if (s.phase === 'after') {
		root.createDiv({
			cls: 'ngt-banner',
			text: `Writing ended on ${formatKey(novel.endDate)}. You wrote ${n(s.current)} words, ${s.percent}% of your goal.`,
		});
	}
}

// ---- Cards -----------------------------------------------------------------

function card(parent: HTMLElement, title: string, wide = false): HTMLElement {
	const c = parent.createDiv({ cls: wide ? 'ngt-card ngt-card-wide' : 'ngt-card' });
	c.createDiv({ cls: 'ngt-card-head' }).createDiv({ cls: 'ngt-card-label', text: title });
	return c;
}

/** The right-hand side of a card's title row, for buttons. */
function tools(c: HTMLElement): HTMLElement {
	const head = c.querySelector('.ngt-card-head') ?? c;
	return head.createDiv({ cls: 'ngt-card-tools' });
}

function renderTotalCard(grid: HTMLElement, s: NovelStats, added: number): void {
	const c = card(grid, 'Total progress');
	ringGauge(c, s.goal > 0 ? s.current / s.goal : 0, `${s.percent}%`, 'of goal', `${s.percent}% of goal`);
	c.createDiv({ cls: 'ngt-card-figure', text: `${n(s.current)} / ${n(s.goal)}` });
	c.createDiv({
		cls: 'ngt-card-unit',
		text: s.goalMet ? 'words. Goal reached!' : `words · ${n(s.remaining)} to go`,
	});
	if (added !== 0) {
		// Say where the total comes from, so it matches the chapter table.
		c.createDiv({
			cls: 'ngt-card-unit ngt-card-breakdown',
			text: `${n(s.current - added)} in chapters ${added > 0 ? '+' : '−'} ${n(Math.abs(added))} added by hand`,
		});
	}
}

function renderTodayCard(grid: HTMLElement, novel: Novel, today: DateKey, s: NovelStats): void {
	const c = card(grid, 'Words needed today');
	if (s.phase === 'before') {
		const until = daysBetween(today, novel.startDate);
		ringGauge(c, 0, String(until), until === 1 ? 'day to go' : 'days to go', 'Writing has not started');
		c.createDiv({ cls: 'ngt-card-unit', text: 'Writing hasn\'t started yet.' });
		return;
	}
	if (s.phase === 'after') {
		ringGauge(c, s.goalMet ? 1 : 0, n(s.today), 'today', 'Writing has ended');
		c.createDiv({ cls: 'ngt-card-unit', text: 'Writing has ended.' });
		return;
	}
	if (s.goalMet) {
		ringGauge(c, 1, n(s.today), 'today', 'Goal reached');
		c.createDiv({ cls: 'ngt-card-unit', text: 'Goal reached. Anything more is a bonus.' });
		return;
	}
	const target = Math.max(1, s.todayTarget);
	ringGauge(c, s.today / target, n(s.today), `of ${n(s.todayTarget)}`, `${n(s.today)} of ${n(s.todayTarget)} words today`);
	c.createDiv({
		cls: 'ngt-card-unit',
		text:
			s.neededToday > 0
				? `${n(s.neededToday)} more to stay on track · ${plural(s.daysLeft, 'day', 'days')} left`
				: `Today's share is done · ${plural(s.daysLeft, 'day', 'days')} left`,
	});
}

function renderStreakCard(grid: HTMLElement, s: NovelStats): void {
	const c = card(grid, 'Writing streak');
	c.createDiv({ cls: 'ngt-card-value', text: String(s.streak) });
	c.createDiv({
		cls: 'ngt-card-unit',
		text: s.streak > 0 ? `${s.streak === 1 ? 'day' : 'days'} in a row` : 'Write today to start a streak.',
	});
	c.createDiv({ cls: 'ngt-card-figure ngt-card-today', text: `${n(s.today)} words today` });
}

function renderAverageCard(grid: HTMLElement, s: NovelStats): void {
	const c = card(grid, 'Daily average');
	if (s.dailyAverage === null) {
		c.createDiv({ cls: 'ngt-card-unit', text: 'Your average appears once writing starts.' });
		return;
	}
	c.createDiv({ cls: 'ngt-card-value', text: n(s.dailyAverage) });
	c.createDiv({ cls: 'ngt-card-unit', text: 'words a day, on average' });
}

function renderFinishCard(grid: HTMLElement, novel: Novel, s: NovelStats): void {
	const c = card(grid, 'Projected finish');
	if (s.goalMet) {
		c.createDiv({ cls: 'ngt-card-value ngt-card-value-sm', text: 'Done' });
		c.createDiv({ cls: 'ngt-card-unit', text: 'You\'ve reached your goal.' });
		return;
	}
	if (s.phase === 'before') {
		c.createDiv({ cls: 'ngt-card-unit', text: 'Your finish date appears once writing starts.' });
		return;
	}
	if (s.phase === 'after') {
		c.createDiv({ cls: 'ngt-card-value ngt-card-value-sm', text: 'Ended' });
		c.createDiv({ cls: 'ngt-card-unit', text: `${n(s.remaining)} words short of your goal.` });
		return;
	}
	if (!s.projectedFinish) {
		c.createDiv({ cls: 'ngt-card-unit', text: 'Write your first words to see your finish date.' });
		return;
	}
	c.createDiv({ cls: 'ngt-card-unit', text: 'At this rate you\'ll finish on' });
	c.createDiv({ cls: 'ngt-card-value ngt-card-value-sm', text: formatKey(s.projectedFinish) });
	const diff = daysBetween(novel.endDate, s.projectedFinish);
	c.createDiv({
		cls: diff > 0 ? 'ngt-card-unit ngt-late' : 'ngt-card-unit ngt-early',
		text:
			diff > 0
				? `${plural(diff, 'day', 'days')} after your last day`
				: diff === 0
					? 'right on your last day'
					: `${plural(-diff, 'day', 'days')} ahead of your last day`,
	});
}

function renderWhenCard(grid: HTMLElement, hours: number[]): void {
	const c = card(grid, 'When I write');
	const values = hours.map((h) => Math.max(0, h));
	const labels = values.map((_, h) => `${h}:00`);
	const ticks = values.map((_, h) => (h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : h === 18 ? '6p' : ''));
	xyChart(c, [{ name: 'Words', values, kind: 'bar', cls: 'ngt-accent' }], {
		ariaLabel: 'Words written by hour of day',
		width: smallChartWidth,
		height: Math.round(smallChartWidth * 0.55),
		labels,
		ticks,
		unit: 'words',
	});
	c.createDiv({ cls: 'ngt-card-unit', text: whenIWriteSummary(hours) });
}

// ---- Charts ------------------------------------------------------------------

/**
 * Day labels for a chart's x axis: the first day, the last day, and evenly
 * spaced days between, each with its month whenever the month changes.
 */
export function dayTicks(days: DateKey[], slots: number): string[] {
	const last = days.length - 1;
	const every = Math.max(1, Math.ceil(days.length / Math.max(2, slots)));
	const show = new Set<number>([0, last]);
	for (let i = every - 1; i < last; i += every) {
		if (last - i >= every / 2) show.add(i); // not too close to the last label
	}
	let prevMonth = '';
	return days.map((d, i) => {
		if (!show.has(i)) return '';
		const month = d.slice(0, 7);
		const label = month !== prevMonth ? formatKey(d).replace(/, \d{4}$/, '') : String(Number(d.slice(8)));
		prevMonth = month;
		return label;
	});
}

function tickSlots(): number {
	return Math.max(3, Math.floor(wideChartWidth / 90));
}

function renderProgressChart(grid: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	const series = d.series as ProgressSeries;
	const state = viewState(d.novel.id);
	const c = card(grid, 'My overall progress', true);
	modeSwitch(tools(c), 'progress', state.progress, ['line', 'bar', 'table'], (m) => {
		state.progress = m;
		actions.redraw();
	});
	const labels = series.days.map((day) => formatKey(day));
	const todayIndex = daysBetween(d.novel.startDate, d.today);
	if (state.progress === 'table') {
		const rows = series.days
			.map((day, i) => [formatKey(day), series.cumulative[i], series.par[i]] as const)
			.filter(([, total]) => total !== null)
			.map(([day, total, par]) => [day, n(total ?? 0), n(par ?? 0)])
			.reverse();
		if (rows.length === 0) c.createDiv({ cls: 'ngt-note', text: 'Nothing to show until writing starts.' });
		else dataTable(c.createDiv({ cls: 'ngt-table-wrap' }), ['Date', 'Total words', 'On-pace total'], rows);
		return;
	}
	xyChart(
		c,
		[
			{ name: 'My words', values: series.cumulative, kind: state.progress === 'bar' ? 'bar' : 'line', cls: 'ngt-accent' },
			{ name: 'On pace', values: series.par, kind: 'line', cls: 'ngt-par', dashed: true },
		],
		{
			ariaLabel: 'Total words by day, against the on-pace line',
			width: wideChartWidth,
			height: clamp(Math.round(wideChartWidth * 0.36), 170, 260),
			labels,
			ticks: dayTicks(series.days, tickSlots()),
			unit: 'words',
			highlight: todayIndex,
		},
	);
	legend(c, [
		['ngt-accent', 'My words'],
		['ngt-par ngt-dashed', 'On pace to finish'],
	]);
}

function renderDailyChart(grid: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	const series = d.series as ProgressSeries;
	const state = viewState(d.novel.id);
	const c = card(grid, 'My daily word count', true);
	modeSwitch(tools(c), 'daily', state.daily, ['bar', 'line', 'table'], (m) => {
		state.daily = m;
		actions.redraw();
	});
	const perDay = Math.ceil(d.novel.goal / Math.max(1, series.days.length));
	if (state.daily === 'table') {
		const rows = series.days
			.map((day, i) => [formatKey(day), series.daily[i]] as const)
			.filter(([, w]) => w !== null)
			.map(([day, w]) => [day, n(w ?? 0)])
			.reverse();
		if (rows.length === 0) c.createDiv({ cls: 'ngt-note', text: 'Nothing to show until writing starts.' });
		else dataTable(c.createDiv({ cls: 'ngt-table-wrap' }), ['Date', 'Words'], rows);
		return;
	}
	xyChart(
		c,
		[
			{ name: 'Words', values: series.daily, kind: state.daily === 'line' ? 'line' : 'bar', cls: 'ngt-accent' },
			{ name: 'Daily target', values: series.days.map(() => perDay), kind: 'line', cls: 'ngt-par', dashed: true },
		],
		{
			ariaLabel: 'Words written each day, against the daily target',
			width: wideChartWidth,
			height: clamp(Math.round(wideChartWidth * 0.36), 170, 260),
			labels: series.days.map((day) => formatKey(day)),
			ticks: dayTicks(series.days, tickSlots()),
			unit: 'words',
			highlight: daysBetween(d.novel.startDate, d.today),
		},
	);
	legend(c, [
		['ngt-accent', 'Words that day'],
		['ngt-par ngt-dashed', `Daily target (${n(perDay)})`],
	]);
}

function legend(parent: HTMLElement, items: [string, string][]): void {
	const l = parent.createDiv({ cls: 'ngt-legend' });
	for (const [cls, text] of items) {
		const item = l.createSpan({ cls: 'ngt-legend-item' });
		item.createSpan({ cls: `ngt-swatch ${cls}` });
		item.createSpan({ text });
	}
}

// ---- Tables ------------------------------------------------------------------

function renderLog(grid: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	const state = viewState(d.novel.id);
	const c = card(grid, 'Progress log');
	if (d.log.length === 0) {
		c.createDiv({ cls: 'ngt-card-unit', text: 'Your writing days will be listed here.' });
		return;
	}
	const rows = state.showFullLog ? d.log : d.log.slice(0, LOG_ROWS);
	const table = c.createDiv({ cls: 'ngt-table-wrap' }).createEl('table', { cls: 'ngt-table' });
	const head = table.createEl('thead').createEl('tr');
	for (const h of ['Date', 'Words', 'How', '']) head.createEl('th', { text: h });
	const body = table.createEl('tbody');
	for (const r of rows) {
		const tr = body.createEl('tr');
		tr.createEl('td', { text: formatKey(r.date) });
		tr.createEl('td', { text: (r.words > 0 ? '+' : '') + n(r.words), cls: 'ngt-num' });
		const how = tr.createEl('td', { text: r.source === 'typed' ? 'Typed' : 'Added' });
		if (r.note) how.createDiv({ cls: 'ngt-log-note', text: r.note });
		const act = tr.createEl('td');
		if (r.adjustmentId) renderDelete(act, r, state, actions);
	}
	if (d.log.length > LOG_ROWS) {
		const more = key(
			c.createEl('button', {
				cls: 'ngt-link-button',
				text: state.showFullLog ? 'Show fewer' : `Show all ${d.log.length}`,
			}),
			'log-more',
		);
		more.addEventListener('click', () => {
			state.showFullLog = !state.showFullLog;
			actions.redraw();
		});
	}
}

/** Delete for a manual entry, in two steps so a stray tap can't remove it. */
function renderDelete(cell: HTMLElement, r: LogRow, state: ViewState, actions: DashboardActions): void {
	const id = r.adjustmentId ?? '';
	const what = `the ${n(r.words)} words added for ${formatKey(r.date)}`;
	const armed = state.armed !== null && state.armed.id === id && state.armed.until > Date.now();
	const del = key(
		cell.createEl('button', {
			cls: armed ? 'ngt-icon-button mod-warning' : 'ngt-icon-button',
			text: armed ? 'Confirm' : 'Delete',
			attr: { 'aria-label': armed ? `Press again to delete ${what}` : `Delete ${what}` },
		}),
		`del-${id}`,
	);
	del.addEventListener('click', () => {
		if (state.armed && state.armed.id === id && state.armed.until > Date.now()) {
			state.armed = null;
			actions.deleteAdjustment(id);
			return;
		}
		state.armed = { id, until: Date.now() + ARM_MS };
		actions.redraw();
		window.setTimeout(() => {
			if (state.armed?.id === id && state.armed.until <= Date.now()) {
				state.armed = null;
				actions.redraw();
			}
		}, ARM_MS + 50);
	});
}

function renderChapters(grid: HTMLElement, d: DashboardData, actions: DashboardActions): void {
	const state = viewState(d.novel.id);
	const c = card(grid, `Chapters (${d.chapters.length})`);
	key(tools(c).createEl('button', { text: 'New chapter', cls: 'mod-cta' }), 'new-chapter').addEventListener(
		'click',
		() => actions.newChapter(),
	);
	if (d.chapters.length === 0) {
		c.createDiv({ cls: 'ngt-card-unit', text: 'No chapters yet. Add one to start writing.' });
		return;
	}
	const sorted = [...d.chapters];
	if (state.chapterSort === 'words') sorted.sort((a, b) => (b.words ?? 0) - (a.words ?? 0));
	const table = c.createDiv({ cls: 'ngt-table-wrap' }).createEl('table', { cls: 'ngt-table' });
	const head = table.createEl('thead').createEl('tr');
	const sortHeader = (label: string, by: ViewState['chapterSort']): void => {
		const active = state.chapterSort === by;
		const th = head.createEl('th');
		if (active) th.setAttr('aria-sort', by === 'words' ? 'descending' : 'ascending');
		const b = key(
			th.createEl('button', {
				cls: 'ngt-sort',
				text: label + (active ? (by === 'words' ? ' ↓' : ' ↑') : ''),
			}),
			`sort-${by}`,
		);
		b.addEventListener('click', () => {
			if (state.chapterSort === by) return;
			state.chapterSort = by;
			actions.redraw();
		});
	};
	sortHeader('Chapter', 'name');
	sortHeader('Words', 'words');
	const body = table.createEl('tbody');
	let total = 0;
	sorted.forEach((ch, i) => {
		const tr = body.createEl('tr');
		// Our own link class: Obsidian's internal-link handling would read "#" as this note.
		const link = key(tr.createEl('td').createEl('a', { text: ch.name, cls: 'ngt-chapter-link', href: '#' }), `ch-${i}`);
		link.addEventListener('click', (evt) => {
			evt.preventDefault();
			actions.openChapter(ch.path);
		});
		tr.createEl('td', { cls: 'ngt-num', text: ch.words === undefined ? '…' : n(ch.words) });
		total += ch.words ?? 0;
	});
	const foot = table.createEl('tfoot');
	if (d.added !== 0) {
		// Words added by hand belong to no chapter but count toward the total.
		const extra = foot.createEl('tr', { cls: 'ngt-added-row' });
		extra.createEl('td', { text: 'Added by hand' });
		extra.createEl('td', { cls: 'ngt-num', text: (d.added > 0 ? '+' : '') + n(d.added) });
		total += d.added;
	}
	const sum = foot.createEl('tr');
	sum.createEl('td', { text: 'Total' });
	sum.createEl('td', { cls: 'ngt-num', text: n(total) });
}

export function renderDashboardError(el: HTMLElement, message: string): void {
	el.empty();
	el.createDiv({ cls: 'ngt-dashboard ngt-error', text: message });
}
