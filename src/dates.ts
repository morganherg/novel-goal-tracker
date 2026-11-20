import type { DateKey } from './types';

/*
 * Pure date helpers. Calendar arithmetic is done on YYYY-MM-DD keys using UTC
 * internally, so daylight-saving changes never shift a day.
 */

const MS_PER_DAY = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function isDateKey(value: string): boolean {
	const m = KEY_RE.exec(value);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = new Date(Date.UTC(y, mo - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function keyToUtc(key: DateKey): number {
	const m = KEY_RE.exec(key);
	if (!m) throw new Error(`Invalid date key: ${key}`);
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcToKey(ms: number): DateKey {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The writing day a moment belongs to, on the device's local calendar.
 * With dayStartHour = 4, 2:30 am on Nov 5 still counts as Nov 4.
 */
export function writingDayKey(now: Date, dayStartHour = 0): DateKey {
	const calendar = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return now.getHours() < dayStartHour ? addDays(calendar, -1) : calendar;
}

export function addDays(key: DateKey, days: number): DateKey {
	return utcToKey(keyToUtc(key) + days * MS_PER_DAY);
}

/** Whole days from a to b (b - a). Same day = 0. */
export function daysBetween(a: DateKey, b: DateKey): number {
	return Math.round((keyToUtc(b) - keyToUtc(a)) / MS_PER_DAY);
}

/** Number of days in an inclusive window. Nov 1 to Nov 30 = 30. */
export function windowLength(start: DateKey, end: DateKey): number {
	return daysBetween(start, end) + 1;
}

/**
 * The "This November" timeframe: November of the current year, or next year
 * once November is over.
 */
export function novemberWindow(today: DateKey): { start: DateKey; end: DateKey } {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7));
	const y = month === 12 ? year + 1 : year;
	return { start: `${y}-11-01`, end: `${y}-11-30` };
}

/** A window that starts today and lasts `days` days, inclusive. */
export function fromTodayWindow(today: DateKey, days: number): { start: DateKey; end: DateKey } {
	return { start: today, end: addDays(today, Math.max(1, Math.floor(days)) - 1) };
}

export type WindowPhase = 'before' | 'during' | 'after';

export function windowPhase(today: DateKey, start: DateKey, end: DateKey): WindowPhase {
	if (daysBetween(start, today) < 0) return 'before';
	if (daysBetween(today, end) < 0) return 'after';
	return 'during';
}

/** Days left in the window, counting today. 0 once the window has ended. */
export function daysRemaining(today: DateKey, start: DateKey, end: DateKey): number {
	const phase = windowPhase(today, start, end);
	if (phase === 'after') return 0;
	if (phase === 'before') return windowLength(start, end);
	return daysBetween(today, end) + 1;
}

/** Words per day needed to hit the goal over the whole window. */
export function dailyTarget(goal: number, start: DateKey, end: DateKey): number {
	const len = windowLength(start, end);
	return len > 0 ? Math.ceil(goal / len) : goal;
}

/** "Nov 1, 2026" */
export function formatKey(key: DateKey): string {
	const m = KEY_RE.exec(key);
	if (!m) return key;
	return `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}, ${m[1]}`;
}
