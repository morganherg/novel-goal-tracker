import { isDateKey } from './dates';
import type { Adjustment, DayRecord, DeviceHistory, History } from './history';
import { DEFAULT_DATA, SCHEMA_VERSION, type Novel, type PluginData } from './types';

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function normalizeNovel(raw: unknown): Novel | null {
	if (!isRecord(raw)) return null;
	const id = str(raw.id);
	const folderPath = str(raw.folderPath);
	const startDate = str(raw.startDate);
	const endDate = str(raw.endDate);
	const goal = typeof raw.goal === 'number' && Number.isFinite(raw.goal) && raw.goal > 0 ? Math.floor(raw.goal) : 0;
	if (!id || !folderPath || !isDateKey(startDate) || !isDateKey(endDate) || goal < 1) return null;
	return {
		id,
		title: str(raw.title, folderPath),
		summary: str(raw.summary),
		genre: str(raw.genre),
		goal,
		startDate,
		endDate,
		folderPath,
		createdAt: str(raw.createdAt),
		updatedAt: str(raw.updatedAt, str(raw.createdAt)),
	};
}

/**
 * Turn whatever loadData() returned (possibly null, old, or hand-edited) into
 * valid PluginData. Invalid novels are dropped rather than crashing the plugin.
 */
export function normalizeData(raw: unknown): PluginData {
	if (!isRecord(raw)) return JSON.parse(JSON.stringify(DEFAULT_DATA)) as PluginData;
	const hour = raw.dayStartHour;
	const novels = Array.isArray(raw.novels)
		? raw.novels.map(normalizeNovel).filter((n): n is Novel => n !== null)
		: [];
	return {
		schemaVersion: SCHEMA_VERSION,
		hasOnboarded: raw.hasOnboarded === true,
		dayStartHour:
			typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
		novelsFolder: str(raw.novelsFolder),
		countOptions: {
			code: isRecord(raw.countOptions) && raw.countOptions.code === true,
			comments: isRecord(raw.countOptions) && raw.countOptions.comments === true,
		},
		settingsUpdatedAt: str(raw.settingsUpdatedAt),
		novels,
		removedNovels: normalizeRemoved(raw),
		history: normalizeHistory(raw.history),
	};
}

/** Removal times by novel id; older data kept a plain list of ids (time unknown). */
function normalizeRemoved(raw: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const id of strArray(raw.removedNovelIds)) out[id] = '';
	if (isRecord(raw.removedNovels)) {
		for (const [id, at] of Object.entries(raw.removedNovels)) if (id) out[id] = str(at);
	}
	return out;
}

function strArray(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function finiteInt(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function normalizeDay(raw: unknown): DayRecord | null {
	if (!isRecord(raw)) return null;
	const net = finiteInt(raw.net);
	if (net === null) return null;
	// Records from before "added" existed: count positive net as typed.
	const added = Math.max(0, finiteInt(raw.added) ?? net);
	const hours: Record<string, number> = {};
	if (isRecord(raw.hours)) {
		for (const [h, n] of Object.entries(raw.hours)) {
			const v = finiteInt(n);
			const i = Number(h);
			if (v !== null && v !== 0 && Number.isInteger(i) && i >= 0 && i < 24) hours[String(i)] = v;
		}
	}
	return { net, added, hours };
}

function normalizeAdjustment(raw: unknown): Adjustment | null {
	if (!isRecord(raw)) return null;
	const words = finiteInt(raw.words);
	const id = str(raw.id);
	const novelId = str(raw.novelId);
	const date = str(raw.date);
	if (!id || !novelId || !isDateKey(date) || words === null) return null;
	return { id, novelId, date, words, note: str(raw.note), createdAt: str(raw.createdAt) };
}

function normalizeDevice(raw: unknown): DeviceHistory | null {
	if (!isRecord(raw)) return null;
	const days: DeviceHistory['days'] = {};
	if (isRecord(raw.days)) {
		for (const [novelId, byDay] of Object.entries(raw.days)) {
			if (!isRecord(byDay)) continue;
			const out: Record<string, DayRecord> = {};
			for (const [day, rec] of Object.entries(byDay)) {
				const r = isDateKey(day) ? normalizeDay(rec) : null;
				if (r) out[day] = r;
			}
			days[novelId] = out;
		}
	}
	const adjustments = Array.isArray(raw.adjustments)
		? raw.adjustments.map(normalizeAdjustment).filter((a): a is Adjustment => a !== null)
		: [];
	return {
		updatedAt: str(raw.updatedAt),
		days,
		adjustments,
		deletedAdjustments: strArray(raw.deletedAdjustments),
	};
}

function normalizeHistory(raw: unknown): History {
	const out: History = {};
	if (!isRecord(raw)) return out;
	for (const [deviceId, dev] of Object.entries(raw)) {
		const d = normalizeDevice(dev);
		if (deviceId && d) out[deviceId] = d;
	}
	return out;
}

/**
 * Combine this device's in-memory data with what is on disk right now, so a
 * save never erases another device's synced changes.
 * - History: this device's entry comes from memory; every other device's from disk.
 * - Novels: the most recently changed copy of each novel wins; novels created
 *   elsewhere are added; novels removed on either side stay removed.
 * - Settings (day start, novels folder, counting rules): the most recently changed side wins.
 */
export function mergeForSave(
	memory: PluginData,
	disk: PluginData,
	deviceId: string,
	/** Memory holds only defaults (a new install that hasn't loaded real data yet). */
	memoryIsFresh = false,
): PluginData {
	const history: History = {};
	for (const [id, dev] of Object.entries(disk.history)) if (id !== deviceId) history[id] = dev;
	for (const [id, dev] of Object.entries(memory.history)) {
		if (id === deviceId || !(id in history)) history[id] = dev;
	}
	// Removals: keep the latest time for each id.
	const removed: Record<string, string> = { ...disk.removedNovels };
	for (const [id, at] of Object.entries(memory.removedNovels)) {
		if (!(id in removed) || at > (removed[id] ?? '')) removed[id] = at;
	}
	// A novel stays removed unless it was changed (e.g. re-attached) after removal.
	const isRemoved = (n: Novel): boolean => n.id in removed && !(n.updatedAt > (removed[n.id] ?? ''));
	const known = new Set(memory.novels.map((n) => n.id));
	const onDisk = new Map(disk.novels.map((n) => [n.id, n]));
	const newest = (n: Novel): Novel => {
		const d = onDisk.get(n.id);
		return d && d.updatedAt > n.updatedAt ? { ...d } : n;
	};
	const novels = [...memory.novels.map(newest), ...disk.novels.filter((n) => !known.has(n.id))].filter(
		(n) => !isRemoved(n),
	);
	// Newest settings win. With equal stamps (e.g. both from before stamps
	// existed), real settings beat a new install's defaults.
	const settings =
		disk.settingsUpdatedAt > memory.settingsUpdatedAt ||
		(disk.settingsUpdatedAt === memory.settingsUpdatedAt && memoryIsFresh)
			? disk
			: memory;
	return {
		...memory,
		dayStartHour: settings.dayStartHour,
		novelsFolder: settings.novelsFolder,
		countOptions: { ...settings.countOptions },
		settingsUpdatedAt: settings.settingsUpdatedAt,
		hasOnboarded: memory.hasOnboarded || disk.hasOnboarded,
		novels,
		removedNovels: removed,
		history,
	};
}

/**
 * A change stamp that is never earlier than the one it replaces, so a local
 * change wins on sync even if another device's clock runs ahead.
 */
export function laterStamp(nowIso: string, previousIso: string): string {
	const now = Date.parse(nowIso);
	const prev = Date.parse(previousIso);
	if (!Number.isFinite(prev) || now > prev) return nowIso;
	return new Date(prev + 1).toISOString();
}

/** Update novel folder paths after a folder or one of its parents is renamed. */
export function applyFolderRename(novels: Novel[], oldPath: string, newPath: string, nowIso = ''): boolean {
	let changed = false;
	for (const n of novels) {
		let next: string | null = null;
		if (n.folderPath === oldPath) next = newPath;
		else if (n.folderPath.startsWith(oldPath + '/')) next = newPath + n.folderPath.slice(oldPath.length);
		if (next !== null) {
			n.folderPath = next;
			if (nowIso) n.updatedAt = laterStamp(nowIso, n.updatedAt);
			changed = true;
		}
	}
	return changed;
}
