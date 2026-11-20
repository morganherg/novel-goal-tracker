import { addDays, daysBetween, windowLength } from './dates';
import type { Adjustment } from './history';
import type { DateKey, Novel } from './types';

/*
 * Pure data for the dashboard's charts and tables.
 */

export interface ProgressSeries {
	/** Every day of the timeframe, first to last. */
	days: DateKey[];
	/** Words in the novel at the end of each day; null for days still ahead. */
	cumulative: (number | null)[];
	/** Where you'd be on each day writing an even share of the goal ("par"). */
	par: number[];
	/** Words typed each day (never below 0); null for days still ahead. */
	daily: (number | null)[];
}

/**
 * Build the timeframe's day-by-day series.
 *
 * The total at the end of a past day is today's total minus everything written
 * after that day, so the line always ends at the live total, and words that
 * were already in the novel before tracking began count from the start.
 */
export function progressSeries(
	novel: Novel,
	today: DateKey,
	current: number,
	daily: Map<DateKey, number>,
	/** Words typed each day, for the daily bars; defaults to the net figures. */
	typed: Map<DateKey, number> = daily,
): ProgressSeries {
	const total = windowLength(novel.startDate, novel.endDate);
	const days: DateKey[] = [];
	for (let i = 0; i < total; i++) days.push(addDays(novel.startDate, i));

	// Net words written after each day, from today backwards.
	const lastShown = daysBetween(novel.startDate, today); // index of today (may be <0 or >=total)
	const cumulative: (number | null)[] = new Array<number | null>(total).fill(null);
	const perDay: (number | null)[] = new Array<number | null>(total).fill(null);
	let after = 0;
	// Words written after the end of the window but up to today also come off.
	if (lastShown >= total) {
		for (let d = addDays(novel.endDate, 1); daysBetween(d, today) >= 0; d = addDays(d, 1)) {
			after += daily.get(d) ?? 0;
		}
	}
	for (let i = Math.min(lastShown, total - 1); i >= 0; i--) {
		const day = days[i] ?? novel.startDate;
		cumulative[i] = Math.max(0, current - after);
		perDay[i] = Math.max(0, typed.get(day) ?? 0);
		after += daily.get(day) ?? 0;
	}

	const par = days.map((_, i) => (i === total - 1 ? novel.goal : Math.round(((i + 1) * novel.goal) / total)));
	return { days, cumulative, par, daily: perDay };
}

/** The hour of day with the most writing, or null if nothing is recorded. */
export function peakHour(hours: number[]): number | null {
	let best = -1;
	let bestWords = 0;
	hours.forEach((n, h) => {
		if (n > bestWords) {
			bestWords = n;
			best = h;
		}
	});
	return best >= 0 ? best : null;
}

/** "9 am", "12 pm", "midnight" style label for an hour (0-24). */
export function hourLabel(h: number): string {
	const hh = ((h % 24) + 24) % 24;
	if (hh === 0) return 'midnight';
	if (hh === 12) return 'noon';
	return hh < 12 ? `${hh} am` : `${hh - 12} pm`;
}

/** A short line about when the writer writes most, NaNoWriMo-style but in our own words. */
export function whenIWriteSummary(hours: number[]): string {
	const h = peakHour(hours);
	if (h === null) return 'Write a little and your busiest hours will show up here.';
	let mood: string;
	if (h >= 5 && h < 12) mood = 'A morning writer.';
	else if (h >= 12 && h < 17) mood = 'An afternoon writer.';
	else if (h >= 17 && h < 22) mood = 'An evening writer.';
	else mood = 'A late-night writer.';
	return `You write most between ${hourLabel(h)} and ${hourLabel(h + 1)}. ${mood}`;
}

export interface LogRow {
	date: DateKey;
	words: number;
	source: 'typed' | 'manual';
	/** Manual rows only: the adjustment to delete. */
	adjustmentId?: string;
	note?: string;
}

/**
 * The progress log: one "typed" row per day with typing, plus one row per
 * manual adjustment, newest first.
 */
export function progressLog(typedByDay: Map<DateKey, number>, adjustments: Adjustment[]): LogRow[] {
	const rows: LogRow[] = [];
	for (const [date, words] of typedByDay) if (words !== 0) rows.push({ date, words, source: 'typed' });
	for (const a of adjustments) {
		rows.push({ date: a.date, words: a.words, source: 'manual', adjustmentId: a.id, note: a.note });
	}
	return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.source === 'typed' ? -1 : 1));
}

/**
 * A rounded maximum for a chart axis with four gridline steps, each a whole,
 * "nice" number (so labels never repeat): 1,234 -> 1,600; 50,000 -> 50,000.
 */
export function niceMax(value: number): number {
	const quarter = Math.max(1, value / 4);
	const exp = Math.pow(10, Math.floor(Math.log10(quarter)));
	for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) {
		const step = m * exp;
		if (Number.isInteger(step) && step >= quarter) return step * 4;
	}
	return 40 * exp;
}
