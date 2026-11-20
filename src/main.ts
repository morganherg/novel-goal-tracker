import {
	debounce,
	MarkdownRenderChild,
	Menu,
	normalizePath,
	Notice,
	Plugin,
	TFile,
	TFolder,
	Vault,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import type { CountRules } from './count';
import { applyFolderRename, laterStamp, mergeForSave, normalizeData } from './data';
import { writingDayKey } from './dates';
import {
	adjustmentsFor,
	adjustmentTotal,
	computeStats,
	dailyTotals,
	emptyDevice,
	hourTotals,
	recordDelta,
	type DeviceHistory,
	type NovelStats,
} from './history';
import { progressLog, progressSeries } from './series';
import {
	chaptersPath,
	createNovelFolder,
	dashboardPath,
	ensureNovelFiles,
	newNovelId,
	nextChapterName,
	parseDashboardSource,
} from './novel-folder';
import { NovelGoalTrackerSettingTab } from './settings';
import { editorPathForEvent, trackerExtension } from './editor-extension';
import { Tracker } from './tracker';
import {
	CHAPTERS_FOLDER,
	DASHBOARD_BLOCK,
	DASHBOARD_FILE,
	DEFAULT_DATA,
	type CountOptions,
	type DateKey,
	type Novel,
	type PluginData,
} from './types';
import { AdjustWordsModal } from './ui/adjust-modal';
import {
	isNarrow,
	renderDashboard,
	renderDashboardError,
	type ChapterLink,
	type DashboardData,
} from './ui/dashboard-block';
import { DASHBOARD_VIEW, DashboardView } from './ui/dashboard-view';
import { EditNovelModal } from './ui/edit-novel-modal';
import { FolderPickerModal, NovelPickerModal } from './ui/novel-picker';
import { SetupWizardModal, type WizardHost } from './ui/setup-wizard';

const DEVICE_KEY = 'novel-goal-tracker-device-id';

/** A rendered dashboard code block, re-drawn when data changes. */
class DashboardBlock extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private plugin: NovelGoalTrackerPlugin,
		private source: string,
		private sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.dashboards.add(this);
		this.draw();
		// Redraw when the note's width crosses the narrow-layout threshold.
		let wasNarrow = isNarrow(this.containerEl);
		const ro = new ResizeObserver(() => {
			const now = isNarrow(this.containerEl);
			if (now !== wasNarrow) {
				wasNarrow = now;
				this.draw();
			}
		});
		ro.observe(this.containerEl);
		this.register(() => ro.disconnect());
	}

	onunload(): void {
		this.plugin.dashboards.delete(this);
	}

	draw(): void {
		const novel = this.plugin.findNovelForBlock(this.source, this.sourcePath);
		if (!novel) {
			renderDashboardError(
				this.containerEl,
				'This dashboard isn\'t linked to a tracked novel. Run "Create new novel" to set one up.',
			);
			return;
		}
		this.plugin.drawDashboard(this.containerEl, novel, () => this.draw());
	}
}

export default class NovelGoalTrackerPlugin extends Plugin implements WizardHost {
	data: PluginData = JSON.parse(JSON.stringify(DEFAULT_DATA)) as PluginData;
	readonly dashboards = new Set<DashboardBlock>();
	tracker!: Tracker;
	private deviceId = '';
	private lastDayKey: DateKey = '';
	private statusEl: HTMLElement | null = null;
	private saveChain: Promise<void> = Promise.resolve();
	/** True until this device has real data (its own or synced); its defaults never override synced settings. */
	private freshInstall = false;
	/** Documents (main window and popouts) already watched for paste, drop, and cut. */
	private watchedDocs = new WeakSet<Document>();

	/** Save at most every 2 seconds while writing. */
	private queueSave = debounce(() => void this.saveSettings(), 2000, false);
	/** Redraw dashboards and the status bar at most a few times a second. */
	private queueRefresh = debounce(() => this.refreshDashboards(), 250, false);

	async onload(): Promise<void> {
		this.deviceId = this.loadDeviceId();
		const raw: unknown = await this.loadData();
		this.freshInstall = raw === null || typeof raw !== 'object';
		this.data = normalizeData(raw);
		this.lastDayKey = this.todayKey();

		this.tracker = new Tracker(this.app, {
			novels: () => this.data.novels,
			countRules: () => this.countRules(),
			chapterFiles: (novel) => this.chapterFiles(novel),
			onTyped: (novel, delta) => this.recordTyping(novel, delta),
			onCountsChanged: () => this.queueRefresh(),
		});

		this.addSettingTab(new NovelGoalTrackerSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor(
			DASHBOARD_BLOCK,
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				ctx.addChild(new DashboardBlock(el, this, source, ctx.sourcePath));
			},
		);

		this.addCommand({ id: 'create-novel', name: 'Create new novel', callback: () => this.openWizard() });
		this.addCommand({
			id: 'open-dashboard',
			name: 'Open novel dashboard',
			callback: () => this.pickAndOpenDashboard(),
		});
		this.addCommand({
			id: 'add-words',
			name: 'Add words for a day',
			callback: () => this.openAdjustModal(this.activeNovel()),
		});
		this.addCommand({
			id: 'open-dashboard-side',
			name: 'Open novel dashboard in side pane',
			callback: () => void this.openDashboardView(),
		});
		this.addCommand({
			id: 'track-existing-folder',
			name: 'Track existing novel folder',
			callback: () => this.trackExistingFolder(),
		});
		this.addCommand({
			id: 'edit-novel',
			name: 'Edit novel',
			callback: () => {
				const novel = this.activeNovel() ?? (this.data.novels.length === 1 ? this.data.novels[0] : undefined);
				if (novel) this.openEditModal(novel);
				else if (this.data.novels.length === 0) new Notice('Create a novel first.');
				else new NovelPickerModal(this.app, this.data.novels, (n) => this.openEditModal(n)).open();
			},
		});
		// One place to find everything: each novel's dashboard, and new novels.
		this.addRibbonIcon('book-open', 'Novels', (evt) => this.showNovelsMenu(evt));

		this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, {
			novels: () => this.data.novels,
			activeNovel: () => this.activeNovel(),
			drawDashboard: (el, novel, redraw) => this.drawDashboard(el, novel, redraw),
		}));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass('ngt-status');

		// Typing: the only thing that counts toward today's words.
		this.registerEditorExtension(trackerExtension(this.tracker));
		// Pastes, drops, and cuts are the writer's own edits, but Obsidian applies
		// them itself without CodeMirror's user-input tag. Watch for them before
		// anything handles them (capture phase), in every window. Only watched;
		// never handled or cancelled.
		this.watchInserts(document);
		this.registerEvent(this.app.workspace.on('window-open', (_w, win) => this.watchInserts(win.document)));
		// Popout windows already open when the plugin loads.
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.iterateAllLeaves((leaf) => this.watchInserts(leaf.view.containerEl.doc));
		});
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateStatusBar()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.updateStatusBar()));

		// Keep novel folder paths correct when a writer renames or moves a folder.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFolder)) return;
				this.tracker.flush(); // count waiting typing under the old paths first
				if (applyFolderRename(this.data.novels, oldPath, file.path, new Date().toISOString())) {
					void this.saveSettings();
					void this.tracker.rescan();
				}
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			// Registered after load so startup doesn't fire a "create" per file.
			this.registerEvent(
				this.app.vault.on('modify', (f) => {
					if (f instanceof TFile) void this.tracker.onModify(f);
				}),
			);
			this.registerEvent(
				this.app.vault.on('create', (f) => {
					if (f instanceof TFile) void this.tracker.onCreate(f);
					this.queueRefresh();
				}),
			);
			this.registerEvent(
				this.app.vault.on('delete', (f) => {
					this.tracker.onDelete(f.path);
					if (f instanceof TFolder) void this.onFolderDeleted(f.path);
					this.queueRefresh();
				}),
			);
			this.registerEvent(
				this.app.vault.on('rename', (f, oldPath) => {
					if (f instanceof TFile) void this.tracker.onRename(f, oldPath);
					this.queueRefresh();
				}),
			);
			void this.tracker.scanAll(false);

			if (!this.data.hasOnboarded && this.data.novels.length === 0) this.openWizard();
		});

		// Save pending words when the app is hidden (mobile can be suspended any time).
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.flushNow();
		});

		// Redraw when the writing day rolls over while Obsidian stays open.
		this.registerInterval(
			window.setInterval(() => {
				const today = this.todayKey();
				if (today !== this.lastDayKey) {
					this.lastDayKey = today;
					this.refreshDashboards();
				}
			}, 60_000),
		);
	}

	private watchInserts(doc: Document): void {
		if (this.watchedDocs.has(doc)) return;
		this.watchedDocs.add(doc);
		const mark = (evt: Event): void => {
			const path = editorPathForEvent(evt);
			if (path) this.tracker.markUserInsert(path);
		};
		this.registerDomEvent(doc, 'paste', mark, { capture: true });
		this.registerDomEvent(doc, 'drop', mark, { capture: true });
		this.registerDomEvent(doc, 'cut', mark, { capture: true });
	}

	onunload(): void {
		this.tracker.stop();
		this.queueSave.cancel();
		this.queueRefresh.cancel();
		void this.saveSettings();
	}

	/** Another device changed data.json through sync. */
	async onExternalSettingsChange(): Promise<void> {
		if (!this.tracker) return;
		const disk = normalizeData(await this.loadData());
		await this.mergeIn(disk);
		// If memory holds anything the synced file lacks (this device's history,
		// novels, newer settings), write it back now so a restart can't lose it.
		if (JSON.stringify(this.data) !== JSON.stringify(disk)) await this.saveSettings();
		this.refreshDashboards();
	}

	/** What decides each chapter's count: the novels tracked and the counting rules. */
	private countingKey(): string {
		const novels = this.data.novels.map((n) => `${n.id}:${n.folderPath}`).join('|');
		return `${novels}#${this.data.countOptions.code}${this.data.countOptions.comments}`;
	}

	/** Merge data from disk into memory, recounting if novels or rules changed. */
	private async mergeIn(disk: PluginData): Promise<void> {
		// Count waiting typing under the current rules before anything changes.
		this.tracker.flush();
		const before = this.countingKey();
		Object.assign(this.data, mergeForSave(this.data, disk, this.deviceId, this.freshInstall));
		if (disk.novels.length > 0 || Object.keys(disk.history).length > 0 || disk.settingsUpdatedAt) {
			this.freshInstall = false;
		}
		if (this.countingKey() !== before) await this.tracker.rescan();
	}

	/** Change a counting rule: count waiting typing first, then recount everything. */
	async setCountRule(key: keyof CountOptions, value: boolean): Promise<void> {
		this.tracker.flush();
		this.data.countOptions[key] = value;
		this.touchSettings();
		await this.saveSettings();
		await this.tracker.rescan();
	}

	/** Mark settings as changed now, so this device's settings win on sync. */
	touchSettings(): void {
		this.freshInstall = false;
		this.data.settingsUpdatedAt = laterStamp(new Date().toISOString(), this.data.settingsUpdatedAt);
	}

	// ---- Data -----------------------------------------------------------

	/**
	 * Save without losing other devices' changes: re-read data.json, merge, write.
	 * Saves run one at a time.
	 */
	saveSettings(): Promise<void> {
		this.saveChain = this.saveChain
			.then(async () => {
				const disk = normalizeData(await this.loadData());
				await this.mergeIn(disk);
				await this.saveData(this.data);
			})
			.catch((e: unknown) => console.error('Novel Goal Tracker: could not save', e));
		return this.saveChain;
	}

	private flushNow(): void {
		this.tracker.flush();
		this.queueSave.cancel();
		void this.saveSettings();
	}

	/** A random id for this device, kept in this vault's local storage (not synced). */
	private loadDeviceId(): string {
		const stored: unknown = this.app.loadLocalStorage(DEVICE_KEY);
		if (typeof stored === 'string' && stored) return stored;
		const id = 'device-' + newNovelId();
		this.app.saveLocalStorage(DEVICE_KEY, id);
		return id;
	}

	private myHistory(): DeviceHistory {
		return (this.data.history[this.deviceId] ??= emptyDevice());
	}

	countRules(): CountRules {
		return { ...this.data.countOptions };
	}

	private recordTyping(novel: Novel, delta: number): void {
		const now = new Date();
		recordDelta(this.myHistory(), novel.id, this.todayKey(), now.getHours(), delta, now.toISOString());
		this.queueSave();
		this.queueRefresh();
	}

	todayKey(): DateKey {
		return writingDayKey(new Date(), this.data.dayStartHour);
	}

	novelsParentFolder(): string {
		return this.data.novelsFolder;
	}

	statsFor(novel: Novel): NovelStats | null {
		if (!this.tracker.ready) return null;
		const current = this.tracker.novelWords(novel) + adjustmentTotal(this.data.history, novel.id);
		return computeStats(
			novel,
			this.todayKey(),
			current,
			dailyTotals(this.data.history, novel.id, 'typed'),
			dailyTotals(this.data.history, novel.id, 'net'),
		);
	}

	// ---- Novels ---------------------------------------------------------

	/** Track a folder that already holds a novel (after "Stop tracking", or one made by hand). */
	trackExistingFolder(onClose?: () => void): void {
		const tracked = new Set(this.data.novels.map((n) => n.folderPath));
		const folders: TFolder[] = [];
		Vault.recurseChildren(this.app.vault.getRoot(), (f) => {
			if (f instanceof TFolder && !tracked.has(f.path) && f.children.some((c) => c instanceof TFolder && c.name === CHAPTERS_FOLDER)) {
				folders.push(f);
			}
		});
		if (folders.length === 0) {
			new Notice('No untracked novel folders were found. A novel folder has a chapters folder inside.');
			return;
		}
		new FolderPickerModal(this.app, folders, (folder) => void this.attachFolder(folder, onClose)).open();
	}

	private async attachFolder(folder: TFolder, onClose?: () => void): Promise<void> {
		// Reuse the novel's old id from its Dashboard.md, so its history comes back.
		const dash = this.app.vault.getFileByPath(normalizePath(`${folder.path}/${DASHBOARD_FILE}`));
		const oldId = dash ? parseDashboardSource(await this.app.vault.cachedRead(dash)).novelId : null;
		const id = oldId && !this.data.novels.some((n) => n.id === oldId) ? oldId : null;
		new SetupWizardModal(this.app, this, () => onClose?.(), { path: folder.path, title: folder.name, id }).open();
	}

	openWizard(onClose?: () => void): void {
		new SetupWizardModal(this.app, this, () => {
			if (!this.data.hasOnboarded) {
				this.data.hasOnboarded = true;
				void this.saveSettings();
			}
			onClose?.();
		}).open();
	}

	async createNovel(novel: Novel, attach = false): Promise<void> {
		if (attach) {
			// Track a folder that already exists: add whatever is missing, touch nothing else.
			await ensureNovelFiles(this.app, novel);
			// Coming back after "Stop tracking": newer than the removal, so sync keeps it.
			novel.updatedAt = laterStamp(novel.updatedAt, this.data.removedNovels[novel.id] ?? '');
		} else {
			const parent = this.data.novelsFolder;
			if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
				await this.app.vault.createFolder(parent);
			}
			await createNovelFolder(this.app, novel);
		}
		this.data.novels.push(novel);
		this.data.hasOnboarded = true;
		await this.saveSettings();
		await this.tracker.rescan();
		await this.openDashboard(novel);
	}

	async untrackNovel(id: string): Promise<void> {
		this.data.novels = this.data.novels.filter((n) => n.id !== id);
		this.data.removedNovels[id] = new Date().toISOString();
		await this.saveSettings();
		await this.tracker.rescan();
		this.refreshDashboards();
	}

	openAdjustModal(initial: Novel | undefined): void {
		if (this.data.novels.length === 0) {
			new Notice('Create a novel first.');
			return;
		}
		new AdjustWordsModal(this.app, this.data.novels, this.todayKey(), initial, async (input) => {
			this.myHistory().adjustments.push({
				id: newNovelId(),
				novelId: input.novel.id,
				date: input.date,
				words: input.words,
				note: input.note,
				createdAt: new Date().toISOString(),
			});
			await this.saveSettings();
			this.refreshDashboards();
			new Notice(`Added ${input.words.toLocaleString()} words to ${input.novel.title}.`);
		}).open();
	}

	/** The novel whose chapter or dashboard is open in the active editor or view. */
	activeNovel(): Novel | undefined {
		const file = this.app.workspace.getActiveFile();
		if (!file) return undefined;
		return (
			this.tracker.novelForPath(file.path) ??
			this.data.novels.find((n) => dashboardPath(n) === file.path)
		);
	}

	/** The novel's folder no longer exists (deleted or moved outside Obsidian). */
	folderMissing(novel: Novel): boolean {
		return !this.app.vault.getFolderByPath(novel.folderPath);
	}

	/** A novel's folder was deleted inside Obsidian: stop tracking it, and say how to undo. */
	private async onFolderDeleted(path: string): Promise<void> {
		const gone = this.data.novels.filter((n) => n.folderPath === path || n.folderPath.startsWith(path + '/'));
		for (const novel of gone) {
			await this.untrackNovel(novel.id);
			new Notice(
				`Stopped tracking "${novel.title}" because its folder was deleted. If you restore the folder, run "Track existing novel folder" to bring it back with its history.`,
				10_000,
			);
		}
	}

	private showNovelsMenu(evt: MouseEvent): void {
		const menu = new Menu();
		for (const novel of this.data.novels) {
			const missing = this.folderMissing(novel);
			menu.addItem((item) =>
				item
					.setTitle(missing ? `${novel.title} (folder missing)` : novel.title)
					.setIcon('layout-dashboard')
					.onClick(() => void this.openDashboard(novel)),
			);
		}
		if (this.data.novels.length > 0) menu.addSeparator();
		// Dialogs open once the menu has closed: Obsidian doesn't show a modal
		// while a menu is still open.
		let afterClose: (() => void) | null = null;
		menu.onHide(() => {
			const run = afterClose;
			afterClose = null;
			if (run) window.setTimeout(run, 0);
		});
		const later = (fn: () => void) => () => {
			afterClose = fn;
		};
		menu.addItem((item) =>
			item
				.setTitle('Create new novel')
				.setIcon('plus')
				.onClick(later(() => this.openWizard())),
		);
		menu.addItem((item) =>
			item
				.setTitle('Track existing novel folder')
				.setIcon('folder-open')
				.onClick(later(() => this.trackExistingFolder())),
		);
		menu.showAtMouseEvent(evt);
	}

	async openDashboard(novel: Novel): Promise<void> {
		if (this.folderMissing(novel)) {
			new Notice(
				`The folder "${novel.folderPath}" for "${novel.title}" is missing. If you moved it, use "Edit novel" to point to its new place; otherwise stop tracking it in settings.`,
				10_000,
			);
			return;
		}
		let file = this.app.vault.getFileByPath(dashboardPath(novel));
		if (!(file instanceof TFile)) {
			// Dashboard.md was deleted: make a new one.
			await ensureNovelFiles(this.app, novel);
			file = this.app.vault.getFileByPath(dashboardPath(novel));
			if (!(file instanceof TFile)) return;
		}
		// Reading view, so the dashboard shows instead of its code block source.
		await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: 'preview' } });
	}

	/** Open a chapter ready to write in (editing mode, even if the pane was in reading view). */
	async openPath(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
	}

	/** Markdown files under the novel's Chapters folder, in natural name order. */
	chapterFiles(novel: Novel): TFile[] {
		const folder = this.app.vault.getFolderByPath(chaptersPath(novel));
		if (!folder) return [];
		const files: TFile[] = [];
		Vault.recurseChildren(folder, (f) => {
			if (f instanceof TFile && f.extension === 'md') files.push(f);
		});
		return files.sort((a, b) =>
			a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }),
		);
	}

	chapterLinks(novel: Novel): ChapterLink[] {
		const base = chaptersPath(novel) + '/';
		return this.chapterFiles(novel).map((f) => ({
			name: f.path.startsWith(base) ? f.path.slice(base.length, -3) : f.basename,
			path: f.path,
			words: this.tracker.chapterWords(f.path),
		}));
	}

	async newChapter(novel: Novel): Promise<void> {
		const folderPath = chaptersPath(novel);
		if (!this.app.vault.getFolderByPath(folderPath)) await this.app.vault.createFolder(folderPath);
		const name = nextChapterName(this.chapterFiles(novel).map((f) => f.basename));
		const file = await this.app.vault.create(normalizePath(`${folderPath}/${name}.md`), '');
		await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
	}

	private pickAndOpenDashboard(): void {
		const novels = this.data.novels;
		if (novels.length === 0) {
			this.openWizard();
			return;
		}
		const only = novels.length === 1 ? novels[0] : undefined;
		if (only) {
			void this.openDashboard(only);
			return;
		}
		new NovelPickerModal(this.app, novels, (n) => void this.openDashboard(n)).open();
	}

	/** Match a dashboard block to its novel: by id first, then by the note's folder. */
	findNovelForBlock(source: string, sourcePath: string): Novel | undefined {
		const { novelId } = parseDashboardSource(source);
		const byId = novelId ? this.data.novels.find((n) => n.id === novelId) : undefined;
		if (byId) return byId;
		const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
		return this.data.novels.find((n) => n.folderPath === folder);
	}

	// ---- Display --------------------------------------------------------

	refreshDashboards(): void {
		for (const d of this.dashboards) d.draw();
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) {
			if (leaf.view instanceof DashboardView) leaf.view.draw();
		}
		this.updateStatusBar();
	}

	/** Everything a dashboard shows for a novel. */
	dashboardData(novel: Novel): DashboardData {
		const today = this.todayKey();
		const stats = this.statsFor(novel);
		const net = dailyTotals(this.data.history, novel.id, 'net');
		const typed = dailyTotals(this.data.history, novel.id, 'typed');
		const typedOnly = dailyTotals(
			Object.fromEntries(
				Object.entries(this.data.history).map(([id, dev]) => [id, { ...dev, adjustments: [] }]),
			),
			novel.id,
		);
		return {
			novel,
			today,
			stats,
			series: stats ? progressSeries(novel, today, stats.current, net, typed) : null,
			hours: hourTotals(this.data.history, novel.id),
			log: progressLog(typedOnly, adjustmentsFor(this.data.history, novel.id)),
			chapters: this.chapterLinks(novel),
			added: adjustmentTotal(this.data.history, novel.id),
		};
	}

	drawDashboard(el: HTMLElement, novel: Novel, redraw: () => void): void {
		try {
			this.renderDashboardInto(el, novel, redraw);
		} catch (e) {
			// Show what went wrong in the note itself, so it can be reported.
			console.error('Novel Goal Tracker: could not draw the dashboard', e);
			const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
			renderDashboardError(el, `The dashboard couldn't be drawn. Error: ${message}`);
		}
	}

	private renderDashboardInto(el: HTMLElement, novel: Novel, redraw: () => void): void {
		renderDashboard(el, this.dashboardData(novel), {
			openChapter: (path) => void this.openPath(path),
			newChapter: () => void this.newChapter(novel),
			addWords: () => this.openAdjustModal(novel),
			editNovel: () => this.openEditModal(novel),
			deleteAdjustment: (id) => void this.deleteAdjustment(id),
			redraw,
		});
	}

	async openDashboardView(): Promise<void> {
		const active = this.activeNovel();
		const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		if (!existing) {
			await leaf.setViewState({ type: DASHBOARD_VIEW, active: true, state: { novelId: active?.id ?? null } });
		} else {
			await leaf.loadIfDeferred();
			// Switch to the novel being written, if any.
			if (active && leaf.view instanceof DashboardView) leaf.view.showNovel(active.id);
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	openEditModal(novel: Novel): void {
		new EditNovelModal(this.app, novel, async (edits) => {
			const target = this.data.novels.find((n) => n.id === novel.id);
			if (!target) return;
			const movedFolder = edits.folderPath !== target.folderPath;
			Object.assign(target, edits);
			target.updatedAt = laterStamp(new Date().toISOString(), target.updatedAt);
			await this.saveSettings();
			if (movedFolder) await this.tracker.rescan();
			this.refreshDashboards();
		}).open();
	}

	private async deleteAdjustment(id: string): Promise<void> {
		const mine = this.myHistory();
		if (!mine.deletedAdjustments.includes(id)) mine.deletedAdjustments.push(id);
		// Our own entries can simply go; others' are hidden by the deletion list.
		mine.adjustments = mine.adjustments.filter((a) => a.id !== id);
		await this.saveSettings();
		this.refreshDashboards();
	}

	private updateStatusBar(): void {
		const el = this.statusEl;
		if (!el) return;
		const novel = this.activeNovel();
		const stats = novel ? this.statsFor(novel) : null;
		if (!novel || !stats) {
			el.setText('');
			el.toggleClass('ngt-hidden', true);
			return;
		}
		el.toggleClass('ngt-hidden', false);
		el.setText(
			`${stats.today.toLocaleString()} today · ${stats.current.toLocaleString()} / ${stats.goal.toLocaleString()} words`,
		);
	}
}
