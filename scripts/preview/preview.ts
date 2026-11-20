// Renders the real dashboard with sample data. Build with `npm run preview`.
import './dom-shim';
import { addDays } from '../../src/dates';
import { computeStats, dailyTotals, emptyDevice, hourTotals, recordDelta, adjustmentsFor, type History } from '../../src/history';
import { progressLog, progressSeries } from '../../src/series';
import type { Novel } from '../../src/types';
import { renderDashboard } from '../../src/ui/dashboard-block';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'mid';
document.body.classList.add(params.get('theme') === 'dark' ? 'theme-dark' : 'theme-light');
if (params.has('clean')) document.querySelector('.preview-note')?.remove();
const width = params.get('width');
if (width) document.getElementById('frame')?.style.setProperty('max-width', `${width}px`);

const novel: Novel = {
	id: 'n1',
	title: 'The Lighthouse Keeper',
	summary: 'A keeper on a storm-bound island finds letters from the woman who kept the light before her.',
	genre: 'Literary',
	goal: 50000,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	folderPath: 'The Lighthouse Keeper',
	createdAt: '',
	updatedAt: '',
};

const today =
	scenario === 'before' ? '2026-10-27' : scenario === 'won' ? '2026-11-28' : scenario === 'missed' ? '2026-12-03' : '2026-11-20';
const dev = emptyDevice();
const pattern = [1850, 2100, 1400, 0, 1720, 2600, 1950, 1300, 0, 0, 2400, 1780, 1650, 2200, 1900, 1100, 2050, 1700, 1850, 830];
const extra = scenario === 'won' ? [2600, 2900, 2500, 2700, 2400, 2800, 2650, 2500] : [];
[...pattern, ...extra].forEach((w, i) => {
	if (scenario === 'before') return;
	const day = addDays('2026-11-01', i);
	if (day > today) return;
	// Mostly evenings, some mornings.
	recordDelta(dev, novel.id, day, 21, Math.round(w * 0.6), 't');
	recordDelta(dev, novel.id, day, 7, Math.round(w * 0.25), 't');
	recordDelta(dev, novel.id, day, 13, w - Math.round(w * 0.6) - Math.round(w * 0.25), 't');
});
if (scenario !== 'before') {
	dev.adjustments.push({ id: 'a1', novelId: 'n1', date: '2026-11-09', words: 1200, note: 'Notebook on the train', createdAt: '' });
}
const history: History = { me: dev };
const daily = dailyTotals(history, novel.id);
const typed = dailyTotals({ me: { ...dev, adjustments: [] } }, novel.id);
const baseline = scenario === 'before' ? 2400 : 3100; // words already in the novel before tracking
let current = baseline;
for (const v of daily.values()) current += v;
// Chapters hold the total minus the words added by hand.
const addedByHand = adjustmentsFor(history, novel.id).reduce((sum, a) => sum + a.words, 0);
const chapterWords = [4210, 5380, 6020, 4875, 5940, current - addedByHand - 4210 - 5380 - 6020 - 4875 - 5940];
const chapters = chapterWords.map((w, i) => ({
	name: `Chapter ${i + 1}`,
	path: `Chapters/Chapter ${i + 1}.md`,
	words: Math.max(0, w),
}));
if (scenario === 'before') chapters.splice(1);

const stats = computeStats(novel, today, current, daily);
const root = document.getElementById('frame') as HTMLElement;
const draw = (): void =>
	renderDashboard(
		root,
		{
			novel,
			today,
			stats,
			series: progressSeries(novel, today, current, dailyTotals(history, novel.id, 'net'), daily),
			hours: hourTotals(history, novel.id),
			log: progressLog(typed, adjustmentsFor(history, novel.id)),
			chapters,
			added: adjustmentsFor(history, novel.id).reduce((sum, a) => sum + a.words, 0),
		},
		{
			openChapter: () => {},
			newChapter: () => {},
			addWords: () => {},
			editNovel: () => {},
			deleteAdjustment: () => {},
			redraw: draw,
		},
	);
draw();
