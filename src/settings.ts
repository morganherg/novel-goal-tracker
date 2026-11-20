import { App, normalizePath, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { formatKey } from './dates';
import type NovelGoalTrackerPlugin from './main';
import type { Novel } from './types';
import { ConfirmModal } from './ui/confirm-modal';

type Key = 'dayStartHour' | 'novelsFolder' | 'countCode' | 'countComments';

function hourLabel(h: number): string {
	if (h === 0) return 'Midnight (default)';
	if (h === 12) return 'Noon';
	return h < 12 ? `${h} am` : `${h - 12} pm`;
}

const TEXT = {
	dayStart: {
		name: 'Writing day starts at',
		desc: 'Words written before this hour count toward the previous day. Useful if you write past midnight.',
	},
	folder: {
		name: 'Folder for new novels',
		desc: 'Where new novel folders are created. Leave empty for the top of your vault.',
	},
	code: { name: 'Count code', desc: 'Count words inside code blocks and inline code.' },
	comments: { name: 'Count comments', desc: 'Count words inside %% comments %% and HTML comments.' },
};

function novelDesc(novel: Novel): string {
	return `${novel.goal.toLocaleString()} words, ${formatKey(novel.startDate)} to ${formatKey(novel.endDate)}. Folder: ${novel.folderPath}`;
}

/**
 * Settings, declared with getSettingDefinitions() (Obsidian 1.13+), so
 * Obsidian draws them and they show up in settings search.
 */
export class NovelGoalTrackerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: NovelGoalTrackerPlugin,
	) {
		super(app, plugin);
	}

	private hourOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (let h = 0; h <= 6; h++) options[String(h)] = hourLabel(h);
		// Keep a value set outside the usual range (e.g. by editing data.json) visible.
		const current = this.plugin.data.dayStartHour;
		if (current > 6) options[String(current)] = hourLabel(current);
		return options;
	}

	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		const data = this.plugin.data;
		// The list's onDelete gives an index into the rows drawn now; keep that list.
		const novels = [...data.novels];
		return [
			{
				...TEXT.dayStart,
				control: { type: 'dropdown', key: 'dayStartHour', options: this.hourOptions() },
			},
			{
				...TEXT.folder,
				control: { type: 'folder', key: 'novelsFolder', placeholder: 'Novels' },
			},
			{
				type: 'group',
				heading: 'Word counting',
				items: [
					{ ...TEXT.code, control: { type: 'toggle', key: 'countCode' } },
					{ ...TEXT.comments, control: { type: 'toggle', key: 'countComments' } },
				],
			},
			{
				type: 'list',
				heading: 'Novels',
				emptyState: 'No novels yet.',
				items: novels.map((novel) => ({
					name: novel.title,
					desc: this.plugin.folderMissing(novel)
						? `${novelDesc(novel)}. This folder is missing: use "Edit novel" to point to it, or stop tracking.`
						: `${novelDesc(novel)}. Select to open its dashboard.`,
					action: () => void this.plugin.openDashboard(novel),
				})),
				onDelete: (index: number) => {
					const novel = novels[index];
					if (novel) this.untrack(novel);
				},
				addItem: {
					name: 'Create new novel',
					action: () => this.plugin.openWizard(() => this.refresh()),
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		const data = this.plugin.data;
		switch (key as Key) {
			case 'dayStartHour':
				return String(data.dayStartHour);
			case 'novelsFolder':
				return data.novelsFolder;
			case 'countCode':
				return data.countOptions.code;
			case 'countComments':
				return data.countOptions.comments;
		}
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as Key) {
			case 'dayStartHour':
				await this.setDayStart(Number(value));
				return;
			case 'novelsFolder':
				await this.setNovelsFolder(typeof value === 'string' ? value : '');
				return;
			case 'countCode':
				await this.plugin.setCountRule('code', value === true);
				return;
			case 'countComments':
				await this.plugin.setCountRule('comments', value === true);
				return;
		}
	}

	private async setDayStart(hour: number): Promise<void> {
		if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
		this.plugin.data.dayStartHour = hour;
		this.plugin.touchSettings();
		await this.plugin.saveSettings();
		this.plugin.refreshDashboards();
	}

	private async setNovelsFolder(value: string): Promise<void> {
		const trimmed = value.trim();
		this.plugin.data.novelsFolder = trimmed ? normalizePath(trimmed) : '';
		this.plugin.touchSettings();
		await this.plugin.saveSettings();
	}

	/** Ask first: untracking is easy to trigger (trash icon, Delete key) and hides the novel's history. */
	private untrack(novel: Novel): void {
		new ConfirmModal(
			this.app,
			`Stop tracking "${novel.title}"?`,
			`Your files in "${novel.folderPath}" stay as they are. To track this novel again later, run "Track existing novel folder"; its history comes back with it.`,
			'Stop tracking',
			() => {
				void (async () => {
					await this.plugin.untrackNovel(novel.id);
					this.refresh();
				})();
			},
		).open();
	}

	/** Redraw after the list of novels changes. */
	private refresh(): void {
		this.update();
	}
}
