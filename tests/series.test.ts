import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourLabel, niceMax, peakHour, progressLog, progressSeries, whenIWriteSummary } from '../src/series';
import { dayTicks } from '../src/ui/dashboard-block';
import type { Novel } from '../src/types';

const nov: Novel = {
	id: 'n1', title: 'Storm', summary: '', genre: '', goal: 50000,
	startDate: '2026-11-01', endDate: '2026-11-30', folderPath: 'Storm', createdAt: '', updatedAt: '',
};

test('cumulative line ends at the live total and counts backwards', () => {
	const daily = new Map([
		['2026-11-01', 1000],
		['2026-11-02', 2000],
		['2026-11-03', -500],
	]);
	// 3,000 words existed before tracking; 2,500 typed since.
	const s = progressSeries(nov, '2026-11-03', 5500, daily);
	assert.equal(s.days.length, 30);
	assert.deepEqual(s.cumulative.slice(0, 4), [4000, 6000, 5500, null]);
	assert.deepEqual(s.daily.slice(0, 4), [1000, 2000, 0, null]);
	assert.equal(s.par[0], 1667);
	assert.equal(s.par[29], 50000);
});

test('before the start, nothing is plotted yet', () => {
	const s = progressSeries(nov, '2026-10-20', 800, new Map());
	assert.ok(s.cumulative.every((v) => v === null));
});

test('after the end, writing since the end is taken off the last day', () => {
	const daily = new Map([
		['2026-11-30', 2000],
		['2026-12-02', 700],
	]);
	const s = progressSeries(nov, '2026-12-05', 51000, daily);
	assert.equal(s.cumulative[29], 50300);
	assert.equal(s.cumulative[28], 48300);
});

test('peak hour and the summary line', () => {
	const hours = new Array<number>(24).fill(0);
	assert.equal(peakHour(hours), null);
	assert.match(whenIWriteSummary(hours), /busiest hours/);
	hours[21] = 900;
	hours[9] = 300;
	assert.equal(peakHour(hours), 21);
	assert.equal(whenIWriteSummary(hours), 'You write most between 9 pm and 10 pm. An evening writer.');
	assert.equal(hourLabel(0), 'midnight');
	assert.equal(hourLabel(12), 'noon');
	assert.equal(hourLabel(23 + 1), 'midnight');
});

test('progress log lists typed days and manual entries, newest first', () => {
	const rows = progressLog(
		new Map([
			['2026-11-18', 1200],
			['2026-11-19', 800],
			['2026-11-17', 0],
		]),
		[{ id: 'a', novelId: 'n1', date: '2026-11-19', words: 500, note: 'train', createdAt: '' }],
	);
	assert.deepEqual(
		rows.map((r) => [r.date, r.words, r.source]),
		[
			['2026-11-19', 800, 'typed'],
			['2026-11-19', 500, 'manual'],
			['2026-11-18', 1200, 'typed'],
		],
	);
	assert.equal(rows[1]?.adjustmentId, 'a');
});

test('nice axis maximums have four whole, distinct steps', () => {
	assert.equal(niceMax(0), 4);
	assert.equal(niceMax(3), 4);
	assert.equal(niceMax(9), 12);
	assert.equal(niceMax(1234), 1600);
	assert.equal(niceMax(50000), 50000);
	assert.equal(niceMax(51000), 60000);
	for (let v = 0; v < 5000; v += 7) {
		const m = niceMax(v);
		assert.ok(m >= v && Number.isInteger(m / 4), `niceMax(${v}) = ${m}`);
	}
});

test('day ticks name the month when it changes and never crowd the last label', () => {
	const days = (start: string, count: number) =>
		Array.from({ length: count }, (_, i) => new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10));
	const nov = dayTicks(days('2026-11-01', 30), 7);
	assert.equal(nov[0], 'Nov 1');
	assert.equal(nov[29], '30');
	const dec = dayTicks(days('2026-11-01', 31), 3);
	assert.equal(dec[30], 'Dec 1');
	assert.equal(dec[29], '', 'no label right next to the last one');
	const long = dayTicks(days('2026-01-01', 365), 7).filter(Boolean);
	assert.ok(long.every((t) => /^[A-Z][a-z]{2} \d+$/.test(t)), long.join('|'));
});

test('daily bars show words typed while the line uses the net change', () => {
	const net = new Map([['2026-11-01', -200]]);
	const typed = new Map([['2026-11-01', 100]]);
	const s = progressSeries(nov, '2026-11-01', 800, net, typed);
	assert.equal(s.cumulative[0], 800);
	assert.equal(s.daily[0], 100);
});
