import { debounce, MarkdownView, TFile, type App, type Debouncer } from 'obsidian';
import { countWords, type CountRules } from './count';
import { chaptersPath } from './novel-folder';
import type { Novel } from './types';

export interface TrackerHost {
	novels(): Novel[];
	countRules(): CountRules;
	chapterFiles(novel: Novel): TFile[];
	/** Words typed (or deleted, if negative) on this device in a novel's chapter. */
	onTyped(novel: Novel, delta: number): void;
	/** Any chapter's word count changed. */
	onCountsChanged(): void;
}

/** Anything with a CodeMirror-style document; in Obsidian this is an EditorView. */
export interface DocView {
	state: { doc: { toString(): string } };
}

interface Pending {
	path: string;
	run: Debouncer<[], void>;
	/** Text before the first waiting change, kept only when the file had no count yet. */
	base?: string;
}

/** How often typing is counted, at most. */
const TYPING_INTERVAL_MS = 500;
/** A paste, drop, or cut marks the next editor change on that file as the writer's own. */
const INSERT_WINDOW_MS = 1000;

/**
 * Keeps a live word count for every chapter file, and reports typing deltas.
 *
 * Only edits the editor tags as user input (typing, deleting, undo, paste,
 * drop) count toward today's words. Everything else, such as a reload after
 * sync, another plugin inserting text, or a file changed while closed,
 * updates the totals without counting as writing. So synced devices never
 * double-count.
 */
export class Tracker {
	private counts = new Map<string, number>();
	private pending = new Map<DocView, Pending>();
	private viewPath = new Map<DocView, string>();
	private insertAt = new Map<string, number>();
	/** Chapters whose count changed since the current scan started; the scan keeps those. */
	private touched = new Set<string>();
	private scanToken = 0;
	ready = false;

	constructor(
		private app: App,
		private host: TrackerHost,
	) {}

	novelForPath(path: string): Novel | undefined {
		if (!path.toLowerCase().endsWith('.md')) return undefined;
		return this.host.novels().find((n) => path.startsWith(chaptersPath(n) + '/'));
	}

	/**
	 * Count every chapter of every novel.
	 * @param fromEditors Count open chapters from their editors (a recount after a
	 *   settings change) rather than from disk (startup, when editors match disk).
	 */
	async scanAll(fromEditors = false): Promise<void> {
		const token = ++this.scanToken;
		this.ready = false;
		this.touched.clear();
		// A recount starts from nothing, so no old-rules count is ever compared
		// with a new-rules count.
		if (fromEditors) this.counts.clear();
		const fresh = new Map<string, number>();
		const rules = this.host.countRules();
		for (const novel of this.host.novels()) {
			for (const file of this.host.chapterFiles(novel)) {
				if (this.touched.has(file.path)) continue;
				const open = fromEditors ? this.openEditorText(file.path) : null;
				const text = open ?? (await this.app.vault.cachedRead(file));
				if (token !== this.scanToken) return; // a newer scan started
				fresh.set(file.path, countWords(text, rules));
			}
		}
		// Anything an editor or file event counted during the scan is newer than
		// what the scan read, so keep it.
		for (const [path, n] of fresh) if (!this.touched.has(path)) this.counts.set(path, n);
		for (const path of Array.from(this.counts.keys())) if (!this.novelForPath(path)) this.counts.delete(path);
		this.touched.clear();
		this.ready = true;
		this.host.onCountsChanged();
	}

	/** Recount everything, e.g. after counting rules or novels change. */
	async rescan(): Promise<void> {
		this.flush();
		await this.scanAll(true);
	}

	/** Count any typing that is waiting. */
	flush(): void {
		for (const p of Array.from(this.pending.values())) p.run.run();
	}

	stop(): void {
		this.flush();
		for (const p of this.pending.values()) p.run.cancel();
		this.pending.clear();
		this.viewPath.clear();
		this.scanToken++;
	}

	chapterWords(path: string): number | undefined {
		return this.counts.get(path);
	}

	novelWords(novel: Novel): number {
		const base = chaptersPath(novel) + '/';
		let total = 0;
		for (const [path, n] of this.counts) if (path.startsWith(base)) total += n;
		return total;
	}

	// ---- Editor ---------------------------------------------------------

	/** An editor now shows this file (or none). Cheap; called on every editor update. */
	trackView(view: DocView, path: string | null): void {
		const was = this.viewPath.get(view);
		if (was !== path) {
			// Switched files without a text change: count waiting typing for the old one.
			const p = this.pending.get(view);
			if (p && p.path === was) p.run.run();
		}
		if (path) {
			if (was !== path) this.viewPath.set(view, path);
		} else {
			this.viewPath.delete(view);
		}
	}

	/** An editor closed: count its waiting typing, then forget it. */
	onViewClosed(view: DocView): void {
		this.pending.get(view)?.run.run();
		this.pending.delete(view);
		this.viewPath.delete(view);
	}

	/** The writer pasted, dropped, or cut text in this file. */
	markUserInsert(path: string, now = Date.now()): void {
		this.insertAt.set(path, now);
	}

	/**
	 * Called for every document change in an editor.
	 * @param path The file the editor shows after the change (null if none).
	 * @param before The document just before the change.
	 * @param after The document after the change.
	 * @param userInput The change is tagged as the writer's own input.
	 */
	onEditorUpdate(
		view: DocView,
		path: string | null,
		before: { toString(): string },
		after: { toString(): string },
		userInput: boolean,
		now = Date.now(),
	): void {
		const tracked = path !== null && this.novelForPath(path) !== undefined;
		const typed = tracked && (userInput || now - (this.insertAt.get(path) ?? -Infinity) < INSERT_WINDOW_MS);

		const p = this.pending.get(view);
		if (p) {
			if (!typed) {
				// Something other than typing is about to change this editor (a reload,
				// another plugin, or switching to another file). Count the typing first,
				// using the text as it was just before this change.
				p.run.cancel();
				this.pending.delete(view);
				this.applyText(p.path, before.toString(), true, p.base);
			} else if (p.path !== path) {
				p.run.cancel();
				this.pending.delete(view);
			}
		}
		this.trackView(view, path);
		if (!tracked || path === null) return;

		if (typed) {
			this.schedule(view, path, before);
			return;
		}
		// Not typed here: bring other editors' waiting typing up to date, then
		// take the new text as the baseline without crediting it.
		for (const q of Array.from(this.pending.values())) if (q.path === path) q.run.run();
		this.applyText(path, after.toString(), false);
	}

	private schedule(view: DocView, path: string, before: { toString(): string }): void {
		let p = this.pending.get(view);
		if (!p) {
			const entry: Pending = {
				path,
				// No count yet (startup or a recount still running): remember the text
				// before this typing, so only the typing itself is credited.
				base: this.counts.has(path) ? undefined : before.toString(),
				run: debounce(
					() => {
						if (this.pending.get(view) !== entry) return;
						this.pending.delete(view);
						if (this.viewPath.get(view) !== entry.path) return;
						this.applyText(entry.path, view.state.doc.toString(), true, entry.base);
					},
					TYPING_INTERVAL_MS,
					false,
				),
			};
			p = entry;
			this.pending.set(view, p);
		}
		p.run();
	}

	/**
	 * Set a chapter's count from its text, crediting the change as typing if asked.
	 * @param before Text the typing started from, used when the chapter has no count yet.
	 */
	private applyText(path: string, text: string, credit: boolean, before?: string): void {
		const novel = this.novelForPath(path);
		if (!novel) return;
		const rules = this.host.countRules();
		const n = countWords(text, rules);
		// The text the typing started from is the exact baseline when we have it.
		const prev = before !== undefined ? countWords(before, rules) : this.counts.get(path);
		this.counts.set(path, n);
		this.touched.add(path);
		if (credit && prev !== undefined && n !== prev) this.host.onTyped(novel, n - prev);
		this.host.onCountsChanged();
	}

	// ---- Vault ----------------------------------------------------------

	async onModify(file: TFile): Promise<void> {
		const path = file.path;
		if (!this.novelForPath(path)) return;
		// Open in an editor: the editor is the source of truth, and a change from
		// outside arrives there as an untagged reload.
		if (this.isOpen(path)) return;
		const text = await this.app.vault.cachedRead(file);
		this.applyText(path, text, false);
	}

	async onCreate(file: TFile): Promise<void> {
		if (!this.novelForPath(file.path)) return;
		this.applyText(file.path, await this.app.vault.cachedRead(file), false);
	}

	onDelete(path: string): void {
		for (const [view, p] of this.pending) {
			if (p.path === path) {
				p.run.cancel();
				this.pending.delete(view);
			}
		}
		this.counts.delete(path);
		this.touched.add(path);
		this.insertAt.delete(path);
		this.host.onCountsChanged();
	}

	async onRename(file: TFile, oldPath: string): Promise<void> {
		// Count waiting typing while the old path still belongs to its novel.
		for (const p of Array.from(this.pending.values())) if (p.path === oldPath) p.run.run();
		const prev = this.counts.get(oldPath);
		this.counts.delete(oldPath);
		this.touched.add(oldPath);
		for (const p of this.pending.values()) if (p.path === oldPath) p.path = file.path;
		for (const [view, path] of this.viewPath) if (path === oldPath) this.viewPath.set(view, file.path);
		if (this.novelForPath(file.path)) {
			if (prev !== undefined) {
				this.counts.set(file.path, prev);
				this.touched.add(file.path);
			}
			else {
				// An open chapter's editor may hold unsaved words already counted.
				const text = this.openEditorText(file.path) ?? (await this.app.vault.cachedRead(file));
				this.applyText(file.path, text, false);
			}
		} else {
			// Moved out of Chapters: typing still waiting there no longer counts.
			for (const [view, p] of this.pending) {
				if (p.path === file.path) {
					p.run.cancel();
					this.pending.delete(view);
				}
			}
		}
		this.host.onCountsChanged();
	}

	// ---- Helpers --------------------------------------------------------

	private isOpen(path: string): boolean {
		if (this.openEditorText(path) !== null) return true;
		for (const p of this.viewPath.values()) if (p === path) return true;
		return false;
	}

	/** Current text of the file in an open Markdown editor, or null if it isn't open. */
	private openEditorText(path: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) return view.editor.getValue();
		}
		return null;
	}
}
