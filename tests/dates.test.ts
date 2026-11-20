import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	addDays,
	dailyTarget,
	daysBetween,
	daysRemaining,
	formatKey,
	fromTodayWindow,
	isDateKey,
	novemberWindow,
	windowLength,
	windowPhase,
	writingDayKey,
} from '../src/dates';

test('window length is inclusive', () => {
	assert.equal(windowLength('2026-11-01', '2026-11-30'), 30);
	assert.equal(windowLength('2026-11-05', '2026-11-05'), 1);
	assert.equal(windowLength('2026-12-20', '2027-01-10'), 22);
});

test('daylight saving does not shift days', () => {
	// US DST ends Nov 1 2026; EU on Oct 25 2026; US starts Mar 8 2026.
	assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
	assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
	assert.equal(addDays('2026-10-24', 2), '2026-10-26');
});

test('addDays crosses months, years, and leap days', () => {
	assert.equal(addDays('2026-11-30', 1), '2026-12-01');
	assert.equal(addDays('2026-12-31', 1), '2027-01-01');
	assert.equal(addDays('2028-02-28', 1), '2028-02-29');
	assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('This November picks the right year', () => {
	assert.deepEqual(novemberWindow('2026-06-15'), { start: '2026-11-01', end: '2026-11-30' });
	assert.deepEqual(novemberWindow('2026-11-19'), { start: '2026-11-01', end: '2026-11-30' });
	assert.deepEqual(novemberWindow('2026-12-02'), { start: '2027-11-01', end: '2027-11-30' });
});

test('Starting today for N days', () => {
	assert.deepEqual(fromTodayWindow('2026-11-19', 30), { start: '2026-11-19', end: '2026-12-18' });
	assert.deepEqual(fromTodayWindow('2026-11-19', 1), { start: '2026-11-19', end: '2026-11-19' });
	assert.deepEqual(fromTodayWindow('2026-11-19', 0), { start: '2026-11-19', end: '2026-11-19' });
});

test('window phase and days remaining count today', () => {
	const s = '2026-11-01', e = '2026-11-30';
	assert.equal(windowPhase('2026-10-31', s, e), 'before');
	assert.equal(windowPhase('2026-11-01', s, e), 'during');
	assert.equal(windowPhase('2026-11-30', s, e), 'during');
	assert.equal(windowPhase('2026-12-01', s, e), 'after');
	assert.equal(daysRemaining('2026-11-19', s, e), 12);
	assert.equal(daysRemaining('2026-11-30', s, e), 1);
	assert.equal(daysRemaining('2026-12-01', s, e), 0);
	assert.equal(daysRemaining('2026-10-01', s, e), 30);
});

test('daily target matches the classic 1,667', () => {
	assert.equal(dailyTarget(50000, '2026-11-01', '2026-11-30'), 1667);
	assert.equal(dailyTarget(100, '2026-11-01', '2026-11-01'), 100);
});

test('writing day honors the day-start hour', () => {
	const lateNight = new Date(2026, 10, 5, 2, 30); // Nov 5, 2:30 am local
	assert.equal(writingDayKey(lateNight, 0), '2026-11-05');
	assert.equal(writingDayKey(lateNight, 4), '2026-11-04');
	const newYear = new Date(2027, 0, 1, 1, 0);
	assert.equal(writingDayKey(newYear, 4), '2026-12-31');
	assert.equal(writingDayKey(new Date(2026, 10, 5, 4, 0), 4), '2026-11-05');
});

test('date key validation', () => {
	assert.ok(isDateKey('2026-11-01'));
	assert.ok(isDateKey('2028-02-29'));
	assert.ok(!isDateKey('2026-02-29'));
	assert.ok(!isDateKey('2026-13-01'));
	assert.ok(!isDateKey('11/01/2026'));
	assert.ok(!isDateKey(''));
});

test('formatKey', () => {
	assert.equal(formatKey('2026-11-01'), 'Nov 1, 2026');
	assert.equal(formatKey('2027-01-31'), 'Jan 31, 2027');
});
