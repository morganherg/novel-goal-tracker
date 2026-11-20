import type { History } from './history';

/** A date on the writer's local calendar, formatted as YYYY-MM-DD. */
export type DateKey = string;

export interface Novel {
	id: string;
	title: string;
	summary: string;
	genre: string;
	/** Word count goal for the timeframe. */
	goal: number;
	/** First writing day, inclusive. */
	startDate: DateKey;
	/** Last writing day, inclusive. */
	endDate: DateKey;
	/** Vault path of the novel's folder (holds Dashboard.md and Chapters/). */
	folderPath: string;
	/** ISO timestamp of when the novel was created. */
	createdAt: string;
	/** ISO timestamp of the last change to these details; the newest copy wins on sync. */
	updatedAt: string;
}

export interface CountOptions {
	/** Count words inside code blocks and inline code. */
	code: boolean;
	/** Count words inside %% comments %% and HTML comments. */
	comments: boolean;
}

export interface PluginData {
	schemaVersion: number;
	/** True once the first-run setup wizard has been shown. */
	hasOnboarded: boolean;
	/** Hour (0-23) at which a new writing day begins. 0 = midnight. */
	dayStartHour: number;
	/** Parent folder for new novels. '' = vault root. */
	novelsFolder: string;
	countOptions: CountOptions;
	/** When the settings above last changed on any device (ISO time); newest wins on sync. */
	settingsUpdatedAt: string;
	novels: Novel[];
	/**
	 * Novels this vault stopped tracking (id -> when), so a synced copy doesn't
	 * bring them back. A novel re-attached later (newer updatedAt) is kept.
	 */
	removedNovels: Record<string, string>;
	/** Writing history, keyed by device id. */
	history: History;
}

export const SCHEMA_VERSION = 1;

export const DEFAULT_DATA: PluginData = {
	schemaVersion: SCHEMA_VERSION,
	hasOnboarded: false,
	dayStartHour: 0,
	novelsFolder: '',
	countOptions: { code: false, comments: false },
	settingsUpdatedAt: '',
	novels: [],
	removedNovels: {},
	history: {},
};

export const DEFAULT_GOAL = 50000;
export const DASHBOARD_FILE = 'Dashboard.md';
export const CHAPTERS_FOLDER = 'Chapters';
export const DASHBOARD_BLOCK = 'novel-dashboard';

export const GENRES = [
	'',
	'Fantasy',
	'Science fiction',
	'Romance',
	'Mystery',
	'Thriller',
	'Horror',
	'Literary',
	'Historical',
	'Young adult',
	'Middle grade',
	'Memoir',
	'Nonfiction',
	'Other',
];
