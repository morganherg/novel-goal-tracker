import { App, FuzzySuggestModal, type TFolder } from 'obsidian';
import type { Novel } from '../types';

export class NovelPickerModal extends FuzzySuggestModal<Novel> {
	constructor(
		app: App,
		private novels: Novel[],
		private onPick: (novel: Novel) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a novel');
	}

	getItems(): Novel[] {
		return this.novels;
	}

	getItemText(novel: Novel): string {
		return novel.title;
	}

	onChooseItem(novel: Novel): void {
		this.onPick(novel);
	}
}

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private folders: TFolder[],
		private onPick: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder('Choose the novel folder to track');
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}
