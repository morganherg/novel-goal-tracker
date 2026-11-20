import { App, Modal, Setting } from 'obsidian';
import { isDateKey } from '../dates';
import type { DateKey, Novel } from '../types';

export interface AdjustmentInput {
	novel: Novel;
	date: DateKey;
	words: number;
	note: string;
}

/** Add (or remove) words for a day, for writing done outside Obsidian. */
export class AdjustWordsModal extends Modal {
	private novelId: string;
	private date: DateKey;
	private words = '';
	private note = '';
	private errorEl: HTMLElement | null = null;
	private saving = false;
	private today: DateKey;

	constructor(
		app: App,
		private novels: Novel[],
		today: DateKey,
		initialNovel: Novel | undefined,
		private onSave: (input: AdjustmentInput) => Promise<void>,
	) {
		super(app);
		this.novelId = (initialNovel ?? novels[0])?.id ?? '';
		this.date = today;
		this.today = today;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('Add words for a day');
		contentEl.createEl('p', {
			text: 'Count writing you did outside Obsidian. Use a negative number to remove words.',
		});

		if (this.novels.length > 1) {
			new Setting(contentEl).setName('Novel').addDropdown((dd) => {
				for (const n of this.novels) dd.addOption(n.id, n.title);
				dd.setValue(this.novelId).onChange((v) => (this.novelId = v));
			});
		}

		new Setting(contentEl).setName('Date').addText((t) => {
			t.inputEl.type = 'date';
			t.inputEl.max = this.today;
			t.setValue(this.date).onChange((v) => (this.date = v));
		});

		new Setting(contentEl).setName('Words').addText((t) => {
			t.inputEl.type = 'number';
			t.inputEl.step = '1';
			t.setPlaceholder('500').onChange((v) => (this.words = v));
			window.setTimeout(() => t.inputEl.focus(), 0);
		});

		new Setting(contentEl).setName('Note').setDesc('Optional.').addText((t) =>
			t.setPlaceholder('Wrote on the train').onChange((v) => (this.note = v)),
		);

		this.errorEl = contentEl.createDiv({ cls: 'ngt-wizard-error' });
		contentEl.addEventListener('input', () => this.errorEl?.setText(''));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Add words').setCta().onClick(() => void this.save()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		const novel = this.novels.find((n) => n.id === this.novelId);
		const words = Number(this.words);
		if (!novel) return this.fail('Choose a novel.');
		if (!isDateKey(this.date)) return this.fail('Enter a date.');
		if (this.date > this.today) return this.fail('Pick today or an earlier day.');
		if (!this.words.trim() || !Number.isInteger(words) || words === 0) {
			return this.fail('Enter a whole number of words, other than 0.');
		}
		if (Math.abs(words) > 1_000_000) return this.fail('Enter 1,000,000 words or fewer.');
		if (this.saving) return;
		this.saving = true;
		try {
			await this.onSave({ novel, date: this.date, words, note: this.note.trim() });
			this.close();
		} finally {
			this.saving = false;
		}
	}

	private fail(message: string): void {
		this.errorEl?.setText(message);
	}
}
