import { addDays, daysBetween, daysRemaining, windowLength, windowPhase } from './dates';
import type { DateKey, Novel } from './types';

/*
 * Writing history, kept per device so synced devices never overwrite or
 * double-count each other. Each device only ever writes its own entry; the
 * other entries are taken from disk when saving (see mergeForSave in data.ts).
 */

export interface DayRecord {
	/** Net change on this day: additions minus deletions. May be negative. Keeps totals exact. */
	net: number;
	/** Words typed on this day (additions only; deleting never lowers it). */
	added: number;
	/** Words typed by local hour of the day ("0"-"23"), for the "When I write" chart. */
	hours: Record<string, number>;
}

export interface Adjustment {
	id: string;
	novelId: string;
	date: DateKey;
	/** Words to add (or remove, if negative) for that day. */
	words: number;
	note: string;
	createdAt: string;
}

export interface DeviceHistory {
	updatedAt: string;
	/** novelId -> day -> record */
	days: Record<string, Record<DateKey, DayRecord>>;
	adjustments: Adjustment[];
	/** Adjustment ids deleted on this device (from any device). */
	deletedAdjustments: string[];
}

export type History = Record<string, DeviceHistory>;

export function emptyDevice(): DeviceHistory {
	return { updatedAt: '', days: {}, adjustments: [], deletedAdjustments: [] };
}

/** Add a typing delta to one device's history. */
export function recordDelta(
	dev: DeviceHistory,
	novelId: string,
	day: DateKey,
	hour: number,
	delta: number,
	nowIso: string,
): void {
	if (!delta) return;
	const novelDays = (dev.days[novelId] ??= {});
	const rec = (novelDays[day] ??= { net: 0, added: 0, hours: {} });
	rec.net += delta;
	if (delta > 0) {
		rec.added += delta;
		const h = String(hour);
		rec.hours[h] = (rec.hours[h] ?? 0) + delta;
	}
	dev.updatedAt = nowIso;
}

function deletedIds(history: History): Set<string> {
	const ids = new Set<string>();
	for (const dev of Object.values(history)) for (const id of dev.deletedAdjustments) ids.add(id);
	return ids;
}

/** All live manual adjustments for a novel, across devices. */
export function adjustmentsFor(history: History, novelId: string): Adjustment[] {
	const deleted = deletedIds(history);
	const out: Adjustment[] = [];
	for (const dev of Object.values(history)) {
		for (const a of dev.adjustments) if (a.novelId === novelId && !deleted.has(a.id)) out.push(a);
	}
	return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Words per day for a novel, summed across devices, including manual adjustments.
 * - 'typed': words typed each day (additions only). This is "words today".
 * - 'net': additions minus deletions, which keeps day-by-day totals exact.
 */
export function dailyTotals(
	history: History,
	novelId: string,
	kind: 'typed' | 'net' = 'typed',
): Map<DateKey, number> {
	const totals = new Map<DateKey, number>();
	for (const dev of Object.values(history)) {
		for (const [day, rec] of Object.entries(dev.days[novelId] ?? {})) {
			totals.set(day, (totals.get(day) ?? 0) + (kind === 'typed' ? rec.added : rec.net));
		}
	}
	for (const a of adjustmentsFor(history, novelId)) {
		totals.set(a.date, (totals.get(a.date) ?? 0) + a.words);
	}
	return totals;
}

/** Words typed by local hour (index 0-23), across all days and devices. */
export function hourTotals(history: History, novelId: string): number[] {
	const hours = new Array<number>(24).fill(0);
	for (const dev of Object.values(history)) {
		for (const rec of Object.values(dev.days[novelId] ?? {})) {
			for (const [h, n] of Object.entries(rec.hours)) {
				const i = Number(h);
				if (i >= 0 && i < 24) hours[i] = (hours[i] ?? 0) + n;
			}
		}
	}
	return hours;
}

/** Sum of all manual adjustments for a novel. They count toward the total. */
export function adjustmentTotal(history: History, novelId: string): number {
	return adjustmentsFor(history, novelId).reduce((s, a) => s + a.words, 0);
}

export interface NovelStats {
	/** Words in the novel: chapter files plus manual adjustments. */
	current: number;
	goal: number;
	percent: number;
	remaining: number;
	/** Words typed today, never below 0. */
	today: number;
	/** Words still needed today to stay on pace (0 if today's share is done). */
	neededToday: number;
	/** Today's share of the remaining goal, including what's already written today. */
	todayTarget: number;
	daysLeft: number;
	totalDays: number;
	phase: 'before' | 'during' | 'after';
	/** Consecutive days with words, ending today or yesterday. */
	streak: number;
	/** Average words per day since the start (null before the start). */
	dailyAverage: number | null;
	/** Projected finish day at the current average (null if it can't be estimated). */
	projectedFinish: DateKey | null;
	goalMet: boolean;
}

export function computeStats(
	novel: Novel,
	today: DateKey,
	current: number,
	daily: Map<DateKey, number>,
	/** Net change per day; used to find what was left at the start of today. Defaults to `daily`. */
	net: Map<DateKey, number> = daily,
): NovelStats {
	const { goal, startDate: start, endDate: end } = novel;
	const phase = windowPhase(today, start, end);
	const totalDays = windowLength(start, end);
	const daysLeft = daysRemaining(today, start, end);
	const todayWords = Math.max(0, daily.get(today) ?? 0);
	const remaining = Math.max(0, goal - current);
	const goalMet = current >= goal;

	// NaNoWriMo's "words needed today": spread what was left at the start of
	// today evenly over the days left. The start-of-day total uses today's net
	// change, so deleting text while revising doesn't move today's target.
	const leftAtStartOfDay = Math.max(0, goal - (current - (net.get(today) ?? 0)));
	const todayTarget =
		phase === 'during' && !goalMet ? Math.ceil(leftAtStartOfDay / Math.max(1, daysLeft)) : 0;
	const neededToday = Math.max(0, todayTarget - todayWords);

	let streak = 0;
	let day = (daily.get(today) ?? 0) > 0 ? today : addDays(today, -1);
	while ((daily.get(day) ?? 0) > 0) {
		streak++;
		day = addDays(day, -1);
	}

	let dailyAverage: number | null = null;
	let projectedFinish: DateKey | null = null;
	if (phase !== 'before') {
		const elapsed = Math.min(totalDays, daysBetween(start, today) + 1);
		const average = current / Math.max(1, elapsed);
		dailyAverage = Math.round(average);
		// Project from the exact average, so a tiny one still gives a (far) date.
		if (goalMet) projectedFinish = null;
		else if (average > 0) projectedFinish = addDays(today, Math.min(36500, Math.ceil(remaining / average)));
	}

	return {
		current,
		goal,
		percent: goal > 0 ? Math.min(100, Math.floor((current / goal) * 100)) : 0,
		remaining,
		today: todayWords,
		neededToday,
		todayTarget,
		daysLeft,
		totalDays,
		phase,
		streak,
		dailyAverage,
		projectedFinish,
		goalMet,
	};
}
