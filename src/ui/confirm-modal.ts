import { App, Modal, Setting } from 'obsidian';

/** A yes/no question with a clear consequence. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmText: string,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText(this.confirmText).onClick(() => {
					this.close();
					this.onConfirm();
				});
				b.setDestructive();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
