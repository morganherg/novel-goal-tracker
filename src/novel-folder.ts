import { App, normalizePath, TFile } from 'obsidian';
import { CHAPTERS_FOLDER, DASHBOARD_BLOCK, DASHBOARD_FILE, type Novel } from './types';

/** Characters Obsidian or common file systems reject in names. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/** Turn a novel title into a safe folder name. Returns '' if nothing usable is left. */
export function folderNameFromTitle(title: string): string {
	// Strip runs of dots and spaces at both ends (no hidden ".folders", no "."),
	// cut to 120 characters without splitting emoji, then strip the end again so
	// the name never ends in a space or dot (Windows rejects those).
	const cleaned = title
		.replace(ILLEGAL, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s.]+|[\s.]+$/g, '');
	return Array.from(cleaned).slice(0, 120).join('').replace(/[\s.]+$/, '');
}

/** Vault path for a new novel folder, optionally inside a parent folder. */
export function novelFolderPath(title: string, parent = ''): string {
	const name = folderNameFromTitle(title);
	const base = parent.trim().replace(/^\/+|\/+$/g, '');
	return normalizePath(base ? `${base}/${name}` : name);
}

export function dashboardMarkdown(novel: Novel): string {
	// The comment line keeps the cursor out of the block when the note opens in
	// editing mode; Obsidian shows a code block's source while the cursor is in it.
	return [
		'%% Novel Goal Tracker dashboard. Write your chapters in the Chapters folder. %%',
		'',
		'```' + DASHBOARD_BLOCK,
		`novel: ${novel.id}`,
		'```',
		'',
	].join('\n');
}

export function dashboardPath(novel: Novel): string {
	return normalizePath(`${novel.folderPath}/${DASHBOARD_FILE}`);
}

export function chaptersPath(novel: Novel): string {
	return normalizePath(`${novel.folderPath}/${CHAPTERS_FOLDER}`);
}

/**
 * Create <Title>/Dashboard.md and <Title>/Chapters/Chapter 1.md.
 * Fails if the folder already exists, so we never touch a writer's files.
 */
export async function createNovelFolder(app: App, novel: Novel): Promise<TFile> {
	const vault = app.vault;
	if (vault.getAbstractFileByPath(novel.folderPath)) {
		throw new Error(`A file or folder named "${novel.folderPath}" already exists.`);
	}
	await vault.createFolder(novel.folderPath);
	const chapters = chaptersPath(novel);
	await vault.createFolder(chapters);
	await vault.create(normalizePath(`${chapters}/Chapter 1.md`), '');
	return vault.create(dashboardPath(novel), dashboardMarkdown(novel));
}

/**
 * For a folder that already exists: create Chapters/ and Dashboard.md only if
 * they're missing. Existing notes are never changed.
 */
export async function ensureNovelFiles(app: App, novel: Novel): Promise<void> {
	const vault = app.vault;
	if (!vault.getFolderByPath(novel.folderPath)) await vault.createFolder(novel.folderPath);
	const chapters = chaptersPath(novel);
	if (!vault.getFolderByPath(chapters)) await vault.createFolder(chapters);
	if (!vault.getFileByPath(dashboardPath(novel))) await vault.create(dashboardPath(novel), dashboardMarkdown(novel));
}

/** Read the `novel: <id>` line from a dashboard code block. */
export function parseDashboardSource(source: string): { novelId: string | null } {
	for (const line of source.split('\n')) {
		const m = /^\s*novel\s*:\s*(\S+)\s*$/.exec(line);
		if (m && m[1]) return { novelId: m[1] };
	}
	return { novelId: null };
}

/** "Chapter N" with the lowest N not already taken (case-insensitive). */
export function nextChapterName(existing: string[]): string {
	const taken = new Set(existing.map((n) => n.toLowerCase()));
	let n = existing.length + 1;
	while (taken.has(`chapter ${n}`)) n++;
	return `Chapter ${n}`;
}

export function newNovelId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
