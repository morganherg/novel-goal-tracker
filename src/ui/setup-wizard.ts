import { App, Modal, Notice, Setting } from 'obsidian';
import {
	daysRemaining,
	formatKey,
	fromTodayWindow,
	isDateKey,
	novemberWindow,
	windowLength,
	windowPhase,
} from '../dates';
import { folderNameFromTitle, newNovelId, novelFolderPath } from '../novel-folder';
import { DEFAULT_GOAL, GENRES, type DateKey, type Novel } from '../types';

type TimeframeMode = 'november' | 'from-today' | 'custom';

interface Draft {
	title: string;
	summary: string;
	genre: string;
	goal: number;
	mode: TimeframeMode;
	fromTodayDays: number;
	customStart: DateKey;
	customEnd: DateKey;
}

export interface WizardHost {
	/** Today's writing day, honoring the "day starts at" setting. */
	todayKey(): DateKey;
	/** Parent folder for new novels ('' = vault root). */
	novelsParentFolder(): string;
	/** Create the folder, save the novel, and open its dashboard. */
	createNovel(novel: Novel, attach?: boolean): Promise<void>;
}

/** A folder that already exists, to track instead of creating a new one. */
export interface ExistingFolder {
	path: string;
	title: string;
	/** The novel id found in its Dashboard.md, to bring back its history. */
	id: string | null;
}

const STEPS = ['Title', 'Summary', 'Word goal', 'Timeframe', 'Confirm'] as const;

export class SetupWizardModal extends Modal {
	private step = 0;
	private draft: Draft;
	private errorEl: HTMLElement | null = null;
	private busy = false;

	constructor(
		app: App,
		private host: WizardHost,
		private onFinish?: () => void,
		private existing?: ExistingFolder,
	) {
		super(app);
		const today = host.todayKey();
		this.draft = {
			title: existing?.title ?? '',
			summary: '',
			genre: '',
			goal: DEFAULT_GOAL,
			mode: 'november',
			fromTodayDays: 30,
			customStart: today,
			customEnd: fromTodayWindow(today, 30).end,
		};
	}

	onOpen(): void {
		this.modalEl.addClass('ngt-wizard');
		this.scope.register([], 'Enter', (evt) => {
			// Let Enter keep its normal meaning in multi-line text and on buttons,
			// dropdowns, and links. Checked by tag name so it also works in popout windows.
			// Read tagName without instanceof, which fails for elements in popout windows.
			const tagName = (evt.target as { tagName?: unknown } | null)?.tagName;
			const tag = typeof tagName === 'string' ? tagName : '';
			if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'A') return true;
			void this.next();
			return false;
		});
		// Clear a stale validation message as soon as the writer edits anything.
		const clearError = (): void => {
			this.errorEl?.setText('');
		};
		this.contentEl.addEventListener('input', clearError);
		this.contentEl.addEventListener('change', clearError);
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onFinish?.();
	}

	private folderPath(): string {
		return this.existing?.path ?? novelFolderPath(this.draft.title, this.host.novelsParentFolder());
	}

	private window(): { start: DateKey; end: DateKey } {
		const today = this.host.todayKey();
		switch (this.draft.mode) {
			case 'november':
				return novemberWindow(today);
			case 'from-today':
				return fromTodayWindow(today, this.draft.fromTodayDays);
			case 'custom':
				return { start: this.draft.customStart, end: this.draft.customEnd };
		}
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(this.step === 0 ? 'Start a new novel' : STEPS[this.step] ?? '');
		contentEl.createDiv({
			cls: 'ngt-wizard-step',
			text: `Step ${this.step + 1} of ${STEPS.length}`,
		});

		switch (this.step) {
			case 0:
				this.renderTitle(contentEl);
				break;
			case 1:
				this.renderSummary(contentEl);
				break;
			case 2:
				this.renderGoal(contentEl);
				break;
			case 3:
				this.renderTimeframe(contentEl);
				break;
			default:
				this.renderConfirm(contentEl);
		}

		this.errorEl = contentEl.createDiv({ cls: 'ngt-wizard-error' });
		this.renderButtons(contentEl);
	}

	private renderTitle(el: HTMLElement): void {
		el.createEl('p', {
			text: 'Set a word goal and a timeframe, then write your chapters. Your dashboard updates as you go.',
		});
		new Setting(el)
			.setName('Novel title')
			.setDesc(
				this.existing
					? `Tracking the existing folder "${this.existing.path}". Its notes are kept as they are.`
					: 'This also names the novel\'s folder.',
			)
			.addText((text) => {
				text.setPlaceholder('My novel')
					.setValue(this.draft.title)
					.onChange((v) => (this.draft.title = v));
				window.setTimeout(() => text.inputEl.focus(), 0);
			});
	}

	private renderSummary(el: HTMLElement): void {
		new Setting(el)
			.setName('Summary')
			.setDesc('Optional. A few lines about your story.')
			.addTextArea((ta) => {
				ta.setValue(this.draft.summary).onChange((v) => (this.draft.summary = v));
				ta.inputEl.rows = 5;
				ta.inputEl.addClass('ngt-wizard-summary');
				window.setTimeout(() => ta.inputEl.focus(), 0);
			});
		new Setting(el)
			.setName('Genre')
			.setDesc('Optional.')
			.addDropdown((dd) => {
				for (const g of GENRES) dd.addOption(g, g === '' ? 'None' : g);
				dd.setValue(this.draft.genre).onChange((v) => (this.draft.genre = v));
			});
	}

	private renderGoal(el: HTMLElement): void {
		const hint = el.createDiv();
		const setting = new Setting(el)
			.setName('Word count goal')
			.setDesc('The total words you want to write in your timeframe.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.step = '1';
				text.setValue(String(this.draft.goal)).onChange((v) => {
					this.draft.goal = Math.floor(Number(v));
					updateHint();
				});
				window.setTimeout(() => text.inputEl.select(), 0);
			});
		setting.settingEl.after(hint);
		hint.addClass('ngt-wizard-hint');
		const updateHint = (): void => {
			const g = this.draft.goal;
			hint.setText(
				Number.isFinite(g) && g > 0
					? `That's about ${Math.ceil(g / 30).toLocaleString()} words a day over 30 days.`
					: '',
			);
		};
		updateHint();
	}

	private renderTimeframe(el: HTMLElement): void {
		const today = this.host.todayKey();
		el.createEl('p', { text: `Today is ${formatKey(today)}.` });
		const details = el.createDiv();

		new Setting(el)
			.setName('Timeframe')
			.addDropdown((dd) => {
				const nov = novemberWindow(today);
				dd.addOption('november', `November ${nov.start.slice(0, 4)}`);
				dd.addOption('from-today', 'Starting today');
				dd.addOption('custom', 'Custom dates');
				dd.setValue(this.draft.mode).onChange((v) => {
					this.draft.mode = v as TimeframeMode;
					renderDetails();
				});
			})
			.settingEl.after(details);

		const summary = el.createDiv({ cls: 'ngt-wizard-hint' });
		details.after(summary);

		const updateSummary = (): void => {
			summary.setText(this.windowSummary());
		};

		const renderDetails = (): void => {
			details.empty();
			if (this.draft.mode === 'from-today') {
				new Setting(details).setName('Number of days').addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.min = '1';
					text.setValue(String(this.draft.fromTodayDays)).onChange((v) => {
						this.draft.fromTodayDays = Math.floor(Number(v));
						updateSummary();
					});
				});
			} else if (this.draft.mode === 'custom') {
				new Setting(details).setName('Start date').addText((text) => {
					text.inputEl.type = 'date';
					text.setValue(this.draft.customStart).onChange((v) => {
						this.draft.customStart = v;
						updateSummary();
					});
				});
				new Setting(details).setName('Last day of writing').addText((text) => {
					text.inputEl.type = 'date';
					text.setValue(this.draft.customEnd).onChange((v) => {
						this.draft.customEnd = v;
						updateSummary();
					});
				});
			}
			updateSummary();
		};
		renderDetails();
	}

	private windowSummary(): string {
		const err = this.validateTimeframe();
		if (err) return '';
		const { start, end } = this.window();
		const today = this.host.todayKey();
		const len = windowLength(start, end);
		const goal = this.draft.goal;
		const base = `${formatKey(start)} to ${formatKey(end)}: ${len} ${len === 1 ? 'day' : 'days'}, ${Math.ceil(goal / len).toLocaleString()} words a day.`;
		if (windowPhase(today, start, end) === 'during' && start !== today) {
			const left = daysRemaining(today, start, end);
			return `${base} It has already started: ${left} ${left === 1 ? 'day' : 'days'} left including today, ${Math.ceil(goal / left).toLocaleString()} words a day from now.`;
		}
		return base;
	}

	private renderConfirm(el: HTMLElement): void {
		const { start, end } = this.window();
		const len = windowLength(start, end);
		const rows: [string, string][] = [
			['Title', this.draft.title.trim()],
			['Folder', this.folderPath()],
			['Genre', this.draft.genre || 'None'],
			['Word goal', this.draft.goal.toLocaleString()],
			['Timeframe', `${formatKey(start)} to ${formatKey(end)} (${len} ${len === 1 ? 'day' : 'days'})`],
			['Daily target', `${this.dailyWords(start, end).toLocaleString()} words`],
		];
		const table = el.createDiv({ cls: 'ngt-wizard-confirm' });
		for (const [label, value] of rows) {
			table.createDiv({ cls: 'ngt-wizard-confirm-label', text: label });
			table.createDiv({ cls: 'ngt-wizard-confirm-value', text: value });
		}
		if (this.draft.summary.trim()) {
			el.createEl('p', { cls: 'ngt-wizard-confirm-summary', text: this.draft.summary.trim() });
		}
	}

	/** Words a day needed from today (or from the start date, if it is still ahead). */
	private dailyWords(start: DateKey, end: DateKey): number {
		const left = daysRemaining(this.host.todayKey(), start, end);
		return Math.ceil(this.draft.goal / Math.max(1, left));
	}

	private renderButtons(el: HTMLElement): void {
		const setting = new Setting(el);
		if (this.step > 0) {
			setting.addButton((b) =>
				b.setButtonText('Back').onClick(() => {
					this.step--;
					this.render();
				}),
			);
		}
		const last = this.step === STEPS.length - 1;
		setting.addButton((b) =>
			b
				.setButtonText(last ? 'Create novel' : 'Next')
				.setCta()
				.onClick(() => void this.next()),
		);
	}

	private validateTimeframe(): string | null {
		if (this.draft.mode === 'from-today') {
			const n = this.draft.fromTodayDays;
			if (!Number.isFinite(n) || n < 1 || n > 3650) return 'Enter a number of days from 1 to 3,650.';
		}
		if (this.draft.mode === 'custom') {
			const { customStart: s, customEnd: e } = this.draft;
			if (!isDateKey(s) || !isDateKey(e)) return 'Enter both dates.';
			if (windowLength(s, e) < 1) return 'The last day can\'t be before the start date.';
			if (windowLength(s, e) > 3650) return 'Pick a timeframe of 10 years or less.';
		}
		const { start, end } = this.window();
		if (windowPhase(this.host.todayKey(), start, end) === 'after') {
			return 'That timeframe has already ended. Pick dates that include today or later.';
		}
		return null;
	}

	private validate(): string | null {
		switch (this.step) {
			case 0: {
				if (!this.draft.title.trim()) return 'Enter a title.';
				if (!folderNameFromTitle(this.draft.title)) {
					return 'Use at least one letter or number in the title.';
				}
				if (this.existing) return null;
				const path = this.folderPath();
				if (this.app.vault.getAbstractFileByPath(path)) {
					return `"${path}" already exists in your vault. Choose another title, or run "Track existing novel folder" to track it.`;
				}
				return null;
			}
			case 2: {
				const g = this.draft.goal;
				if (!Number.isFinite(g) || g < 1) return 'Enter a goal of at least 1 word.';
				if (g > 10_000_000) return 'Enter a goal of 10,000,000 words or fewer.';
				return null;
			}
			case 3:
				return this.validateTimeframe();
			default:
				return null;
		}
	}

	private async next(): Promise<void> {
		if (this.busy) return;
		const error = this.validate();
		if (error) {
			this.errorEl?.setText(error);
			return;
		}
		if (this.step < STEPS.length - 1) {
			this.step++;
			this.render();
			return;
		}
		this.busy = true;
		const { start, end } = this.window();
		const novel: Novel = {
			id: this.existing?.id ?? newNovelId(),
			title: this.draft.title.trim(),
			summary: this.draft.summary.trim(),
			genre: this.draft.genre,
			goal: this.draft.goal,
			startDate: start,
			endDate: end,
			folderPath: this.folderPath(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		try {
			await this.host.createNovel(novel, this.existing !== undefined);
			new Notice(`Created "${novel.title}". Happy writing!`);
			this.close();
		} catch (e) {
			this.errorEl?.setText(e instanceof Error ? e.message : 'Could not create the novel.');
		} finally {
			this.busy = false;
		}
	}
}
