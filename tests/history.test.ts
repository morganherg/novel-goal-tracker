import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	adjustmentTotal,
	computeStats,
	dailyTotals,
	emptyDevice,
	hourTotals,
	recordDelta,
	type History,
} from '../src/history';
import type { Novel } from '../src/types';

const nov: Novel = {
	id: 'n1',
	title: 'Storm',
	summary: '',
	genre: '',
	goal: 50000,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	folderPath: 'Storm',
	createdAt: '',
	updatedAt: '',
};

test('recordDelta keeps net change and words typed per day and hour', () => {
	const dev = emptyDevice();
	recordDelta(dev, 'n1', '2026-11-19', 9, 120, 't');
	recordDelta(dev, 'n1', '2026-11-19', 9, -20, 't');
	recordDelta(dev, 'n1', '2026-11-19', 22, 50, 't');
	recordDelta(dev, 'n1', '2026-11-19', 22, -50, 't');
	recordDelta(dev, 'n1', '2026-11-19', 3, 0, 't');
	assert.deepEqual(dev.days.n1?.['2026-11-19'], { net: 100, added: 170, hours: { '9': 120, '22': 50 } });
});

test('daily totals sum devices and live adjustments', () => {
	const a = emptyDevice();
	const b = emptyDevice();
	recordDelta(a, 'n1', '2026-11-19', 9, 300, 't');
	recordDelta(b, 'n1', '2026-11-19', 21, 200, 't');
	recordDelta(b, 'other', '2026-11-19', 21, 999, 't');
	a.adjustments.push({ id: 'x', novelId: 'n1', date: '2026-11-18', words: 1000, note: '', createdAt: '' });
	a.adjustments.push({ id: 'y', novelId: 'n1', date: '2026-11-18', words: 50, note: '', createdAt: '' });
	b.deletedAdjustments.push('y');
	const history: History = { a, b };
	const daily = dailyTotals(history, 'n1');
	assert.equal(daily.get('2026-11-19'), 500);
	assert.equal(daily.get('2026-11-18'), 1000);
	assert.equal(adjustmentTotal(history, 'n1'), 1000);
	const hours = hourTotals(history, 'n1');
	assert.equal(hours[9], 300);
	assert.equal(hours[21], 200);
});

test('stats mid-November match the NaNoWriMo formulas', () => {
	// Nov 19: 12 days left including today. 20,000 words so far, 800 of them today.
	const daily = new Map([
		['2026-11-17', 1500],
		['2026-11-18', 2000],
		['2026-11-19', 800],
	]);
	const s = computeStats(nov, '2026-11-19', 20000, daily);
	assert.equal(s.phase, 'during');
	assert.equal(s.daysLeft, 12);
	assert.equal(s.remaining, 30000);
	assert.equal(s.percent, 40);
	assert.equal(s.today, 800);
	assert.equal(s.todayTarget, Math.ceil(30800 / 12)); // 2,567
	assert.equal(s.neededToday, 2567 - 800);
	assert.equal(s.streak, 3);
	assert.equal(s.dailyAverage, Math.round(20000 / 19));
	assert.equal(s.projectedFinish, '2026-12-18'); // 30000 / 1053 = 28.5 -> 29 days
});

test('streak counts from yesterday when today is empty, and breaks on gaps', () => {
	const daily = new Map([
		['2026-11-15', 100],
		['2026-11-17', 100],
		['2026-11-18', 100],
	]);
	assert.equal(computeStats(nov, '2026-11-19', 300, daily).streak, 2);
	assert.equal(computeStats(nov, '2026-11-20', 300, daily).streak, 0);
	daily.set('2026-11-18', -40);
	assert.equal(computeStats(nov, '2026-11-19', 300, daily).streak, 0);
});

test('today never shows negative words', () => {
	const s = computeStats(nov, '2026-11-19', 1000, new Map([['2026-11-19', -250]]));
	assert.equal(s.today, 0);
});

test('before the start and after the end', () => {
	const before = computeStats(nov, '2026-10-20', 0, new Map());
	assert.equal(before.phase, 'before');
	assert.equal(before.dailyAverage, null);
	assert.equal(before.todayTarget, 0);
	assert.equal(before.daysLeft, 30);

	const after = computeStats(nov, '2026-12-05', 51000, new Map());
	assert.equal(after.phase, 'after');
	assert.equal(after.goalMet, true);
	assert.equal(after.dailyAverage, 1700); // 51,000 over the 30 days
	assert.equal(after.projectedFinish, null);
	assert.equal(after.percent, 100);
});

test('no words yet gives no projected finish', () => {
	const s = computeStats(nov, '2026-11-03', 0, new Map());
	assert.equal(s.dailyAverage, 0);
	assert.equal(s.projectedFinish, null);
	assert.equal(s.todayTarget, Math.ceil(50000 / 28));
});

test('a tiny average still projects a finish date', () => {
	const s = computeStats(nov, '2026-11-20', 9, new Map());
	assert.equal(s.dailyAverage, 0);
	assert.ok(s.projectedFinish !== null && s.projectedFinish > '2100-01-01');
});

test('deleting text never lowers words typed today, but the net still tracks the total', () => {
	const dev = emptyDevice();
	recordDelta(dev, 'n1', '2026-11-20', 15, -312, 't'); // trimmed old text
	recordDelta(dev, 'n1', '2026-11-20', 15, 13, 't'); // then typed 13 words
	const history: History = { me: dev };
	assert.equal(dailyTotals(history, 'n1').get('2026-11-20'), 13);
	assert.equal(dailyTotals(history, 'n1', 'net').get('2026-11-20'), -299);
	const s = computeStats(nov, '2026-11-20', 13, dailyTotals(history, 'n1'));
	assert.equal(s.today, 13);
	assert.equal(s.streak, 1);
});

test("today's target doesn't move when you delete while revising", () => {
	// 10,000 words at the start of Nov 20, 11 days left: target ceil(40,000 / 11) = 3,637.
	const typed = new Map([['2026-11-20', 3000]]);
	const net = new Map([['2026-11-20', 0]]); // typed 3,000 and deleted 3,000
	const s = computeStats(nov, '2026-11-20', 10000, typed, net);
	assert.equal(s.todayTarget, 3637);
	assert.equal(s.neededToday, 637);
	const plain = computeStats(nov, '2026-11-20', 13000, new Map([['2026-11-20', 3000]]));
	assert.equal(plain.todayTarget, 3637, 'typing without deleting gives the same target');
});
