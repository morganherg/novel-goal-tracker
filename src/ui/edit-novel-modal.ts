import { App, Modal, normalizePath, Setting } from 'obsidian';
import { isDateKey, windowLength } from '../dates';
import { GENRES, type Novel } from '../types';

export type NovelEdits = Pick<Novel, 'title' | 'summary' | 'genre' | 'goal' | 'startDate' | 'endDate' | 'folderPath'>;

/** Change a novel's title, summary, genre, goal, or dates. */
export class EditNovelModal extends Modal {
	private draft: NovelEdits;
	private goalText: string;
	private errorEl: HTMLElement | null = null;
	private saving = false;

	constructor(
		app: App,
		private novel: Novel,
		private onSave: (edits: NovelEdits) => Promise<void>,
	) {
		super(app);
		this.draft = {
			title: novel.title,
			summary: novel.summary,
			genre: novel.genre,
			goal: novel.goal,
			startDate: novel.startDate,
			endDate: novel.endDate,
			folderPath: novel.folderPath,
		};
		this.goalText = String(novel.goal);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('Edit novel');

		new Setting(contentEl)
			.setName('Title')
			.setDesc('Changing the title doesn\'t rename the folder.')
			.addText((t) => t.setValue(this.draft.title).onChange((v) => (this.draft.title = v)));
		new Setting(contentEl).setName('Summary').addTextArea((t) => {
			t.setValue(this.draft.summary).onChange((v) => (this.draft.summary = v));
			t.inputEl.rows = 4;
			t.inputEl.addClass('ngt-wizard-summary');
		});
		new Setting(contentEl).setName('Genre').addDropdown((dd) => {
			for (const g of GENRES) dd.addOption(g, g === '' ? 'None' : g);
			if (!GENRES.includes(this.draft.genre)) dd.addOption(this.draft.genre, this.draft.genre);
			dd.setValue(this.draft.genre).onChange((v) => (this.draft.genre = v));
		});
		new Setting(contentEl).setName('Word count goal').addText((t) => {
			t.inputEl.type = 'number';
			t.inputEl.min = '1';
			t.setValue(this.goalText).onChange((v) => (this.goalText = v));
		});
		new Setting(contentEl).setName('Start date').addText((t) => {
			t.inputEl.type = 'date';
			t.setValue(this.draft.startDate).onChange((v) => (this.draft.startDate = v));
		});
		new Setting(contentEl).setName('Last day of writing').addText((t) => {
			t.inputEl.type = 'date';
			t.setValue(this.draft.endDate).onChange((v) => (this.draft.endDate = v));
		});

		new Setting(contentEl)
			.setName('Folder')
			.setDesc('The folder holding Dashboard.md and Chapters. Change it if you moved or renamed the folder outside Obsidian.')
			.addText((t) => t.setValue(this.draft.folderPath).onChange((v) => (this.draft.folderPath = v)));

		this.errorEl = contentEl.createDiv({ cls: 'ngt-wizard-error' });
		contentEl.addEventListener('input', () => this.errorEl?.setText(''));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Save').setCta().onClick(() => void this.save()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		const goal = Number(this.goalText);
		const { startDate, endDate } = this.draft;
		if (!this.draft.title.trim()) return this.fail('Enter a title.');
		const folder = normalizePath(this.draft.folderPath.trim());
		if (!this.app.vault.getFolderByPath(folder)) return this.fail(`There's no folder "${folder}" in your vault.`);
		if (!Number.isInteger(goal) || goal < 1 || goal > 10_000_000) {
			return this.fail('Enter a goal from 1 to 10,000,000 words.');
		}
		if (!isDateKey(startDate) || !isDateKey(endDate)) return this.fail('Enter both dates.');
		const len = windowLength(startDate, endDate);
		if (len < 1) return this.fail('The last day can\'t be before the start date.');
		if (len > 3650) return this.fail('Pick a timeframe of 10 years or less.');
		if (this.saving) return;
		this.saving = true;
		try {
			await this.onSave({
				...this.draft,
				title: this.draft.title.trim(),
				summary: this.draft.summary.trim(),
				goal,
				folderPath: folder,
			});
			this.close();
		} finally {
			this.saving = false;
		}
	}

	private fail(message: string): void {
		this.errorEl?.setText(message);
	}
}
